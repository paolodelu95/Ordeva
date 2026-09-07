//! /api/google — sincronizzazione bidirezionale di Agenda (appuntamenti) e
//! Todo con Google Calendar / Google Tasks.
//!
//! Ambito: un unico consenso OAuth copre entrambi gli scope (Calendar +
//! Tasks); due switch indipendenti (`calendar_attivo`/`tasks_attivo`)
//! decidono cosa sincronizzare davvero — riflettono la scelta dell'utente
//! finale, non un tutto-o-niente.
//!
//! Redirect OAuth: a differenza di eBay (routes/marketplace.rs, che usa un
//! deep-link OS-level perché eBay non accetta `localhost`), Google supporta e
//! raccomanda esplicitamente il redirect `http://127.0.0.1:<porta>` per le
//! app desktop. Qui si apre un listener TCP temporaneo (solo per la durata
//! del consenso, poi si chiude) invece del deep-link — coerente con la scelta
//! dell'utente di seguire il metodo raccomandato da Google piuttosto che
//! riusare il meccanismo eBay.
//!
//! Le credenziali dell'applicazione Ordeva (client id/secret registrati una
//! volta sola sulla Google Cloud Console) sono lette da variabili d'ambiente
//! di build (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) — non sono il token
//! dell'utente finale, che vive in `google_config` ed è sempre mascherato in
//! uscita.

use std::time::Duration;

use axum::{extract::State, routing::get, Json, Router};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use crate::db::AppState;
use crate::error::ApiError;
use crate::web::{oggi, tenant_conn};

type ApiResult<T> = Result<T, ApiError>;

const SCOPE_CALENDAR: &str = "https://www.googleapis.com/auth/calendar";
const SCOPE_TASKS: &str = "https://www.googleapis.com/auth/tasks";

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/config", get(get_config))
        .route("/connetti", axum::routing::post(connetti))
        .route("/disconnetti", axum::routing::post(disconnetti))
        .route("/calendar/toggle", axum::routing::post(toggle_calendar))
        .route("/tasks/toggle", axum::routing::post(toggle_tasks))
        .route("/calendar/sync", axum::routing::post(sync_calendar))
        .route("/tasks/sync", axum::routing::post(sync_tasks))
}

fn client() -> reqwest::Client {
    reqwest::Client::builder().timeout(Duration::from_secs(20)).build().unwrap_or_default()
}

fn google_credenziali() -> Result<(String, String), ApiError> {
    // Lette a tempo di compilazione (non a runtime): l'app installata su un PC
    // cliente non ha alcuna variabile d'ambiente configurata, quindi il valore
    // deve finire "cotto" nel binario in fase di build (CI o build locale con
    // GOOGLE_CLIENT_ID/SECRET esportate prima di `cargo build`/`tauri build`).
    let id = option_env!("GOOGLE_CLIENT_ID").unwrap_or_default().to_string();
    let secret = option_env!("GOOGLE_CLIENT_SECRET").unwrap_or_default().to_string();
    if id.is_empty() || secret.is_empty() {
        return Err(ApiError::Status(axum::http::StatusCode::SERVICE_UNAVAILABLE, "Integrazione Google non configurata in questa build".into()));
    }
    Ok((id, secret))
}

// ── configurazione ───────────────────────────────────────────────────────────

async fn get_config(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let row = conn
        .query_row(
            "SELECT access_token, account_label, calendar_attivo, calendar_ultima_sync, tasks_attivo, tasks_ultima_sync, connessione_in_corso, ultimo_errore FROM google_config WHERE id=1",
            [],
            |r| {
                Ok(json!({
                    "connesso": r.get::<_, Option<String>>(0)?.filter(|s| !s.is_empty()).is_some(),
                    "accountLabel": r.get::<_, Option<String>>(1)?,
                    "calendarAttivo": r.get::<_, Option<i64>>(2)? == Some(1),
                    "calendarUltimaSync": r.get::<_, Option<String>>(3)?,
                    "tasksAttivo": r.get::<_, Option<i64>>(4)? == Some(1),
                    "tasksUltimaSync": r.get::<_, Option<String>>(5)?,
                    "connessioneInCorso": r.get::<_, Option<i64>>(6)? == Some(1),
                    "ultimoErrore": r.get::<_, Option<String>>(7)?,
                }))
            },
        )
        .optional()?
        .unwrap_or_else(|| json!({ "connesso": false, "calendarAttivo": false, "tasksAttivo": false, "connessioneInCorso": false, "ultimoErrore": null }));
    Ok(Json(row))
}

