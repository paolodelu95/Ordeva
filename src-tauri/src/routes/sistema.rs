//! /api/sistema — gestione "da app vera" dei file dati (edizione offline):
//! dove vivono i dati, spostarli (anche in Dropbox), stato del lock di sessione e
//! chiusura sicura con sincronizzazione.

use std::path::PathBuf;

use axum::{extract::State, routing::{get, post}, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::db::AppState;
use crate::error::{ApiError, ApiResult};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/percorsi", get(percorsi))
        .route("/data-dir", post(set_data_dir))
        .route("/lock", get(lock_stato))
        .route("/flush", post(flush))
        .route("/snapshots", get(snapshots_list).post(snapshot_create))
        .route("/snapshots/restore", post(snapshot_restore))
        .route("/cifratura", get(cifratura_stato).post(cifratura_set))
        .route("/aggiornamenti", get(aggiornamenti))
        .route("/diagnostica", get(diagnostica_stato).post(diagnostica_esito))
}

/// GET /api/sistema/aggiornamenti — chi si occupa di aggiornare l'app.
///
/// Quando Ordeva è installata da uno store (Snap, Flatpak) il binario è di sola
/// lettura e l'aggiornamento lo fa il gestore di pacchetti: l'updater interno
/// non deve né controllare né tentare di installare, altrimenti proporrebbe un
/// aggiornamento che poi fallisce. Fuori dagli store non cambia nulla.
async fn aggiornamenti() -> Json<Value> {
    // Variabili impostate dai rispettivi runtime; ORDEVA_DISABLE_UPDATER è la
    // via manuale per chi impacchetta l'app altrove (AUR, Nix, build interne).
    let gestore = if std::env::var_os("SNAP").is_some() {
        "snap"
    } else if std::env::var_os("FLATPAK_ID").is_some() {
        "flatpak"
    } else if std::env::var_os("ORDEVA_DISABLE_UPDATER").is_some() {
        "pacchetto"
    } else {
        ""
    };
    Json(json!({
        "interno": gestore.is_empty(),
        "gestore": gestore,
    }))
}

/// GET /api/sistema/diagnostica — autotest da eseguire all'avvio, se richiesto.
///
/// La lettura dei documenti vive nella WebView, che su ogni sistema è un motore
/// diverso (WKWebView su macOS, WebView2 su Windows, WebKitGTK su Linux) e
/// fallisce in modi diversi. Avviando l'app con ORDEVA_SELFTEST=ocr il frontend
/// esegue la pipeline su un documento di prova e rimanda qui l'esito, che
/// finisce nei log: così si vede l'errore VERO del motore reale, invece di
/// indovinare da fuori.
async fn diagnostica_stato() -> Json<Value> {
    let attivo = std::env::var("ORDEVA_SELFTEST").unwrap_or_default();
    Json(json!({ "selftest": attivo }))
}

/// POST /api/sistema/diagnostica — esito dell'autotest, body { contesto, esito, dettaglio }.
async fn diagnostica_esito(Json(b): Json<Value>) -> Json<Value> {
    let contesto = b.get("contesto").and_then(Value::as_str).unwrap_or("?");
    let esito = b.get("esito").and_then(Value::as_str).unwrap_or("?");
    let dettaglio = b.get("dettaglio").and_then(Value::as_str).unwrap_or("");
    if esito == "ok" {
        tracing::warn!("[selftest] {contesto}: OK {dettaglio}");
    } else {
        tracing::error!("[selftest] {contesto}: FALLITO {dettaglio}");
    }
    Json(json!({ "ok": true }))
}

/// GET /api/sistema/percorsi — cartella dati corrente + elenco file principali.
async fn percorsi(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let dir = &state.data_dir;
    let mut files: Vec<Value> = Vec::new();
    for nome in [crate::db::DB_FILE, "backups"] {
        let p = dir.join(nome);
        let size = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
        files.push(json!({ "nome": nome, "esiste": p.exists(), "bytes": size }));
    }
    Ok(Json(json!({
        "dataDir": dir.to_string_lossy(),
        "configPath": state.config_path.to_string_lossy(),
    "files": files,
    })))
}

#[derive(Deserialize)]
struct DataDirReq {
    path: String,
}

