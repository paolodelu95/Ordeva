//! /api/stats — statistiche/BI/export contabili. Parità con routes/stats.js.
//! Per lo più query aggregate read-only; lipe-xml e esterometro-csv sono export.

use std::collections::HashMap;

use axum::{
    extract::{Query, State},
    http::header,
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use rusqlite::{params, Connection, Row};
use serde_json::{json, Value};

use crate::db::AppState;
use crate::error::ApiResult;
use crate::web::{anno, days_in_month, iso_of_days, num, oggi, tenant_conn, today_days};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/vendite-mensili", get(vendite_mensili))
        .route("/acquisti-mensili", get(acquisti_mensili))
        .route("/top-prodotti", get(top_prodotti))
        .route("/top-clienti", get(top_clienti))
        .route("/margini", get(margini))
        .route("/cashflow", get(cashflow))
        .route("/cashflow-forecast", get(cashflow_forecast))
        .route("/cashflow-3060-90", get(cashflow_306090))
        .route("/kpi-anno", get(kpi_anno))
        .route("/iva-trimestre", get(iva_trimestre))
        .route("/lipe-xml", get(lipe_xml))
        .route("/esterometro-csv", get(esterometro_csv))
        .route("/export-contabile", get(export_contabile))
        .route("/bi", get(bi))
}

type Q = Query<HashMap<String, String>>;

fn anno_q(q: &HashMap<String, String>) -> String {
    match q.get("anno").filter(|s| !s.is_empty()) {
        Some(a) => a.clone(),
        None => anno().to_string(),
    }
}
fn round2(x: f64) -> f64 {
    (x * 100.0).round() / 100.0
}

/// "Oggi" come lo calcola Node nei cashflow: `new Date()` → setHours(0) (mezzanotte
/// LOCALE) → toISOString (UTC). Con fuso UTC+ la data UTC risultante è il giorno
/// precedente. Replichiamo usando l'offset locale letto da SQLite.
fn oggi_node(conn: &Connection) -> (i64, String) {
    use std::time::{SystemTime, UNIX_EPOCH};
    let offset: i64 = conn
        .query_row("SELECT CAST(round((julianday('now','localtime') - julianday('now')) * 86400) AS INTEGER)", [], |r| r.get(0))
        .unwrap_or(0);
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) as i64;
    let day_local = (now + offset).div_euclid(86400);
    let local_midnight_utc = day_local * 86400 - offset;
    let days = local_midnight_utc.div_euclid(86400);
    (days, iso_of_days(days))
}
fn round1(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}

async fn vendite_mensili(State(s): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&s)?;
    let conn = conn.lock().unwrap();
    // UNION con vendite_banco (banco + import marketplace, canale EBAY/AMAZON):
    // altrimenti quelle vendite scaricano il magazzino ma restano invisibili qui.
    let mut stmt = conn.prepare(
        "WITH righe AS ( \
            SELECT f.data_emissione as data, fr.quantita, fr.prezzo, fr.sconto, fr.iva \
            FROM fatture f JOIN fatture_righe fr ON fr.fattura_id = f.id \
            WHERE f.data_emissione >= date('now','-12 months') AND f.stato != 'ANNULLATA' \
            UNION ALL \
            SELECT vb.data as data, vbr.quantita, vbr.prezzo, vbr.sconto, vbr.iva \
            FROM vendite_banco vb JOIN vendite_banco_righe vbr ON vbr.vendita_id = vb.id \
            WHERE vb.data >= date('now','-12 months') \
         ) \
         SELECT substr(data,1,7) as mese, \
                COALESCE(SUM(quantita * prezzo * (1-COALESCE(sconto,0)/100)),0) as imponibile, \
                COALESCE(SUM(quantita * prezzo * (1-COALESCE(sconto,0)/100) * (1+iva/100)),0) as totale \
         FROM righe GROUP BY mese ORDER BY mese",
    )?;
    let rows = stmt.query_map([], |r| Ok(json!({
        "mese": r.get::<_, Option<String>>(0)?,
        "imponibile": num(r.get::<_, Option<f64>>(1)?.unwrap_or(0.0)),
        "totale": num(r.get::<_, Option<f64>>(2)?.unwrap_or(0.0)),
    })))?.collect::<Result<Vec<_>, _>>()?;
    Ok(Json(Value::Array(rows)))
}

async fn acquisti_mensili(State(s): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&s)?;
    let conn = conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT substr(a.data_emissione,1,7) as mese, COALESCE(SUM(ar.quantita * ar.prezzo * (1-COALESCE(ar.sconto,0)/100)),0) as imponibile \
         FROM acquisti a JOIN acquisti_righe ar ON ar.acquisto_id = a.id \
         WHERE a.data_emissione >= date('now','-12 months') GROUP BY mese ORDER BY mese",
    )?;
    let rows = stmt.query_map([], |r| Ok(json!({
        "mese": r.get::<_, Option<String>>(0)?,
        "imponibile": num(r.get::<_, Option<f64>>(1)?.unwrap_or(0.0)),
    })))?.collect::<Result<Vec<_>, _>>()?;
    Ok(Json(Value::Array(rows)))
}

async fn top_prodotti(State(s): State<AppState>, Query(q): Q) -> ApiResult<Json<Value>> {
    let anno = anno_q(&q);
    let conn = tenant_conn(&s)?;
    let conn = conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "WITH righe AS ( \
            SELECT substr(f.data_emissione,1,4) as anno, fr.prodotto_id, fr.quantita, fr.prezzo, fr.sconto \
            FROM fatture_righe fr JOIN fatture f ON f.id = fr.fattura_id \
            WHERE f.stato != 'ANNULLATA' AND fr.prodotto_id IS NOT NULL \
            UNION ALL \
            SELECT substr(vb.data,1,4) as anno, vbr.prodotto_id, vbr.quantita, vbr.prezzo, vbr.sconto \
            FROM vendite_banco_righe vbr JOIN vendite_banco vb ON vb.id = vbr.vendita_id \
            WHERE vbr.prodotto_id IS NOT NULL \
         ) \
         SELECT p.nome, COALESCE(SUM(r.quantita * r.prezzo * (1-COALESCE(r.sconto,0)/100)),0) as fatturato, \
                COALESCE(SUM(r.quantita),0) as quantita_venduta \
         FROM righe r LEFT JOIN prodotti p ON p.id = r.prodotto_id \
         WHERE r.anno = ?1 \
         GROUP BY r.prodotto_id ORDER BY fatturato DESC LIMIT 10",
    )?;
    let rows = stmt.query_map([anno], |r| Ok(json!({
        "nome": r.get::<_, Option<String>>(0)?,
        "fatturato": num(r.get::<_, Option<f64>>(1)?.unwrap_or(0.0)),
        "quantita_venduta": num(r.get::<_, Option<f64>>(2)?.unwrap_or(0.0)),
    })))?.collect::<Result<Vec<_>, _>>()?;
    Ok(Json(Value::Array(rows)))
}