async fn disconnetti(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    conn.execute("DELETE FROM google_config WHERE id=1", [])?;
    conn.execute("DELETE FROM google_calendar_tombstone", [])?;
    conn.execute("DELETE FROM google_tasks_tombstone", [])?;
    Ok(Json(json!({ "success": true })))
}

async fn toggle_calendar(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    conn.execute("UPDATE google_config SET calendar_attivo = CASE calendar_attivo WHEN 1 THEN 0 ELSE 1 END WHERE id=1", [])?;
    Ok(Json(json!({ "success": true })))
}

async fn toggle_tasks(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    conn.execute("UPDATE google_config SET tasks_attivo = CASE tasks_attivo WHEN 1 THEN 0 ELSE 1 END WHERE id=1", [])?;
    Ok(Json(json!({ "success": true })))
}

// ── OAuth (PKCE + redirect via porta locale temporanea) ──────────────────────

#[derive(Deserialize)]
struct GoogleTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
}

#[derive(Deserialize)]
struct GoogleUserinfo {
    email: Option<String>,
}

/// Avvia il collegamento e ritorna SUBITO — non aspetta il consenso
/// dell'utente su Google. Motivo: l'attesa può durare decine di secondi
/// (l'utente deve scegliere l'account, leggere il consenso, cliccare
/// "Consenti"), ma il canale interno di Ordeva (lo scheme custom `ordeva://`,
/// non una connessione di rete vera) è mediato dal motore della webview di
/// sistema, che impone un proprio timeout su una singola richiesta — più
/// corto di quanto un umano impieghi a completare un consenso OAuth. Se si
/// aspettasse qui, la richiesta veniva abbandonata dalla webview senza né
/// successo né errore visibile (bug osservato: il pulsante torna su "non
/// collegato" senza alcun messaggio). Il resto del flusso (attesa redirect,
/// scambio codice, scrittura DB) gira in un task in background; il frontend
/// fa polling su GET /config finché non risulta connesso o in errore.
async fn connetti(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let (client_id, client_secret) = google_credenziali()?;

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| ApiError::Status(axum::http::StatusCode::INTERNAL_SERVER_ERROR, format!("impossibile aprire una porta locale temporanea: {e}")))?;
    let porta = listener
        .local_addr()
        .map_err(|e| ApiError::Status(axum::http::StatusCode::INTERNAL_SERVER_ERROR, format!("porta locale non disponibile: {e}")))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{porta}");

    let verifier = token_casuale(64);
    let challenge = base64url_no_padding(&Sha256::digest(verifier.as_bytes()));
    let state_token = token_casuale(24);

    let scope = format!("{SCOPE_CALENDAR} {SCOPE_TASKS}");
    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&access_type=offline&prompt=consent&scope={}&code_challenge={}&code_challenge_method=S256&state={}",
        urlencoding_semplice(&client_id),
        urlencoding_semplice(&redirect_uri),
        urlencoding_semplice(&scope),
        challenge,
        state_token,
    );
    tracing::info!("apertura consenso Google (redirect_uri={redirect_uri})");

    {
        let conn = tenant_conn(&state)?;
        let conn = conn.lock().unwrap();
        conn.execute(
            "INSERT INTO google_config (id, connessione_in_corso, ultimo_errore) VALUES (1,1,NULL) \
             ON CONFLICT(id) DO UPDATE SET connessione_in_corso=1, ultimo_errore=NULL",
            [],
        )?;
    }

    let _ = open_url_in_system_browser(&auth_url);

    let state_clone = state.clone();
    tokio::spawn(async move {
        let esito = completa_collegamento(&state_clone, listener, state_token, client_id, client_secret, verifier, redirect_uri).await;
        let conn = match tenant_conn(&state_clone) {
            Ok(c) => c,
            Err(_) => return,
        };
        let conn = conn.lock().unwrap();
        match esito {
            Ok(()) => {
                let _ = conn.execute("UPDATE google_config SET connessione_in_corso=0, ultimo_errore=NULL WHERE id=1", []);
            }
            Err(e) => {
                tracing::warn!("collegamento Google fallito: {e}");
                let _ = conn.execute("UPDATE google_config SET connessione_in_corso=0, ultimo_errore=?1 WHERE id=1", params![e.to_string()]);
            }
        }
    });

    Ok(Json(json!({ "avviato": true })))
}

