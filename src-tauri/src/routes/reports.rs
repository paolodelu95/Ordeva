//! /api/reports — report builder template-based. Parità con routes/reports.js.

use axum::{extract::State, routing::{get, post}, Json, Router};
use rusqlite::{types::ValueRef, Connection, Row};
use serde_json::{json, Map, Value};

use crate::db::AppState;
use crate::error::{ApiError, ApiResult};
use crate::web::{anno, num, oggi, tenant_conn};

pub fn routes() -> Router<AppState> {
    Router::new().route("/", get(list)).route("/run", post(run))
}

/// (key, nome, descrizione, categoria, parametri)
const META: &[(&str, &str, &str, &str, &[&str])] = &[
    ("vendite-per-cliente", "Vendite per cliente", "Fatturato totale, numero fatture e ultimo invio per ogni cliente, nel periodo selezionato.", "Vendite", &["dataDa", "dataA"]),
    ("vendite-per-prodotto", "Vendite per prodotto", "Quantità venduta, imponibile e totale per prodotto, nel periodo selezionato.", "Vendite", &["dataDa", "dataA"]),
    ("vendite-mensili", "Andamento vendite mensile", "Fatturato per mese, ordinato cronologicamente.", "Vendite", &["dataDa", "dataA"]),
    ("acquisti-per-fornitore", "Acquisti per fornitore", "Totale acquistato, numero documenti e ultimo acquisto per ogni fornitore.", "Acquisti", &["dataDa", "dataA"]),
    ("acquisti-per-conto", "Acquisti per conto contabile", "Spese aggregate per conto (es. Carburanti, Cancelleria, Utenze).", "Acquisti", &["dataDa", "dataA"]),
    ("giacenze", "Giacenze magazzino", "Quantità e valore di magazzino per prodotto. Valore = quantità × prezzo (o prezzo acquisto se presente).", "Magazzino", &[]),
    ("iva-per-aliquota", "IVA per aliquota", "Riepilogo imponibile e IVA per aliquota, suddiviso tra vendite e acquisti.", "Contabilità", &["dataDa", "dataA"]),
    ("scadute", "Scadenze scadute", "Fatture e acquisti con scadenza già passata, residuo da incassare/pagare.", "Contabilità", &[]),
];

async fn list(State(_s): State<AppState>) -> ApiResult<Json<Value>> {
    let out: Vec<Value> = META.iter().map(|(k, n, d, c, p)| json!({
        "key": k, "nome": n, "descrizione": d, "categoria": c, "parametri": p,
    })).collect();
    Ok(Json(Value::Array(out)))
}

async fn run(State(s): State<AppState>, Json(b): Json<Value>) -> ApiResult<Json<Value>> {
    let key = b.get("key").and_then(Value::as_str).unwrap_or("");
    let meta = match META.iter().find(|m| m.0 == key) {
        Some(m) => m,
        None => return Err(ApiError::not_found("Report non trovato")),
    };
    let p_in = b.get("parametri").cloned().unwrap_or_else(|| json!({}));
    let y = anno();
    let data_da = if meta.4.contains(&"dataDa") {
        p_in.get("dataDa").and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string).unwrap_or_else(|| format!("{y}-01-01"))
    } else {
        String::new()
    };
    let data_a = if meta.4.contains(&"dataA") {
        p_in.get("dataA").and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string).unwrap_or_else(oggi)
    } else {
        String::new()
    };
    // parametri di echo (come Node: p con eventuali default applicati)
    let mut p_echo = Map::new();
    if meta.4.contains(&"dataDa") { p_echo.insert("dataDa".into(), json!(data_da)); }
    if meta.4.contains(&"dataA") { p_echo.insert("dataA".into(), json!(data_a)); }
    // preserva eventuali altri parametri passati
    if let Some(obj) = p_in.as_object() {
        for (k, v) in obj {
            p_echo.entry(k.clone()).or_insert_with(|| v.clone());
        }
    }

    let conn = tenant_conn(&s)?;
    let conn = conn.lock().unwrap();
    let (colonne, righe, tot_fields) = exec(&conn, key, &data_da, &data_a)?;
    let totali = aggregate(&righe, &tot_fields);

    Ok(Json(json!({
        "key": key, "nome": meta.1, "parametri": Value::Object(p_echo),
        "colonne": colonne, "righe": righe, "totali": totali,
    })))
}