/// POST /api/sistema/data-dir — sposta i dati nella cartella indicata (es. Dropbox) e
/// persiste la scelta. Richiede un riavvio dell'app (lo fa il frontend).
async fn set_data_dir(
    State(state): State<AppState>,
    Json(req): Json<DataDirReq>,
) -> ApiResult<Json<Value>> {
    let path = req.path.trim();
    if path.is_empty() {
        return Err(ApiError::bad_request("Percorso mancante"));
    }
    let new_dir = PathBuf::from(path);
    if !new_dir.is_dir() {
        return Err(ApiError::bad_request("La cartella scelta non esiste"));
    }
    state.set_data_dir(&new_dir)?;
    Ok(Json(json!({ "ok": true, "riavvioRichiesto": true, "dataDir": new_dir.to_string_lossy() })))
}

/// GET /api/sistema/lock — se all'avvio risultava una sessione viva su un ALTRO computer
/// (per avvisare l'utente prima di lavorare sullo stesso DB Dropbox).
async fn lock_stato(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let other = state.other_session.lock().unwrap().clone();
    Ok(Json(match other {
        Some(l) => json!({
            "altraSessione": true,
            "host": l.host,
            "heartbeatAt": l.heartbeat_at,
        }),
        None => json!({ "altraSessione": false }),
    }))
}

/// GET /api/sistema/snapshots — cronologia versioni ripristinabili (più recenti prima).
async fn snapshots_list(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    Ok(Json(json!({ "snapshots": crate::backup::list_snapshots(&state) })))
}

/// POST /api/sistema/snapshots — crea uno snapshot ora.
async fn snapshot_create(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let name = crate::backup::create_snapshot(&state)?;
    Ok(Json(json!({ "ok": true, "name": name })))
}

#[derive(Deserialize)]
struct SnapshotReq {
    name: String,
}

/// POST /api/sistema/snapshots/restore — ripristina i dati da uno snapshot.
async fn snapshot_restore(
    State(state): State<AppState>,
    Json(req): Json<SnapshotReq>,
) -> ApiResult<Json<Value>> {
    crate::backup::restore_snapshot(&state, &req.name)?;
    Ok(Json(json!({ "ok": true })))
}

fn app_password_hash(state: &AppState) -> String {
    state
        .with_tenant(crate::db::DEFAULT_TENANT, |c| {
            Ok(c.query_row("SELECT app_password_hash FROM azienda WHERE id=1", [], |r| {
                r.get::<_, Option<String>>(0)
            })
            .ok()
            .flatten()
            .unwrap_or_default())
        })
        .unwrap_or_default()
}

/// GET /api/sistema/cifratura — stato cifratura a riposo.
async fn cifratura_stato(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    Ok(Json(json!({
        "attiva": crate::config::is_encrypted(&state.config_path),
        "passwordImpostata": !app_password_hash(&state).is_empty(),
    })))
}

#[derive(Deserialize)]
struct CifraturaReq {
    enabled: bool,
    #[serde(default)]
    password: String,
}

/// POST /api/sistema/cifratura — attiva/disattiva la cifratura del database a riposo.
/// L'attivazione richiede la password d'accesso (con cui verrà cifrato/sbloccato il file).
async fn cifratura_set(
    State(state): State<AppState>,
    Json(req): Json<CifraturaReq>,
) -> ApiResult<Json<Value>> {
    if req.enabled {
        let hash = app_password_hash(&state);
        if hash.is_empty() {
            return Err(ApiError::bad_request(
                "Imposta prima una password d'accesso (Impostazioni → Sicurezza).",
            ));
        }
        if !bcrypt::verify(&req.password, &hash).unwrap_or(false) {
            return Err(ApiError::bad_request("Password d'accesso errata"));
        }
        // Consolida il DB e crea subito il file cifrato; il chiaro resta in uso e verrà
        // ricifrato/rimosso alla chiusura.
        state.flush();
        crate::atrest::encrypt_now(&state.data_dir, &req.password)
            .map_err(|e| ApiError::Internal(e))?;
        crate::config::set_encrypted(&state.config_path, true).map_err(ApiError::Internal)?;
        *state.atrest_password.lock().unwrap() = Some(req.password.clone());
        Ok(Json(json!({ "ok": true, "attiva": true })))
    } else {
        crate::atrest::remove_enc(&state.data_dir);
        crate::config::set_encrypted(&state.config_path, false).map_err(ApiError::Internal)?;
        *state.atrest_password.lock().unwrap() = None;
        Ok(Json(json!({ "ok": true, "attiva": false })))
    }
}

/// POST /api/sistema/flush — checkpoint finale + rilascio lock, per "Chiudi in sicurezza".
/// Dopo questa, il frontend chiude l'app (plugin-process), così Dropbox sincronizza un
/// file `.db` pulito prima di aprire Ordeva su un altro computer.
async fn flush(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    state.flush();
    state.release_lock();
    Ok(Json(json!({ "ok": true })))
}