/// La parte lunga del collegamento (attesa redirect + scambio token + userinfo
/// + scrittura DB), eseguita fuori dal ciclo richiesta/risposta di `connetti`.
async fn completa_collegamento(
    state: &AppState,
    listener: TcpListener,
    state_token: String,
    client_id: String,
    client_secret: String,
    verifier: String,
    redirect_uri: String,
) -> ApiResult<()> {
    let code = attendi_redirect_oauth(listener, &state_token).await?;

    let resp = client()
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", &code),
            ("client_id", &client_id),
            ("client_secret", &client_secret),
            ("redirect_uri", &redirect_uri),
            ("code_verifier", &verifier),
        ])
        .send()
        .await
        .map_err(|e| ApiError::Status(axum::http::StatusCode::BAD_GATEWAY, format!("Google non raggiungibile: {e}")))?;
    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(ApiError::Status(axum::http::StatusCode::BAD_GATEWAY, format!("Google ha rifiutato il collegamento: {body}")));
    }
    let tok: GoogleTokenResponse = resp.json().await.map_err(|e| ApiError::Status(axum::http::StatusCode::BAD_GATEWAY, format!("risposta Google non valida: {e}")))?;

    let email = client()
        .get("https://www.googleapis.com/oauth2/v2/userinfo")
        .bearer_auth(&tok.access_token)
        .send()
        .await
        .ok()
        .and_then(|r| r.error_for_status().ok());
    let email = match email {
        Some(r) => r.json::<GoogleUserinfo>().await.ok().and_then(|u| u.email),
        None => None,
    };

    let conn = tenant_conn(state)?;
    let conn = conn.lock().unwrap();
    conn.execute(
        "INSERT INTO google_config (id, access_token, refresh_token, account_label) VALUES (1,?1,?2,?3) \
         ON CONFLICT(id) DO UPDATE SET access_token=excluded.access_token, \
         refresh_token=COALESCE(excluded.refresh_token, google_config.refresh_token), account_label=excluded.account_label",
        params![tok.access_token, tok.refresh_token, email.unwrap_or_default()],
    )?;
    Ok(())
}

/// Ascolta UNA sola richiesta HTTP sul listener temporaneo (il redirect di
/// Google dopo il consenso), ne estrae `code`/`state`, risponde con una
/// paginetta di cortesia e chiude. Niente framework: serve solo a catturare
/// una singola GET, un router axum completo sarebbe sovradimensionato.
async fn attendi_redirect_oauth(listener: TcpListener, state_atteso: &str) -> ApiResult<String> {
    let (mut stream, _) = tokio::time::timeout(Duration::from_secs(180), listener.accept())
        .await
        .map_err(|_| ApiError::bad_request("Tempo scaduto in attesa del consenso Google"))?
        .map_err(|e| ApiError::Status(axum::http::StatusCode::INTERNAL_SERVER_ERROR, format!("errore di rete: {e}")))?;

    let mut buf = [0u8; 8192];
    let n = stream.read(&mut buf).await.unwrap_or(0);
    let request = String::from_utf8_lossy(&buf[..n]);
    let path = request.lines().next().unwrap_or("").split_whitespace().nth(1).unwrap_or("/");
    let query = path.splitn(2, '?').nth(1).unwrap_or("");
    let params = parse_query_semplice(query);

    let corpo = "<html><body style=\"font-family:sans-serif;text-align:center;padding:40px\">\
                 <h2>Fatto!</h2><p>Puoi chiudere questa finestra e tornare a Ordeva.</p></body></html>";
    let risposta = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", corpo.len(), corpo);
    let _ = stream.write_all(risposta.as_bytes()).await;

    if params.get("state").map(String::as_str) != Some(state_atteso) {
        return Err(ApiError::bad_request("Stato OAuth non corrispondente: collegamento annullato per sicurezza"));
    }
    params.get("code").cloned().ok_or_else(|| ApiError::bad_request("Google non ha restituito un codice (consenso annullato?)"))
}

/// Rinnova l'access token se necessario usando il refresh token salvato.
/// v1: come per eBay, si riusa sempre l'access token corrente e si rifà un
/// giro di refresh solo se la chiamata API risponde 401 (vedi `chiamata_google`).
fn access_token_corrente(conn: &Connection) -> ApiResult<String> {
    conn.query_row("SELECT access_token FROM google_config WHERE id=1", [], |r| r.get::<_, Option<String>>(0))
        .optional()?
        .flatten()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| ApiError::bad_request("Google non collegato"))
}