async fn top_clienti(State(s): State<AppState>, Query(q): Q) -> ApiResult<Json<Value>> {
    let anno = anno_q(&q);
    let conn = tenant_conn(&s)?;
    let conn = conn.lock().unwrap();
    // Raggruppato per nome (non per id): le vendite_banco/marketplace non hanno un
    // cliente_id, solo un nome testuale — unico modo per unificarle con le fatture.
    let mut stmt = conn.prepare(
        "WITH righe AS ( \
            SELECT substr(f.data_emissione,1,4) as anno, COALESCE(c.ragione_sociale,'') as nome, \
                   fr.quantita, fr.prezzo, fr.sconto, fr.iva \
            FROM fatture f JOIN fatture_righe fr ON fr.fattura_id = f.id LEFT JOIN clienti c ON c.id = f.cliente_id \
            WHERE f.stato != 'ANNULLATA' AND f.cliente_id IS NOT NULL \
            UNION ALL \
            SELECT substr(vb.data,1,4) as anno, vb.cliente_nome as nome, \
                   vbr.quantita, vbr.prezzo, vbr.sconto, vbr.iva \
            FROM vendite_banco vb JOIN vendite_banco_righe vbr ON vbr.vendita_id = vb.id \
            WHERE vb.cliente_nome IS NOT NULL AND vb.cliente_nome != '' \
         ) \
         SELECT nome, COALESCE(SUM(quantita * prezzo * (1-COALESCE(sconto,0)/100) * (1+iva/100)),0) as fatturato \
         FROM righe WHERE anno = ?1 \
         GROUP BY nome ORDER BY fatturato DESC LIMIT 10",
    )?;
    let rows = stmt.query_map([anno], |r| Ok(json!({
        "nome": r.get::<_, Option<String>>(0)?,
        "fatturato": num(r.get::<_, Option<f64>>(1)?.unwrap_or(0.0)),
    })))?.collect::<Result<Vec<_>, _>>()?;
    Ok(Json(Value::Array(rows)))
}

fn con_margine(mut base: Value, ricavo: f64, costo: f64) -> Value {
    let ricavo = round2(ricavo);
    let costo = round2(costo);
    let margine = round2(ricavo - costo);
    let margine_pct = if ricavo > 0.0 { Value::from(round1(margine / ricavo * 100.0)) } else { Value::Null };
    let o = base.as_object_mut().unwrap();
    o.insert("ricavo".into(), num(ricavo));
    o.insert("costo".into(), num(costo));
    o.insert("margine".into(), num(margine));
    o.insert("marginePct".into(), if margine_pct.is_null() { Value::Null } else { num(margine_pct.as_f64().unwrap()) });
    base
}

async fn margini(State(s): State<AppState>, Query(q): Q) -> ApiResult<Json<Value>> {
    let anno = anno_q(&q);
    let conn = tenant_conn(&s)?;
    let conn = conn.lock().unwrap();
    let mut sp = conn.prepare(
        "SELECT p.id, p.nome, COALESCE(NULLIF(TRIM(p.categoria),''),'—') AS categoria, \
                COALESCE(SUM(fr.quantita*fr.prezzo*(1-COALESCE(fr.sconto,0)/100)),0) AS ricavo, \
                COALESCE(SUM(fr.quantita*COALESCE(p.prezzo_acquisto,0)),0) AS costo, COALESCE(SUM(fr.quantita),0) AS quantita \
         FROM fatture_righe fr JOIN fatture f ON f.id = fr.fattura_id JOIN prodotti p ON p.id = fr.prodotto_id \
         WHERE substr(f.data_emissione,1,4) = ?1 AND f.stato != 'ANNULLATA' GROUP BY fr.prodotto_id HAVING ricavo <> 0 OR costo <> 0",
    )?;
    let mut prodotti: Vec<(f64, Value)> = sp.query_map([&anno], |r| {
        let ric = r.get::<_, Option<f64>>(3)?.unwrap_or(0.0);
        let cost = r.get::<_, Option<f64>>(4)?.unwrap_or(0.0);
        let base = json!({ "id": r.get::<_, i64>(0)?, "nome": r.get::<_, Option<String>>(1)?, "categoria": r.get::<_, Option<String>>(2)?, "quantita": num(r.get::<_, Option<f64>>(5)?.unwrap_or(0.0)) });
        let v = con_margine(base, ric, cost);
        Ok((v["margine"].as_f64().unwrap_or(0.0), v))
    })?.collect::<Result<Vec<_>, _>>()?;
    prodotti.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    let tot_ric: f64 = prodotti.iter().map(|(_, v)| v["ricavo"].as_f64().unwrap_or(0.0)).sum();
    let tot_cost: f64 = prodotti.iter().map(|(_, v)| v["costo"].as_f64().unwrap_or(0.0)).sum();
    let prodotti: Vec<Value> = prodotti.into_iter().map(|(_, v)| v).collect();

    let mut sc = conn.prepare(
        "SELECT c.id, c.ragione_sociale AS nome, COALESCE(SUM(fr.quantita*fr.prezzo*(1-COALESCE(fr.sconto,0)/100)),0) AS ricavo, \
                COALESCE(SUM(fr.quantita*COALESCE(p.prezzo_acquisto,0)),0) AS costo \
         FROM fatture f JOIN fatture_righe fr ON fr.fattura_id = f.id LEFT JOIN prodotti p ON p.id = fr.prodotto_id LEFT JOIN clienti c ON c.id = f.cliente_id \
         WHERE substr(f.data_emissione,1,4) = ?1 AND f.stato != 'ANNULLATA' AND f.cliente_id IS NOT NULL GROUP BY f.cliente_id",
    )?;
    let mut clienti: Vec<(f64, Value)> = sc.query_map([&anno], |r| {
        let ric = r.get::<_, Option<f64>>(2)?.unwrap_or(0.0);
        let cost = r.get::<_, Option<f64>>(3)?.unwrap_or(0.0);
        let base = json!({ "id": r.get::<_, i64>(0)?, "nome": r.get::<_, Option<String>>(1)? });
        let v = con_margine(base, ric, cost);
        Ok((v["margine"].as_f64().unwrap_or(0.0), v))
    })?.collect::<Result<Vec<_>, _>>()?;
    clienti.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    let clienti: Vec<Value> = clienti.into_iter().map(|(_, v)| v).collect();

    let totali = con_margine(json!({}), tot_ric, tot_cost);
    Ok(Json(json!({ "anno": anno.parse::<i64>().unwrap_or(0), "prodotti": prodotti, "clienti": clienti, "totali": totali })))
}

