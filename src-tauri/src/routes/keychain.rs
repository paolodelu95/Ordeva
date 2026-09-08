//! /api/keychain — portachiavi: contenitore cifrato di password personali/aziendali.
//!
//! Protetto da una **master password dedicata**, indipendente dalla password d'accesso
//! all'archivio/app (`archivi.rs`) e dalla password di cifratura a riposo del DB
//! (`atrest.rs`/`backup.rs`): chi sblocca Ordeva non vede automaticamente le password
//! salvate qui.
//!
//! Titolo/username/url/categoria restano in chiaro (si sfoglia/cerca senza sblocco);
//! solo `password`/`note` sono cifrate (AES-256-GCM, chiave scrypt dalla master
//! password) e richiedono la sessione sbloccata per essere lette. La chiave di sessione
//! vive SOLO in memoria (`AppState.keychain_key`, mai su disco) e si riusa la
//! crittografia già scritta per i backup (`crate::backup::{derive_key_raw,
//! encrypt_buffer, decrypt_buffer}`), senza duplicarla.
//!
//! Nessun recupero password: se la master password viene dimenticata, le voci salvate
//! non sono più decifrabili (stesso principio della cifratura a riposo in `atrest.rs`).

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use rusqlite::{params, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::backup::{decrypt_buffer, derive_key_raw, encrypt_buffer};
use crate::db::AppState;
use crate::error::{ApiError, ApiResult};
use crate::web::tenant_conn;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/stato", get(stato))
        .route("/imposta", post(imposta))
        .route("/sblocca", post(sblocca))
        .route("/blocca", post(blocca))
        .route("/cambia-password", post(cambia_password))
        .route("/entries", get(list_entries).post(create_entry))
        .route("/entries/:id", put(update_entry).delete(delete_entry))
        .route("/entries/:id/rivela", post(rivela_entry))
}

/// Recupera la chiave di sessione o 423 LOCKED se il portachiavi non è sbloccato.
fn chiave_sessione(state: &AppState) -> ApiResult<[u8; 32]> {
    state
        .keychain_key
        .lock()
        .unwrap()
        .ok_or_else(|| ApiError::Status(StatusCode::LOCKED, "Portachiavi bloccato: inserisci la master password".into()))
}

fn cifra(chiave: &[u8; 32], salt: &[u8], chiaro: &str) -> ApiResult<Vec<u8>> {
    encrypt_buffer(chiaro.as_bytes(), chiave, salt).map_err(|e| ApiError::Internal(e))
}

fn decifra(chiave: [u8; 32], dati: &[u8]) -> ApiResult<String> {
    let plain = decrypt_buffer(dati, Some(chiave), None)
        .map_err(|_| ApiError::Internal(anyhow::anyhow!("decifratura portachiavi fallita")))?;
    String::from_utf8(plain).map_err(|e| ApiError::Internal(e.into()))
}

// ── configurazione / sblocco ────────────────────────────────────────────────

async fn stato(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let configurato: bool = conn
        .query_row("SELECT 1 FROM keychain_config WHERE id=1 AND password_hash!=''", [], |_| Ok(true))
        .optional()?
        .unwrap_or(false);
    let sbloccato = state.keychain_key.lock().unwrap().is_some();
    Ok(Json(json!({ "configurato": configurato, "sbloccato": sbloccato })))
}

#[derive(Deserialize)]
struct ImpostaReq {
    password: String,
}

async fn imposta(State(state): State<AppState>, Json(req): Json<ImpostaReq>) -> ApiResult<Json<Value>> {
    if req.password.len() < 8 {
        return Err(ApiError::bad_request("La master password deve avere almeno 8 caratteri"));
    }
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let già_configurato: bool = conn
        .query_row("SELECT 1 FROM keychain_config WHERE id=1 AND password_hash!=''", [], |_| Ok(true))
        .optional()?
        .unwrap_or(false);
    if già_configurato {
        return Err(ApiError::conflict("Il portachiavi è già configurato"));
    }
    let mut salt = [0u8; 16];
    getrandom::getrandom(&mut salt).map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?;
    let hash = bcrypt::hash(&req.password, bcrypt::DEFAULT_COST).map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?;
    let chiave = derive_key_raw(&req.password, &salt).map_err(ApiError::Internal)?;
    conn.execute(
        "INSERT INTO keychain_config (id, password_hash, salt) VALUES (1, ?1, ?2)
         ON CONFLICT(id) DO UPDATE SET password_hash=excluded.password_hash, salt=excluded.salt",
        params![hash, salt.to_vec()],
    )?;
    *state.keychain_key.lock().unwrap() = Some(chiave);
    Ok(Json(json!({ "configurato": true, "sbloccato": true })))
}

