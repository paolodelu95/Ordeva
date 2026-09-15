//! /api/ordini — ordini cliente/fornitore con conversione in DDT. Parità con routes/ordini.js.
//! Nota: la conversione ordine→DDT NON movimenta il magazzino (come Node).

use std::collections::HashMap;

use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde_json::{json, Value};

use crate::audit::audit;
use crate::db::AppState;
use crate::error::{ApiError, ApiResult};
use crate::numerazione::get_next_numero;
use crate::web::{num, oggi, opt_num, raw_opt, str_def, tenant_conn};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/count-aperti", get(count_aperti))
        .route("/:id", get(detail).put(update).delete(remove))
        .route("/:id/print", get(print))
        .route("/:id/stato", axum::routing::patch(patch_stato))
        .route("/:id/acquisto", axum::routing::patch(patch_acquisto))
        .route("/:id/to-ddt", axum::routing::post(to_ddt))
}

async fn list(
    State(state): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let tipo = q.get("tipo").filter(|s| !s.is_empty()).cloned();
    let where_ = if tipo.is_some() { "WHERE o.tipo = ?1 " } else { "" };
    let sql = format!(
        "SELECT o.*, c.ragione_sociale as cliente_nome, f.ragione_sociale as fornitore_nome, a.numero as acquisto_numero \
         FROM ordini o LEFT JOIN clienti c ON o.cliente_id = c.id LEFT JOIN fornitori f ON o.fornitore_id = f.id \
         LEFT JOIN acquisti a ON o.acquisto_id = a.id {where_}ORDER BY o.data_ordine DESC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = match tipo {
        Some(t) => stmt.query_map([t], |r| to_dto(&conn, r))?.collect::<Result<Vec<_>, _>>()?,
        None => stmt.query_map([], |r| to_dto(&conn, r))?.collect::<Result<Vec<_>, _>>()?,
    };
    Ok(Json(Value::Array(rows)))
}

async fn count_aperti(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM ordini WHERE stato='APERTO'", [], |r| r.get(0))?;
    Ok(Json(json!(n)))
}

async fn detail(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let dto = conn
        .query_row(
            "SELECT o.*, c.ragione_sociale as cliente_nome, f.ragione_sociale as fornitore_nome \
             FROM ordini o LEFT JOIN clienti c ON o.cliente_id = c.id LEFT JOIN fornitori f ON o.fornitore_id = f.id WHERE o.id=?1",
            [id],
            |r| to_dto(&conn, r),
        )
        .optional()?;
    let mut dto = dto.ok_or_else(|| ApiError::not_found("Not found"))?;
    dto["righe"] = Value::Array(get_righe(&conn, id)?);
    Ok(Json(dto))
}

async fn create(State(state): State<AppState>, Json(o): Json<Value>) -> ApiResult<Json<Value>> {
    let numero = o.get("numero").and_then(Value::as_str).unwrap_or("");
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    if conn.query_row("SELECT id FROM ordini WHERE numero=?1", [numero], |_| Ok(())).optional()?.is_some() {
        return Err(ApiError::conflict(format!("Il numero {numero} è già utilizzato da un altro documento")));
    }
    conn.execute(
        "INSERT INTO ordini (numero, data_ordine, cliente_id, fornitore_id, tipo, stato, note, acquisto_id) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![
            numero,
            o.get("dataOrdine").and_then(Value::as_str),
            opt_i64(&o, "clienteId"),
            opt_i64(&o, "fornitoreId"),
            o.get("tipo").and_then(Value::as_str).unwrap_or("CLIENTE"),
            o.get("stato").and_then(Value::as_str).unwrap_or("APERTO"),
            raw_opt(&o, "note"),
            opt_i64(&o, "acquistoId"),
        ],
    )?;
    let id = conn.last_insert_rowid();
    if let Some(righe) = o.get("righe").and_then(Value::as_array).filter(|r| !r.is_empty()) {
        save_righe(&conn, id, righe)?;
    }
    audit(&conn, "ordine", id, "CREATE", &json!({ "numero": numero, "tipo": o.get("tipo").and_then(Value::as_str), "clienteId": opt_i64(&o, "clienteId"), "fornitoreId": opt_i64(&o, "fornitoreId"), "stato": o.get("stato").and_then(Value::as_str).unwrap_or("APERTO"), "numRighe": righe_len(&o) }));
    Ok(Json(json!({ "id": id })))
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(o): Json<Value>,
) -> ApiResult<Json<Value>> {
    let numero = o.get("numero").and_then(Value::as_str).unwrap_or("");
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    if conn.query_row("SELECT id FROM ordini WHERE numero=?1 AND id!=?2", params![numero, id], |_| Ok(())).optional()?.is_some() {
        return Err(ApiError::conflict(format!("Il numero {numero} è già utilizzato da un altro documento")));
    }
    conn.execute(
        "UPDATE ordini SET numero=?1, data_ordine=?2, cliente_id=?3, fornitore_id=?4, tipo=?5, stato=?6, note=?7 WHERE id=?8",
        params![
            numero,
            o.get("dataOrdine").and_then(Value::as_str),
            opt_i64(&o, "clienteId"),
            opt_i64(&o, "fornitoreId"),
            o.get("tipo").and_then(Value::as_str),
            o.get("stato").and_then(Value::as_str),
            raw_opt(&o, "note"),
            id,
        ],
    )?;
    conn.execute("DELETE FROM ordini_righe WHERE ordine_id=?1", [id])?;
    if let Some(righe) = o.get("righe").and_then(Value::as_array).filter(|r| !r.is_empty()) {
        save_righe(&conn, id, righe)?;
    }
    audit(&conn, "ordine", id, "UPDATE", &json!({ "numero": numero }));
    Ok(Json(json!({ "success": true })))
}