async fn cashflow(State(s): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&s)?;
    let conn = conn.lock().unwrap();
    let da_incassare: f64 = conn.query_row(
        "SELECT COALESCE(SUM(rim),0) FROM (SELECT COALESCE(SUM(fr.quantita*fr.prezzo*(1-COALESCE(fr.sconto,0)/100)*(1+fr.iva/100)),0) - COALESCE((SELECT SUM(importo) FROM pagamenti WHERE fattura_id=f.id),0) as rim FROM fatture f JOIN fatture_righe fr ON fr.fattura_id=f.id WHERE f.stato='EMESSA' GROUP BY f.id HAVING rim > 0)",
        [], |r| r.get(0))?;
    let da_pagare: f64 = conn.query_row(
        "SELECT COALESCE(SUM(rim),0) FROM (SELECT COALESCE(SUM(ar.quantita*ar.prezzo*(1-COALESCE(ar.sconto,0)/100)*(1+ar.iva/100)),0) - COALESCE((SELECT SUM(importo) FROM pagamenti WHERE acquisto_id=a.id),0) as rim FROM acquisti a JOIN acquisti_righe ar ON ar.acquisto_id=a.id GROUP BY a.id HAVING rim > 0)",
        [], |r| r.get(0))?;
    Ok(Json(json!({ "daIncassare": num(da_incassare), "daPagare": num(da_pagare) })))
}

// righe (scadenza, rimanente) per i forecast
fn forecast_rows(conn: &Connection, entrata: bool) -> rusqlite::Result<Vec<(String, f64)>> {
    let sql = if entrata {
        "SELECT date(f.data_emissione, '+' || COALESCE(tp.giorni_scadenza, 30) || ' days') AS scadenza, COALESCE(SUM(fr.quantita*fr.prezzo*(1-COALESCE(fr.sconto,0)/100)*(1+fr.iva/100)),0) - COALESCE((SELECT SUM(importo) FROM pagamenti p WHERE p.fattura_id=f.id),0) AS rim FROM fatture f JOIN fatture_righe fr ON fr.fattura_id=f.id LEFT JOIN tipi_pagamento tp ON tp.id=f.tipo_pagamento_id WHERE f.stato NOT IN ('PAGATA','ANNULLATA','STORNATA') GROUP BY f.id HAVING rim > 0"
    } else {
        "SELECT date(a.data_emissione, '+' || COALESCE(tp.giorni_scadenza, 30) || ' days') AS scadenza, COALESCE(SUM(ar.quantita*ar.prezzo*(1-COALESCE(ar.sconto,0)/100)*(1+ar.iva/100)),0) - COALESCE((SELECT SUM(importo) FROM pagamenti p WHERE p.acquisto_id=a.id),0) AS rim FROM acquisti a JOIN acquisti_righe ar ON ar.acquisto_id=a.id LEFT JOIN tipi_pagamento tp ON tp.id=a.tipo_pagamento_id WHERE a.stato NOT IN ('PAGATA','PAGATO','ANNULLATA','ANNULLATO') GROUP BY a.id HAVING rim > 0"
    };
    let mut stmt = conn.prepare(sql)?;
    let v = stmt.query_map([], |r| Ok((r.get::<_, Option<String>>(0)?.unwrap_or_default(), r.get::<_, Option<f64>>(1)?.unwrap_or(0.0))))?.collect::<Result<Vec<_>, _>>()?;
    Ok(v)
}

async fn cashflow_forecast(State(s): State<AppState>, Query(q): Q) -> ApiResult<Json<Value>> {
    let giorni: i64 = q.get("giorni").and_then(|g| g.parse().ok()).unwrap_or(60).clamp(7, 180);
    let conn = tenant_conn(&s)?;
    let conn = conn.lock().unwrap();
    let (oggi_d, oggi_iso) = oggi_node(&conn);
    // Node confronta `new Date(d) > fine` (istanti): con fuso UTC+ equivale a
    // includere solo d < (oggi+giorni). Quindi salta quando d >= fine_iso.
    let fine_iso = iso_of_days(oggi_d + giorni);
    let rin = forecast_rows(&conn, true)?;
    let rout = forecast_rows(&conn, false)?;
    let mut map: HashMap<String, (f64, f64)> = HashMap::new();
    for (sc, rim) in rin {
        let d = if sc < oggi_iso { oggi_iso.clone() } else { sc };
        if d >= fine_iso { continue; }
        map.entry(d).or_default().0 += rim;
    }
    for (sc, rim) in rout {
        let d = if sc < oggi_iso { oggi_iso.clone() } else { sc };
        if d >= fine_iso { continue; }
        map.entry(d).or_default().1 += rim;
    }
    let mut keys: Vec<String> = map.keys().cloned().collect();
    keys.sort();
    let mut cum = 0.0;
    let mut items = Vec::new();
    let (mut tot_in, mut tot_out) = (0.0, 0.0);
    for k in keys {
        let (inn, out) = map[&k];
        cum += inn - out;
        let ri = round2(inn);
        let ro = round2(out);
        tot_in += ri;
        tot_out += ro;
        items.push(json!({ "date": k, "in": num(ri), "out": num(ro), "cumulativo": num(round2(cum)) }));
    }
    Ok(Json(json!({ "giorni": giorni, "saldoFinale": num(round2(cum)), "totEntrate": num(round2(tot_in)), "totUscite": num(round2(tot_out)), "items": items })))
}

