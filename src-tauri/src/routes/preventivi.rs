//! /api/preventivi — preventivi (no movimento magazzino) con conversione in DDT/ordine.
//! Parità con routes/preventivi.js.

use axum::{
    extract::{Path, State},
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
        .route("/:id", get(detail).put(update).delete(remove))
        .route("/:id/print", get(print))
        .route("/:id/stato", axum::routing::patch(patch_stato))
        .route("/:id/to-ddt", axum::routing::post(to_ddt))
        .route("/:id/to-ordine", axum::routing::post(to_ordine))
}

async fn list(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT p.*, c.ragione_sociale as cliente_nome FROM preventivi p \
         LEFT JOIN clienti c ON p.cliente_id = c.id ORDER BY p.data_emissione DESC",
    )?;
    let rows = stmt.query_map([], |r| to_dto(&conn, r))?.collect::<Result<Vec<_>, _>>()?;
    Ok(Json(Value::Array(rows)))
}

async fn detail(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let dto = conn
        .query_row(
            "SELECT p.*, c.ragione_sociale as cliente_nome FROM preventivi p LEFT JOIN clienti c ON p.cliente_id = c.id WHERE p.id=?1",
            [id],
            |r| to_dto(&conn, r),
        )
        .optional()?;
    let mut dto = dto.ok_or_else(|| ApiError::not_found("Not found"))?;
    dto["righe"] = Value::Array(get_righe(&conn, id)?);
    Ok(Json(dto))
}

async fn create(State(state): State<AppState>, Json(p): Json<Value>) -> ApiResult<Json<Value>> {
    let numero = p.get("numero").and_then(Value::as_str).unwrap_or("");
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    if conn.query_row("SELECT id FROM preventivi WHERE numero=?1", [numero], |_| Ok(())).optional()?.is_some() {
        return Err(ApiError::conflict(format!("Il numero {numero} è già utilizzato da un altro documento")));
    }
    conn.execute(
        "INSERT INTO preventivi (numero, data_emissione, cliente_id, validita, stato, note, stampa_immagini) VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![
            numero,
            p.get("dataEmissione").and_then(Value::as_str),
            opt_i64(&p, "clienteId"),
            p.get("validita").and_then(Value::as_i64).filter(|&v| v != 0).unwrap_or(30),
            p.get("stato").and_then(Value::as_str).unwrap_or("INVIATO"),
            raw_opt(&p, "note"),
            if matches!(p.get("stampaImmagini"), Some(Value::Bool(false))) { 0 } else { 1 },
        ],
    )?;
    let id = conn.last_insert_rowid();
    if let Some(righe) = p.get("righe").and_then(Value::as_array).filter(|r| !r.is_empty()) {
        save_righe(&conn, id, righe)?;
    }
    audit(&conn, "preventivo", id, "CREATE", &json!({ "numero": numero, "clienteId": opt_i64(&p, "clienteId"), "stato": p.get("stato").and_then(Value::as_str).unwrap_or("INVIATO"), "numRighe": righe_len(&p) }));
    Ok(Json(json!({ "id": id })))
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(p): Json<Value>,
) -> ApiResult<Json<Value>> {
    let numero = p.get("numero").and_then(Value::as_str).unwrap_or("");
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    if conn.query_row("SELECT id FROM preventivi WHERE numero=?1 AND id!=?2", params![numero, id], |_| Ok(())).optional()?.is_some() {
        return Err(ApiError::conflict(format!("Il numero {numero} è già utilizzato da un altro documento")));
    }
    conn.execute(
        "UPDATE preventivi SET numero=?1, data_emissione=?2, cliente_id=?3, validita=?4, stato=?5, note=?6, stampa_immagini=?7 WHERE id=?8",
        params![
            numero,
            p.get("dataEmissione").and_then(Value::as_str),
            opt_i64(&p, "clienteId"),
            p.get("validita").and_then(Value::as_i64),
            p.get("stato").and_then(Value::as_str),
            raw_opt(&p, "note"),
            if matches!(p.get("stampaImmagini"), Some(Value::Bool(false))) { 0 } else { 1 },
            id,
        ],
    )?;
    conn.execute("DELETE FROM preventivi_righe WHERE preventivo_id=?1", [id])?;
    if let Some(righe) = p.get("righe").and_then(Value::as_array).filter(|r| !r.is_empty()) {
        save_righe(&conn, id, righe)?;
    }
    audit(&conn, "preventivo", id, "UPDATE", &json!({ "numero": numero }));
    Ok(Json(json!({ "success": true })))
}

