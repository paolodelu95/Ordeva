//! /api/note-credito — note di credito (reso merce, campi fiscali). Parità con routes/noteCredito.js.
//! Reso merce: delta +1 (rientro). Storno/eliminazione: delta -1.

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
use crate::fiscale::{calcola_totali_fiscali, fisc_from_row, fisc_values};
use crate::routes::fatture::ricalcola_stato;
use crate::stock::{applica_righe_stock, StockCtx};
use crate::web::{num, opt_num, raw_opt, str_def, tenant_conn};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/:id", get(detail).put(update).delete(remove))
        .route("/:id/print", get(print))
        .route("/:id/stato", axum::routing::patch(patch_stato))
}

const INS: &str = "INSERT INTO note_credito (numero, data_emissione, cliente_id, fattura_id, note, stato, \
    ritenuta_aliquota, ritenuta_causale, ritenuta_tipo, ritenuta_su_cassa, cassa_tipo, cassa_aliquota, cassa_iva, bollo) \
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)";

async fn list(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let mut stmt = conn.prepare("SELECT n.*, c.ragione_sociale as cliente_nome FROM note_credito n LEFT JOIN clienti c ON n.cliente_id = c.id ORDER BY n.data_emissione DESC")?;
    let rows = stmt.query_map([], |r| to_dto(&conn, r))?.collect::<Result<Vec<_>, _>>()?;
    Ok(Json(Value::Array(rows)))
}

async fn detail(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let dto = conn
        .query_row("SELECT n.*, c.ragione_sociale as cliente_nome FROM note_credito n LEFT JOIN clienti c ON n.cliente_id = c.id WHERE n.id=?1", [id], |r| to_dto(&conn, r))
        .optional()?;
    let mut dto = dto.ok_or_else(|| ApiError::not_found("Not found"))?;
    dto["righe"] = Value::Array(get_righe(&conn, id)?);
    Ok(Json(dto))
}

async fn create(State(state): State<AppState>, Json(n): Json<Value>) -> ApiResult<Json<Value>> {
    if let Some(e) = valida_righe(n.get("righe")) {
        return Err(ApiError::bad_request(e));
    }
    let numero = n.get("numero").and_then(Value::as_str).unwrap_or("");
    let arc = tenant_conn(&state)?;
    let mut guard = arc.lock().unwrap();
    if guard.query_row("SELECT id FROM note_credito WHERE numero=?1", [numero], |_| Ok(())).optional()?.is_some() {
        return Err(ApiError::conflict(format!("Il numero {numero} è già utilizzato da un altro documento")));
    }
    let tx = guard.transaction().map_err(ApiError::from)?;
    let id = create_tx(&tx, &n).map_err(sql_400)?;
    tx.commit().map_err(ApiError::from)?;
    Ok(Json(json!({ "id": id })))
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(n): Json<Value>,
) -> ApiResult<Json<Value>> {
    if let Some(e) = valida_righe(n.get("righe")) {
        return Err(ApiError::bad_request(e));
    }
    let numero = n.get("numero").and_then(Value::as_str).unwrap_or("");
    let arc = tenant_conn(&state)?;
    let mut guard = arc.lock().unwrap();
    if guard.query_row("SELECT id FROM note_credito WHERE numero=?1 AND id!=?2", params![numero, id], |_| Ok(())).optional()?.is_some() {
        return Err(ApiError::conflict(format!("Il numero {numero} è già utilizzato da un altro documento")));
    }
    let tx = guard.transaction().map_err(ApiError::from)?;
    update_tx(&tx, id, &n).map_err(sql_400)?;
    tx.commit().map_err(ApiError::from)?;
    Ok(Json(json!({ "success": true })))
}