async fn cashflow_306090(State(s): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&s)?;
    let conn = conn.lock().unwrap();
    let (oggi_d, oggi_iso) = oggi_node(&conn);
    let d30 = iso_of_days(oggi_d + 30);
    let d60 = iso_of_days(oggi_d + 60);
    let d90 = iso_of_days(oggi_d + 90);
    let rin = forecast_rows(&conn, true)?;
    let rout = forecast_rows(&conn, false)?;
    let saldo_oggi: f64 = conn.query_row("SELECT COALESCE(SUM(CASE WHEN tipo='ENTRATA' THEN importo ELSE 0 END),0) - COALESCE(SUM(CASE WHEN tipo='USCITA' THEN importo ELSE 0 END),0) FROM prima_nota", [], |r| r.get(0))?;
    let saldo_oggi = round2(saldo_oggi);
    let bucket = |entro: &str| -> Value {
        let mut inn = 0.0;
        let mut out = 0.0;
        for (sc, rim) in &rin {
            let d = if sc < &oggi_iso { &oggi_iso } else { sc };
            if d.as_str() <= entro { inn += rim; }
        }
        for (sc, rim) in &rout {
            let d = if sc < &oggi_iso { &oggi_iso } else { sc };
            if d.as_str() <= entro { out += rim; }
        }
        json!({ "in": num(round2(inn)), "out": num(round2(out)), "saldo": num(round2(saldo_oggi + inn - out)) })
    };
    Ok(Json(json!({ "saldoOggi": num(saldo_oggi), "bucket30": bucket(&d30), "bucket60": bucket(&d60), "bucket90": bucket(&d90) })))
}

async fn kpi_anno(State(s): State<AppState>, Query(q): Q) -> ApiResult<Json<Value>> {
    let anno = anno_q(&q);
    let conn = tenant_conn(&s)?;
    let conn = conn.lock().unwrap();
    let fat: f64 = conn.query_row("SELECT COALESCE(SUM(fr.quantita*fr.prezzo*(1-COALESCE(fr.sconto,0)/100)*(1+fr.iva/100)),0) FROM fatture f JOIN fatture_righe fr ON fr.fattura_id=f.id WHERE substr(f.data_emissione,1,4)=?1 AND f.stato!='ANNULLATA'", [&anno], |r| r.get(0))?;
    let acq: f64 = conn.query_row("SELECT COALESCE(SUM(ar.quantita*ar.prezzo*(1-COALESCE(ar.sconto,0)/100)*(1+ar.iva/100)),0) FROM acquisti a JOIN acquisti_righe ar ON ar.acquisto_id=a.id WHERE substr(a.data_emissione,1,4)=?1", [&anno], |r| r.get(0))?;
    Ok(Json(json!({ "fatturato": num(fat), "costi": num(acq), "margine": num(fat - acq) })))
}

fn trim_periodo(q: &HashMap<String, String>) -> (i64, i64, String, String) {
    let anno: i64 = q.get("anno").and_then(|a| a.parse().ok()).unwrap_or_else(anno);
    let trim: i64 = q.get("trimestre").and_then(|t| t.parse().ok()).unwrap_or(1).clamp(1, 4);
    let m_start = (trim - 1) * 3 + 1;
    let m_end = m_start + 2;
    let from = format!("{anno}-{m_start:02}-01");
    let last = days_in_month(anno, m_end);
    let to = format!("{anno}-{m_end:02}-{last:02}");
    (anno, trim, from, to)
}

async fn iva_trimestre(State(s): State<AppState>, Query(q): Q) -> ApiResult<Json<Value>> {
    let (anno, trim, from, to) = trim_periodo(&q);
    let conn = tenant_conn(&s)?;
    let conn = conn.lock().unwrap();
    let vend = iva_per_aliquota(&conn, true, &from, &to)?;
    let acq = iva_per_aliquota(&conn, false, &from, &to)?;
    let iva_debito: f64 = vend.iter().map(|(_, _, i)| i).sum();
    let iva_credito: f64 = acq.iter().map(|(_, _, i)| i).sum();
    let saldo = iva_debito - iva_credito;
    let map_al = |rows: &[(Option<f64>, f64, f64)]| -> Vec<Value> {
        rows.iter().map(|(al, imp, iva)| json!({ "aliquota": al.map(num).unwrap_or(Value::Null), "imponibile": num(round2(*imp)), "iva": num(round2(*iva)) })).collect()
    };
    Ok(Json(json!({
        "anno": anno, "trimestre": trim, "periodo": { "from": from, "to": to },
        "ivaDebito": num(round2(iva_debito)), "ivaCredito": num(round2(iva_credito)), "saldo": num(round2(saldo)),
        "debito": saldo > 0.0,
        "venditePerAliquota": map_al(&vend), "acquistiPerAliquota": map_al(&acq),
    })))
}

fn iva_per_aliquota(conn: &Connection, vendite: bool, from: &str, to: &str) -> rusqlite::Result<Vec<(Option<f64>, f64, f64)>> {
    let sql = if vendite {
        "SELECT fr.iva AS aliquota, COALESCE(SUM(fr.quantita*fr.prezzo*(1-COALESCE(fr.sconto,0)/100.0)),0) as imponibile, COALESCE(SUM(fr.quantita*fr.prezzo*(1-COALESCE(fr.sconto,0)/100.0)*(COALESCE(fr.iva,0)/100.0)),0) as iva FROM fatture f JOIN fatture_righe fr ON fr.fattura_id=f.id WHERE f.data_emissione BETWEEN ?1 AND ?2 AND f.stato != 'ANNULLATA' GROUP BY fr.iva ORDER BY fr.iva"
    } else {
        "SELECT ar.iva AS aliquota, COALESCE(SUM(ar.quantita*ar.prezzo*(1-COALESCE(ar.sconto,0)/100.0)),0) as imponibile, COALESCE(SUM(ar.quantita*ar.prezzo*(1-COALESCE(ar.sconto,0)/100.0)*(COALESCE(ar.iva,0)/100.0)),0) as iva FROM acquisti a JOIN acquisti_righe ar ON ar.acquisto_id=a.id WHERE a.data_emissione BETWEEN ?1 AND ?2 GROUP BY ar.iva ORDER BY ar.iva"
    };
    let mut stmt = conn.prepare(sql)?;
    let v = stmt.query_map(params![from, to], |r| Ok((r.get::<_, Option<f64>>(0)?, r.get::<_, Option<f64>>(1)?.unwrap_or(0.0), r.get::<_, Option<f64>>(2)?.unwrap_or(0.0))))?.collect::<Result<Vec<_>, _>>()?;
    Ok(v)
}