async fn remove(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let snap = conn
        .query_row("SELECT numero, cliente_id, stato, data_emissione FROM preventivi WHERE id=?1", [id], |r| {
            Ok(json!({
                "numero": r.get::<_, Option<String>>(0)?,
                "cliente_id": r.get::<_, Option<i64>>(1)?,
                "stato": r.get::<_, Option<String>>(2)?,
                "data_emissione": r.get::<_, Option<String>>(3)?,
            }))
        })
        .optional()?
        .unwrap_or_else(|| json!({}));
    conn.execute("DELETE FROM preventivi WHERE id=?1", [id])?;
    audit(&conn, "preventivo", id, "DELETE", &snap);
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
        .query_row("SELECT stato FROM preventivi WHERE id=?1", [id], |r| r.get::<_, Option<String>>(0))
        .optional()?
        .flatten();
    let stato = b.get("stato").and_then(Value::as_str);
    conn.execute("UPDATE preventivi SET stato=?1 WHERE id=?2", params![stato, id])?;
    audit(&conn, "preventivo", id, "UPDATE", &json!({ "before": { "stato": before }, "after": { "stato": stato } }));
    Ok(Json(json!({ "success": true })))
}

async fn print(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let dto = conn
        .query_row(
            "SELECT p.*, c.ragione_sociale as c_nome, c.via as c_via, c.cap as c_cap, c.citta as c_citta, \
                    c.provincia as c_provincia, c.p_iva as c_p_iva, c.email as c_email, c.telefono as c_telefono \
             FROM preventivi p LEFT JOIN clienti c ON p.cliente_id = c.id WHERE p.id=?1",
            [id],
            |r| {
                let mut dto = to_dto(&conn, r)?;
                let g = |k: &str| r.get::<_, Option<String>>(k).ok().flatten();
                dto["cliente"] = json!({
                    "ragioneSociale": g("c_nome"), "via": g("c_via"), "cap": g("c_cap"), "citta": g("c_citta"),
                    "provincia": g("c_provincia"), "pIva": g("c_p_iva"), "email": g("c_email"), "telefono": g("c_telefono"),
                });
                Ok(dto)
            },
        )
        .optional()?;
    let mut dto = dto.ok_or_else(|| ApiError::not_found("Not found"))?;
    if let Some(o) = dto.as_object_mut() {
        o.remove("clienteNome"); // la query /print non seleziona cliente_nome
    }
    dto["righe"] = Value::Array(get_righe(&conn, id)?);
    Ok(Json(dto))
}

async fn to_ddt(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    convert(state, id, Conv::Ddt).await
}
async fn to_ordine(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    convert(state, id, Conv::Ordine).await
}

enum Conv {
    Ddt,
    Ordine,
}

async fn convert(state: AppState, id: i64, kind: Conv) -> ApiResult<Json<Value>> {
    let arc = tenant_conn(&state)?;
    let mut guard = arc.lock().unwrap();
    let prev = guard
        .query_row("SELECT cliente_id, numero FROM preventivi WHERE id=?1", [id], |r| {
            Ok((r.get::<_, Option<i64>>(0)?, r.get::<_, Option<String>>(1)?))
        })
        .optional()?;
    let (cliente_id, pnum) = prev.ok_or_else(|| ApiError::not_found("Preventivo non trovato"))?;
    let righe = get_righe(&guard, id)?;
    let pnum = pnum.unwrap_or_default();
    let tx = guard.transaction().map_err(ApiError::from)?;
    let data = oggi();
    let (new_id, numero) = match kind {
        Conv::Ddt => {
            let numero = get_next_numero(&tx, "ddt", "ddt", 0)?;
            tx.execute(
                "INSERT INTO ddt (numero, data_emissione, cliente_id, causale, stato, preventivo_id) VALUES (?1,?2,?3,?4,'EMESSO',?5)",
                params![numero, data, cliente_id, format!("Da preventivo n. {pnum}"), id],
            )?;
            let did = tx.last_insert_rowid();
            for r in &righe {
                tx.execute(
                    "INSERT INTO ddt_righe (ddt_id, prodotto_id, descrizione, quantita, prezzo, sconto, iva, unita_misura, variante_id, variante_taglia, variante_colore) \
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                    riga_params(did, r),
                )?;
            }
            (did, numero)
        }
        Conv::Ordine => {
            let numero = get_next_numero(&tx, "ordini", "ordini", 0)?;
            tx.execute(
                "INSERT INTO ordini (numero, data_ordine, cliente_id, tipo, stato, note, preventivo_id) VALUES (?1,?2,?3,'CLIENTE','APERTO',?4,?5)",
                params![numero, data, cliente_id, format!("Da preventivo n. {pnum}"), id],
            )?;
            let oid = tx.last_insert_rowid();
            for r in &righe {
                tx.execute(
                    "INSERT INTO ordini_righe (ordine_id, prodotto_id, descrizione, quantita, prezzo, sconto, iva, unita_misura, variante_id, variante_taglia, variante_colore) \
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                    riga_params(oid, r),
                )?;
            }
            (oid, numero)
        }
    };
    tx.execute("UPDATE preventivi SET stato='CONFERMATO' WHERE id=?1", [id])?;
    tx.commit().map_err(ApiError::from)?;
    Ok(Json(json!({ "id": new_id, "numero": numero })))
}