#[derive(Deserialize)]
struct SbloccaReq {
    password: String,
}

async fn sblocca(State(state): State<AppState>, Json(req): Json<SbloccaReq>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let (hash, salt): (String, Vec<u8>) = {
        let conn = conn.lock().unwrap();
        conn.query_row("SELECT password_hash, salt FROM keychain_config WHERE id=1", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()?
            .ok_or_else(|| ApiError::conflict("Portachiavi non ancora configurato"))?
    };
    if hash.is_empty() || !bcrypt::verify(&req.password, &hash).unwrap_or(false) {
        return Err(ApiError::Status(StatusCode::UNAUTHORIZED, "Password errata".into()));
    }
    let chiave = derive_key_raw(&req.password, &salt).map_err(ApiError::Internal)?;
    *state.keychain_key.lock().unwrap() = Some(chiave);
    Ok(Json(json!({ "sbloccato": true })))
}

async fn blocca(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    *state.keychain_key.lock().unwrap() = None;
    Ok(Json(json!({ "sbloccato": false })))
}

#[derive(Deserialize)]
struct CambiaPasswordReq {
    vecchia: String,
    nuova: String,
}

async fn cambia_password(State(state): State<AppState>, Json(req): Json<CambiaPasswordReq>) -> ApiResult<Json<Value>> {
    if req.nuova.len() < 8 {
        return Err(ApiError::bad_request("La nuova master password deve avere almeno 8 caratteri"));
    }
    let conn = tenant_conn(&state)?;
    let mut guard = conn.lock().unwrap();
    let (hash, salt_vecchio): (String, Vec<u8>) = guard
        .query_row("SELECT password_hash, salt FROM keychain_config WHERE id=1", [], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?
        .ok_or_else(|| ApiError::conflict("Portachiavi non ancora configurato"))?;
    if hash.is_empty() || !bcrypt::verify(&req.vecchia, &hash).unwrap_or(false) {
        return Err(ApiError::Status(StatusCode::UNAUTHORIZED, "Password attuale errata".into()));
    }
    let chiave_vecchia = derive_key_raw(&req.vecchia, &salt_vecchio).map_err(ApiError::Internal)?;
    let mut salt_nuovo = [0u8; 16];
    getrandom::getrandom(&mut salt_nuovo).map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?;
    let chiave_nuova = derive_key_raw(&req.nuova, &salt_nuovo).map_err(ApiError::Internal)?;
    let hash_nuovo = bcrypt::hash(&req.nuova, bcrypt::DEFAULT_COST).map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?;

    let tx = guard.transaction().map_err(ApiError::from)?;
    {
        let mut stmt = tx.prepare("SELECT id, password_cifrata, note_cifrata FROM keychain_entries")?;
        let righe: Vec<(i64, Vec<u8>, Option<Vec<u8>>)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<rusqlite::Result<_>>()?;
        drop(stmt);
        for (id, pw_cifrata, note_cifrata) in righe {
            let pw = decifra(chiave_vecchia, &pw_cifrata)?;
            let pw_nuova = cifra(&chiave_nuova, &salt_nuovo, &pw)?;
            let note_nuova = match note_cifrata.filter(|n| !n.is_empty()) {
                Some(n) => Some(cifra(&chiave_nuova, &salt_nuovo, &decifra(chiave_vecchia, &n)?)?),
                None => None,
            };
            tx.execute(
                "UPDATE keychain_entries SET password_cifrata=?1, note_cifrata=?2 WHERE id=?3",
                params![pw_nuova, note_nuova, id],
            )?;
        }
    }
    tx.execute(
        "UPDATE keychain_config SET password_hash=?1, salt=?2 WHERE id=1",
        params![hash_nuovo, salt_nuovo.to_vec()],
    )?;
    tx.commit().map_err(ApiError::from)?;

    *state.keychain_key.lock().unwrap() = Some(chiave_nuova);
    Ok(Json(json!({ "success": true })))
}

// ── voci ─────────────────────────────────────────────────────────────────────

async fn list_entries(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id, titolo, username, url, categoria, updated_at FROM keychain_entries ORDER BY titolo COLLATE NOCASE",
    )?;
    let rows: Vec<Value> = stmt
        .query_map([], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "titolo": r.get::<_, String>(1)?,
                "username": r.get::<_, String>(2)?,
                "url": r.get::<_, String>(3)?,
                "categoria": r.get::<_, String>(4)?,
                "updatedAt": r.get::<_, String>(5)?,
            }))
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(Json(json!(rows)))
}