async fn rinnova_access_token(state: &AppState) -> ApiResult<String> {
    let (client_id, client_secret) = google_credenziali()?;
    let refresh_token = {
        let conn = tenant_conn(state)?;
        let conn = conn.lock().unwrap();
        conn.query_row("SELECT refresh_token FROM google_config WHERE id=1", [], |r| r.get::<_, Option<String>>(0))
            .optional()?
            .flatten()
            .filter(|s| !s.is_empty())
            .ok_or_else(|| ApiError::bad_request("Google non collegato"))?
    };
    let resp = client()
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", &refresh_token),
            ("client_id", &client_id),
            ("client_secret", &client_secret),
        ])
        .send()
        .await
        .map_err(|e| ApiError::Status(axum::http::StatusCode::BAD_GATEWAY, format!("Google non raggiungibile: {e}")))?;
    if !resp.status().is_success() {
        return Err(ApiError::Status(axum::http::StatusCode::BAD_GATEWAY, "rinnovo del collegamento Google fallito, riprova a connetterti".into()));
    }
    let tok: GoogleTokenResponse = resp.json().await.map_err(|e| ApiError::Status(axum::http::StatusCode::BAD_GATEWAY, format!("risposta Google non valida: {e}")))?;
    let conn = tenant_conn(state)?;
    let conn = conn.lock().unwrap();
    conn.execute("UPDATE google_config SET access_token=?1 WHERE id=1", params![tok.access_token])?;
    Ok(tok.access_token)
}

// ── Sync Calendar ────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct GEventsList {
    #[serde(default)]
    items: Vec<GEvent>,
    #[serde(rename = "nextSyncToken")]
    next_sync_token: Option<String>,
    #[serde(default)]
    #[allow(dead_code)] // v1: una sola pagina; vedi nota su EbayOrdersResponse::next in marketplace.rs
    #[serde(rename = "nextPageToken")]
    next_page_token: Option<String>,
}

#[derive(Deserialize)]
struct GEvent {
    id: String,
    status: Option<String>,
    summary: Option<String>,
    description: Option<String>,
    location: Option<String>,
    start: Option<GEventTime>,
    end: Option<GEventTime>,
    updated: Option<String>,
    etag: Option<String>,
}

#[derive(Deserialize)]
struct GEventTime {
    #[serde(rename = "dateTime")]
    date_time: Option<String>,
    date: Option<String>,
}