fn xml_resp(xml: String, filename: String) -> Response {
    ([(header::CONTENT_TYPE, "application/xml; charset=utf-8".to_string()), (header::CONTENT_DISPOSITION, format!("attachment; filename=\"{filename}\""))], xml).into_response()
}

async fn lipe_xml(State(s): State<AppState>, Query(q): Q) -> ApiResult<Response> {
    let anno: i64 = q.get("anno").and_then(|a| a.parse().ok()).unwrap_or_else(anno);
    let is_mensile = q.get("mese").map(|m| !m.is_empty()).unwrap_or(false);
    let (m_start, m_end, periodo_tag): (i64, i64, String) = if is_mensile {
        let mese: i64 = q.get("mese").and_then(|m| m.parse().ok()).unwrap_or(1).clamp(1, 12);
        (mese, mese, format!("<Mese>{mese:02}</Mese>"))
    } else {
        let trim: i64 = q.get("trimestre").and_then(|t| t.parse().ok()).unwrap_or(1).clamp(1, 4);
        let ms = (trim - 1) * 3 + 1;
        (ms, ms + 2, format!("<Trimestre>{trim}</Trimestre>"))
    };
    let from = format!("{anno}-{m_start:02}-01");
    let last = days_in_month(anno, m_end);
    let to = format!("{anno}-{m_end:02}-{last:02}");

    let conn = tenant_conn(&s)?;
    let conn = conn.lock().unwrap();
    let (vend_imp, vend_iva): (f64, f64) = conn.query_row(
        "SELECT COALESCE(SUM(fr.quantita*fr.prezzo*(1-COALESCE(fr.sconto,0)/100)),0), COALESCE(SUM(fr.quantita*fr.prezzo*(1-COALESCE(fr.sconto,0)/100)*(fr.iva/100)),0) FROM fatture f JOIN fatture_righe fr ON fr.fattura_id=f.id WHERE f.data_emissione BETWEEN ?1 AND ?2 AND f.stato != 'ANNULLATA'",
        params![from, to], |r| Ok((r.get::<_, Option<f64>>(0)?.unwrap_or(0.0), r.get::<_, Option<f64>>(1)?.unwrap_or(0.0))))?;
    let (acq_imp, acq_iva): (f64, f64) = conn.query_row(
        "SELECT COALESCE(SUM(ar.quantita*ar.prezzo*(1-COALESCE(ar.sconto,0)/100)),0), COALESCE(SUM(ar.quantita*ar.prezzo*(1-COALESCE(ar.sconto,0)/100)*(ar.iva/100)),0) FROM acquisti a JOIN acquisti_righe ar ON ar.acquisto_id=a.id WHERE a.data_emissione BETWEEN ?1 AND ?2",
        params![from, to], |r| Ok((r.get::<_, Option<f64>>(0)?.unwrap_or(0.0), r.get::<_, Option<f64>>(1)?.unwrap_or(0.0))))?;
    let (cf_raw, piva_raw): (String, String) = conn.query_row("SELECT cod_fiscale, p_iva FROM azienda WHERE id=1", [], |r| Ok((r.get::<_, Option<String>>(0)?.unwrap_or_default(), r.get::<_, Option<String>>(1)?.unwrap_or_default()))).unwrap_or_default();

    let vp2 = round2(vend_imp);
    let vp3 = round2(acq_imp);
    let vp4 = round2(vend_iva);
    let vp5 = round2(acq_iva);
    let vp6 = round2(vp4 - vp5);
    let vp14 = if vp6 > 0.0 { vp6 } else { 0.0 };
    let digits = |s: &str| -> String { s.chars().filter(|c| c.is_ascii_digit()).collect() };
    let cf = esc_xml(&digits(if !cf_raw.is_empty() { &cf_raw } else { &piva_raw }));
    let piva = esc_xml(&digits(&piva_raw));
    let identif = if is_mensile { m_start } else { m_end / 3 };
    let vp = |tag: &str, v: f64| if v != 0.0 { format!("<{tag}>{:.2}</{tag}>", v) } else { String::new() };

    let xml = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Fornitura xmlns=\"urn:www.agenziaentrate.gov.it:specificheTecniche:sco:ivp\">\n  <Intestazione>\n    <CodiceFornitura>IVP21</CodiceFornitura>\n    <CodiceFiscaleDichiarante>{cf}</CodiceFiscaleDichiarante>\n  </Intestazione>\n  <Comunicazione identificativo=\"{identif}\">\n    <Frontespizio>\n      <CodiceFiscale>{cf}</CodiceFiscale>\n      <AnnoImposta>{anno}</AnnoImposta>\n      <PartitaIVA>{piva}</PartitaIVA>\n      <CFDichiarante>{cf}</CFDichiarante>\n      <CodiceCaricaDichiarante>1</CodiceCaricaDichiarante>\n    </Frontespizio>\n    <DatiContabili>\n      <Modulo numeroModulo=\"1\">\n        <QuadroVP>\n          {periodo_tag}\n          {vp2}\n          {vp3}\n          {vp4}\n          {vp5}\n          {vp6}\n          {vp14}\n        </QuadroVP>\n      </Modulo>\n    </DatiContabili>\n  </Comunicazione>\n</Fornitura>",
        vp2 = vp("VP2", vp2), vp3 = vp("VP3", vp3), vp4 = vp("VP4", vp4), vp5 = vp("VP5", vp5), vp6 = vp("VP6", vp6), vp14 = vp("VP14", vp14),
    );
    let filename = if is_mensile { format!("LIPE_{anno}_{m_start:02}.xml") } else { format!("LIPE_{anno}_T{}.xml", m_end / 3) };
    Ok(xml_resp(xml, filename))
}

