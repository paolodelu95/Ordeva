//! /api/azienda — parità con routes/azienda.js (riga singleton id=1).
//! In offline l'utente è OWNER: i segreti SMTP/SDI restano mascherati nel GET
//! (come Node, dove la maschera cade solo per SUPERADMIN/ADMIN).

use axum::{
    extract::State,
    routing::get,
    Json, Router,
};
use rusqlite::{params, OptionalExtension, Row};
use serde_json::{json, Value};

use crate::db::AppState;
use crate::error::ApiResult;
use crate::web::{num, tenant_conn};

pub fn routes() -> Router<AppState> {
    Router::new().route("/", get(get_azienda).put(put_azienda))
}

async fn get_azienda(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let dto = conn
        .query_row("SELECT * FROM azienda WHERE id=1", [], |r| Ok(to_dto(r)))
        .optional()?;
    // include_secrets=false: in offline l'utente è OWNER, non SUPERADMIN/ADMIN.
    Ok(Json(dto.unwrap_or_else(|| json!({}))))
}

async fn put_azienda(
    State(state): State<AppState>,
    Json(a): Json<Value>,
) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();

    let sdi_provider = pick(&a, "sdiProvider", &["FIC", "ARUBA", "GENERICO"], "GENERICO");
    let email_mode = pick(
        &a,
        "emailMode",
        &["SMTP", "MAILTO", "WEBMAIL_GMAIL", "WEBMAIL_OUTLOOK"],
        "SMTP",
    );

    conn.execute(
        "UPDATE azienda SET ragione_sociale=?1, indirizzo=?2, cap=?3, citta=?4, provincia=?5, stato=?6, \
         p_iva=?7, cod_fiscale=?8, email=?9, telefono=?10, pec=?11, sdi=?12, banca=?13, iban=?14, logo=?15, \
         smtp_host=?16, smtp_port=?17, smtp_user=?18, smtp_pass=?19, smtp_from=?20, smtp_secure=?21, \
         sdi_api_url=?22, sdi_api_key=?23, sdi_provider=?24, \
         riordino_automatico=?25, multi_utente_attivo=?26, \
         numerazione_annuale=?27, numero_prefissi=?28, \
         template_config=?29, notifiche_config=?30, email_corpo_documento=?31, email_mode=?32, \
         lock_documenti_default=?33, \
         regime_fiscale=?34, ritenuta_aliquota_default=?35, ritenuta_causale_default=?36, ritenuta_tipo_default=?37, \
         cassa_tipo_default=?38, cassa_aliquota_default=?39, cassa_iva_default=?40, \
         decimali_prezzo=?41 \
         WHERE id=1",
        params![
            raw_str(&a, "ragioneSociale"),
            raw_str(&a, "indirizzo"),
            raw_str(&a, "cap"),
            raw_str(&a, "citta"),
            raw_str(&a, "provincia"),
            raw_str(&a, "stato"),
            raw_str(&a, "pIva"),
            raw_str(&a, "codFiscale"),
            raw_str(&a, "email"),
            raw_str(&a, "telefono"),
            raw_str(&a, "pec"),
            raw_str(&a, "sdi"),
            raw_str(&a, "banca"),
            raw_str(&a, "iban"),
            str_or_empty(&a, "logo"),
            str_or_empty(&a, "smtpHost"),
            int_or(&a, "smtpPort", 587),
            str_or_empty(&a, "smtpUser"),
            str_or_empty(&a, "smtpPass"),
            str_or_empty(&a, "smtpFrom"),
            flag(&a, "smtpSecure"),
            str_or_empty(&a, "sdiApiUrl"),
            str_or_empty(&a, "sdiApiKey"),
            sdi_provider,
            flag(&a, "riordinoAutomatico"),
            flag(&a, "multiUtenteAttivo"),
            flag(&a, "numerazioneAnnuale"),
            json_string_or(&a, "numeroPrefissi", "{}"),
            json_opt(&a, "templateConfig"),
            json_opt(&a, "notificheConfig"),
            opt_text(&a, "emailCorpoDocumento"),
            email_mode,
            lock_default(&a),
            str_or_default(&a, "regimeFiscale", "RF01"),
            num_or_zero(&a, "ritenutaAliquotaDefault"),
            str_or_empty(&a, "ritenutaCausaleDefault"),
            str_or_default(&a, "ritenutaTipoDefault", "RT02"),
            str_or_empty(&a, "cassaTipoDefault"),
            num_or_zero(&a, "cassaAliquotaDefault"),
            num_or_zero(&a, "cassaIvaDefault"),
            decimali_prezzo(&a),
        ],
    )?;
    Ok(Json(json!({ "success": true })))
}

