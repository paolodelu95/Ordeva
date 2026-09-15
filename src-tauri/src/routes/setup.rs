//! /api/setup — parità con routes/setup.js (solo edizione offline): stato primo
//! avvio, dati demo, password d'accesso opzionale (con chiave backup in memoria).

use axum::{extract::State, routing::{get, post}, Json, Router};
use rusqlite::params;
use serde_json::{json, Value};

use crate::backup as bk;
use crate::db::AppState;
use crate::error::{ApiError, ApiResult};
use crate::web::tenant_conn;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/status", get(status))
        .route("/seed-demo", post(seed_demo))
        .route("/password/status", get(password_status))
        .route("/password", post(set_password))
        .route("/unlock", post(unlock))
}

// (descrizione, categoria, prezzo, quantita, soglia, um, codice, iva)
const PRODOTTI: [(&str, &str, f64, f64, f64, &str, &str, f64); 10] = [
    ("Carta A4 80g", "Cancelleria", 4.90, 150.0, 50.0, "risma", "CAR001", 22.0),
    ("Penna Biro Blu", "Cancelleria", 0.50, 300.0, 100.0, "pz", "PEN001", 22.0),
    ("Toner HP LaserJet", "Informatica", 89.00, 12.0, 5.0, "pz", "TON001", 22.0),
    ("Cartuccia Inkjet Nera", "Informatica", 22.50, 8.0, 10.0, "pz", "CAR002", 22.0),
    ("Scrivania Ufficio 140cm", "Arredamento", 249.00, 3.0, 1.0, "pz", "SCR001", 22.0),
    ("Sedia Ergonomica", "Arredamento", 189.00, 6.0, 2.0, "pz", "SED001", 22.0),
    ("Monitor 24\" Full HD", "Informatica", 179.00, 5.0, 2.0, "pz", "MON001", 22.0),
    ("Tastiera Wireless", "Informatica", 45.00, 14.0, 5.0, "pz", "TAS001", 22.0),
    ("Mouse Ottico USB", "Informatica", 18.00, 20.0, 8.0, "pz", "MOU001", 22.0),
    ("Raccoglitore A4 4 Anelli", "Cancelleria", 3.20, 4.0, 20.0, "pz", "RAC001", 22.0),
];

// (rs, email, tel, via, cap, citta, prov, cf, piva)
const CLIENTI: [(&str, &str, &str, &str, &str, &str, &str, &str, &str); 5] = [
    ("Alfa Srl", "amministrazione@alfasrl.it", "02 1234567", "Via Roma 12", "20121", "Milano", "MI", "ALFA00000000000", "IT01234567890"),
    ("Beta SpA", "contabilita@betaspa.it", "06 9876543", "Corso Vittorio 88", "00186", "Roma", "RM", "BETA00000000000", "IT09876543210"),
    ("Gamma Snc", "info@gammasnc.it", "011 5551234", "Via Torino 5", "10121", "Torino", "TO", "GAMM00000000000", "IT05551234567"),
    ("Delta Studio", "studio@delta.it", "051 3334444", "Via Indipendenza 22", "40121", "Bologna", "BO", "DELT00000000000", "IT03334444555"),
    ("Epsilon Srl", "fatture@epsilon.it", "055 7778888", "Lungarno Corsini 10", "50123", "Firenze", "FI", "EPSI00000000000", "IT07778888999"),
];

// (rs, email, tel, via, cap, citta, prov, piva)
const FORNITORI: [(&str, &str, &str, &str, &str, &str, &str, &str); 3] = [
    ("Forniture Ufficio Nord Srl", "ordini@funord.it", "02 8889990", "Via Bisceglie 45", "20152", "Milano", "MI", "IT11112222333"),
    ("Tech Supply SpA", "vendite@techsupply.it", "049 6667778", "Via Venezia 100", "35121", "Padova", "PD", "IT44445555666"),
    ("MobiliOffice Srl", "info@mobilioffice.it", "039 2223334", "Via Lecco 8", "20900", "Monza", "MB", "IT77778888999"),
];

fn count(conn: &rusqlite::Connection, table: &str) -> i64 {
    conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0)).unwrap_or(0)
}

