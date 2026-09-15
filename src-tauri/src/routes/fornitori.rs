//! /api/fornitori — parità con routes/fornitori.js

use std::collections::HashMap;

use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use rusqlite::{params, OptionalExtension, Row};
use serde_json::{json, Value};

use crate::db::AppState;
use crate::error::{ApiError, ApiResult};
use crate::gemello::{applica_da_fornitore, normalize_piva, scollega_fornitore};
use crate::web::{flag_opt, raw_opt, str_def, tenant_conn};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/check-piva", get(check_piva))
        .route("/import", axum::routing::post(import))
        .route("/:id", get(detail).put(update).delete(remove))
        .route("/:id/nascosto", axum::routing::patch(patch_nascosto))
}

fn to_dto(r: &Row) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": r.get::<_, i64>("id")?,
        "ragioneSociale": r.get::<_, Option<String>>("ragione_sociale")?,
        "email": r.get::<_, Option<String>>("email")?,
        "telefono": r.get::<_, Option<String>>("telefono")?,
        "cellulare": r.get::<_, Option<String>>("cellulare")?,
        "via": r.get::<_, Option<String>>("via")?,
        "cap": r.get::<_, Option<String>>("cap")?,
        "citta": r.get::<_, Option<String>>("citta")?,
        "provincia": r.get::<_, Option<String>>("provincia")?,
        "stato": r.get::<_, Option<String>>("stato")?,
        "pIva": r.get::<_, Option<String>>("p_iva")?,
        "sdi": r.get::<_, Option<String>>("sdi")?,
        "pec": r.get::<_, Option<String>>("pec")?,
        "estero": r.get::<_, Option<i64>>("estero")? == Some(1),
        "ancheCliente": r.get::<_, Option<i64>>("anche_cliente")? == Some(1),
        "clienteCollegatoId": r.get::<_, Option<i64>>("cliente_collegato_id")?,
        "nascosto": r.get::<_, Option<i64>>("nascosto")? == Some(1),
    }))
}

async fn list(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let mut stmt = conn.prepare("SELECT * FROM fornitori ORDER BY ragione_sociale")?;
    let rows = stmt
        .query_map([], |r| to_dto(r))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(Value::Array(rows)))
}

async fn check_piva(
    State(state): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let piva = match q.get("piva") {
        Some(p) if !p.is_empty() => p.clone(),
        _ => return Ok(Json(json!({ "exists": false }))),
    };
    let clean = normalize_piva(&piva);
    if clean.len() != 11 || !clean.bytes().all(|b| b.is_ascii_digit()) {
        return Ok(Json(json!({ "exists": false })));
    }
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let it = format!("IT{clean}");
    let id: Option<i64> = match q.get("excludeId").and_then(|s| s.parse::<i64>().ok()) {
        Some(ex) => conn
            .query_row(
                "SELECT id FROM fornitori WHERE (p_iva=?1 OR p_iva=?2) AND id!=?3",
                params![clean, it, ex],
                |r| r.get(0),
            )
            .optional()?,
        None => conn
            .query_row(
                "SELECT id FROM fornitori WHERE p_iva=?1 OR p_iva=?2",
                params![clean, it],
                |r| r.get(0),
            )
            .optional()?,
    };
    Ok(Json(json!({ "exists": id.is_some(), "id": id })))
}

async fn detail(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let dto = conn
        .query_row("SELECT * FROM fornitori WHERE id=?1", [id], |r| to_dto(r))
        .optional()?;
    dto.map(Json)
        .ok_or_else(|| ApiError::not_found("Fornitore non trovato"))
}