async fn remove(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let snap = conn
        .query_row("SELECT numero, cliente_id, fornitore_id, tipo, stato, data_ordine FROM ordini WHERE id=?1", [id], |r| {
            Ok(json!({
                "numero": r.get::<_, Option<String>>(0)?, "cliente_id": r.get::<_, Option<i64>>(1)?,
                "fornitore_id": r.get::<_, Option<i64>>(2)?, "tipo": r.get::<_, Option<String>>(3)?,
                "stato": r.get::<_, Option<String>>(4)?, "data_ordine": r.get::<_, Option<String>>(5)?,
            }))
        })
        .optional()?
        .unwrap_or_else(|| json!({}));
    conn.execute("DELETE FROM ordini WHERE id=?1", [id])?;
    audit(&conn, "ordine", id, "DELETE", &snap);
    Ok(Json(json!({ "success": true })))
}

async fn patch_stato(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(b): Json<Value>,
) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let before: Option<String> = conn
        .query_row("SELECT stato FROM ordini WHERE id=?1", [id], |r| r.get::<_, Option<String>>(0))
        .optional()?
        .flatten();
    let stato = b.get("stato").and_then(Value::as_str);
    conn.execute("UPDATE ordini SET stato=?1 WHERE id=?2", params![stato, id])?;
    audit(&conn, "ordine", id, "UPDATE", &json!({ "before": { "stato": before }, "after": { "stato": stato } }));
    Ok(Json(json!({ "success": true })))
}

async fn patch_acquisto(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(b): Json<Value>,
) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    conn.execute("UPDATE ordini SET acquisto_id=?1 WHERE id=?2", params![opt_i64(&b, "acquistoId"), id])?;
    Ok(Json(json!({ "success": true })))
}