async fn status(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let (rs, piva): (Option<String>, Option<String>) = conn
        .query_row("SELECT ragione_sociale, p_iva FROM azienda WHERE id=1", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .unwrap_or((None, None));
    // Basta la ragione sociale (unico campo richiesto nel form di benvenuto):
    // così, inseriti i dati azienda, il benvenuto non si ripresenta.
    let _ = &piva;
    let azienda_configurata = rs.as_deref().map(|s| !s.trim().is_empty()).unwrap_or(false);
    let has_dati = count(&conn, "prodotti") > 0 || count(&conn, "clienti") > 0 || count(&conn, "fornitori") > 0;
    Ok(Json(json!({ "aziendaConfigurata": azienda_configurata, "hasDati": has_dati })))
}

async fn seed_demo(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let mut conn = conn.lock().unwrap();
    if count(&conn, "prodotti") > 0 || count(&conn, "clienti") > 0 || count(&conn, "fornitori") > 0 {
        return Err(ApiError::Status(
            axum::http::StatusCode::CONFLICT,
            "Ci sono già dei dati: i dati demo non sono stati caricati per non sovrascriverli.".into(),
        ));
    }
    let tx = conn.transaction()?;
    for p in &PRODOTTI {
        tx.execute(
            "INSERT INTO prodotti (descrizione, categoria, prezzo, quantita, soglia_minima, unita_misura, codice, iva) VALUES (?,?,?,?,?,?,?,?)",
            params![p.0, p.1, p.2, p.3, p.4, p.5, p.6, p.7],
        )?;
    }
    for c in &CLIENTI {
        tx.execute(
            "INSERT INTO clienti (ragione_sociale, email, telefono, via, cap, citta, provincia, stato, codice_fiscale, p_iva) VALUES (?,?,?,?,?,?,?,?,?,?)",
            params![c.0, c.1, c.2, c.3, c.4, c.5, c.6, "Italia", c.7, c.8],
        )?;
    }
    for f in &FORNITORI {
        tx.execute(
            "INSERT INTO fornitori (ragione_sociale, email, telefono, via, cap, citta, provincia, stato, p_iva) VALUES (?,?,?,?,?,?,?,?,?)",
            params![f.0, f.1, f.2, f.3, f.4, f.5, f.6, "Italia", f.7],
        )?;
    }
    tx.commit()?;
    Ok(Json(json!({
        "success": true,
        "prodotti": PRODOTTI.len(),
        "clienti": CLIENTI.len(),
        "fornitori": FORNITORI.len(),
    })))
}

fn current_hash(state: &AppState) -> String {
    let conn = match tenant_conn(state) {
        Ok(c) => c,
        Err(_) => return String::new(),
    };
    let conn = conn.lock().unwrap();
    conn.query_row("SELECT app_password_hash FROM azienda WHERE id=1", [], |r| r.get::<_, Option<String>>(0))
        .ok()
        .flatten()
        .unwrap_or_default()
}

async fn password_status(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    Ok(Json(json!({ "enabled": !current_hash(&state).is_empty() })))
}

async fn set_password(State(state): State<AppState>, Json(b): Json<Value>) -> ApiResult<Json<Value>> {
    let existing = current_hash(&state);
    let current = b.get("current").and_then(Value::as_str).unwrap_or("");
    if !existing.is_empty() && !bcrypt::verify(current, &existing).unwrap_or(false) {
        return Err(ApiError::Status(axum::http::StatusCode::FORBIDDEN, "Password attuale errata.".into()));
    }
    let next = b.get("password").and_then(Value::as_str).unwrap_or("");
    let hash = if next.is_empty() {
        String::new()
    } else {
        bcrypt::hash(next, 10).map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?
    };
    {
        let conn = tenant_conn(&state)?;
        let conn = conn.lock().unwrap();
        conn.execute("UPDATE azienda SET app_password_hash=? WHERE id=1", params![hash])?;
    }
    if !next.is_empty() {
        let salt = bk::ensure_salt(&state)?;
        bk::set_key_from_password(&state, next, &salt);
    } else {
        bk::clear_key(&state);
    }
    Ok(Json(json!({ "success": true, "enabled": !hash.is_empty() })))
}

async fn unlock(State(state): State<AppState>, Json(b): Json<Value>) -> ApiResult<Json<Value>> {
    let existing = current_hash(&state);
    if existing.is_empty() {
        return Ok(Json(json!({ "ok": true })));
    }
    let pwd = b.get("password").and_then(Value::as_str).unwrap_or("");
    let ok = bcrypt::verify(pwd, &existing).unwrap_or(false);
    if ok {
        let salt = bk::ensure_salt(&state)?;
        bk::set_key_from_password(&state, pwd, &salt);
        // Se la cifratura a riposo è attiva, memorizza la password (= password d'accesso)
        // per poter ricifrare alla chiusura, utile dopo un avvio "non pulito" in cui il
        // file in chiaro era rimasto.
        if crate::config::is_encrypted(&state.config_path) {
            *state.atrest_password.lock().unwrap() = Some(pwd.to_string());
        }
    }
    Ok(Json(json!({ "ok": ok })))
}