async fn sync_calendar(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let (attivo, mut access_token, sync_token) = {
        let conn = tenant_conn(&state)?;
        let conn = conn.lock().unwrap();
        let row: (i64, String) = conn
            .query_row("SELECT calendar_attivo, calendar_sync_token FROM google_config WHERE id=1", [], |r| {
                Ok((r.get::<_, Option<i64>>(0)?.unwrap_or(0), r.get::<_, Option<String>>(1)?.unwrap_or_default()))
            })
            .optional()?
            .ok_or_else(|| ApiError::bad_request("Google non collegato"))?;
        if row.0 != 1 {
            return Err(ApiError::bad_request("Sincronizzazione calendario disattivata dalle impostazioni"));
        }
        (row.0, access_token_corrente(&conn)?, row.1)
    };

    // ── 1. Push locale → Google ──
    let righe_da_creare: Vec<(i64, String, String, String, String, i64, String)> = {
        let conn = tenant_conn(&state)?;
        let conn = conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, titolo, descrizione, inizio, COALESCE(fine,''), tutto_giorno, luogo FROM appuntamenti WHERE google_event_id IS NULL",
        )?;
        let righe = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        righe
    };
    let mut creati = 0i64;
    for (id, titolo, descrizione, inizio, fine, tutto_giorno, luogo) in righe_da_creare {
        let body = evento_google_da_riga(&titolo, &descrizione, &luogo, &inizio, &fine, tutto_giorno == 1);
        match google_json::<GEvent>(&state, &mut access_token, reqwest::Method::POST, "https://www.googleapis.com/calendar/v3/events", Some(&body)).await {
            Ok(ev) => {
                let conn = tenant_conn(&state)?;
                let conn = conn.lock().unwrap();
                conn.execute("UPDATE appuntamenti SET google_event_id=?1, google_etag=?2 WHERE id=?3", params![ev.id, ev.etag, id])?;
                creati += 1;
            }
            Err(e) => tracing::warn!("push appuntamento {id} verso Google fallito: {e}"),
        }
    }

    let righe_da_aggiornare: Vec<(i64, String, String, String, String, i64, String, String)> = {
        let conn = tenant_conn(&state)?;
        let conn = conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, titolo, descrizione, inizio, COALESCE(fine,''), tutto_giorno, google_event_id, luogo FROM appuntamenti \
             WHERE google_event_id IS NOT NULL AND (updated_at > COALESCE((SELECT calendar_ultima_sync FROM google_config WHERE id=1), '1970-01-01'))",
        )?;
        let righe = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        righe
    };
    let mut aggiornati = 0i64;
    for (_id, titolo, descrizione, inizio, fine, tutto_giorno, event_id, luogo) in righe_da_aggiornare {
        let body = evento_google_da_riga(&titolo, &descrizione, &luogo, &inizio, &fine, tutto_giorno == 1);
        let url = format!("https://www.googleapis.com/calendar/v3/events/{event_id}");
        if chiamata_google(&state, &mut access_token, reqwest::Method::PATCH, &url, Some(&body)).await.map(|r| r.status().is_success()).unwrap_or(false) {
            aggiornati += 1;
        }
    }

    let tombstone: Vec<String> = {
        let conn = tenant_conn(&state)?;
        let conn = conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT google_event_id FROM google_calendar_tombstone")?;
        let righe = stmt.query_map([], |r| r.get(0))?.collect::<Result<Vec<_>, _>>()?;
        righe
    };
    let mut eliminati = 0i64;
    for event_id in &tombstone {
        let url = format!("https://www.googleapis.com/calendar/v3/events/{event_id}");
        let _ = chiamata_google(&state, &mut access_token, reqwest::Method::DELETE, &url, None).await;
        eliminati += 1;
    }
    {
        let conn = tenant_conn(&state)?;
        let conn = conn.lock().unwrap();
        conn.execute("DELETE FROM google_calendar_tombstone", [])?;
    }

    // ── 2. Pull Google → locale ──
    let mut url = if sync_token.is_empty() {
        format!("https://www.googleapis.com/calendar/v3/events?calendarId=primary&timeMin={}T00:00:00Z&singleEvents=true", oggi_meno_giorni(30))
    } else {
        format!("https://www.googleapis.com/calendar/v3/events?calendarId=primary&syncToken={}", urlencoding_semplice(&sync_token))
    };
    let mut importati = 0i64;
    let mut nuovo_sync_token = sync_token.clone();
    let mut riprovato_senza_token = false;
    loop {
        let resp = chiamata_google(&state, &mut access_token, reqwest::Method::GET, &url, None).await?;
        if resp.status() == reqwest::StatusCode::GONE && !riprovato_senza_token {
            // syncToken scaduto: sync completo da zero, un solo nuovo tentativo.
            riprovato_senza_token = true;
            url = format!("https://www.googleapis.com/calendar/v3/events?calendarId=primary&timeMin={}T00:00:00Z&singleEvents=true", oggi_meno_giorni(30));
            continue;
        }
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(ApiError::Status(axum::http::StatusCode::BAD_GATEWAY, format!("Google ha risposto {status}: {body}")));
        }
        let dati: GEventsList = resp.json().await.map_err(|e| ApiError::Status(axum::http::StatusCode::BAD_GATEWAY, format!("risposta Google non valida: {e}")))?;
        for ev in dati.items {
            applica_evento_google(&state, &ev)?;
            importati += 1;
        }
        if let Some(t) = dati.next_sync_token {
            nuovo_sync_token = t;
        }
        break; // v1: una sola pagina per giro, come per eBay — vedi nota next_page_token
    }

    {
        let conn = tenant_conn(&state)?;
        let conn = conn.lock().unwrap();
        conn.execute(
            "UPDATE google_config SET calendar_sync_token=?1, calendar_ultima_sync=datetime('now') WHERE id=1",
            params![nuovo_sync_token],
        )?;
    }
    let _ = attivo;
    Ok(Json(json!({ "creati": creati, "aggiornati": aggiornati, "eliminati": eliminati, "importati": importati })))
}

fn evento_google_da_riga(titolo: &str, descrizione: &str, luogo: &str, inizio: &str, fine: &str, tutto_giorno: bool) -> Value {
    let (start, end) = if tutto_giorno {
        (json!({ "date": &inizio[..10.min(inizio.len())] }), json!({ "date": if fine.is_empty() { &inizio[..10.min(inizio.len())] } else { &fine[..10.min(fine.len())] } }))
    } else {
        (json!({ "dateTime": inizio }), json!({ "dateTime": if fine.is_empty() { inizio } else { fine } }))
    };
    json!({ "summary": titolo, "description": descrizione, "location": luogo, "start": start, "end": end })
}

