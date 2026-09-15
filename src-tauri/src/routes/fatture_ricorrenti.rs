//! /api/fatture-ricorrenti — parità con routes/fattureRicorrenti.js
//! (template di fatture periodiche + emissione transazionale).
//! Nota: l'emissione automatica giornaliera (cron 7:00 in Node) è un job di
//! background gestito a parte; qui ci sono solo gli endpoint HTTP.

use axum::{
    extract::{Path, State},
    routing::{get, post},
    Json, Router,
};
use rusqlite::{params, Connection};
use serde_json::{json, Value};

use crate::db::AppState;
use crate::error::{ApiError, ApiResult};
use crate::numerazione::get_next_numero;
use crate::web::{self, tenant_conn};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/:id", axum::routing::put(update).delete(remove))
        .route("/:id/emetti", post(emetti))
}

fn to_dto(r: &rusqlite::Row) -> rusqlite::Result<Value> {
    let righe_raw: Option<String> = r.get("righe")?;
    let righe: Value = serde_json::from_str(righe_raw.as_deref().unwrap_or("[]"))
        .unwrap_or_else(|_| json!([]));
    let attiva = r.get::<_, Option<i64>>("attiva")?;
    Ok(json!({
        "id": r.get::<_, i64>("id")?,
        "clienteId": r.get::<_, Option<i64>>("cliente_id")?,
        "clienteNome": r.get::<_, Option<String>>("cliente_nome")?.unwrap_or_default(),
        "descrizione": r.get::<_, Option<String>>("descrizione")?,
        "frequenza": r.get::<_, Option<String>>("frequenza")?,
        "giornoEmissione": r.get::<_, Option<i64>>("giorno_emissione")?,
        "prossimaEmissione": r.get::<_, Option<String>>("prossima_emissione")?,
        "attiva": attiva == Some(1),
        "righe": righe,
        "tipoPagamentoId": r.get::<_, Option<i64>>("tipo_pagamento_id")?,
        "note": r.get::<_, Option<String>>("note")?.unwrap_or_default(),
        "createdAt": r.get::<_, Option<String>>("created_at")?,
    }))
}

/// Avanza prossima_emissione di un periodo (semantica UTC di Node: setUTCMonth + setUTCDate).
fn next_emissione(prossima: &str, frequenza: &str, giorno_raw: Option<i64>) -> String {
    let giorno = giorno_raw.unwrap_or(1).clamp(1, 28);
    let (y, m, d) = web::parse_ymd(prossima).unwrap_or((1970, 1, 1));
    let months = match frequenza {
        "MENSILE" => 1,
        "BIMESTRALE" => 2,
        "TRIMESTRALE" => 3,
        "SEMESTRALE" => 6,
        "ANNUALE" => 12,
        _ => 1,
    };
    let new_idx = (m - 1) + months;
    let base_year = y + new_idx.div_euclid(12);
    let base_month = new_idx.rem_euclid(12) + 1;
    // setUTCMonth mantiene il giorno originale (con eventuale overflow nel mese dopo)…
    let first = web::days_of(&format!("{base_year:04}-{base_month:02}-01")).unwrap_or(0);
    let landed = first + (d - 1);
    let landed_iso = web::iso_of_days(landed);
    let (y2, m2, _) = web::parse_ymd(&landed_iso).unwrap_or((base_year, base_month, 1));
    // …poi setUTCDate(giorno) fissa il giorno (≤28, sempre valido).
    format!("{y2:04}-{m2:02}-{giorno:02}")
}

async fn list(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT fr.*, c.ragione_sociale as cliente_nome
         FROM fatture_ricorrenti fr
         LEFT JOIN clienti c ON fr.cliente_id = c.id
         ORDER BY fr.prossima_emissione ASC",
    )?;
    let rows = stmt
        .query_map([], to_dto)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(Value::Array(rows)))
}