// ── helpers ──────────────────────────────────────────────────────────────────

fn riga_params<'a>(doc_id: i64, r: &'a Value) -> impl rusqlite::Params + 'a {
    // (doc_id, prodotto_id, descrizione, quantita, prezzo, sconto, iva, unita, variante_id, taglia, colore)
    (
        doc_id,
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
    )
}

fn save_righe(conn: &Connection, prev_id: i64, righe: &[Value]) -> rusqlite::Result<()> {
    for r in righe {
        conn.execute(
            "INSERT INTO preventivi_righe (preventivo_id, prodotto_id, codice_prodotto, descrizione, quantita, prezzo, sconto, iva, unita_misura, variante_id, variante_taglia, variante_colore, tipo) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
            params![
                prev_id,
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
            ],
        )?;
    }
    Ok(())
}

fn get_righe(conn: &Connection, prev_id: i64) -> rusqlite::Result<Vec<Value>> {
    let mut stmt = conn.prepare(
        "SELECT r.*, p.codice as prodotto_codice FROM preventivi_righe r LEFT JOIN prodotti p ON r.prodotto_id = p.id WHERE r.preventivo_id=?1",
    )?;
    let rows = stmt
        .query_map([prev_id], |r| {
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
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn to_dto(conn: &Connection, r: &Row) -> rusqlite::Result<Value> {
    let id = r.get::<_, i64>("id")?;
    let totale: f64 = conn.query_row(
        "SELECT COALESCE(SUM(quantita * prezzo * (1 - COALESCE(sconto,0)/100) * (1 + iva/100)), 0) FROM preventivi_righe WHERE preventivo_id=?1",
        [id], |x| x.get(0),
    )?;
    let imponibile: f64 = conn.query_row(
        "SELECT COALESCE(SUM(quantita * prezzo * (1 - COALESCE(sconto,0)/100)), 0) FROM preventivi_righe WHERE preventivo_id=?1",
        [id], |x| x.get(0),
    )?;
    Ok(json!({
        "id": id,
        "numero": r.get::<_, Option<String>>("numero")?,
        "dataEmissione": r.get::<_, Option<String>>("data_emissione")?,
        "clienteId": r.get::<_, Option<i64>>("cliente_id")?,
        "clienteNome": r.get::<_, Option<String>>("cliente_nome").ok().flatten(),
        "validita": opt_num(r.get::<_, Option<f64>>("validita")?),
        "stato": r.get::<_, Option<String>>("stato")?,
        "note": r.get::<_, Option<String>>("note")?,
        "totale": num(totale),
        "imponibile": num(imponibile),
        "stampaImmagini": r.get::<_, Option<i64>>("stampa_immagini")? != Some(0),
    }))
}

fn str_or(b: &Value, k: &str, d: &str) -> String {
    let s = str_def(b, k);
    if s.is_empty() { d.to_string() } else { s }
}
fn opt_i64(b: &Value, k: &str) -> Option<i64> {
    b.get(k).and_then(Value::as_i64).filter(|&v| v != 0)
}
fn righe_len(p: &Value) -> usize {
    p.get("righe").and_then(Value::as_array).map(|a| a.len()).unwrap_or(0)
}
