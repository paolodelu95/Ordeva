//! /api/scadenzario — scadenze fatture (incassare) e acquisti (pagare). Parità con routes/scadenzario.js.

use std::collections::HashMap;

use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use serde_json::{json, Value};

use crate::db::AppState;
use crate::error::ApiResult;
use crate::web::{days_of, num, tenant_conn, today_days};

pub fn routes() -> Router<AppState> {
    Router::new().route("/", get(list))
}

async fn list(
    State(state): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let oggi = today_days();
    let mut items: Vec<Value> = Vec::new();

    let mut q1 = conn.prepare(
        "SELECT f.id, f.numero, f.data_emissione, f.stato, c.ragione_sociale as cliente_nome, \
                date(f.data_emissione, '+' || COALESCE(tp.giorni_scadenza, 30) || ' days') as data_scadenza, \
                COALESCE((SELECT SUM(fr.quantita * fr.prezzo * (1 - COALESCE(fr.sconto,0)/100) * (1 + fr.iva/100)) FROM fatture_righe fr WHERE fr.fattura_id = f.id), 0) as totale \
         FROM fatture f LEFT JOIN clienti c ON f.cliente_id = c.id LEFT JOIN tipi_pagamento tp ON f.tipo_pagamento_id = tp.id \
         WHERE f.stato NOT IN ('PAGATA','ANNULLATA','STORNATA')",
    )?;
    let rows1 = q1.query_map([], |r| Ok(to_item(r, "fattura", "ENTRATA", "cliente_nome", oggi)))?.collect::<Result<Vec<_>, _>>()?;
    items.extend(rows1);
    drop(q1);

    let mut q2 = conn.prepare(
        "SELECT a.id, a.numero, a.data_emissione, a.stato, forn.ragione_sociale as fornitore_nome, \
                date(a.data_emissione, '+' || COALESCE(tp.giorni_scadenza, 30) || ' days') as data_scadenza, \
                COALESCE((SELECT SUM(ar.quantita * ar.prezzo * (1 - COALESCE(ar.sconto,0)/100) * (1 + ar.iva/100)) FROM acquisti_righe ar WHERE ar.acquisto_id = a.id), 0) as totale \
         FROM acquisti a LEFT JOIN fornitori forn ON a.fornitore_id = forn.id LEFT JOIN tipi_pagamento tp ON a.tipo_pagamento_id = tp.id \
         WHERE a.stato NOT IN ('PAGATO','ANNULLATO','PAGATA')",
    )?;
    let rows2 = q2.query_map([], |r| Ok(to_item(r, "acquisto", "USCITA", "fornitore_nome", oggi)))?.collect::<Result<Vec<_>, _>>()?;
    items.extend(rows2);
    drop(q2);

    let mut q3 = conn.prepare(
        "SELECT p.id, p.data_pagamento, p.tipo, p.causale, p.note, p.importo \
         FROM pagamenti p \
         WHERE p.fattura_id IS NULL AND p.acquisto_id IS NULL AND p.vendita_banco_id IS NULL AND p.saldato = 0",
    )?;
    let rows3 = q3
        .query_map([], |r| {
            let data = r.get::<_, Option<String>>("data_pagamento")?.unwrap_or_default();
            let causale = r.get::<_, Option<String>>("causale")?.unwrap_or_default();
            let note = r.get::<_, Option<String>>("note")?.unwrap_or_default();
            let controparte = if !causale.is_empty() { causale } else { note };
            let giorni_mancanti = days_of(&data).map(|d| d - oggi);
            Ok(json!({
                "id": r.get::<_, i64>("id")?,
                "numero": Value::Null,
                "tipo": "manuale",
                "direzione": r.get::<_, Option<String>>("tipo")?.filter(|s| !s.is_empty()).unwrap_or_else(|| "ENTRATA".into()),
                "dataScadenza": data.clone(),
                "dataEmissione": data,
                "totale": num(r.get::<_, Option<f64>>("importo")?.unwrap_or(0.0)),
                "stato": "APERTO",
                "controparte": controparte,
                "giorniMancanti": giorni_mancanti,
                "scaduto": giorni_mancanti.map(|g| g < 0).unwrap_or(false),
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    items.extend(rows3);
    drop(q3);

    if let Some(mese) = q.get("mese").filter(|m| is_yyyymm(m)) {
        items.retain(|i| i["dataScadenza"].as_str().map(|d| d.starts_with(mese.as_str())).unwrap_or(false));
    }
    items.sort_by(|a, b| a["dataScadenza"].as_str().unwrap_or("").cmp(b["dataScadenza"].as_str().unwrap_or("")));
    Ok(Json(Value::Array(items)))
}

fn to_item(r: &rusqlite::Row, tipo: &str, direzione: &str, controparte_col: &str, oggi: i64) -> Value {
    let data_scadenza = r.get::<_, Option<String>>("data_scadenza").ok().flatten();
    let giorni_mancanti = data_scadenza.as_deref().and_then(days_of).map(|d| d - oggi);
    let totale = r.get::<_, Option<f64>>("totale").ok().flatten().unwrap_or(0.0);
    json!({
        "id": r.get::<_, i64>("id").unwrap_or(0),
        "numero": r.get::<_, Option<String>>("numero").ok().flatten(),
        "tipo": tipo,
        "direzione": direzione,
        "dataScadenza": data_scadenza,
        "dataEmissione": r.get::<_, Option<String>>("data_emissione").ok().flatten(),
        "totale": num(totale),
        "stato": r.get::<_, Option<String>>("stato").ok().flatten(),
        "controparte": r.get::<_, Option<String>>(controparte_col).ok().flatten(),
        "giorniMancanti": giorni_mancanti,
        "scaduto": giorni_mancanti.map(|g| g < 0).unwrap_or(false),
    })
}

fn is_yyyymm(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 7 && b[4] == b'-' && b[0..4].iter().all(u8::is_ascii_digit) && b[5..7].iter().all(u8::is_ascii_digit)
}