async fn create(State(state): State<AppState>, Json(f): Json<Value>) -> ApiResult<Json<Value>> {
    let cliente_id = f.get("clienteId");
    let descrizione = f.get("descrizione").and_then(Value::as_str).unwrap_or("");
    let frequenza = f.get("frequenza").and_then(Value::as_str).unwrap_or("");
    let prossima = f.get("prossimaEmissione").and_then(Value::as_str).unwrap_or("");
    let cliente_truthy = matches!(cliente_id, Some(Value::Number(_))) || matches!(cliente_id, Some(Value::String(s)) if !s.is_empty());
    if !cliente_truthy || descrizione.is_empty() || frequenza.is_empty() || prossima.is_empty() {
        return Err(ApiError::Status(axum::http::StatusCode::BAD_REQUEST, "Campi obbligatori mancanti".into()));
    }
    let righe = serde_json::to_string(f.get("righe").unwrap_or(&json!([]))).unwrap_or_else(|_| "[]".into());
    let cid = cliente_id.and_then(Value::as_i64);
    let giorno = f.get("giornoEmissione").and_then(Value::as_i64).filter(|n| *n != 0).unwrap_or(1);
    let attiva = if web::bool_or_true(&f, "attiva") { 1 } else { 0 };
    let tipo_pag = f.get("tipoPagamentoId").and_then(Value::as_i64);
    let note = f.get("note").and_then(Value::as_str).unwrap_or("");

    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    conn.execute(
        "INSERT INTO fatture_ricorrenti
           (cliente_id, descrizione, frequenza, giorno_emissione, prossima_emissione, attiva, righe, tipo_pagamento_id, note)
         VALUES (?,?,?,?,?,?,?,?,?)",
        params![cid, descrizione, frequenza, giorno, prossima, attiva, righe, tipo_pag, note],
    )?;
    Ok(Json(json!({ "id": conn.last_insert_rowid() })))
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(f): Json<Value>,
) -> ApiResult<Json<Value>> {
    let righe = serde_json::to_string(f.get("righe").unwrap_or(&json!([]))).unwrap_or_else(|_| "[]".into());
    let cid = f.get("clienteId").and_then(Value::as_i64);
    let descrizione = f.get("descrizione").and_then(Value::as_str).unwrap_or("");
    let frequenza = f.get("frequenza").and_then(Value::as_str).unwrap_or("");
    let giorno = f.get("giornoEmissione").and_then(Value::as_i64).filter(|n| *n != 0).unwrap_or(1);
    let prossima = f.get("prossimaEmissione").and_then(Value::as_str).unwrap_or("");
    let attiva = if web::bool_or_true(&f, "attiva") { 1 } else { 0 };
    let tipo_pag = f.get("tipoPagamentoId").and_then(Value::as_i64);
    let note = f.get("note").and_then(Value::as_str).unwrap_or("");

    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    conn.execute(
        "UPDATE fatture_ricorrenti
         SET cliente_id=?, descrizione=?, frequenza=?, giorno_emissione=?, prossima_emissione=?,
             attiva=?, righe=?, tipo_pagamento_id=?, note=?
         WHERE id=?",
        params![cid, descrizione, frequenza, giorno, prossima, attiva, righe, tipo_pag, note, id],
    )?;
    Ok(Json(json!({ "success": true })))
}

async fn remove(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    conn.execute("DELETE FROM fatture_ricorrenti WHERE id=?", params![id])?;
    Ok(Json(json!({ "success": true })))
}

async fn emetti(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let mut conn = conn.lock().unwrap();
    match emetti_template(&mut conn, id)? {
        Some((fattura_id, numero, nuova_prossima)) => {
            Ok(Json(json!({ "id": fattura_id, "numero": numero, "nuovaProssima": nuova_prossima })))
        }
        None => Err(ApiError::Status(axum::http::StatusCode::NOT_FOUND, "Non trovato".into())),
    }
}

/// Emette una fattura reale da un template ricorrente (transazionale) e avanza il
/// periodo. None se il template non esiste. Riusato dall'endpoint e dallo scheduler.
pub fn emetti_template(
    conn: &mut Connection,
    id: i64,
) -> rusqlite::Result<Option<(i64, String, String)>> {
    let tpl = conn
        .query_row(
            "SELECT cliente_id, frequenza, giorno_emissione, prossima_emissione, righe, tipo_pagamento_id, note
             FROM fatture_ricorrenti WHERE id=?",
            params![id],
            |r| {
                Ok((
                    r.get::<_, Option<i64>>(0)?,
                    r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    r.get::<_, Option<i64>>(2)?,
                    r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                    r.get::<_, Option<String>>(4)?.unwrap_or_else(|| "[]".into()),
                    r.get::<_, Option<i64>>(5)?,
                    r.get::<_, Option<String>>(6)?.unwrap_or_default(),
                ))
            },
        )
        .ok();
    let (cliente_id, frequenza, giorno, prossima, righe_json, tipo_pag, note) = match tpl {
        Some(t) => t,
        None => return Ok(None),
    };

    let righe: Vec<Value> = serde_json::from_str(&righe_json).unwrap_or_default();
    let today = web::oggi();

    let tx = conn.transaction()?;
    let numero = get_next_numero(&tx, "fatture", "fatture", 0)?;
    tx.execute(
        "INSERT INTO fatture (numero, data_emissione, cliente_id, note, stato, tipo_pagamento_id)
         VALUES (?,?,?,?,?,?)",
        params![numero, today, cliente_id, note, "EMESSA", tipo_pag],
    )?;
    let fattura_id = tx.last_insert_rowid();
    for riga in &righe {
        if crate::web::riga_vuota(riga) {
            continue;
        }
        tx.execute(
            "INSERT INTO fatture_righe (fattura_id, prodotto_id, descrizione, quantita, prezzo, iva, sconto, unita_misura)
             VALUES (?,?,?,?,?,?,?,?)",
            params![
                fattura_id,
                riga.get("prodottoId").and_then(Value::as_i64),
                riga.get("descrizione").and_then(Value::as_str).unwrap_or(""),
                riga.get("quantita").and_then(Value::as_f64).unwrap_or(1.0),
                riga.get("prezzo").and_then(Value::as_f64).unwrap_or(0.0),
                riga.get("iva").and_then(Value::as_f64).unwrap_or(22.0),
                riga.get("sconto").and_then(Value::as_f64).unwrap_or(0.0),
                riga.get("unitaMisura").and_then(Value::as_str).unwrap_or(""),
            ],
        )?;
    }
    let nuova_prossima = next_emissione(&prossima, &frequenza, giorno);
    tx.execute(
        "UPDATE fatture_ricorrenti SET prossima_emissione=? WHERE id=?",
        params![nuova_prossima, id],
    )?;
    tx.commit()?;
    Ok(Some((fattura_id, numero, nuova_prossima)))
}
