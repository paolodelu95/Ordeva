//! /api/backup — parità con routes/backup.js (backup cifrato, edizione offline).

use std::time::{SystemTime, UNIX_EPOCH};

use axum::{extract::State, routing::{get, post}, Json, Router};
use serde_json::{json, Value};

use crate::backup as bk;
use crate::db::{AppState, DEFAULT_TENANT};
use crate::error::{ApiError, ApiResult};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/config", get(get_config).put(put_config))
        .route("/run", post(run))
        .route("/prune", post(prune))
        .route("/alert-dismiss", post(alert_dismiss))
        .route("/list", get(list))
        .route("/restore", post(restore))
        .route("/verifica", post(verifica))
}

fn now_secs() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) as i64
}

fn now_iso() -> String {
    let secs = now_secs();
    let days = secs.div_euclid(86400);
    let rem = secs.rem_euclid(86400);
    let (h, mi, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let iso = crate::web::iso_of_days(days);
    format!("{iso}T{h:02}:{mi:02}:{s:02}.000Z")
}

/// Secondi epoch da una ISO "YYYY-MM-DDTHH:MM:SS...". None se non parsabile.
fn iso_to_secs(s: &str) -> Option<i64> {
    let date = crate::web::days_of(s)?;
    let mut secs = date * 86400;
    if let Some(tpos) = s.find('T') {
        let t = &s[tpos + 1..];
        let parts: Vec<&str> = t.splitn(3, ':').collect();
        let h: i64 = parts.first().and_then(|x| x.parse().ok()).unwrap_or(0);
        let mi: i64 = parts.get(1).and_then(|x| x.parse().ok()).unwrap_or(0);
        let sec: i64 = parts.get(2).map(|x| x.chars().take_while(|c| c.is_ascii_digit()).collect::<String>()).and_then(|x| x.parse().ok()).unwrap_or(0);
        secs += h * 3600 + mi * 60 + sec;
    }
    Some(secs)
}

/// daysSince(iso): (ora - data)/86400. None/null → +∞.
fn days_since(cfg_val: Option<&Value>) -> f64 {
    match cfg_val.and_then(Value::as_str) {
        Some(iso) => match iso_to_secs(iso) {
            Some(ds) => (now_secs() - ds) as f64 / 86400.0,
            None => f64::INFINITY,
        },
        None => f64::INFINITY,
    }
}

fn password_set(state: &AppState) -> bool {
    state
        .with_tenant(DEFAULT_TENANT, |c| {
            let h: Option<String> = c
                .query_row("SELECT app_password_hash FROM azienda WHERE id=1", [], |r| r.get(0))
                .ok()
                .flatten();
            Ok(h.map(|s| !s.is_empty()).unwrap_or(false))
        })
        .unwrap_or(false)
}

fn alert_due(cfg: &Value) -> bool {
    if cfg.get("alertDisabled").and_then(Value::as_bool).unwrap_or(false) {
        return false;
    }
    let alert_days = cfg.get("alertDays").and_then(Value::as_f64).unwrap_or(3.0);
    let overdue = days_since(cfg.get("lastAt")) >= alert_days;
    let dismissed_recently = days_since(cfg.get("alertDismissedAt")) < alert_days;
    overdue && !dismissed_recently
}

/// publicCfg: cfg senza encSalt + campi derivati.
fn public_cfg(state: &AppState, cfg: &Value) -> Value {
    let mut out = serde_json::Map::new();
    if let Some(obj) = cfg.as_object() {
        for (k, v) in obj {
            if k != "encSalt" {
                out.insert(k.clone(), v.clone());
            }
        }
    }
    let days_since_last = match cfg.get("lastAt").and_then(Value::as_str) {
        Some(_) => json!(days_since(cfg.get("lastAt")).floor() as i64),
        None => Value::Null,
    };
    out.insert("daysSinceLast".into(), days_since_last);
    out.insert("alertDue".into(), json!(alert_due(cfg)));
    out.insert("passwordSet".into(), json!(password_set(state)));
    out.insert("keyReady".into(), json!(bk::get_key(state).is_some()));
    Value::Object(out)
}

async fn get_config(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let cfg = bk::read_config(&state)?;
    Ok(Json(public_cfg(&state, &cfg)))
}

async fn put_config(State(state): State<AppState>, Json(b): Json<Value>) -> ApiResult<Json<Value>> {
    let mut patch = serde_json::Map::new();
    if let Some(d) = b.get("dir").and_then(Value::as_str) {
        patch.insert("dir".into(), json!(d.trim()));
    }
    if let Some(v) = b.get("enabled").and_then(Value::as_bool) {
        patch.insert("enabled".into(), json!(v));
    }
    if let Some(v) = b.get("encrypt").and_then(Value::as_bool) {
        patch.insert("encrypt".into(), json!(v));
    }
    if let Some(v) = b.get("alertDays").and_then(Value::as_f64) {
        if v.is_finite() {
            let clamped = (v.round() as i64).clamp(1, 60);
            patch.insert("alertDays".into(), json!(clamped));
        }
    }
    if let Some(v) = b.get("alertDisabled").and_then(Value::as_bool) {
        patch.insert("alertDisabled".into(), json!(v));
    }
    if let Some(v) = b.get("retentionDays").and_then(Value::as_f64) {
        if v.is_finite() {
            let clamped = (v.round() as i64).clamp(0, 365);
            patch.insert("retentionDays".into(), json!(clamped));
        }
    }
    let merged = bk::write_config(&state, Value::Object(patch))?;
    Ok(Json(public_cfg(&state, &merged)))
}

async fn run(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let cfg = bk::read_config(&state)?;
    let dir = cfg.get("dir").and_then(Value::as_str).unwrap_or("").to_string();
    if dir.is_empty() {
        return Err(ApiError::Status(axum::http::StatusCode::BAD_REQUEST, "Imposta prima la cartella di backup.".into()));
    }
    let encrypt = cfg.get("encrypt").and_then(Value::as_bool).unwrap_or(false);
    let key = bk::get_key(&state);
    if encrypt && key.is_none() {
        return Err(ApiError::Status(
            axum::http::StatusCode::CONFLICT,
            "La cifratura è attiva ma manca la password d'accesso sbloccata. Imposta/inserisci la password e riprova.".into(),
        ));
    }
    let salt = bk::ensure_salt(&state)?;
    let (file, encrypted) = bk::run_external_backup(&state, &dir, encrypt, key, &salt)
        .map_err(|e| ApiError::Status(axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let updated = bk::write_config(&state, json!({ "lastAt": now_iso() }))?;
    // Pulizia per età: a ogni backup elimina le copie più vecchie di retentionDays giorni.
    let retention = updated.get("retentionDays").and_then(Value::as_f64).unwrap_or(0.0) as u32;
    bk::prune_external_older_than(&dir, retention);
    let basename = file.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let mut out = public_cfg(&state, &updated);
    let obj = out.as_object_mut().unwrap();
    obj.insert("success".into(), json!(true));
    obj.insert("file".into(), json!(basename));
    obj.insert("encrypted".into(), json!(encrypted));
    Ok(Json(out))
}

/// Elimina subito i backup più vecchi di `retentionDays` giorni (pulizia manuale).
/// Ritorna quanti file ha rimosso e l'elenco aggiornato.
async fn prune(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let cfg = bk::read_config(&state)?;
    let dir = cfg.get("dir").and_then(Value::as_str).unwrap_or("").to_string();
    if dir.is_empty() {
        return Err(ApiError::Status(axum::http::StatusCode::BAD_REQUEST, "Imposta prima la cartella di backup.".into()));
    }
    let days = cfg.get("retentionDays").and_then(Value::as_f64).unwrap_or(0.0) as u32;
    if days == 0 {
        return Err(ApiError::Status(axum::http::StatusCode::BAD_REQUEST, "Imposta prima i giorni di conservazione.".into()));
    }
    let removed = bk::prune_external_older_than(&dir, days);
    let files = bk::list_external(&dir);
    Ok(Json(json!({ "removed": removed, "files": files })))
}

async fn alert_dismiss(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let updated = bk::write_config(&state, json!({ "alertDismissedAt": now_iso() }))?;
    Ok(Json(public_cfg(&state, &updated)))
}

async fn list(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let cfg = bk::read_config(&state)?;
    let dir = cfg.get("dir").and_then(Value::as_str).unwrap_or("");
    let files = bk::list_external(dir);
    Ok(Json(json!({ "files": files })))
}

/// POST /api/backup/verifica — apre davvero l'ultimo backup e dice se è
/// ripristinabile. body opzionale { password } per gli archivi cifrati con una
/// password diversa da quella in uso.
async fn verifica(State(state): State<AppState>, Json(b): Json<Value>) -> ApiResult<Json<Value>> {
    let password = b.get("password").and_then(Value::as_str).filter(|s| !s.is_empty());
    let e = bk::verifica_ultimo_backup(&state, password)
        .map_err(|e| ApiError::Status(axum::http::StatusCode::BAD_REQUEST, e.to_string()))?;
    Ok(Json(json!({
        "ok": e.ok,
        "file": e.file,
        "cifrato": e.cifrato,
        "problema": e.problema,
        "tabelle": e.tabelle,
        "bytes": e.bytes,
    })))
}

async fn restore(State(state): State<AppState>, Json(b): Json<Value>) -> ApiResult<Json<Value>> {
    let cfg = bk::read_config(&state)?;
    let dir = cfg.get("dir").and_then(Value::as_str).unwrap_or("");
    let file_path = match b.get("filePath").and_then(Value::as_str) {
        Some(fp) if !fp.is_empty() => fp.to_string(),
        _ => match b.get("name").and_then(Value::as_str) {
            Some(name) if !name.is_empty() && !dir.is_empty() => {
                std::path::Path::new(dir).join(name).to_string_lossy().to_string()
            }
            _ => String::new(),
        },
    };
    if file_path.is_empty() {
        return Err(ApiError::Status(axum::http::StatusCode::BAD_REQUEST, "Backup da ripristinare non indicato.".into()));
    }
    let password = b.get("password").and_then(Value::as_str).filter(|s| !s.is_empty());
    bk::restore_backup(&state, &file_path, bk::get_key(&state), password)
        .map_err(|e| ApiError::Status(axum::http::StatusCode::BAD_REQUEST, e.to_string()))?;
    Ok(Json(json!({ "success": true })))
}
