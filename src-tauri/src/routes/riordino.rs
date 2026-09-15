//! /api/riordino — proposte di riordino e generazione ordini fornitore.
//! Parità con routes/riordino.js.

use axum::{extract::State, routing::{get, post}, Json, Router};
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};

use crate::db::AppState;
use crate::error::{ApiError, ApiResult};
use crate::web::{num, oggi, tenant_conn};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/proposte", get(proposte))
        .route("/genera", post(genera))
}

async fn proposte(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT p.id, p.descrizione, p.codice, p.quantita, p.soglia_minima, p.riordino_quantita, \
                p.prezzo_acquisto, p.prezzo, p.iva, p.unita_misura, \
                p.fornitore_id_preferito, f.ragione_sociale AS fornitore_nome \
         FROM prodotti p LEFT JOIN fornitori f ON f.id = p.fornitore_id_preferito \
         WHERE p.soglia_minima > 0 AND p.quantita < p.soglia_minima \
         ORDER BY COALESCE(f.ragione_sociale, 'ZZZZ'), p.codice",
    )?;
    let rows = stmt
        .query_map([], |r| {
            let quantita = r.get::<_, Option<f64>>(3)?.unwrap_or(0.0);
            let soglia = r.get::<_, Option<f64>>(4)?.unwrap_or(0.0);
            let riordino_q = r.get::<_, Option<f64>>(5)?.unwrap_or(0.0);
            let prezzo_acq = r.get::<_, Option<f64>>(6)?;
            let prezzo = r.get::<_, Option<f64>>(7)?;
            let iva = r.get::<_, Option<f64>>(8)?;
            let suggerita = if riordino_q > 0.0 {
                riordino_q
            } else {
                let diff = soglia - quantita;
                if diff > 0.0 { diff } else { 1.0 }
            };
            Ok(json!({
                "prodottoId": r.get::<_, i64>(0)?,
                "descrizione": r.get::<_, Option<String>>(1)?,
                "codice": r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                "quantita": num(quantita),
                "sogliaMinima": num(soglia),
                "quantitaSuggerita": num(suggerita),
                "prezzoAcquisto": num(prezzo_acq.or(prezzo).unwrap_or(0.0)),
                "iva": num(iva.unwrap_or(22.0)),
                "unitaMisura": r.get::<_, Option<String>>(9)?.unwrap_or_default(),
                "fornitoreId": r.get::<_, Option<i64>>(10)?,
                "fornitoreNome": r.get::<_, Option<String>>(11)?,
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(Value::Array(rows)))
}

async fn genera(State(state): State<AppState>, Json(b): Json<Value>) -> ApiResult<Json<Value>> {
    // items validi: prodottoId, fornitoreId, quantita > 0
    let items: Vec<&Value> = b
        .get("items")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter(|i| {
                    i.get("prodottoId").and_then(Value::as_i64).filter(|&v| v != 0).is_some()
                        && i.get("fornitoreId").and_then(Value::as_i64).filter(|&v| v != 0).is_some()
                        && i.get("quantita").and_then(Value::as_f64).map(|q| q > 0.0).unwrap_or(false)
                })
                .collect()
        })
        .unwrap_or_default();
    if items.is_empty() {
        return Err(ApiError::bad_request(
            "Nessun prodotto valido da ordinare (serve un fornitore e una quantità).",
        ));
    }

    // raggruppa per fornitore preservando l'ordine di prima apparizione
    let mut order: Vec<i64> = Vec::new();
    let mut groups: std::collections::HashMap<i64, Vec<&Value>> = std::collections::HashMap::new();
    for it in &items {
        let fid = it.get("fornitoreId").and_then(Value::as_i64).unwrap();
        if !groups.contains_key(&fid) {
            order.push(fid);
        }
        groups.entry(fid).or_default().push(it);
    }

    let oggi = oggi();
    let arc = tenant_conn(&state)?;
    let mut guard = arc.lock().unwrap();
    let tx = guard.transaction().map_err(ApiError::from)?;
    let mut created: Vec<Value> = Vec::new();

    for fid in order {
        let righe = &groups[&fid];
        let mut n: i64 = tx.query_row("SELECT COUNT(*) FROM ordini", [], |r| r.get(0))?;
        n += 1;
        let mut numero = format!("RO-{n}");
        while tx.query_row("SELECT id FROM ordini WHERE numero=?1", [&numero], |_| Ok(())).optional()?.is_some() {
            n += 1;
            numero = format!("RO-{n}");
        }
        tx.execute(
            "INSERT INTO ordini (numero, data_ordine, fornitore_id, tipo, stato, note) VALUES (?1,?2,?3,'FORNITORE','APERTO','Riordino scorte')",
            params![numero, oggi, fid],
        )?;
        let ordine_id = tx.last_insert_rowid();
        for r in righe {
            let pid = r.get("prodottoId").and_then(Value::as_i64).unwrap();
            let prod = tx
                .query_row("SELECT codice, descrizione, prezzo_acquisto, prezzo, iva FROM prodotti WHERE id=?1", [pid], |x| {
                    Ok((
                        x.get::<_, Option<String>>(0)?,
                        x.get::<_, Option<String>>(1)?,
                        x.get::<_, Option<f64>>(2)?,
                        x.get::<_, Option<f64>>(3)?,
                        x.get::<_, Option<f64>>(4)?,
                    ))
                })
                .optional()?;
            let (pcodice, pdescr, pacq, pprezzo, piva) = prod.unwrap_or((None, None, None, None, None));
            // La riga d'ordine porta la descrizione del prodotto; senza, il codice.
            let descrizione = pdescr
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| pcodice.as_deref().unwrap_or_default())
                .to_string();
            let pf = tx
                .query_row(
                    "SELECT codice_fornitore, prezzo_acquisto FROM prodotto_fornitori WHERE prodotto_id=?1 AND fornitore_id=?2",
                    params![pid, fid],
                    |x| Ok((x.get::<_, Option<String>>(0)?, x.get::<_, Option<f64>>(1)?)),
                )
                .optional()?;
            let prezzo = pf
                .as_ref()
                .and_then(|(_, pa)| *pa)
                .or(pacq)
                .or(pprezzo)
                .unwrap_or(0.0);
            tx.execute(
                "INSERT INTO ordini_righe (ordine_id, prodotto_id, descrizione, quantita, prezzo, iva, codice_fornitore) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7)",
                params![
                    ordine_id,
                    pid,
                    descrizione,
                    r.get("quantita").and_then(Value::as_f64).unwrap_or(0.0),
                    prezzo,
                    piva.unwrap_or(22.0),
                    pf.as_ref().and_then(|(c, _)| c.clone()).unwrap_or_default(),
                ],
            )?;
        }
        let forn_nome: String = tx
            .query_row("SELECT ragione_sociale FROM fornitori WHERE id=?1", [fid], |r| r.get::<_, Option<String>>(0))
            .optional()?
            .flatten()
            .unwrap_or_default();
        created.push(json!({ "numero": numero, "fornitoreNome": forn_nome, "righe": righe.len() }));
    }
    tx.commit().map_err(ApiError::from)?;
    Ok(Json(json!({ "created": created })))
}