// ── toDto (segreti mascherati) ───────────────────────────────────────────────

fn to_dto(r: &Row) -> Value {
    let g = |k: &str| r.get::<_, Option<String>>(k).ok().flatten();
    let gi = |k: &str| r.get::<_, Option<i64>>(k).ok().flatten();
    let gf = |k: &str| r.get::<_, Option<f64>>(k).ok().flatten();

    let smtp_pass = g("smtp_pass").unwrap_or_default();
    let sdi_api_key = g("sdi_api_key").unwrap_or_default();
    let masked_pass = if smtp_pass.is_empty() { "" } else { "••••••••" };
    let masked_key = if sdi_api_key.is_empty() { "" } else { "••••••••" };

    json!({
        "id": gi("id"),
        "ragioneSociale": g("ragione_sociale"),
        "indirizzo": g("indirizzo"),
        "cap": g("cap"), "citta": g("citta"), "provincia": g("provincia"), "stato": g("stato"),
        "pIva": g("p_iva"), "codFiscale": g("cod_fiscale"),
        "email": g("email"), "telefono": g("telefono"), "pec": g("pec"), "sdi": g("sdi"),
        "banca": g("banca"), "iban": g("iban"), "logo": g("logo").unwrap_or_default(),
        "smtpHost": g("smtp_host").unwrap_or_default(),
        "smtpPort": gi("smtp_port").filter(|&v| v != 0).unwrap_or(587),
        "smtpUser": g("smtp_user").unwrap_or_default(),
        "smtpPass": masked_pass,
        "smtpFrom": g("smtp_from").unwrap_or_default(),
        "smtpSecure": gi("smtp_secure") == Some(1),
        "sdiApiUrl": g("sdi_api_url").unwrap_or_default(),
        "sdiApiKey": masked_key,
        "sdiProvider": valid_in(g("sdi_provider"), &["FIC", "ARUBA", "GENERICO"], "GENERICO"),
        "riordinoAutomatico": gi("riordino_automatico") == Some(1),
        "multiUtenteAttivo": gi("multi_utente_attivo") == Some(1),
        "numerazioneAnnuale": gi("numerazione_annuale").unwrap_or(1) != 0,
        "numeroPrefissi": parse_json(g("numero_prefissi"), json!({})),
        "templateConfig": parse_json(g("template_config"), Value::Null),
        "notificheConfig": parse_json(g("notifiche_config"), Value::Null),
        "emailCorpoDocumento": g("email_corpo_documento").unwrap_or_default(),
        "emailMode": valid_in(g("email_mode"), &["SMTP","MAILTO","WEBMAIL_GMAIL","WEBMAIL_OUTLOOK"], "SMTP"),
        "lockDocumentiDefault": gi("lock_documenti_default").unwrap_or(1) != 0,
        "regimeFiscale": g("regime_fiscale").filter(|s| !s.is_empty()).unwrap_or_else(|| "RF01".into()),
        "ritenutaAliquotaDefault": num(gf("ritenuta_aliquota_default").unwrap_or(0.0)),
        "ritenutaCausaleDefault": g("ritenuta_causale_default").unwrap_or_default(),
        "ritenutaTipoDefault": g("ritenuta_tipo_default").filter(|s| !s.is_empty()).unwrap_or_else(|| "RT02".into()),
        "cassaTipoDefault": g("cassa_tipo_default").unwrap_or_default(),
        "cassaAliquotaDefault": num(gf("cassa_aliquota_default").unwrap_or(0.0)),
        "cassaIvaDefault": num(gf("cassa_iva_default").unwrap_or(0.0)),
        "decimaliPrezzo": gi("decimali_prezzo").filter(|&v| v == 2 || v == 3).unwrap_or(2),
    })
}