fn applica_evento_google(state: &AppState, ev: &GEvent) -> ApiResult<()> {
    let conn = tenant_conn(state)?;
    let conn = conn.lock().unwrap();
    let esistente: Option<(i64, String)> = conn
        .query_row("SELECT id, updated_at FROM appuntamenti WHERE google_event_id=?1", params![ev.id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?;

    if ev.status.as_deref() == Some("cancelled") {
        if let Some((id, _)) = esistente {
            conn.execute("DELETE FROM appuntamenti WHERE id=?1", params![id])?;
        }
        return Ok(());
    }
    let (inizio, tutto_giorno) = match &ev.start {
        Some(GEventTime { date_time: Some(dt), .. }) => (dt.clone(), 0),
        Some(GEventTime { date: Some(d), .. }) => (d.clone(), 1),
        _ => return Ok(()), // evento senza data valida, ignorato
    };
    let fine = ev.end.as_ref().and_then(|e| e.date_time.clone().or_else(|| e.date.clone()));
    let titolo = ev.summary.clone().unwrap_or_else(|| "(senza titolo)".into());
    let descrizione = ev.description.clone().unwrap_or_default();
    let luogo = ev.location.clone().unwrap_or_default();

    match esistente {
        None => {
            conn.execute(
                "INSERT INTO appuntamenti (titolo, descrizione, inizio, fine, tutto_giorno, luogo, stato, google_event_id, google_etag) \
                 VALUES (?1,?2,?3,?4,?5,?6,'PIANIFICATO',?7,?8)",
                params![titolo, descrizione, inizio, fine, tutto_giorno, luogo, ev.id, ev.etag],
            )?;
        }
        Some((id, updated_at_locale)) => {
            // Last-write-wins: se la modifica locale è più recente di quella
            // Google, la si preserva e si aspetta che il prossimo push la
            // sovrascriva lato Google — non si applica l'evento in arrivo.
            let google_piu_recente = match &ev.updated {
                Some(u) => u.as_str() > updated_at_locale.as_str(),
                None => true,
            };
            if google_piu_recente {
                conn.execute(
                    "UPDATE appuntamenti SET titolo=?1, descrizione=?2, inizio=?3, fine=?4, tutto_giorno=?5, luogo=?6, google_etag=?7 WHERE id=?8",
                    params![titolo, descrizione, inizio, fine, tutto_giorno, luogo, ev.etag, id],
                )?;
            }
        }
    }
    Ok(())
}

// ── Sync Tasks ───────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct GTasksList {
    items: Option<Vec<GTask>>,
}

#[derive(Deserialize)]
struct GTask {
    id: String,
    title: Option<String>,
    notes: Option<String>,
    due: Option<String>,
    status: Option<String>, // "needsAction" | "completed"
    updated: Option<String>,
    deleted: Option<bool>,
}

/// Sync Google Tasks. Nota: a differenza di Calendar, l'API Tasks non espone
/// un syncToken opaco — qui si usa `updatedMin` (per-tenant, il timestamp
/// dell'ultima sync) come cursore incrementale con `showDeleted=true`. Da
/// riverificare contro la documentazione Tasks corrente prima del rilascio:
/// è il punto con meno copertura di ricerca rispetto a Calendar.
async fn sync_tasks(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let (mut access_token, ultima_sync) = {
        let conn = tenant_conn(&state)?;
        let conn = conn.lock().unwrap();
        let row: (i64, Option<String>) = conn
            .query_row("SELECT tasks_attivo, tasks_ultima_sync FROM google_config WHERE id=1", [], |r| Ok((r.get::<_, Option<i64>>(0)?.unwrap_or(0), r.get(1)?)))
            .optional()?
            .ok_or_else(|| ApiError::bad_request("Google non collegato"))?;
        if row.0 != 1 {
            return Err(ApiError::bad_request("Sincronizzazione cose-da-fare disattivata dalle impostazioni"));
        }
        (access_token_corrente(&conn)?, row.1)
    };

    // 1. Push locale → Google
    let da_creare: Vec<(i64, String, String, Option<String>)> = {
        let conn = tenant_conn(&state)?;
        let conn = conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, titolo, descrizione, scadenza FROM todo WHERE google_task_id IS NULL")?;
        let righe = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?.collect::<Result<Vec<_>, _>>()?;
        righe
    };
    let mut creati = 0i64;
    for (id, titolo, descrizione, scadenza) in da_creare {
        let mut body = json!({ "title": titolo, "notes": descrizione });
        if let Some(d) = scadenza.filter(|s| !s.is_empty()) {
            body["due"] = json!(format!("{}T00:00:00.000Z", &d[..10.min(d.len())]));
        }
        if let Ok(resp) = chiamata_google(&state, &mut access_token, reqwest::Method::POST, "https://tasks.googleapis.com/tasks/v1/lists/@default/tasks", Some(&body)).await {
            if let Ok(t) = resp.json::<GTask>().await {
                let conn = tenant_conn(&state)?;
                let conn = conn.lock().unwrap();
                conn.execute("UPDATE todo SET google_task_id=?1 WHERE id=?2", params![t.id, id])?;
                creati += 1;
            }
        }
    }

    let da_aggiornare: Vec<(String, String, String, Option<String>, String)> = {
        let conn = tenant_conn(&state)?;
        let conn = conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT google_task_id, titolo, descrizione, scadenza, stato FROM todo \
             WHERE google_task_id IS NOT NULL AND (updated_at > COALESCE((SELECT tasks_ultima_sync FROM google_config WHERE id=1), '1970-01-01'))",
        )?;
        let righe = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?.collect::<Result<Vec<_>, _>>()?;
        righe
    };
    let mut aggiornati = 0i64;
    for (task_id, titolo, descrizione, scadenza, stato) in da_aggiornare {
        let mut body = json!({ "title": titolo, "notes": descrizione, "status": if stato == "FATTA" { "completed" } else { "needsAction" } });
        if let Some(d) = scadenza.filter(|s| !s.is_empty()) {
            body["due"] = json!(format!("{}T00:00:00.000Z", &d[..10.min(d.len())]));
        }
        let url = format!("https://tasks.googleapis.com/tasks/v1/lists/@default/tasks/{task_id}");
        if chiamata_google(&state, &mut access_token, reqwest::Method::PATCH, &url, Some(&body)).await.is_ok() {
            aggiornati += 1;
        }
    }

    let tombstone: Vec<String> = {
        let conn = tenant_conn(&state)?;
        let conn = conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT google_task_id FROM google_tasks_tombstone")?;
        let righe = stmt.query_map([], |r| r.get(0))?.collect::<Result<Vec<_>, _>>()?;
        righe
    };
    let mut eliminati = 0i64;
    for task_id in &tombstone {
        let url = format!("https://tasks.googleapis.com/tasks/v1/lists/@default/tasks/{task_id}");
        let _ = chiamata_google(&state, &mut access_token, reqwest::Method::DELETE, &url, None).await;
        eliminati += 1;
    }
    {
        let conn = tenant_conn(&state)?;
        let conn = conn.lock().unwrap();
        conn.execute("DELETE FROM google_tasks_tombstone", [])?;
    }

    // 2. Pull Google → locale
    let updated_min = ultima_sync.clone().unwrap_or_else(|| "1970-01-01T00:00:00Z".into());
    let url = format!(
        "https://tasks.googleapis.com/tasks/v1/lists/@default/tasks?showDeleted=true&showHidden=true&updatedMin={}",
        urlencoding_semplice(&updated_min)
    );
    let mut importati = 0i64;
    if let Ok(resp) = chiamata_google(&state, &mut access_token, reqwest::Method::GET, &url, None).await {
        let dati: GTasksList = resp.json().await.unwrap_or(GTasksList { items: None });
        for t in dati.items.unwrap_or_default() {
            applica_task_google(&state, &t)?;
            importati += 1;
        }
    }

    {
        let conn = tenant_conn(&state)?;
        let conn = conn.lock().unwrap();
        conn.execute("UPDATE google_config SET tasks_ultima_sync=datetime('now') WHERE id=1", [])?;
    }
    Ok(Json(json!({ "creati": creati, "aggiornati": aggiornati, "eliminati": eliminati, "importati": importati })))
}