async fn to_ddt(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let arc = tenant_conn(&state)?;
    let mut guard = arc.lock().unwrap();
    let ord = guard
        .query_row("SELECT tipo, cliente_id, numero FROM ordini WHERE id=?1", [id], |r| {
            Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<i64>>(1)?, r.get::<_, Option<String>>(2)?))
        })
        .optional()?;
    let (tipo, cliente_id, onum) = ord.ok_or_else(|| ApiError::not_found("Ordine non trovato"))?;
    if tipo.as_deref() != Some("CLIENTE") {
        return Err(ApiError::bad_request("Solo gli ordini cliente possono essere convertiti in documento di trasporto"));
    }
    let righe = get_righe(&guard, id)?;
    let onum = onum.unwrap_or_default();
    let tx = guard.transaction().map_err(ApiError::from)?;
    let numero = get_next_numero(&tx, "ddt", "ddt", 0)?;
    let data = oggi();
    tx.execute(
        "INSERT INTO ddt (numero, data_emissione, cliente_id, causale, stato) VALUES (?1,?2,?3,?4,'EMESSO')",
        params![numero, data, cliente_id, format!("Da ordine n. {onum}")],
    )?;
    let ddt_id = tx.last_insert_rowid();
    for r in &righe {
        tx.execute(
            "INSERT INTO ddt_righe (ddt_id, prodotto_id, descrizione, quantita, prezzo, sconto, iva, unita_misura, variante_id, variante_taglia, variante_colore) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            (
                ddt_id,
                r.get("prodottoId").and_then(Value::as_i64).filter(|&v| v != 0),
                r.get("descrizione").and_then(Value::as_str).map(str::to_string),
                r.get("quantita").and_then(Value::as_f64),
                r.get("prezzo").and_then(Value::as_f64),
                r.get("sconto").and_then(Value::as_f64).unwrap_or(0.0),
                r.get("iva").and_then(Value::as_f64),
                r.get("unitaMisura").and_then(Value::as_str).unwrap_or("").to_string(),
                r.get("varianteId").and_then(Value::as_i64).filter(|&v| v != 0),
                r.get("varianteTaglia").and_then(Value::as_str).unwrap_or("").to_string(),
                r.get("varianteColore").and_then(Value::as_str).unwrap_or("").to_string(),
            ),
        )?;
    }
    tx.execute("UPDATE ordini SET stato='EVASO' WHERE id=?1", [id])?;
    tx.commit().map_err(ApiError::from)?;
    Ok(Json(json!({ "id": ddt_id, "numero": numero })))
}

async fn print(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let dto = conn
        .query_row(
            "SELECT o.*, c.ragione_sociale as c_nome, c.via as c_via, c.cap as c_cap, c.citta as c_citta, c.provincia as c_provincia, c.p_iva as c_p_iva, \
                    f.ragione_sociale as f_nome, f.via as f_via, f.cap as f_cap, f.citta as f_citta, f.provincia as f_provincia, f.p_iva as f_p_iva \
             FROM ordini o LEFT JOIN clienti c ON o.cliente_id = c.id LEFT JOIN fornitori f ON o.fornitore_id = f.id WHERE o.id=?1",
            [id],
            |r| {
                let mut dto = to_dto(&conn, r)?;
                let g = |k: &str| r.get::<_, Option<String>>(k).ok().flatten();
                dto["cliente"] = json!({ "ragioneSociale": g("c_nome"), "via": g("c_via"), "cap": g("c_cap"), "citta": g("c_citta"), "provincia": g("c_provincia"), "pIva": g("c_p_iva") });
                dto["fornitore"] = json!({ "ragioneSociale": g("f_nome"), "via": g("f_via"), "cap": g("f_cap"), "citta": g("f_citta"), "provincia": g("f_provincia"), "pIva": g("f_p_iva") });
                Ok(dto)
            },
        )
        .optional()?;
    let mut dto = dto.ok_or_else(|| ApiError::not_found("Not found"))?;
    // la query /print non seleziona cliente_nome/fornitore_nome → Node li omette
    if let Some(o) = dto.as_object_mut() {
        o.remove("clienteNome");
        o.remove("fornitoreNome");
    }
    dto["righe"] = Value::Array(get_righe(&conn, id)?);
    Ok(Json(dto))
}

// ── helpers ──────────────────────────────────────────────────────────────────

fn save_righe(conn: &Connection, ordine_id: i64, righe: &[Value]) -> rusqlite::Result<()> {
    for r in righe {
        conn.execute(
            "INSERT INTO ordini_righe (ordine_id, prodotto_id, codice_prodotto, descrizione, quantita, prezzo, sconto, iva, unita_misura, variante_id, variante_taglia, variante_colore, tipo, codice_fornitore) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
            params![
                ordine_id,
                r.get("prodottoId").and_then(Value::as_i64).filter(|&v| v != 0),
                str_def(r, "codiceProdotto"),
                raw_opt(r, "descrizione"),
                r.get("quantita").and_then(Value::as_f64),
                r.get("prezzo").and_then(Value::as_f64),
                r.get("sconto").and_then(Value::as_f64).unwrap_or(0.0),
                r.get("iva").and_then(Value::as_f64),
                str_def(r, "unitaMisura"),
                r.get("varianteId").and_then(Value::as_i64).filter(|&v| v != 0),
                str_def(r, "varianteTaglia"),
                str_def(r, "varianteColore"),
                str_or(r, "tipo", "PRODOTTO"),
                str_def(r, "codiceFornitore"),
            ],
        )?;
    }
    Ok(())
}