async fn remove(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let arc = tenant_conn(&state)?;
    let mut guard = arc.lock().unwrap();
    let tx = guard.transaction().map_err(ApiError::from)?;
    let snapshot = tx
        .query_row("SELECT numero, cliente_id, fattura_id, stato, data_emissione FROM note_credito WHERE id=?1", [id], |r| {
            Ok((
                json!({ "numero": r.get::<_,Option<String>>(0)?, "cliente_id": r.get::<_,Option<i64>>(1)?, "fattura_id": r.get::<_,Option<i64>>(2)?, "stato": r.get::<_,Option<String>>(3)?, "data_emissione": r.get::<_,Option<String>>(4)? }),
                r.get::<_, Option<String>>(0)?,
                r.get::<_, Option<i64>>(1)?,
                r.get::<_, Option<i64>>(2)?,
            ))
        })
        .optional()?;
    let snap = if let Some((snap, onum, ocid, ofid)) = snapshot {
        let righe = get_righe(&tx, id)?;
        if !righe.is_empty() {
            let ctx = ctx_nc("ELIMINAZIONE", id, &onum.unwrap_or_default(), ocid, nome_cliente(&tx, ocid), None);
            applica_righe_stock(&tx, &righe, -1, &ctx)?;
        }
        tx.execute("DELETE FROM note_credito WHERE id=?1", [id])?;
        if let Some(fid) = ofid {
            ricalcola_stato(&tx, fid)?;
        }
        snap
    } else {
        json!({})
    };
    audit(&tx, "nota_credito", id, "DELETE", &snap);
    tx.commit().map_err(ApiError::from)?;
    Ok(Json(json!({ "success": true })))
}