fn applica_task_google(state: &AppState, t: &GTask) -> ApiResult<()> {
    let conn = tenant_conn(state)?;
    let conn = conn.lock().unwrap();
    let esistente: Option<(i64, String)> = conn
        .query_row("SELECT id, updated_at FROM todo WHERE google_task_id=?1", params![t.id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?;
    if t.deleted == Some(true) {
        if let Some((id, _)) = esistente {
            conn.execute("DELETE FROM todo WHERE id=?1", params![id])?;
        }
        return Ok(());
    }
    let titolo = t.title.clone().unwrap_or_else(|| "(senza titolo)".into());
    let descrizione = t.notes.clone().unwrap_or_default();
    let scadenza = t.due.as_ref().map(|d| d[..10.min(d.len())].to_string());
    let stato = if t.status.as_deref() == Some("completed") { "FATTA" } else { "DA_FARE" };
    match esistente {
        None => {
            conn.execute(
                "INSERT INTO todo (titolo, descrizione, scadenza, stato, google_task_id) VALUES (?1,?2,?3,?4,?5)",
                params![titolo, descrizione, scadenza, stato, t.id],
            )?;
        }
        Some((id, updated_at_locale)) => {
            let google_piu_recente = match &t.updated {
                Some(u) => u.as_str() > updated_at_locale.as_str(),
                None => true,
            };
            if google_piu_recente {
                conn.execute("UPDATE todo SET titolo=?1, descrizione=?2, scadenza=?3, stato=?4 WHERE id=?5", params![titolo, descrizione, scadenza, stato, id])?;
            }
        }
    }
    Ok(())
}

// ── chiamata HTTP autenticata con refresh automatico su 401 ─────────────────

/// Esegue la chiamata con rinnovo automatico del token su 401. Ritorna la
/// risposta grezza (anche se non 2xx): i chiamanti che devono distinguere
/// stati specifici (es. 410 Gone per il syncToken scaduto) la ispezionano da
/// sé; per gli altri, `google_json` sotto gestisce l'errore generico.
async fn chiamata_google(
    state: &AppState,
    access_token: &mut String,
    metodo: reqwest::Method,
    url: &str,
    body: Option<&Value>,
) -> ApiResult<reqwest::Response> {
    let esegui = |token: &str, body: Option<&Value>| {
        let mut req = client().request(metodo.clone(), url).bearer_auth(token);
        if let Some(b) = body {
            req = req.json(b);
        }
        req.send()
    };
    let resp = esegui(access_token, body).await.map_err(|e| ApiError::Status(axum::http::StatusCode::BAD_GATEWAY, format!("Google non raggiungibile: {e}")))?;
    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        *access_token = rinnova_access_token(state).await?;
        return esegui(access_token, body).await.map_err(|e| ApiError::Status(axum::http::StatusCode::BAD_GATEWAY, format!("Google non raggiungibile: {e}")));
    }
    Ok(resp)
}

/// Come `chiamata_google`, ma pretende un 2xx e deserializza il JSON —
/// per i casi (la maggioranza) dove un errore va semplicemente propagato.
async fn google_json<T: for<'de> Deserialize<'de>>(
    state: &AppState,
    access_token: &mut String,
    metodo: reqwest::Method,
    url: &str,
    body: Option<&Value>,
) -> ApiResult<T> {
    let resp = chiamata_google(state, access_token, metodo, url, body).await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(ApiError::Status(axum::http::StatusCode::BAD_GATEWAY, format!("Google ha risposto {status}: {body}")));
    }
    resp.json::<T>().await.map_err(|e| ApiError::Status(axum::http::StatusCode::BAD_GATEWAY, format!("risposta Google non valida: {e}")))
}