async fn esterometro_csv(State(s): State<AppState>, Query(q): Q) -> ApiResult<Response> {
    let y = anno();
    let data_da = q.get("dataDa").cloned().unwrap_or_else(|| format!("{y}-01-01"));
    let data_a = q.get("dataA").cloned().unwrap_or_else(|| format!("{y}-12-31"));
    let conn = tenant_conn(&s)?;
    let conn = conn.lock().unwrap();
    let mut lines: Vec<String> = vec!["Tipo;Numero;Data;Controparte;PartitaIVA;CodiceFiscale;Paese;Imponibile;IVA;Totale".to_string()];
    let mut sv = conn.prepare(
        "SELECT f.numero, f.data_emissione, c.ragione_sociale, c.p_iva, c.codice_fiscale, c.stato, COALESCE(SUM(fr.quantita*fr.prezzo*(1-COALESCE(fr.sconto,0)/100)),0) as imp, COALESCE(SUM(fr.quantita*fr.prezzo*(1-COALESCE(fr.sconto,0)/100)*(fr.iva/100)),0) as iva FROM fatture f JOIN clienti c ON c.id=f.cliente_id LEFT JOIN fatture_righe fr ON fr.fattura_id=f.id WHERE c.estero=1 AND f.data_emissione BETWEEN ?1 AND ?2 AND f.stato != 'ANNULLATA' GROUP BY f.id ORDER BY f.data_emissione, f.numero")?;
    let vend = sv.query_map(params![data_da, data_a], |r| Ok((sopt(r,0), sopt(r,1), sopt(r,2), sopt(r,3), sopt(r,4), sopt(r,5), r.get::<_, Option<f64>>(6)?.unwrap_or(0.0), r.get::<_, Option<f64>>(7)?.unwrap_or(0.0))))?.collect::<Result<Vec<_>, _>>()?;
    for (numero, data, rs, piva, cf, stato, imp, iva) in vend {
        lines.push([
            "ATTIVA".to_string(), numero, data, rs, piva, cf, stato,
            format!("{:.2}", imp), format!("{:.2}", iva), format!("{:.2}", imp + iva),
        ].iter().map(|v| csv_esc(v)).collect::<Vec<_>>().join(";"));
    }
    let mut sa = conn.prepare(
        "SELECT a.numero, a.data_emissione, forn.ragione_sociale, forn.p_iva, forn.stato, COALESCE(SUM(ar.quantita*ar.prezzo*(1-COALESCE(ar.sconto,0)/100)),0) as imp, COALESCE(SUM(ar.quantita*ar.prezzo*(1-COALESCE(ar.sconto,0)/100)*(ar.iva/100)),0) as iva FROM acquisti a JOIN fornitori forn ON forn.id=a.fornitore_id LEFT JOIN acquisti_righe ar ON ar.acquisto_id=a.id WHERE forn.estero=1 AND a.data_emissione BETWEEN ?1 AND ?2 GROUP BY a.id ORDER BY a.data_emissione, a.numero")?;
    let acq = sa.query_map(params![data_da, data_a], |r| Ok((sopt(r,0), sopt(r,1), sopt(r,2), sopt(r,3), sopt(r,4), r.get::<_, Option<f64>>(5)?.unwrap_or(0.0), r.get::<_, Option<f64>>(6)?.unwrap_or(0.0))))?.collect::<Result<Vec<_>, _>>()?;
    for (numero, data, rs, piva, stato, imp, iva) in acq {
        lines.push([
            "PASSIVA".to_string(), numero, data, rs, piva, String::new(), stato,
            format!("{:.2}", imp), format!("{:.2}", iva), format!("{:.2}", imp + iva),
        ].iter().map(|v| csv_esc(v)).collect::<Vec<_>>().join(";"));
    }
    let csv = format!("\u{feff}{}", lines.join("\r\n"));
    Ok((
        [(header::CONTENT_TYPE, "text/csv; charset=utf-8".to_string()), (header::CONTENT_DISPOSITION, format!("attachment; filename=\"Esterometro_{data_da}_{data_a}.csv\""))],
        csv,
    ).into_response())
}