async fn print(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let dto = conn
        .query_row(
            "SELECT n.*, c.ragione_sociale as c_nome, c.via as c_via, c.cap as c_cap, c.citta as c_citta, c.provincia as c_provincia, c.p_iva as c_p_iva, \
                    f.numero as fattura_numero FROM note_credito n LEFT JOIN clienti c ON n.cliente_id = c.id LEFT JOIN fatture f ON n.fattura_id = f.id WHERE n.id=?1",
            [id],
            |r| {
                let mut dto = to_dto(&conn, r)?;
                let g = |k: &str| r.get::<_, Option<String>>(k).ok().flatten();
                dto["cliente"] = json!({ "ragioneSociale": g("c_nome"), "via": g("c_via"), "cap": g("c_cap"), "citta": g("c_citta"), "provincia": g("c_provincia"), "pIva": g("c_p_iva") });
                dto["fatturaNumeroColl"] = json!(g("fattura_numero").unwrap_or_default());
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

async fn patch_stato(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(b): Json<Value>,
) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let before: Option<String> = conn.query_row("SELECT stato FROM note_credito WHERE id=?1", [id], |r| r.get(0)).optional()?.flatten();
    let stato = b.get("stato").and_then(Value::as_str);
    conn.execute("UPDATE note_credito SET stato=?1 WHERE id=?2", params![stato, id])?;
    // Annullare o riattivare la nota cambia quanto risulta stornato: la fattura
    // collegata va riallineata, altrimenti resta STORNATA per una nota annullata.
    if let Some(fid) = conn.query_row("SELECT fattura_id FROM note_credito WHERE id=?1", [id], |r| r.get::<_, Option<i64>>(0)).optional()?.flatten() {
        ricalcola_stato(&conn, fid)?;
    }
    audit(&conn, "nota_credito", id, "UPDATE", &json!({ "before": { "stato": before }, "after": { "stato": stato } }));
    Ok(Json(json!({ "success": true })))
}

// ── tx bodies ────────────────────────────────────────────────────────────────

fn create_tx(tx: &Connection, n: &Value) -> rusqlite::Result<i64> {
    let (ra, rc, rt, rsc, ct, ca, ci, bo) = fisc_values(n);
    let cliente_id = opt_i64(n, "clienteId");
    let fattura_id = opt_i64(n, "fatturaId");
    tx.execute(
        INS,
        params![
            n.get("numero").and_then(Value::as_str).unwrap_or(""),
            n.get("dataEmissione").and_then(Value::as_str),
            cliente_id,
            fattura_id,
            raw_opt(n, "note"),
            n.get("stato").and_then(Value::as_str).unwrap_or("EMESSA"),
            ra, rc, rt, rsc, ct, ca, ci, bo,
        ],
    )?;
    let id = tx.last_insert_rowid();
    if let Some(righe) = n.get("righe").and_then(Value::as_array).filter(|r| !r.is_empty()) {
        save_righe(tx, id, righe)?;
        let ctx = ctx_nc("NOTA_CREDITO", id, n.get("numero").and_then(Value::as_str).unwrap_or(""), cliente_id, nome_cliente(tx, cliente_id), n.get("dataEmissione").and_then(Value::as_str).map(str::to_string));
        applica_righe_stock(tx, righe, 1, &ctx)?;
    }
    if let Some(fid) = fattura_id {
        ricalcola_stato(tx, fid)?;
    }
    audit(tx, "nota_credito", id, "CREATE", &json!({ "numero": n.get("numero").and_then(Value::as_str), "clienteId": cliente_id, "fatturaId": fattura_id, "stato": n.get("stato").and_then(Value::as_str).unwrap_or("EMESSA"), "numRighe": righe_len(n) }));
    Ok(id)
}

fn update_tx(tx: &Connection, id: i64, n: &Value) -> rusqlite::Result<()> {
    let before_fid: Option<i64> = tx.query_row("SELECT fattura_id FROM note_credito WHERE id=?1", [id], |r| r.get::<_, Option<i64>>(0)).optional()?.flatten();
    let vecchie = get_righe(tx, id)?;
    if !vecchie.is_empty() {
        let (onum, ocid) = tx.query_row("SELECT numero, cliente_id FROM note_credito WHERE id=?1", [id], |r| Ok((r.get::<_,Option<String>>(0)?, r.get::<_,Option<i64>>(1)?))).optional()?.unwrap_or((None, None));
        let ctx = ctx_nc("STORNO", id, &onum.unwrap_or_default(), ocid, nome_cliente(tx, ocid), None);
        applica_righe_stock(tx, &vecchie, -1, &ctx)?;
    }
    let (ra, rc, rt, rsc, ct, ca, ci, bo) = fisc_values(n);
    let cliente_id = opt_i64(n, "clienteId");
    let fattura_id = opt_i64(n, "fatturaId");
    tx.execute(
        "UPDATE note_credito SET numero=?1, data_emissione=?2, cliente_id=?3, fattura_id=?4, note=?5, stato=?6, \
         ritenuta_aliquota=?7, ritenuta_causale=?8, ritenuta_tipo=?9, ritenuta_su_cassa=?10, cassa_tipo=?11, cassa_aliquota=?12, cassa_iva=?13, bollo=?14 WHERE id=?15",
        params![
            n.get("numero").and_then(Value::as_str).unwrap_or(""),
            n.get("dataEmissione").and_then(Value::as_str),
            cliente_id, fattura_id,
            raw_opt(n, "note"),
            n.get("stato").and_then(Value::as_str),
            ra, rc, rt, rsc, ct, ca, ci, bo, id,
        ],
    )?;
    tx.execute("DELETE FROM note_credito_righe WHERE nota_credito_id=?1", [id])?;
    if let Some(righe) = n.get("righe").and_then(Value::as_array).filter(|r| !r.is_empty()) {
        save_righe(tx, id, righe)?;
        let ctx = ctx_nc("NOTA_CREDITO", id, n.get("numero").and_then(Value::as_str).unwrap_or(""), cliente_id, nome_cliente(tx, cliente_id), n.get("dataEmissione").and_then(Value::as_str).map(str::to_string));
        applica_righe_stock(tx, righe, 1, &ctx)?;
    }
    if let Some(old_fid) = before_fid {
        if Some(old_fid) != fattura_id {
            ricalcola_stato(tx, old_fid)?;
        }
    }
    if let Some(fid) = fattura_id {
        ricalcola_stato(tx, fid)?;
    }
    audit(tx, "nota_credito", id, "UPDATE", &json!({ "numero": n.get("numero").and_then(Value::as_str) }));
    Ok(())
}

// ── helpers ──────────────────────────────────────────────────────────────────

fn ctx_nc(causale: &str, doc_id: i64, doc_num: &str, cliente_id: Option<i64>, cliente_nome: String, data: Option<String>) -> StockCtx {
    StockCtx {
        data,
        causale: causale.into(),
        documento_tipo: "NOTA_CREDITO".into(),
        documento_id: Some(doc_id),
        documento_numero: doc_num.to_string(),
        cliente_id,
        cliente_nome,
        ..Default::default()
    }
}

fn save_righe(conn: &Connection, nc_id: i64, righe: &[Value]) -> rusqlite::Result<()> {
    for r in righe {
        if crate::web::riga_vuota(r) {
            continue;
        }
        conn.execute(
            "INSERT INTO note_credito_righe (nota_credito_id, prodotto_id, codice_prodotto, descrizione, quantita, prezzo, sconto, iva, unita_misura, variante_id, variante_taglia, variante_colore, tipo, scarica_magazzino, codice_iva) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
            params![
                nc_id,
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
                // Nota di credito = reso: di norma la merce rientra. Si spegne
                // per le note di sola cifra (abbuono, sconto, errore di prezzo),
                // dove nessun pezzo torna indietro.
                i64::from(!matches!(r.get("scaricaMagazzino"), Some(Value::Bool(false)))),
                str_def(r, "codiceIva"),
            ],
        )?;
    }
    Ok(())
}

fn get_righe(conn: &Connection, nc_id: i64) -> rusqlite::Result<Vec<Value>> {
    let mut stmt = conn.prepare("SELECT r.*, p.codice as prodotto_codice FROM note_credito_righe r LEFT JOIN prodotti p ON r.prodotto_id = p.id WHERE r.nota_credito_id=?1")?;
    let rows = stmt
        .query_map([nc_id], |r| {
            Ok(json!({
                "id": r.get::<_, i64>("id")?,
                "prodottoId": r.get::<_, Option<i64>>("prodotto_id")?,
                "prodottoCodice": r.get::<_, Option<String>>("prodotto_codice")?,
                "codiceProdotto": r.get::<_, Option<String>>("codice_prodotto")?.unwrap_or_default(),
                "descrizione": r.get::<_, Option<String>>("descrizione")?,
                "quantita": opt_num(r.get::<_, Option<f64>>("quantita")?),
                "unitaMisura": r.get::<_, Option<String>>("unita_misura")?,
                "codiceIva": r.get::<_, Option<String>>("codice_iva")?.unwrap_or_default(),
                "prezzo": opt_num(r.get::<_, Option<f64>>("prezzo")?),
                "sconto": num(r.get::<_, Option<f64>>("sconto")?.unwrap_or(0.0)),
                "iva": opt_num(r.get::<_, Option<f64>>("iva")?),
                "varianteId": r.get::<_, Option<i64>>("variante_id")?,
                "varianteTaglia": r.get::<_, Option<String>>("variante_taglia")?.unwrap_or_default(),
                "varianteColore": r.get::<_, Option<String>>("variante_colore")?.unwrap_or_default(),
                "tipo": r.get::<_, Option<String>>("tipo")?.filter(|s| !s.is_empty()).unwrap_or_else(|| "PRODOTTO".into()),
                "scaricaMagazzino": r.get::<_, Option<i64>>("scarica_magazzino")? != Some(0),
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn to_dto(conn: &Connection, r: &Row) -> rusqlite::Result<Value> {
    let id = r.get::<_, i64>("id")?;
    let mut stmt = conn.prepare("SELECT quantita, prezzo, sconto, iva FROM note_credito_righe WHERE nota_credito_id=?1")?;
    let righe: Vec<(f64, f64, f64, f64)> = stmt
        .query_map([id], |x| Ok((x.get::<_, Option<f64>>(0)?.unwrap_or(0.0), x.get::<_, Option<f64>>(1)?.unwrap_or(0.0), x.get::<_, Option<f64>>(2)?.unwrap_or(0.0), x.get::<_, Option<f64>>(3)?.unwrap_or(0.0))))?
        .collect::<Result<Vec<_>, _>>()?;
    let fisc = fisc_from_row(r);
    let t = calcola_totali_fiscali(&righe, &fisc);
    Ok(json!({
        "id": id,
        "numero": r.get::<_, Option<String>>("numero")?,
        "dataEmissione": r.get::<_, Option<String>>("data_emissione")?,
        "clienteId": r.get::<_, Option<i64>>("cliente_id")?,
        "clienteNome": r.get::<_, Option<String>>("cliente_nome").ok().flatten(),
        "fatturaId": r.get::<_, Option<i64>>("fattura_id")?,
        "note": r.get::<_, Option<String>>("note")?,
        "stato": r.get::<_, Option<String>>("stato")?,
        "statoSdi": r.get::<_, Option<String>>("stato_sdi")?,
        "imponibile": num(t.imponibile),
        "totale": num(t.totale),
        "ritenutaAliquota": num(fisc.ritenuta_aliquota),
        "ritenutaCausale": fisc.ritenuta_causale,
        "ritenutaTipo": fisc.ritenuta_tipo,
        "ritenutaSuCassa": fisc.ritenuta_su_cassa,
        "cassaTipo": fisc.cassa_tipo,
        "cassaAliquota": num(fisc.cassa_aliquota),
        "cassaIva": num(fisc.cassa_iva),
        "bollo": fisc.bollo,
        "cassaImporto": num(t.cassa_importo),
        "iva": num(t.iva),
        "ritenutaImporto": num(t.ritenuta_importo),
        "bolloImporto": num(t.bollo_importo),
        "nettoAPagare": num(t.netto_a_pagare),
    }))
}

fn valida_righe(righe: Option<&Value>) -> Option<&'static str> {
    let arr = match righe.and_then(Value::as_array) {
        Some(a) if !a.is_empty() => a,
        _ => return Some("Il documento deve contenere almeno una riga"),
    };
    for r in arr {
        if r.get("quantita").and_then(Value::as_f64).unwrap_or(0.0) < 0.0 {
            return Some("La quantità di una riga non può essere negativa");
        }
        if r.get("prezzo").and_then(Value::as_f64).unwrap_or(0.0) < 0.0 {
            return Some("Il prezzo di una riga non può essere negativo");
        }
    }
    None
}

fn nome_cliente(conn: &Connection, id: Option<i64>) -> String {
    match id {
        Some(i) => conn.query_row("SELECT ragione_sociale FROM clienti WHERE id=?1", [i], |r| r.get::<_, Option<String>>(0)).optional().ok().flatten().flatten().unwrap_or_default(),
        None => String::new(),
    }
}
fn sql_400(e: rusqlite::Error) -> ApiError {
    let msg = match &e {
        rusqlite::Error::SqliteFailure(_, Some(m)) => m.clone(),
        other => other.to_string(),
    };
    ApiError::Status(axum::http::StatusCode::BAD_REQUEST, msg)
}
fn str_or(b: &Value, k: &str, d: &str) -> String {
    let s = str_def(b, k);
    if s.is_empty() { d.to_string() } else { s }
}
fn opt_i64(b: &Value, k: &str) -> Option<i64> {
    b.get(k).and_then(Value::as_i64).filter(|&v| v != 0)
}
fn righe_len(n: &Value) -> usize {
    n.get("righe").and_then(Value::as_array).map(|a| a.len()).unwrap_or(0)
}