// ── helper di binding/lettura specifici di azienda ───────────────────────────

/// Stringa grezza (anche null) — come `a.campo` passato direttamente a better-sqlite3.
fn raw_str(a: &Value, key: &str) -> Option<String> {
    a.get(key).and_then(Value::as_str).map(str::to_string)
}
fn str_or_empty(a: &Value, key: &str) -> String {
    a.get(key).and_then(Value::as_str).unwrap_or("").to_string()
}
fn str_or_default(a: &Value, key: &str, d: &str) -> String {
    let s = str_or_empty(a, key);
    if s.is_empty() {
        d.to_string()
    } else {
        s
    }
}
fn flag(a: &Value, key: &str) -> i64 {
    if matches!(a.get(key), Some(Value::Bool(true))) {
        1
    } else {
        0
    }
}
fn int_or(a: &Value, key: &str, d: i64) -> i64 {
    a.get(key).and_then(Value::as_i64).filter(|&v| v != 0).unwrap_or(d)
}
fn num_or_zero(a: &Value, key: &str) -> f64 {
    a.get(key).and_then(Value::as_f64).unwrap_or(0.0)
}
/// `a.campo ?? null` per le TEXT che distinguono assente da vuoto.
fn opt_text(a: &Value, key: &str) -> Option<String> {
    match a.get(key) {
        Some(Value::String(s)) => Some(s.clone()),
        _ => None,
    }
}
/// `JSON.stringify(a.campo || {})` → sempre una stringa.
fn json_string_or(a: &Value, key: &str, d: &str) -> String {
    match a.get(key) {
        Some(v) if !v.is_null() => v.to_string(),
        _ => d.to_string(),
    }
}
/// `a.campo ? JSON.stringify(a.campo) : null` (oggetti/array sono truthy, anche vuoti).
fn json_opt(a: &Value, key: &str) -> Option<String> {
    match a.get(key) {
        Some(v) if is_truthy(v) => Some(v.to_string()),
        _ => None,
    }
}
fn is_truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().map(|x| x != 0.0).unwrap_or(true),
        Value::String(s) => !s.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}
/// `a.lockDocumentiDefault === false ? 0 : 1` (default 1).
fn lock_default(a: &Value) -> i64 {
    if matches!(a.get("lockDocumentiDefault"), Some(Value::Bool(false))) {
        0
    } else {
        1
    }
}
/// `a.decimaliPrezzo` valido solo se 2 o 3, altrimenti default 2.
fn decimali_prezzo(a: &Value) -> i64 {
    match a.get("decimaliPrezzo").and_then(Value::as_i64) {
        Some(v) if v == 2 || v == 3 => v,
        _ => 2,
    }
}
fn pick(a: &Value, key: &str, allowed: &[&str], d: &str) -> String {
    let v = str_or_empty(a, key);
    if allowed.contains(&v.as_str()) {
        v
    } else {
        d.to_string()
    }
}
fn valid_in(v: Option<String>, allowed: &[&str], d: &str) -> String {
    match v {
        Some(s) if allowed.contains(&s.as_str()) => s,
        _ => d.to_string(),
    }
}
fn parse_json(s: Option<String>, default: Value) -> Value {
    match s {
        Some(s) if !s.is_empty() => serde_json::from_str(&s).unwrap_or(default),
        _ => default,
    }
}