// ── helper locali ────────────────────────────────────────────────────────────

fn oggi_meno_giorni(giorni: i64) -> String {
    use crate::web::days_of;
    let oggi_str = oggi();
    let Some(g) = days_of(&oggi_str) else { return oggi_str };
    civil_from_days(g - giorni)
}

fn civil_from_days(z: i64) -> String {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as i64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{:04}-{:02}-{:02}", y, m, d)
}

fn urlencoding_semplice(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

fn parse_query_semplice(query: &str) -> std::collections::HashMap<String, String> {
    let mut out = std::collections::HashMap::new();
    for pair in query.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            out.insert(url_decode_semplice(k), url_decode_semplice(v));
        }
    }
    out
}

fn url_decode_semplice(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                    out.push(v);
                    i += 3;
                    continue;
                }
                out.push(bytes[i]);
                i += 1;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn token_casuale(n: usize) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let mut seed = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let mut out = String::with_capacity(n);
    const ALFABETO: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for _ in 0..n {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
        out.push(ALFABETO[(seed >> 33) as usize % ALFABETO.len()] as char);
    }
    out
}

fn base64url_no_padding(bytes: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity((bytes.len() * 4 + 2) / 3);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = *chunk.get(1).unwrap_or(&0);
        let b2 = *chunk.get(2).unwrap_or(&0);
        out.push(TABLE[(b0 >> 2) as usize] as char);
        out.push(TABLE[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char);
        }
        if chunk.len() > 2 {
            out.push(TABLE[(b2 & 0x3f) as usize] as char);
        }
    }
    out
}

/// Apre l'URL nel browser di sistema. Il backend non ha accesso diretto ai
/// plugin Tauri (vive nel Router axum, non nel contesto dell'app handle): usa
/// il comando nativo del sistema operativo, stesso effetto di
/// `@tauri-apps/plugin-shell` ma lato Rust puro — evita di dover far viaggiare
/// l'URL fino al frontend solo per aprirlo.
fn open_url_in_system_browser(url: &str) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(url).spawn()?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd").args(["/C", "start", "", url]).spawn()?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open").arg(url).spawn()?;
    }
    Ok(())
}
