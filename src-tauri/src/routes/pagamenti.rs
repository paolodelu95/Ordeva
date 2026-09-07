//! /api/pagamenti — registro incassi/pagamenti + scadenzario. Parità con routes/pagamenti.js.

use std::collections::HashMap;

use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

use crate::db::AppState;
use crate::error::{ApiError, ApiResult};
use crate::web::{data_scadenza, num, opt_num, tenant_conn};

const TOLERANCE: f64 = 0.05;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/scadenzario", get(scadenzario))
        .route("/:id", axum::routing::put(update).delete(remove))
        .route("/:id/salda", axum::routing::patch(salda))
}

async fn list(
    State(state): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let where_ = match q.get("tipo").map(String::as_str) {
        Some("ENTRATA") => "WHERE p.tipo = 'ENTRATA'",
        Some("USCITA") => "WHERE p.tipo = 'USCITA'",
        _ => "",
    };
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let sql = format!(
        "SELECT p.*, f.numero as fattura_numero, c.ragione_sociale as cliente_nome, \
                a.numero as acquisto_numero, forn.ragione_sociale as fornitore_nome, tp.nome as tipo_pagamento_nome, \
                vb.numero as vendita_banco_numero, vb.cliente_nome as vb_cliente_nome \
         FROM pagamenti p \
         LEFT JOIN fatture f ON p.fattura_id = f.id LEFT JOIN clienti c ON f.cliente_id = c.id \
         LEFT JOIN acquisti a ON p.acquisto_id = a.id LEFT JOIN fornitori forn ON a.fornitore_id = forn.id \
         LEFT JOIN tipi_pagamento tp ON p.tipo_pagamento_id = tp.id \
         LEFT JOIN vendite_banco vb ON p.vendita_banco_id = vb.id {where_} ORDER BY p.data_pagamento DESC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map([], |r| {
            let cliente_nome = r.get::<_, Option<String>>("cliente_nome")?.or(r.get::<_, Option<String>>("vb_cliente_nome")?);
            Ok(json!({
                "id": r.get::<_, i64>("id")?,
                "fatturaId": r.get::<_, Option<i64>>("fattura_id")?,
                "fatturaNumero": r.get::<_, Option<String>>("fattura_numero")?,
                "acquistoId": r.get::<_, Option<i64>>("acquisto_id")?,
                "acquistoNumero": r.get::<_, Option<String>>("acquisto_numero")?,
                "venditaBancoId": r.get::<_, Option<i64>>("vendita_banco_id")?,
                "venditaBancoNumero": r.get::<_, Option<String>>("vendita_banco_numero")?,
                "clienteNome": cliente_nome,
                "fornitoreNome": r.get::<_, Option<String>>("fornitore_nome")?,
                "dataPagamento": r.get::<_, Option<String>>("data_pagamento")?,
                "importo": opt_num(r.get::<_, Option<f64>>("importo")?),
                "metodo": r.get::<_, Option<String>>("metodo")?,
                "note": r.get::<_, Option<String>>("note")?,
                "tipo": r.get::<_, Option<String>>("tipo")?.filter(|s| !s.is_empty()).unwrap_or_else(|| "ENTRATA".into()),
                "conto": r.get::<_, Option<String>>("conto")?.filter(|s| !s.is_empty()).unwrap_or_else(|| "BANCA".into()),
                "causale": r.get::<_, Option<String>>("causale")?.unwrap_or_default(),
                "tipoPagamentoId": r.get::<_, Option<i64>>("tipo_pagamento_id")?,
                "tipoPagamentoNome": r.get::<_, Option<String>>("tipo_pagamento_nome")?,
                "saldato": r.get::<_, Option<i64>>("saldato")?.unwrap_or(1) != 0,
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(Value::Array(rows)))
}

async fn scadenzario(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let mut items: Vec<Value> = Vec::new();
    let mut q1 = conn.prepare(
        "SELECT f.id, f.numero, f.data_emissione, c.ragione_sociale as controparte, tp.giorni_scadenza, tp.fine_mese, tp.conto, tp.nome as tipo_pagamento_nome, \
                COALESCE(SUM(fr.quantita * fr.prezzo * (1 - COALESCE(fr.sconto,0)/100.0) * (1 + COALESCE(fr.iva,0)/100.0)), 0) as importo_totale, \
                COALESCE((SELECT SUM(p.importo) FROM pagamenti p WHERE p.fattura_id = f.id AND p.saldato = 1), 0) as importo_pagato \
         FROM fatture f LEFT JOIN clienti c ON f.cliente_id = c.id LEFT JOIN fatture_righe fr ON fr.fattura_id = f.id \
         LEFT JOIN tipi_pagamento tp ON f.tipo_pagamento_id = tp.id WHERE f.stato = 'EMESSA' GROUP BY f.id HAVING importo_totale > importo_pagato",
    )?;
    collect_scad(&mut q1, "FATTURA", &mut items)?;
    drop(q1);
    let mut q2 = conn.prepare(
        "SELECT a.id, a.numero, a.data_emissione, f.ragione_sociale as controparte, tp.giorni_scadenza, tp.fine_mese, tp.conto, tp.nome as tipo_pagamento_nome, \
                COALESCE(SUM(ar.quantita * ar.prezzo * (1 - COALESCE(ar.sconto,0)/100.0) * (1 + COALESCE(ar.iva,0)/100.0)), 0) as importo_totale, \
                COALESCE((SELECT SUM(p.importo) FROM pagamenti p WHERE p.acquisto_id = a.id AND p.saldato = 1), 0) as importo_pagato \
         FROM acquisti a LEFT JOIN fornitori f ON a.fornitore_id = f.id LEFT JOIN acquisti_righe ar ON ar.acquisto_id = a.id \
         LEFT JOIN tipi_pagamento tp ON a.tipo_pagamento_id = tp.id WHERE a.stato = 'RICEVUTA' GROUP BY a.id HAVING importo_totale > importo_pagato",
    )?;
    collect_scad(&mut q2, "ACQUISTO", &mut items)?;
    drop(q2);
    collect_manuali(&conn, &mut items)?;
    items.sort_by(|a, b| a["dataScadenza"].as_str().unwrap_or("").cmp(b["dataScadenza"].as_str().unwrap_or("")));
    Ok(Json(Value::Array(items)))
}

/// Pagamenti standalone (senza fattura/acquisto/vendita collegati) marcati non
/// saldati: compaiono come voce aperta a sé nello scadenzario finché non
/// vengono saldati (v. `salda`).
fn collect_manuali(conn: &Connection, out: &mut Vec<Value>) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare(
        "SELECT p.id, p.data_pagamento, p.importo, p.tipo, p.conto, p.causale, p.note, tp.nome as tipo_pagamento_nome \
         FROM pagamenti p LEFT JOIN tipi_pagamento tp ON p.tipo_pagamento_id = tp.id \
         WHERE p.fattura_id IS NULL AND p.acquisto_id IS NULL AND p.vendita_banco_id IS NULL AND p.saldato = 0",
    )?;
    let rows = stmt.query_map([], |r| {
        let data = r.get::<_, Option<String>>("data_pagamento")?.unwrap_or_default();
        let importo = r.get::<_, Option<f64>>("importo")?.unwrap_or(0.0);
        let causale = r.get::<_, Option<String>>("causale")?.unwrap_or_default();
        let note = r.get::<_, Option<String>>("note")?.unwrap_or_default();
        let controparte = if !causale.is_empty() { causale } else { note };
        Ok(json!({
            "id": r.get::<_, i64>("id")?,
            "numero": Value::Null,
            "dataEmissione": data.clone(),
            "controparte": controparte,
            "dataScadenza": data,
            "tipoPagamentoNome": r.get::<_, Option<String>>("tipo_pagamento_nome")?,
            "conto": r.get::<_, Option<String>>("conto")?.filter(|s| !s.is_empty()).unwrap_or_else(|| "BANCA".into()),
            "importoTotale": num(importo),
            "importoPagato": num(0.0),
            "rimanente": num(importo),
            "tipo": r.get::<_, Option<String>>("tipo")?.filter(|s| !s.is_empty()).unwrap_or_else(|| "ENTRATA".into()),
            "tipoEntry": "PAGAMENTO_MANUALE",
        }))
    })?;
    for r in rows {
        out.push(r?);
    }
    Ok(())
}

fn collect_scad(stmt: &mut rusqlite::Statement, tipo_entry: &str, out: &mut Vec<Value>) -> rusqlite::Result<()> {
    let rows = stmt.query_map([], |r| {
        let data_em = r.get::<_, Option<String>>("data_emissione")?.unwrap_or_default();
        let giorni = r.get::<_, Option<i64>>("giorni_scadenza")?.unwrap_or(0);
        let fine_mese = r.get::<_, Option<i64>>("fine_mese")? == Some(1);
        let totale = r.get::<_, Option<f64>>("importo_totale")?.unwrap_or(0.0);
        let pagato = r.get::<_, Option<f64>>("importo_pagato")?.unwrap_or(0.0);
        let scad = data_scadenza(&data_em, giorni, fine_mese);
        Ok(json!({
            "id": r.get::<_, i64>("id")?,
            "numero": r.get::<_, Option<String>>("numero")?,
            "dataEmissione": data_em,
            "controparte": r.get::<_, Option<String>>("controparte")?,
            "dataScadenza": scad,
            "tipoPagamentoNome": r.get::<_, Option<String>>("tipo_pagamento_nome")?,
            "conto": r.get::<_, Option<String>>("conto")?.filter(|s| !s.is_empty()).unwrap_or_else(|| "BANCA".into()),
            "importoTotale": num(totale),
            "importoPagato": num(pagato),
            "rimanente": num(totale - pagato),
            "tipoEntry": tipo_entry,
        }))
    })?;
    for r in rows {
        out.push(r?);
    }
    Ok(())
}

async fn create(State(state): State<AppState>, Json(p): Json<Value>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    if let Some(e) = validate_pagamento(&conn, &p, None)? {
        return Err(ApiError::bad_request(e));
    }
    let fid = opt_i64(&p, "fatturaId");
    let aid = opt_i64(&p, "acquistoId");
    let tpid = opt_i64(&p, "tipoPagamentoId");
    let conto = conto_da_tipo(&conn, tpid, p.get("conto").and_then(Value::as_str))?;
    conn.execute(
        "INSERT INTO pagamenti (fattura_id, acquisto_id, data_pagamento, importo, metodo, note, tipo, tipo_pagamento_id, conto, causale, saldato) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
        params![
            fid, aid,
            p.get("dataPagamento").and_then(Value::as_str),
            p.get("importo").and_then(Value::as_f64),
            str_or(&p, "metodo", "Bonifico"),
            str_def(&p, "note"),
            str_or(&p, "tipo", "ENTRATA"),
            tpid, conto,
            str_def(&p, "causale"),
            saldato(&p),
        ],
    )?;
    let id = conn.last_insert_rowid();
    if let Some(f) = fid { aggiorna_stato_fattura(&conn, f)?; }
    if let Some(a) = aid { aggiorna_stato_acquisto(&conn, a)?; }
    Ok(Json(json!({ "id": id })))
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(p): Json<Value>,
) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    if let Some(e) = validate_pagamento(&conn, &p, Some(id))? {
        return Err(ApiError::bad_request(e));
    }
    let fid = opt_i64(&p, "fatturaId");
    let aid = opt_i64(&p, "acquistoId");
    let tpid = opt_i64(&p, "tipoPagamentoId");
    let conto = conto_da_tipo(&conn, tpid, p.get("conto").and_then(Value::as_str))?;
    conn.execute(
        "UPDATE pagamenti SET fattura_id=?1,acquisto_id=?2,data_pagamento=?3,importo=?4,metodo=?5,note=?6,tipo=?7,tipo_pagamento_id=?8,conto=?9,causale=?10,saldato=?11 WHERE id=?12",
        params![
            fid, aid,
            p.get("dataPagamento").and_then(Value::as_str),
            p.get("importo").and_then(Value::as_f64),
            str_or(&p, "metodo", "Bonifico"),
            str_def(&p, "note"),
            str_or(&p, "tipo", "ENTRATA"),
            tpid, conto,
            str_def(&p, "causale"),
            saldato(&p),
            id,
        ],
    )?;
    if let Some(f) = fid { aggiorna_stato_fattura(&conn, f)?; }
    if let Some(a) = aid { aggiorna_stato_acquisto(&conn, a)?; }
    Ok(Json(json!({ "success": true })))
}

async fn remove(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let pag = conn
        .query_row("SELECT fattura_id, acquisto_id FROM pagamenti WHERE id=?1", [id], |r| Ok((r.get::<_, Option<i64>>(0)?, r.get::<_, Option<i64>>(1)?)))
        .optional()?;
    conn.execute("DELETE FROM pagamenti WHERE id=?1", [id])?;
    if let Some((f, a)) = pag {
        if let Some(f) = f { aggiorna_stato_fattura(&conn, f)?; }
        if let Some(a) = a { aggiorna_stato_acquisto(&conn, a)?; }
    }
    Ok(Json(json!({ "success": true })))
}

/// Marca un pagamento come saldato (azione rapida "Salda" dallo Scadenzario) —
/// non richiede di ricostruire l'intero payload del pagamento.
async fn salda(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let pag = conn
        .query_row("SELECT fattura_id, acquisto_id FROM pagamenti WHERE id=?1", [id], |r| Ok((r.get::<_, Option<i64>>(0)?, r.get::<_, Option<i64>>(1)?)))
        .optional()?;
    let Some((f, a)) = pag else {
        return Err(ApiError::bad_request("pagamento non trovato"));
    };
    conn.execute("UPDATE pagamenti SET saldato=1 WHERE id=?1", [id])?;
    if let Some(f) = f { aggiorna_stato_fattura(&conn, f)?; }
    if let Some(a) = a { aggiorna_stato_acquisto(&conn, a)?; }
    Ok(Json(json!({ "success": true })))
}

// ── helpers ──────────────────────────────────────────────────────────────────

fn calcola_rimanente(conn: &Connection, fattura_id: Option<i64>, acquisto_id: Option<i64>, exclude: Option<i64>) -> rusqlite::Result<Option<(f64, f64)>> {
    if let Some(fid) = fattura_id {
        let totale: f64 = conn.query_row("SELECT COALESCE(SUM(quantita * prezzo * (1 - COALESCE(sconto,0)/100.0) * (1 + COALESCE(iva,0)/100.0)), 0) FROM fatture_righe WHERE fattura_id=?1", [fid], |r| r.get(0))?;
        let pagato: f64 = conn.query_row("SELECT COALESCE(SUM(importo), 0) FROM pagamenti WHERE fattura_id=?1 AND saldato=1 AND (?2 IS NULL OR id != ?2)", params![fid, exclude], |r| r.get(0))?;
        return Ok(Some((totale, totale - pagato)));
    }
    if let Some(aid) = acquisto_id {
        let totale: f64 = conn.query_row("SELECT COALESCE(SUM(quantita * prezzo * (1 - COALESCE(sconto,0)/100.0) * (1 + COALESCE(iva,0)/100.0)), 0) FROM acquisti_righe WHERE acquisto_id=?1", [aid], |r| r.get(0))?;
        let pagato: f64 = conn.query_row("SELECT COALESCE(SUM(importo), 0) FROM pagamenti WHERE acquisto_id=?1 AND saldato=1 AND (?2 IS NULL OR id != ?2)", params![aid, exclude], |r| r.get(0))?;
        return Ok(Some((totale, totale - pagato)));
    }
    Ok(None)
}

fn validate_pagamento(conn: &Connection, p: &Value, exclude: Option<i64>) -> rusqlite::Result<Option<String>> {
    if p.get("dataPagamento").and_then(Value::as_str).filter(|s| !s.is_empty()).is_none() {
        return Ok(Some("dataPagamento mancante".into()));
    }
    let importo = match p.get("importo").and_then(Value::as_f64) {
        Some(i) if i.is_finite() => i,
        Some(_) => return Ok(Some("importo non valido".into())),
        None => return Ok(Some("importo non valido".into())),
    };
    if importo <= 0.0 {
        return Ok(Some("importo deve essere positivo".into()));
    }
    let has_fatt = opt_i64(p, "fatturaId").is_some();
    let has_acq = opt_i64(p, "acquistoId").is_some();
    if has_fatt && has_acq {
        return Ok(Some("specificare al massimo uno tra fattura e acquisto".into()));
    }
    if has_fatt || has_acq {
        let r = calcola_rimanente(conn, opt_i64(p, "fatturaId"), opt_i64(p, "acquistoId"), exclude)?;
        let (totale, rimanente) = match r {
            Some(t) => t,
            None => return Ok(Some("fattura/acquisto non trovato".into())),
        };
        if totale <= 0.0 {
            return Ok(Some("documento senza righe imponibili".into()));
        }
        if importo > rimanente + TOLERANCE {
            return Ok(Some(format!("importo {:.2} € supera il residuo ({:.2} €)", importo, rimanente)));
        }
    }
    Ok(None)
}

fn conto_da_tipo(conn: &Connection, tpid: Option<i64>, fallback: Option<&str>) -> rusqlite::Result<String> {
    if let Some(id) = tpid {
        if let Some(conto) = conn.query_row("SELECT conto FROM tipi_pagamento WHERE id=?1", [id], |r| r.get::<_, Option<String>>(0)).optional()?.flatten() {
            if !conto.is_empty() {
                return Ok(conto);
            }
        }
    }
    Ok(fallback.filter(|s| !s.is_empty()).unwrap_or("BANCA").to_string())
}

fn aggiorna_stato_fattura(conn: &Connection, fattura_id: i64) -> rusqlite::Result<()> {
    let nc: i64 = conn.query_row("SELECT COUNT(*) FROM note_credito WHERE fattura_id=?1", [fattura_id], |r| r.get(0))?;
    if nc > 0 {
        conn.execute("UPDATE fatture SET stato='STORNATA' WHERE id=?1", [fattura_id])?;
        return Ok(());
    }
    let totale: f64 = conn.query_row("SELECT COALESCE(SUM(quantita * prezzo * (1 - COALESCE(sconto,0)/100.0) * (1 + COALESCE(iva,0)/100.0)), 0) FROM fatture_righe WHERE fattura_id=?1", [fattura_id], |r| r.get(0))?;
    let pagato: f64 = conn.query_row("SELECT COALESCE(SUM(importo), 0) FROM pagamenti WHERE fattura_id=?1 AND saldato=1", [fattura_id], |r| r.get(0))?;
    let stato = if pagato >= totale && totale > 0.0 { "PAGATA" } else { "EMESSA" };
    conn.execute("UPDATE fatture SET stato=?1 WHERE id=?2", params![stato, fattura_id])?;
    Ok(())
}

fn aggiorna_stato_acquisto(conn: &Connection, acquisto_id: i64) -> rusqlite::Result<()> {
    let totale: f64 = conn.query_row("SELECT COALESCE(SUM(quantita * prezzo * (1 - COALESCE(sconto,0)/100.0) * (1 + COALESCE(iva,0)/100.0)), 0) FROM acquisti_righe WHERE acquisto_id=?1", [acquisto_id], |r| r.get(0))?;
    let pagato: f64 = conn.query_row("SELECT COALESCE(SUM(importo), 0) FROM pagamenti WHERE acquisto_id=?1 AND saldato=1", [acquisto_id], |r| r.get(0))?;
    let stato = if pagato >= totale && totale > 0.0 { "PAGATA" } else { "RICEVUTA" };
    conn.execute("UPDATE acquisti SET stato=?1 WHERE id=?2", params![stato, acquisto_id])?;
    Ok(())
}

fn opt_i64(b: &Value, k: &str) -> Option<i64> {
    b.get(k).and_then(Value::as_i64).filter(|&v| v != 0)
}
fn str_def(b: &Value, k: &str) -> String {
    b.get(k).and_then(Value::as_str).unwrap_or("").to_string()
}
fn str_or(b: &Value, k: &str, d: &str) -> String {
    let s = str_def(b, k);
    if s.is_empty() { d.to_string() } else { s }
}
/// `saldato` di default true — assente/mancante equivale a "già saldato" (compatibile
/// con il comportamento pre-esistente dei pagamenti collegati a fatture/acquisti).
fn saldato(b: &Value) -> i64 {
    if matches!(b.get("saldato"), Some(Value::Bool(false))) { 0 } else { 1 }
}