async fn export_contabile(State(s): State<AppState>, Query(q): Q) -> ApiResult<Json<Value>> {
    let y = anno();
    let data_da = q.get("dataDa").cloned().unwrap_or_else(|| format!("{y}-01-01"));
    let data_a = q.get("dataA").cloned().unwrap_or_else(|| format!("{y}-12-31"));
    let conn = tenant_conn(&s)?;
    let conn = conn.lock().unwrap();
    let mut sv = conn.prepare(
        "SELECT f.id, f.numero, f.data_emissione, f.stato, c.ragione_sociale as controparte, c.p_iva as piva, c.codice_fiscale as cf, COALESCE(SUM(fr.quantita*fr.prezzo*(1-COALESCE(fr.sconto,0)/100)),0) as imponibile, COALESCE(SUM(fr.quantita*fr.prezzo*(1-COALESCE(fr.sconto,0)/100)*(fr.iva/100)),0) as iva, COALESCE(SUM(fr.quantita*fr.prezzo*(1-COALESCE(fr.sconto,0)/100)*(1+fr.iva/100)),0) as totale FROM fatture f LEFT JOIN clienti c ON c.id=f.cliente_id LEFT JOIN fatture_righe fr ON fr.fattura_id=f.id WHERE f.data_emissione BETWEEN ?1 AND ?2 AND f.stato != 'ANNULLATA' GROUP BY f.id ORDER BY f.data_emissione, f.numero")?;
    let vendite: Vec<(Value, f64, f64, f64)> = sv.query_map(params![data_da, data_a], |r| Ok(contabile_dto(r, "VENDITA", true)))?.collect::<Result<Vec<_>, _>>()?;
    let mut sa = conn.prepare(
        "SELECT a.id, a.numero, a.data_emissione, a.stato, forn.ragione_sociale as controparte, forn.p_iva as piva, COALESCE(SUM(ar.quantita*ar.prezzo*(1-COALESCE(ar.sconto,0)/100)),0) as imponibile, COALESCE(SUM(ar.quantita*ar.prezzo*(1-COALESCE(ar.sconto,0)/100)*(ar.iva/100)),0) as iva, COALESCE(SUM(ar.quantita*ar.prezzo*(1-COALESCE(ar.sconto,0)/100)*(1+ar.iva/100)),0) as totale FROM acquisti a LEFT JOIN fornitori forn ON forn.id=a.fornitore_id LEFT JOIN acquisti_righe ar ON ar.acquisto_id=a.id WHERE a.data_emissione BETWEEN ?1 AND ?2 GROUP BY a.id ORDER BY a.data_emissione, a.numero")?;
    let acquisti: Vec<(Value, f64, f64, f64)> = sa.query_map(params![data_da, data_a], |r| Ok(contabile_dto(r, "ACQUISTO", false)))?.collect::<Result<Vec<_>, _>>()?;
    let sum = |v: &[(Value, f64, f64, f64)], idx: u8| -> f64 { round2(v.iter().map(|t| match idx { 0 => t.1, 1 => t.2, _ => t.3 }).sum()) };
    Ok(Json(json!({
        "periodo": { "dataDa": data_da, "dataA": data_a },
        "vendite": vendite.iter().map(|t| t.0.clone()).collect::<Vec<_>>(),
        "acquisti": acquisti.iter().map(|t| t.0.clone()).collect::<Vec<_>>(),
        "totali": {
            "venditeImponibile": num(sum(&vendite, 0)), "venditeIva": num(sum(&vendite, 1)), "venditeTotale": num(sum(&vendite, 2)),
            "acquistiImponibile": num(sum(&acquisti, 0)), "acquistiIva": num(sum(&acquisti, 1)), "acquistiTotale": num(sum(&acquisti, 2)),
        },
    })))
}

fn contabile_dto(r: &Row, tipo: &str, has_cf: bool) -> (Value, f64, f64, f64) {
    let off = if has_cf { 0 } else { 0 };
    let _ = off;
    let imp = r.get::<_, Option<f64>>(if has_cf { 7 } else { 6 }).ok().flatten().unwrap_or(0.0);
    let iva = r.get::<_, Option<f64>>(if has_cf { 8 } else { 7 }).ok().flatten().unwrap_or(0.0);
    let totale = r.get::<_, Option<f64>>(if has_cf { 9 } else { 8 }).ok().flatten().unwrap_or(0.0);
    let v = json!({
        "tipo": tipo, "id": r.get::<_, i64>(0).unwrap_or(0), "numero": sopt(r, 1), "data": sopt(r, 2),
        "controparte": sopt(r, 4), "piva": sopt(r, 5), "cf": if has_cf { sopt(r, 6) } else { String::new() },
        "imponibile": num(round2(imp)), "iva": num(round2(iva)), "totale": num(round2(totale)), "stato": sopt(r, 3),
    });
    (v, round2(imp), round2(iva), round2(totale))
}