fn aggregate(righe: &[Value], fields: &[&str]) -> Value {
    let mut o = Map::new();
    for f in fields {
        let sum: f64 = righe.iter().map(|r| r.get(*f).and_then(Value::as_f64).unwrap_or(0.0)).sum();
        o.insert((*f).to_string(), num(sum));
    }
    Value::Object(o)
}

fn col(key: &str, label: &str, format: &str) -> Value {
    json!({ "key": key, "label": label, "format": format })
}

fn row_to_json(row: &Row, cols: &[String]) -> rusqlite::Result<Value> {
    let mut o = Map::new();
    for (i, name) in cols.iter().enumerate() {
        let v = match row.get_ref(i)? {
            ValueRef::Null => Value::Null,
            ValueRef::Integer(n) => json!(n),
            ValueRef::Real(f) => num(f),
            ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
            ValueRef::Blob(_) => Value::Null,
        };
        o.insert(name.clone(), v);
    }
    Ok(Value::Object(o))
}

fn query(conn: &Connection, sql: &str, p: impl rusqlite::Params) -> rusqlite::Result<Vec<Value>> {
    let mut stmt = conn.prepare(sql)?;
    let cols: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let rows = stmt.query_map(p, |r| row_to_json(r, &cols))?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[allow(clippy::type_complexity)]
fn exec(conn: &Connection, key: &str, da: &str, a: &str) -> ApiResult<(Vec<Value>, Vec<Value>, Vec<&'static str>)> {
    use rusqlite::params;
    let r = match key {
        "vendite-per-cliente" => (
            vec![col("cliente","Cliente","text"),col("p_iva","P.IVA","text"),col("num_fatture","N° fatture","int"),col("imponibile","Imponibile","eur"),col("iva","IVA","eur"),col("totale","Totale","eur"),col("ultima_fattura","Ultima fattura","date")],
            query(conn, "SELECT c.ragione_sociale AS cliente, c.p_iva AS p_iva, COUNT(DISTINCT f.id) AS num_fatture, COALESCE(SUM(fr.quantita*fr.prezzo*(1-COALESCE(fr.sconto,0)/100)),0) AS imponibile, COALESCE(SUM(fr.quantita*fr.prezzo*(1-COALESCE(fr.sconto,0)/100)*(fr.iva/100)),0) AS iva, COALESCE(SUM(fr.quantita*fr.prezzo*(1-COALESCE(fr.sconto,0)/100)*(1+fr.iva/100)),0) AS totale, MAX(f.data_emissione) AS ultima_fattura FROM fatture f JOIN clienti c ON c.id=f.cliente_id LEFT JOIN fatture_righe fr ON fr.fattura_id=f.id WHERE f.data_emissione BETWEEN ?1 AND ?2 AND f.stato!='ANNULLATA' GROUP BY f.cliente_id ORDER BY totale DESC", params![da, a])?,
            vec!["num_fatture","imponibile","iva","totale"],
        ),
        "vendite-per-prodotto" => (
            vec![col("prodotto","Prodotto","text"),col("codice","Codice","text"),col("categoria","Categoria","text"),col("quantita","Q.tà venduta","num"),col("imponibile","Imponibile","eur"),col("totale","Totale (IVA inc.)","eur")],
            query(conn, "SELECT COALESCE(NULLIF(p.descrizione,''), fr.descrizione) AS prodotto, COALESCE(p.codice, '') AS codice, COALESCE(p.categoria, '') AS categoria, COALESCE(SUM(fr.quantita), 0) AS quantita, COALESCE(SUM(fr.quantita*fr.prezzo*(1-COALESCE(fr.sconto,0)/100)),0) AS imponibile, COALESCE(SUM(fr.quantita*fr.prezzo*(1-COALESCE(fr.sconto,0)/100)*(1+fr.iva/100)),0) AS totale FROM fatture f JOIN fatture_righe fr ON fr.fattura_id=f.id LEFT JOIN prodotti p ON p.id=fr.prodotto_id WHERE f.data_emissione BETWEEN ?1 AND ?2 AND f.stato!='ANNULLATA' AND fr.tipo!='NOTA' GROUP BY COALESCE(p.id, fr.descrizione) ORDER BY totale DESC", params![da, a])?,
            vec!["quantita","imponibile","totale"],
        ),
        "vendite-mensili" => (
            vec![col("mese","Mese","text"),col("num_fatture","N° fatture","int"),col("imponibile","Imponibile","eur"),col("totale","Totale","eur")],
            query(conn, "SELECT substr(f.data_emissione,1,7) AS mese, COUNT(DISTINCT f.id) AS num_fatture, COALESCE(SUM(fr.quantita*fr.prezzo*(1-COALESCE(fr.sconto,0)/100)),0) AS imponibile, COALESCE(SUM(fr.quantita*fr.prezzo*(1-COALESCE(fr.sconto,0)/100)*(1+fr.iva/100)),0) AS totale FROM fatture f JOIN fatture_righe fr ON fr.fattura_id=f.id WHERE f.data_emissione BETWEEN ?1 AND ?2 AND f.stato!='ANNULLATA' GROUP BY mese ORDER BY mese", params![da, a])?,
            vec!["num_fatture","imponibile","totale"],
        ),
        "acquisti-per-fornitore" => (
            vec![col("fornitore","Fornitore","text"),col("p_iva","P.IVA","text"),col("num_acquisti","N° acquisti","int"),col("imponibile","Imponibile","eur"),col("iva","IVA","eur"),col("totale","Totale","eur"),col("ultimo_acquisto","Ultimo acquisto","date")],
            query(conn, "SELECT f.ragione_sociale AS fornitore, f.p_iva AS p_iva, COUNT(DISTINCT a.id) AS num_acquisti, COALESCE(SUM(ar.quantita*ar.prezzo*(1-COALESCE(ar.sconto,0)/100)),0) AS imponibile, COALESCE(SUM(ar.quantita*ar.prezzo*(1-COALESCE(ar.sconto,0)/100)*(ar.iva/100)),0) AS iva, COALESCE(SUM(ar.quantita*ar.prezzo*(1-COALESCE(ar.sconto,0)/100)*(1+ar.iva/100)),0) AS totale, MAX(a.data_emissione) AS ultimo_acquisto FROM acquisti a JOIN fornitori f ON f.id=a.fornitore_id LEFT JOIN acquisti_righe ar ON ar.acquisto_id=a.id WHERE a.data_emissione BETWEEN ?1 AND ?2 GROUP BY a.fornitore_id ORDER BY totale DESC", params![da, a])?,
            vec!["num_acquisti","imponibile","iva","totale"],
        ),
        "acquisti-per-conto" => (
            vec![col("conto","Conto","text"),col("num_acquisti","N° documenti","int"),col("imponibile","Imponibile","eur"),col("totale","Totale (IVA inc.)","eur")],
            query(conn, "SELECT COALESCE(ca.nome, '(non assegnato)') AS conto, COUNT(DISTINCT a.id) AS num_acquisti, COALESCE(SUM(ar.quantita*ar.prezzo*(1-COALESCE(ar.sconto,0)/100)),0) AS imponibile, COALESCE(SUM(ar.quantita*ar.prezzo*(1-COALESCE(ar.sconto,0)/100)*(1+ar.iva/100)),0) AS totale FROM acquisti a LEFT JOIN conti_acquisto ca ON ca.id=a.conto_acquisto_id LEFT JOIN acquisti_righe ar ON ar.acquisto_id=a.id WHERE a.data_emissione BETWEEN ?1 AND ?2 GROUP BY a.conto_acquisto_id ORDER BY totale DESC", params![da, a])?,
            vec!["num_acquisti","imponibile","totale"],
        ),
        "giacenze" => (
            vec![col("prodotto","Prodotto","text"),col("codice","Codice","text"),col("categoria","Categoria","text"),col("quantita","Q.tà","num"),col("soglia_minima","Soglia min","int"),col("valore_unitario","€ unit.","eur"),col("valore_totale","Valore","eur"),col("stato","Stato","text")],
            query(conn, "SELECT COALESCE(NULLIF(descrizione,''), codice) AS prodotto, codice, categoria, quantita, soglia_minima, COALESCE(prezzo_acquisto, prezzo) AS valore_unitario, quantita * COALESCE(prezzo_acquisto, prezzo) AS valore_totale, CASE WHEN quantita < soglia_minima THEN 'sotto soglia' ELSE 'ok' END AS stato FROM prodotti ORDER BY valore_totale DESC", [])?,
            vec!["quantita","valore_totale"],
        ),
        "iva-per-aliquota" => {
            let colonne = vec![col("tipo","Tipo","text"),col("aliquota","Aliquota","pct"),col("imponibile","Imponibile","eur"),col("iva","IVA","eur")];
            let mut rows = query(conn, "SELECT 'VENDITA' AS tipo, fr.iva AS aliquota, COALESCE(SUM(fr.quantita*fr.prezzo*(1-COALESCE(fr.sconto,0)/100)),0) AS imponibile, COALESCE(SUM(fr.quantita*fr.prezzo*(1-COALESCE(fr.sconto,0)/100)*(fr.iva/100)),0) AS iva FROM fatture f JOIN fatture_righe fr ON fr.fattura_id=f.id WHERE f.data_emissione BETWEEN ?1 AND ?2 AND f.stato!='ANNULLATA' GROUP BY fr.iva", params![da, a])?;
            rows.extend(query(conn, "SELECT 'ACQUISTO' AS tipo, ar.iva AS aliquota, COALESCE(SUM(ar.quantita*ar.prezzo*(1-COALESCE(ar.sconto,0)/100)),0) AS imponibile, COALESCE(SUM(ar.quantita*ar.prezzo*(1-COALESCE(ar.sconto,0)/100)*(ar.iva/100)),0) AS iva FROM acquisti a JOIN acquisti_righe ar ON ar.acquisto_id=a.id WHERE a.data_emissione BETWEEN ?1 AND ?2 GROUP BY ar.iva", params![da, a])?);
            rows.sort_by(|x, y| {
                let t = x["tipo"].as_str().unwrap_or("").cmp(y["tipo"].as_str().unwrap_or(""));
                if t != std::cmp::Ordering::Equal { t } else {
                    x["aliquota"].as_f64().unwrap_or(0.0).partial_cmp(&y["aliquota"].as_f64().unwrap_or(0.0)).unwrap_or(std::cmp::Ordering::Equal)
                }
            });
            (colonne, rows, vec!["imponibile","iva"])
        }
        "scadute" => {
            let colonne = vec![col("tipo","Tipo","text"),col("numero","Numero","text"),col("controparte","Controparte","text"),col("data_emissione","Data emissione","date"),col("scadenza","Scadenza","date"),col("residuo","Residuo","eur")];
            let oggi_iso = oggi();
            let mut rows = query(conn, "SELECT 'FATTURA' AS tipo, f.numero, c.ragione_sociale AS controparte, f.data_emissione, date(f.data_emissione, '+' || COALESCE(tp.giorni_scadenza, 30) || ' days') AS scadenza, (SELECT COALESCE(SUM(quantita*prezzo*(1-COALESCE(sconto,0)/100)*(1+iva/100)),0) FROM fatture_righe WHERE fattura_id=f.id) - COALESCE((SELECT SUM(importo) FROM pagamenti WHERE fattura_id=f.id), 0) AS residuo FROM fatture f LEFT JOIN clienti c ON c.id=f.cliente_id LEFT JOIN tipi_pagamento tp ON tp.id=f.tipo_pagamento_id WHERE f.stato='EMESSA' UNION ALL SELECT 'ACQUISTO' AS tipo, a.numero, fo.ragione_sociale AS controparte, a.data_emissione, date(a.data_emissione, '+' || COALESCE(tp.giorni_scadenza, 30) || ' days') AS scadenza, (SELECT COALESCE(SUM(quantita*prezzo*(1-COALESCE(sconto,0)/100)*(1+iva/100)),0) FROM acquisti_righe WHERE acquisto_id=a.id) - COALESCE((SELECT SUM(importo) FROM pagamenti WHERE acquisto_id=a.id), 0) AS residuo FROM acquisti a LEFT JOIN fornitori fo ON fo.id=a.fornitore_id LEFT JOIN tipi_pagamento tp ON tp.id=a.tipo_pagamento_id WHERE a.stato NOT IN ('PAGATA','ANNULLATA')", [])?;
            rows.retain(|r| {
                let scad = r["scadenza"].as_str().unwrap_or("");
                let res = r["residuo"].as_f64().unwrap_or(0.0);
                scad < oggi_iso.as_str() && res > 0.01
            });
            rows.sort_by(|x, y| x["scadenza"].as_str().unwrap_or("").cmp(y["scadenza"].as_str().unwrap_or("")));
            (colonne, rows, vec!["residuo"])
        }
        _ => return Err(ApiError::not_found("Report non trovato")),
    };
    Ok(r)
}