#[derive(Deserialize)]
struct EntryReq {
    titolo: String,
    #[serde(default)]
    username: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    categoria: String,
    password: String,
    #[serde(default)]
    note: String,
}

fn salt_corrente(conn: &rusqlite::Connection) -> ApiResult<Vec<u8>> {
    conn.query_row("SELECT salt FROM keychain_config WHERE id=1", [], |r| r.get(0))
        .optional()?
        .ok_or_else(|| ApiError::conflict("Portachiavi non ancora configurato"))
}

async fn create_entry(State(state): State<AppState>, Json(req): Json<EntryReq>) -> ApiResult<Json<Value>> {
    if req.titolo.trim().is_empty() {
        return Err(ApiError::bad_request("Il titolo è obbligatorio"));
    }
    let chiave = chiave_sessione(&state)?;
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let salt = salt_corrente(&conn)?;
    let pw_cifrata = cifra(&chiave, &salt, &req.password)?;
    let note_cifrata = (!req.note.is_empty()).then(|| cifra(&chiave, &salt, &req.note)).transpose()?;
    conn.execute(
        "INSERT INTO keychain_entries (titolo, username, url, categoria, password_cifrata, note_cifrata, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6, datetime('now'))",
        params![req.titolo.trim(), req.username, req.url, req.categoria, pw_cifrata, note_cifrata],
    )?;
    Ok(Json(json!({ "id": conn.last_insert_rowid() })))
}

async fn update_entry(State(state): State<AppState>, Path(id): Path<i64>, Json(req): Json<EntryReq>) -> ApiResult<Json<Value>> {
    if req.titolo.trim().is_empty() {
        return Err(ApiError::bad_request("Il titolo è obbligatorio"));
    }
    let chiave = chiave_sessione(&state)?;
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let salt = salt_corrente(&conn)?;
    let pw_cifrata = cifra(&chiave, &salt, &req.password)?;
    let note_cifrata = (!req.note.is_empty()).then(|| cifra(&chiave, &salt, &req.note)).transpose()?;
    let n = conn.execute(
        "UPDATE keychain_entries SET titolo=?1, username=?2, url=?3, categoria=?4, password_cifrata=?5, note_cifrata=?6, updated_at=datetime('now') WHERE id=?7",
        params![req.titolo.trim(), req.username, req.url, req.categoria, pw_cifrata, note_cifrata, id],
    )?;
    if n == 0 {
        return Err(ApiError::not_found("Voce non trovata"));
    }
    Ok(Json(json!({ "success": true })))
}

async fn delete_entry(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    // Eliminare non richiede di decifrare nulla, ma va comunque impedito a sessione
    // bloccata: chi non conosce la master password non deve poter cancellare voci
    // alla cieca solo perché ha accesso all'app.
    chiave_sessione(&state)?;
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    conn.execute("DELETE FROM keychain_entries WHERE id=?1", [id])?;
    Ok(Json(json!({ "success": true })))
}

async fn rivela_entry(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let chiave = chiave_sessione(&state)?;
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let (pw_cifrata, note_cifrata): (Vec<u8>, Option<Vec<u8>>) = conn
        .query_row("SELECT password_cifrata, note_cifrata FROM keychain_entries WHERE id=?1", [id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?
        .ok_or_else(|| ApiError::not_found("Voce non trovata"))?;
    let password = decifra(chiave, &pw_cifrata)?;
    let note = match note_cifrata.filter(|n| !n.is_empty()) {
        Some(n) => Some(decifra(chiave, &n)?),
        None => None,
    };
    Ok(Json(json!({ "password": password, "note": note })))
}