async fn create(State(state): State<AppState>, Json(f): Json<Value>) -> ApiResult<Json<Value>> {
    if str_def(&f, "ragioneSociale").trim().is_empty() {
        return Err(ApiError::bad_request("La ragione sociale è obbligatoria"));
    }
    let piva = norm_piva(&f);
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    if let Some(p) = piva.as_deref().filter(|p| !p.is_empty()) {
        if let Some(dup) = find_by_piva(&conn, p, None)? {
            return Err(ApiError::Body(
                axum::http::StatusCode::CONFLICT,
                json!({ "error": format!("Esiste già un fornitore con la P.IVA {p}"), "duplicateId": dup }),
            ));
        }
    }
    conn.execute(
        "INSERT INTO fornitori \
         (ragione_sociale, email, telefono, cellulare, via, cap, citta, provincia, stato, p_iva, sdi, pec, estero, anche_cliente, nascosto) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
        params![
            raw_opt(&f, "ragioneSociale"),
            raw_opt(&f, "email"),
            raw_opt(&f, "telefono"),
            str_def(&f, "cellulare"),
            raw_opt(&f, "via"),
            raw_opt(&f, "cap"),
            raw_opt(&f, "citta"),
            raw_opt(&f, "provincia"),
            raw_opt(&f, "stato"),
            piva,
            str_def(&f, "sdi"),
            str_def(&f, "pec"),
            flag(&f, "estero"),
            flag(&f, "ancheCliente"),
            flag(&f, "nascosto"),
        ],
    )?;
    let id = conn.last_insert_rowid();
    applica_da_fornitore(&conn, id)?;
    Ok(Json(json!({ "id": id })))
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(f): Json<Value>,
) -> ApiResult<Json<Value>> {
    if str_def(&f, "ragioneSociale").trim().is_empty() {
        return Err(ApiError::bad_request("La ragione sociale è obbligatoria"));
    }
    let piva = norm_piva(&f);
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    if let Some(p) = piva.as_deref().filter(|p| !p.is_empty()) {
        if let Some(dup) = find_by_piva(&conn, p, Some(id))? {
            return Err(ApiError::Body(
                axum::http::StatusCode::CONFLICT,
                json!({ "error": format!("Esiste già un altro fornitore con la P.IVA {p}"), "duplicateId": dup }),
            ));
        }
    }
    conn.execute(
        "UPDATE fornitori SET ragione_sociale=?1, email=?2, telefono=?3, cellulare=?4, via=?5, cap=?6, \
         citta=?7, provincia=?8, stato=?9, p_iva=?10, sdi=?11, pec=?12, estero=?13, anche_cliente=?14, \
         nascosto=COALESCE(?15, nascosto) WHERE id=?16",
        params![
            raw_opt(&f, "ragioneSociale"),
            raw_opt(&f, "email"),
            raw_opt(&f, "telefono"),
            str_def(&f, "cellulare"),
            raw_opt(&f, "via"),
            raw_opt(&f, "cap"),
            raw_opt(&f, "citta"),
            raw_opt(&f, "provincia"),
            raw_opt(&f, "stato"),
            piva,
            str_def(&f, "sdi"),
            str_def(&f, "pec"),
            flag(&f, "estero"),
            flag(&f, "ancheCliente"),
            flag_opt(&f, "nascosto"),
            id,
        ],
    )?;
    applica_da_fornitore(&conn, id)?;
    Ok(Json(json!({ "success": true })))
}