fn get_righe(conn: &Connection, ordine_id: i64) -> rusqlite::Result<Vec<Value>> {
    let mut stmt = conn.prepare(
        "SELECT r.*, p.codice as prodotto_codice FROM ordini_righe r LEFT JOIN prodotti p ON r.prodotto_id = p.id WHERE r.ordine_id=?1",
    )?;
    let rows = stmt
        .query_map([ordine_id], |r| {
            Ok(json!({
                "id": r.get::<_, i64>("id")?,
                "prodottoId": r.get::<_, Option<i64>>("prodotto_id")?,
                "prodottoCodice": r.get::<_, Option<String>>("prodotto_codice")?,
                "codiceProdotto": r.get::<_, Option<String>>("codice_prodotto")?.unwrap_or_default(),
                "descrizione": r.get::<_, Option<String>>("descrizione")?,
                "quantita": opt_num(r.get::<_, Option<f64>>("quantita")?),
                "unitaMisura": r.get::<_, Option<String>>("unita_misura")?,
                "prezzo": opt_num(r.get::<_, Option<f64>>("prezzo")?),
                "sconto": num(r.get::<_, Option<f64>>("sconto")?.unwrap_or(0.0)),
                "iva": opt_num(r.get::<_, Option<f64>>("iva")?),
                "varianteId": r.get::<_, Option<i64>>("variante_id")?,
                "varianteTaglia": r.get::<_, Option<String>>("variante_taglia")?.unwrap_or_default(),
                "varianteColore": r.get::<_, Option<String>>("variante_colore")?.unwrap_or_default(),
                "tipo": r.get::<_, Option<String>>("tipo")?.filter(|s| !s.is_empty()).unwrap_or_else(|| "PRODOTTO".into()),
                "codiceFornitore": r.get::<_, Option<String>>("codice_fornitore")?.unwrap_or_default(),
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn to_dto(conn: &Connection, r: &Row) -> rusqlite::Result<Value> {
    let id = r.get::<_, i64>("id")?;
    let totale: f64 = conn.query_row(
        "SELECT COALESCE(SUM(quantita * prezzo * (1 - COALESCE(sconto,0)/100) * (1 + iva/100)), 0) FROM ordini_righe WHERE ordine_id=?1",
        [id], |x| x.get(0),
    )?;
    let imponibile: f64 = conn.query_row(
        "SELECT COALESCE(SUM(quantita * prezzo * (1 - COALESCE(sconto,0)/100)), 0) FROM ordini_righe WHERE ordine_id=?1",
        [id], |x| x.get(0),
    )?;
    Ok(json!({
        "id": id,
        "numero": r.get::<_, Option<String>>("numero")?,
        "dataOrdine": r.get::<_, Option<String>>("data_ordine")?,
        "clienteId": r.get::<_, Option<i64>>("cliente_id")?,
        "clienteNome": r.get::<_, Option<String>>("cliente_nome").ok().flatten(),
        "fornitoreId": r.get::<_, Option<i64>>("fornitore_id")?,
        "fornitoreNome": r.get::<_, Option<String>>("fornitore_nome").ok().flatten(),
        "acquistoId": r.get::<_, Option<i64>>("acquisto_id")?,
        "acquistoNumero": r.get::<_, Option<String>>("acquisto_numero").ok().flatten(),
        "tipo": r.get::<_, Option<String>>("tipo")?,
        "stato": r.get::<_, Option<String>>("stato")?,
        "note": r.get::<_, Option<String>>("note")?,
        "totale": num(totale),
        "imponibile": num(imponibile),
    }))
}

fn str_or(b: &Value, k: &str, d: &str) -> String {
    let s = str_def(b, k);
    if s.is_empty() { d.to_string() } else { s }
}
fn opt_i64(b: &Value, k: &str) -> Option<i64> {
    b.get(k).and_then(Value::as_i64).filter(|&v| v != 0)
}
fn righe_len(o: &Value) -> usize {
    o.get("righe").and_then(Value::as_array).map(|a| a.len()).unwrap_or(0)
}