async fn bi(State(s): State<AppState>, Query(q): Q) -> ApiResult<Json<Value>> {
    let anno = anno_q(&q);
    let anno_prec = (anno.parse::<i64>().unwrap_or(0) - 1).to_string();
    let conn = tenant_conn(&s)?;
    let conn = conn.lock().unwrap();

    let fattura_mensile = qmap(&conn,
        "SELECT substr(f.data_emissione,1,7) as mese, COALESCE(SUM(fr.quantita*fr.prezzo*(1-COALESCE(fr.sconto,0)/100)*(1+fr.iva/100)),0) as fatturato, COALESCE(SUM(fr.quantita*fr.prezzo*(1-COALESCE(fr.sconto,0)/100)),0) as imponibile FROM fatture f JOIN fatture_righe fr ON fr.fattura_id=f.id WHERE substr(f.data_emissione,1,4) IN (?1,?2) AND f.stato != 'ANNULLATA' GROUP BY mese ORDER BY mese",
        params![anno, anno_prec], |r| json!({ "mese": sopt(r,0), "fatturato": num(fopt(r,1)), "imponibile": num(fopt(r,2)) }))?;
    let acquisti_mensili = qmap(&conn,
        "SELECT substr(a.data_emissione,1,7) as mese, COALESCE(SUM(ar.quantita*ar.prezzo*(1-COALESCE(ar.sconto,0)/100)*(1+ar.iva/100)),0) as costi FROM acquisti a JOIN acquisti_righe ar ON ar.acquisto_id=a.id WHERE substr(a.data_emissione,1,4) IN (?1,?2) GROUP BY mese ORDER BY mese",
        params![anno, anno_prec], |r| json!({ "mese": sopt(r,0), "costi": num(fopt(r,1)) }))?;

    // ABC clienti
    let abc_raw: Vec<(String, f64, i64)> = {
        let mut st = conn.prepare("SELECT c.ragione_sociale as nome, COALESCE(SUM(fr.quantita*fr.prezzo*(1-COALESCE(fr.sconto,0)/100)*(1+fr.iva/100)),0) as fatturato, COUNT(DISTINCT f.id) as numFatture FROM fatture f JOIN fatture_righe fr ON fr.fattura_id=f.id LEFT JOIN clienti c ON c.id=f.cliente_id WHERE substr(f.data_emissione,1,4)=?1 AND f.stato != 'ANNULLATA' AND f.cliente_id IS NOT NULL GROUP BY f.cliente_id ORDER BY fatturato DESC")?;
        let v: Vec<(String, f64, i64)> = st.query_map([&anno], |r| Ok((sopt(r,0), fopt(r,1), r.get::<_, i64>(2)?)))?.collect::<Result<Vec<_>, _>>()?;
        v
    };
    let tot_fat: f64 = abc_raw.iter().map(|(_, f, _)| f).sum();
    let mut cum = 0.0;
    let abc: Vec<Value> = abc_raw.iter().map(|(nome, fatt, nf)| {
        cum += fatt;
        let pct = if tot_fat > 0.0 { fatt / tot_fat * 100.0 } else { 0.0 };
        let pct_cum = if tot_fat > 0.0 { cum / tot_fat * 100.0 } else { 0.0 };
        let pct_cum_r = round1(pct_cum);
        json!({ "nome": nome, "fatturato": num(*fatt), "numFatture": nf, "pct": num(round1(pct)), "pctCumulativa": num(pct_cum_r), "classe": if pct_cum_r <= 80.0 { "A" } else if pct_cum_r <= 95.0 { "B" } else { "C" } })
    }).collect();

    let categorie = qmap(&conn,
        "SELECT COALESCE(NULLIF(TRIM(p.categoria),''),'Senza categoria') as categoria, COALESCE(SUM(fr.quantita*fr.prezzo*(1-COALESCE(fr.sconto,0)/100)),0) as imponibile, COALESCE(SUM(fr.quantita),0) as quantita FROM fatture_righe fr JOIN fatture f ON f.id=fr.fattura_id LEFT JOIN prodotti p ON p.id=fr.prodotto_id WHERE substr(f.data_emissione,1,4)=?1 AND f.stato!='ANNULLATA' GROUP BY categoria ORDER BY imponibile DESC",
        params![anno], |r| json!({ "categoria": sopt(r,0), "imponibile": num(fopt(r,1)), "quantita": num(fopt(r,2)) }))?;

    let dso: Option<f64> = conn.query_row("SELECT AVG(julianday(p.data_pagamento) - julianday(f.data_emissione)) FROM pagamenti p JOIN fatture f ON f.id=p.fattura_id WHERE substr(p.data_pagamento,1,4)=?1 AND p.data_pagamento IS NOT NULL AND f.data_emissione IS NOT NULL", [&anno], |r| r.get::<_, Option<f64>>(0))?;
    let (emesso, incassato): (f64, f64) = conn.query_row(
        "SELECT COALESCE(SUM(fr.quantita*fr.prezzo*(1-COALESCE(fr.sconto,0)/100)*(1+fr.iva/100)),0), COALESCE((SELECT SUM(importo) FROM pagamenti pg JOIN fatture ff ON ff.id=pg.fattura_id WHERE substr(pg.data_pagamento,1,4)=?1 AND ff.stato!='ANNULLATA'),0) FROM fatture f JOIN fatture_righe fr ON fr.fattura_id=f.id WHERE substr(f.data_emissione,1,4)=?2 AND f.stato!='ANNULLATA'",
        params![anno, anno], |r| Ok((r.get::<_, Option<f64>>(0)?.unwrap_or(0.0), r.get::<_, Option<f64>>(1)?.unwrap_or(0.0))))?;

    let prodotti_margini = {
        let mut st = conn.prepare("SELECT p.nome, COALESCE(SUM(fr.quantita*fr.prezzo*(1-COALESCE(fr.sconto,0)/100)),0) as ricavi, COALESCE(SUM(fr.quantita * COALESCE(NULLIF(p.prezzo_acquisto,0), NULL)),0) as costi_stimati, COALESCE(SUM(fr.quantita),0) as qta_venduta FROM fatture_righe fr JOIN fatture f ON f.id=fr.fattura_id JOIN prodotti p ON p.id=fr.prodotto_id WHERE substr(f.data_emissione,1,4)=?1 AND f.stato!='ANNULLATA' GROUP BY fr.prodotto_id HAVING ricavi > 0 ORDER BY (ricavi - costi_stimati) DESC LIMIT 10")?;
        let v: Vec<Value> = st.query_map([&anno], |r| {
            let ricavi = fopt(r, 1);
            let costi = fopt(r, 2);
            Ok(json!({ "nome": sopt(r,0), "ricavi": num(round2(ricavi)), "costiStimati": num(round2(costi)), "margine": num(round2(ricavi - costi)), "marginePerc": if ricavi > 0.0 { num(round1((1.0 - costi / ricavi) * 100.0)) } else { num(0.0) }, "qtaVenduta": num(fopt(r,3)) }))
        })?.collect::<Result<Vec<_>, _>>()?;
        v
    };

    let stagionalita = qmap(&conn,
        "SELECT f.mese_num, AVG(f.mensile) as media FROM (SELECT substr(f.data_emissione,1,7) as ym, substr(f.data_emissione,6,2) as mese_num, SUM(fr.quantita*fr.prezzo*(1-COALESCE(fr.sconto,0)/100)*(1+fr.iva/100)) as mensile FROM fatture f JOIN fatture_righe fr ON fr.fattura_id=f.id WHERE f.stato!='ANNULLATA' GROUP BY ym) f GROUP BY f.mese_num ORDER BY f.mese_num",
        [], |r| json!({ "mese_num": sopt(r,0), "media": fopt_or_null(r,1) }))?;

    Ok(Json(json!({
        "anno": anno, "annoPrec": anno_prec,
        "fatturaMensile": fattura_mensile, "acquistiMensili": acquisti_mensili,
        "abcClienti": abc, "categorie": categorie,
        "dsoMedio": dso.map(|d| num(round1(d))).unwrap_or(Value::Null),
        "incassoStats": { "emesso": num(emesso), "incassato": num(incassato), "tassoIncasso": if emesso > 0.0 { num(round1(incassato / emesso * 100.0)) } else { num(0.0) } },
        "prodottiMargini": prodotti_margini, "stagionalita": stagionalita,
    })))
}

// ── helper ───────────────────────────────────────────────────────────────────

fn qmap(conn: &Connection, sql: &str, p: impl rusqlite::Params, f: impl Fn(&Row) -> Value) -> rusqlite::Result<Vec<Value>> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(p, |r| Ok(f(r)))?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}
fn sopt(r: &Row, i: usize) -> String {
    r.get::<_, Option<String>>(i).ok().flatten().unwrap_or_default()
}
fn fopt(r: &Row, i: usize) -> f64 {
    r.get::<_, Option<f64>>(i).ok().flatten().unwrap_or(0.0)
}
fn fopt_or_null(r: &Row, i: usize) -> Value {
    match r.get::<_, Option<f64>>(i).ok().flatten() {
        Some(v) => num(v),
        None => Value::Null,
    }
}
fn esc_xml(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}
fn csv_esc(s: &str) -> String {
    if s.contains('"') || s.contains(',') || s.contains('\n') || s.contains(';') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}