/// Come per i clienti: un fornitore che compare su dei documenti non si elimina,
/// resterebbero righe che puntano a un'anagrafica sparita. In quel caso si
/// nasconde (v. `patch_nascosto`), che è quello che il messaggio propone.
/// Documenti che citano il fornitore, per tipo. Zero ovunque = si può eliminare.
/// Solo documenti: le tabelle di collegamento (listini per fornitore, alias
/// codici, layout OCR) hanno ON DELETE CASCADE e non sono un motivo per bloccare.
fn documenti_collegati(conn: &rusqlite::Connection, id: i64) -> rusqlite::Result<[(&'static str, i64); 5]> {
    let mut out = [("acquisti", 0), ("ordini", 0), ("ddt", 0), ("arrivi", 0), ("autofatture", 0)];
    for (chiave, valore) in out.iter_mut() {
        let tabella = if *chiave == "arrivi" { "arrivi_merce" } else { *chiave };
        *valore = conn.query_row(
            &format!("SELECT COUNT(*) FROM {tabella} WHERE fornitore_id=?1"),
            [id],
            |r| r.get(0),
        )?;
    }
    Ok(out)
}

async fn remove(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let conteggi = documenti_collegati(&conn, id)?;
    if conteggi.iter().any(|(_, n)| *n > 0) {
        let counts: serde_json::Map<String, Value> =
            conteggi.iter().map(|(k, n)| ((*k).to_string(), json!(n))).collect();
        return Err(ApiError::Body(
            axum::http::StatusCode::CONFLICT,
            json!({ "error": "fornitore_ha_documenti", "counts": Value::Object(counts) }),
        ));
    }
    scollega_fornitore(&conn, id)?;
    // `fornitore_id_preferito` non ha una FOREIGN KEY: senza questo resterebbe a
    // puntare a un'anagrafica che non c'è più, e il riordino automatico
    // creerebbe ordini per un fornitore inesistente.
    conn.execute("UPDATE prodotti SET fornitore_id_preferito=NULL WHERE fornitore_id_preferito=?1", [id])?;
    conn.execute("DELETE FROM fornitori WHERE id=?1", [id])?;
    Ok(Json(json!({ "success": true })))
}

/// Nasconde/ripristina l'anagrafica: la toglie dalle liste di scelta dei nuovi
/// documenti senza toccare lo storico. Vedi `clienti::patch_nascosto`.
async fn patch_nascosto(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(b): Json<Value>,
) -> ApiResult<Json<Value>> {
    let nascosto = flag(&b, "nascosto");
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let n = conn.execute("UPDATE fornitori SET nascosto=?1 WHERE id=?2", params![nascosto, id])?;
    if n == 0 {
        return Err(ApiError::not_found("Fornitore non trovato"));
    }
    Ok(Json(json!({ "success": true, "nascosto": nascosto == 1 })))
}

async fn import(State(state): State<AppState>, Json(body): Json<Value>) -> ApiResult<Json<Value>> {
    let records = body.as_array().cloned().unwrap_or_default();
    let (mut created, mut updated, mut skipped) = (0i64, 0i64, 0i64);
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    for f in &records {
        if str_def(f, "ragioneSociale").trim().is_empty() {
            skipped += 1;
            continue;
        }
        let piva = norm_piva(f);
        let mut existing: Option<i64> = None;
        if let Some(p) = piva.as_deref().filter(|p| p.len() == 11 && p.bytes().all(|b| b.is_ascii_digit())) {
            existing = find_by_piva(&conn, p, None)?;
        }
        if existing.is_none() {
            let rs = str_def(f, "ragioneSociale").to_lowercase().trim().to_string();
            existing = conn
                .query_row(
                    "SELECT id FROM fornitori WHERE LOWER(TRIM(ragione_sociale))=?1",
                    [rs],
                    |r| r.get(0),
                )
                .optional()?;
        }
        match existing {
            Some(id) => {
                if patch_existing(&conn, "fornitori", id, f, piva.as_deref())? {
                    updated += 1;
                } else {
                    skipped += 1;
                }
            }
            None => {
                conn.execute(
                    "INSERT INTO fornitori (ragione_sociale,email,telefono,cellulare,via,cap,citta,provincia,stato,p_iva,sdi,pec) \
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
                    params![
                        str_def(f, "ragioneSociale").trim(),
                        str_def(f, "email"),
                        str_def(f, "telefono"),
                        str_def(f, "cellulare"),
                        str_def(f, "via"),
                        str_def(f, "cap"),
                        str_def(f, "citta"),
                        str_def(f, "provincia"),
                        import_stato(f),
                        piva.clone().unwrap_or_default(),
                        str_def(f, "sdi"),
                        str_def(f, "pec"),
                    ],
                )?;
                created += 1;
            }
        }
    }
    Ok(Json(json!({ "created": created, "updated": updated, "skipped": skipped })))
}

// ── helper condivisi con clienti ─────────────────────────────────────────────

pub(crate) fn norm_piva(body: &Value) -> Option<String> {
    match body.get("pIva") {
        Some(Value::String(s)) => Some(normalize_piva(s)),
        _ => None,
    }
}

fn flag(body: &Value, key: &str) -> i64 {
    if matches!(body.get(key), Some(Value::Bool(true))) {
        1
    } else {
        0
    }
}

pub(crate) fn import_stato(body: &Value) -> String {
    let s = str_def(body, "stato");
    if s.is_empty() {
        "Italia".to_string()
    } else {
        s
    }
}

fn find_by_piva(
    conn: &rusqlite::Connection,
    clean: &str,
    exclude: Option<i64>,
) -> rusqlite::Result<Option<i64>> {
    let it = format!("IT{clean}");
    match exclude {
        Some(ex) => conn
            .query_row(
                "SELECT id FROM fornitori WHERE (p_iva=?1 OR p_iva=?2) AND id!=?3",
                params![clean, it, ex],
                |r| r.get(0),
            )
            .optional(),
        None => conn
            .query_row(
                "SELECT id FROM fornitori WHERE p_iva=?1 OR p_iva=?2",
                params![clean, it],
                |r| r.get(0),
            )
            .optional(),
    }
}

/// Merge dei soli campi vuoti (parità con la logica di import di Node).
/// `table` è "clienti" o "fornitori"; `codice_fiscale` solo per clienti.
pub(crate) fn patch_existing(
    conn: &rusqlite::Connection,
    table: &str,
    id: i64,
    src: &Value,
    piva: Option<&str>,
) -> rusqlite::Result<bool> {
    // (colonna DB, chiave JSON) candidate al merge
    let mut candidates: Vec<(&str, String)> = vec![
        ("email", str_def(src, "email")),
        ("telefono", str_def(src, "telefono")),
        ("cellulare", str_def(src, "cellulare")),
        ("via", str_def(src, "via")),
        ("cap", str_def(src, "cap")),
        ("citta", str_def(src, "citta")),
        ("provincia", str_def(src, "provincia")),
    ];
    if table == "clienti" {
        candidates.push(("codice_fiscale", str_def(src, "codiceFiscale")));
    }
    candidates.push(("p_iva", piva.unwrap_or("").to_string()));
    candidates.push(("sdi", str_def(src, "sdi")));
    candidates.push(("pec", str_def(src, "pec")));

    // Patcha solo dove il valore sorgente è non vuoto E la colonna esistente è vuota/NULL.
    let mut sets = Vec::new();
    let mut vals: Vec<String> = Vec::new();
    for (col, src_val) in candidates {
        if src_val.is_empty() {
            continue;
        }
        let cur: Option<String> = conn
            .query_row(
                &format!("SELECT {col} FROM {table} WHERE id=?1"),
                [id],
                |r| r.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten();
        if cur.map(|s| s.is_empty()).unwrap_or(true) {
            sets.push(format!("{col}=?"));
            vals.push(src_val);
        }
    }
    if sets.is_empty() {
        return Ok(false);
    }
    let sql = format!("UPDATE {table} SET {} WHERE id=?", sets.join(", "));
    use rusqlite::types::ToSql;
    let mut p: Vec<&dyn ToSql> = vals.iter().map(|s| s as &dyn ToSql).collect();
    p.push(&id);
    conn.execute(&sql, p.as_slice())?;
    Ok(true)
}

#[cfg(test)]
mod test_eliminazione {
    use super::*;
    use rusqlite::Connection;

    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(include_str!("../schema/tenant.sql")).unwrap();
        c.execute("INSERT INTO fornitori (id, ragione_sociale) VALUES (1,'ACME Forniture')", []).unwrap();
        c
    }

    fn totale(c: &Connection) -> i64 {
        documenti_collegati(c, 1).unwrap().iter().map(|(_, n)| n).sum()
    }

    #[test]
    fn un_fornitore_senza_documenti_si_puo_eliminare() {
        assert_eq!(totale(&db()), 0);
    }

    /// Ogni tipo di documento da solo basta a bloccare l'eliminazione: prima non
    /// c'era nessun controllo e si cancellava un fornitore lasciando acquisti,
    /// ordini e arrivi che puntavano a un'anagrafica sparita.
    #[test]
    fn ogni_tipo_di_documento_blocca_l_eliminazione() {
        for sql in [
            "INSERT INTO acquisti (numero, data_emissione, fornitore_id) VALUES ('A1','2026-09-01',1)",
            "INSERT INTO ordini (numero, data_ordine, fornitore_id, tipo) VALUES ('O1','2026-09-01',1,'FORNITORE')",
            "INSERT INTO ddt (numero, data_emissione, fornitore_id, tipo) VALUES ('D1','2026-09-01',1,'FORNITORE')",
            "INSERT INTO arrivi_merce (numero, data, fornitore_id) VALUES ('AM1','2026-09-01',1)",
            "INSERT INTO autofatture (numero, data, tipo_documento, fornitore_id) VALUES ('AF1','2026-09-01','TD18',1)",
        ] {
            let c = db();
            c.execute(sql, []).unwrap();
            assert_eq!(totale(&c), 1, "non bloccato da: {sql}");
        }
    }

    /// Un listino o un alias codice non sono documenti: hanno ON DELETE CASCADE
    /// e non devono impedire di fare pulizia in anagrafica.
    #[test]
    fn i_collegamenti_di_servizio_non_bloccano() {
        let c = db();
        c.execute("INSERT INTO prodotti (id, codice, prezzo, iva) VALUES (1,'ART-1',10,22)", []).unwrap();
        c.execute("INSERT INTO prodotto_fornitori (prodotto_id, fornitore_id) VALUES (1,1)", []).unwrap();
        c.execute("INSERT INTO fornitore_codice_alias (fornitore_id, codice, codice_norm, prodotto_id) VALUES (1,'X','x',1)", []).unwrap();
        assert_eq!(totale(&c), 0);
    }
}
