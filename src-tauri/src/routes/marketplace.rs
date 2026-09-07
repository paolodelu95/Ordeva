//! /api/marketplace — import ordini da marketplace esterni (eBay, poi Amazon).
//!
//! Ambito volutamente ridotto: SOLA LETTURA degli ordini già conclusi, per
//! scaricare il magazzino e alimentare le statistiche — niente gestione
//! annunci, niente invio prezzi/giacenze verso il marketplace. Ogni ordine
//! importato diventa una riga in `vendite_banco`/`vendite_banco_righe` (stessa
//! tabella della vendita al banco, `canale` a distinguerle), riusando
//! `vendite_banco::inserisci_vendita()` per lo scarico scorte.
//!
//! Le credenziali OAuth dell'applicazione Ordeva (client id/secret registrati
//! una volta sola sul developer portal eBay) sono lette da variabili
//! d'ambiente al momento della build (`EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`,
//! `EBAY_RUNAME`) — NON sono il token dell'utente finale, che invece vive in
//! `marketplace_config` (access/refresh token ottenuti per-utente via consenso
//! OAuth) ed è sempre mascherato in uscita, mai il valore vero.

use std::time::Duration;

use axum::{extract::State, routing::get, Json, Router};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::db::AppState;
use crate::error::{ApiError, ApiResult};
use crate::numerazione::get_next_numero;
use crate::web::{num, oggi, tenant_conn};

use super::vendite_banco::inserisci_vendita;

const EBAY_SCOPE: &str = "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly";

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/configs", get(list_configs))
        .route("/configs/:canale/disconnetti", axum::routing::post(disconnetti))
        .route("/configs/:canale/toggle", axum::routing::post(toggle_attivo))
        .route("/ebay/auth-url", get(ebay_auth_url))
        .route("/ebay/exchange-code", axum::routing::post(ebay_exchange_code))
        .route("/ebay/sync", axum::routing::post(ebay_sync))
        .route("/ebay/abbina", axum::routing::post(ebay_abbina))
}

fn client() -> reqwest::Client {
    reqwest::Client::builder().timeout(Duration::from_secs(20)).build().unwrap_or_default()
}

fn ebay_credenziali() -> Result<(String, String, String), ApiError> {
    // Lette a tempo di compilazione, non a runtime — vedi la stessa nota in
    // google_sync.rs::google_credenziali().
    let client_id = option_env!("EBAY_CLIENT_ID").unwrap_or_default().to_string();
    let client_secret = option_env!("EBAY_CLIENT_SECRET").unwrap_or_default().to_string();
    let runame = option_env!("EBAY_RUNAME").unwrap_or_default().to_string();
    if client_id.is_empty() || client_secret.is_empty() || runame.is_empty() {
        return Err(ApiError::Status(
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            "Integrazione eBay non configurata in questa build".into(),
        ));
    }
    Ok((client_id, client_secret, runame))
}

// ── configurazioni ───────────────────────────────────────────────────────────

async fn list_configs(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT canale, access_token, refresh_token, account_label, attivo, ultima_sync FROM marketplace_config ORDER BY canale",
    )?;
    let rows = stmt
        .query_map([], |r| {
            let access: Option<String> = r.get("access_token")?;
            Ok(json!({
                "canale": r.get::<_, String>("canale")?,
                "connesso": access.as_deref().unwrap_or("").is_empty().then_some(false).unwrap_or(true),
                "accountLabel": r.get::<_, Option<String>>("account_label")?,
                "attivo": r.get::<_, Option<i64>>("attivo")? == Some(1),
                "ultimaSync": r.get::<_, Option<String>>("ultima_sync")?,
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(json!({
        "canali": rows,
        // Amazon non ancora attivabile: in attesa della revisione "Public Application".
        "amazonDisponibile": false,
    })))
}

async fn disconnetti(
    State(state): State<AppState>,
    axum::extract::Path(canale): axum::extract::Path<String>,
) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    conn.execute("DELETE FROM marketplace_config WHERE canale=?1", params![canale.to_uppercase()])?;
    Ok(Json(json!({ "success": true })))
}

/// Sospende/riattiva la sincronizzazione senza perdere il collegamento (i token
/// restano salvati) — la funzione "disattivabile dalle impostazioni" richiesta,
/// senza dover rifare il consenso OAuth per riattivarla.
async fn toggle_attivo(
    State(state): State<AppState>,
    axum::extract::Path(canale): axum::extract::Path<String>,
) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    conn.execute(
        "UPDATE marketplace_config SET attivo = CASE attivo WHEN 1 THEN 0 ELSE 1 END WHERE canale=?1",
        params![canale.to_uppercase()],
    )?;
    Ok(Json(json!({ "success": true })))
}

// ── OAuth eBay ───────────────────────────────────────────────────────────────

async fn ebay_auth_url(State(_state): State<AppState>) -> ApiResult<Json<Value>> {
    let (client_id, _secret, runame) = ebay_credenziali()?;
    let state_token = uuid_semplice();
    let url = format!(
        "https://auth.ebay.com/oauth2/authorize?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}",
        urlencoding_semplice(&client_id),
        urlencoding_semplice(&runame),
        urlencoding_semplice(EBAY_SCOPE),
        state_token,
    );
    Ok(Json(json!({ "url": url, "state": state_token })))
}

#[derive(Deserialize)]
struct EbayTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
}

async fn ebay_exchange_code(State(state): State<AppState>, Json(b): Json<Value>) -> ApiResult<Json<Value>> {
    let code = b.get("code").and_then(Value::as_str).unwrap_or("");
    if code.is_empty() {
        return Err(ApiError::bad_request("code mancante"));
    }
    let (client_id, client_secret, runame) = ebay_credenziali()?;
    let resp = client()
        .post("https://api.ebay.com/identity/v1/oauth2/token")
        .basic_auth(&client_id, Some(&client_secret))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(format!(
            "grant_type=authorization_code&code={}&redirect_uri={}",
            urlencoding_semplice(code),
            urlencoding_semplice(&runame),
        ))
        .send()
        .await
        .map_err(|e| ApiError::Status(axum::http::StatusCode::BAD_GATEWAY, format!("eBay non raggiungibile: {e}")))?;
    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(ApiError::Status(axum::http::StatusCode::BAD_GATEWAY, format!("eBay ha rifiutato il collegamento: {body}")));
    }
    let tok: EbayTokenResponse = resp
        .json()
        .await
        .map_err(|e| ApiError::Status(axum::http::StatusCode::BAD_GATEWAY, format!("risposta eBay non valida: {e}")))?;

    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    conn.execute(
        "INSERT INTO marketplace_config (canale, access_token, refresh_token, attivo) VALUES ('EBAY',?1,?2,1) \
         ON CONFLICT(canale) DO UPDATE SET access_token=excluded.access_token, refresh_token=COALESCE(excluded.refresh_token, marketplace_config.refresh_token), attivo=1",
        params![tok.access_token, tok.refresh_token],
    )?;
    let _ = tok.expires_in; // usato solo per eventuale refresh anticipato, non persistito in v1
    Ok(Json(json!({ "success": true })))
}

fn ebay_refresh_token_se_serve(conn: &Connection) -> ApiResult<String> {
    let (access, refresh, attivo): (Option<String>, Option<String>, i64) = conn
        .query_row("SELECT access_token, refresh_token, attivo FROM marketplace_config WHERE canale='EBAY'", [], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .optional()?
        .ok_or_else(|| ApiError::bad_request("eBay non collegato"))?;
    if attivo != 1 {
        return Err(ApiError::bad_request("Sincronizzazione eBay disattivata dalle impostazioni"));
    }
    // v1: riusa sempre l'access token corrente; se scaduto, getOrders risponderà 401 e
    // andrà rifatto un giro con refresh_token — il refresh esplicito preventivo (basato su
    // expires_in salvato) è un miglioramento successivo, non necessario per il primo giro.
    let access = access.filter(|s| !s.is_empty()).ok_or_else(|| ApiError::bad_request("eBay non collegato"))?;
    let _ = refresh;
    Ok(access)
}

// ── Sync ordini ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EbayOrdersResponse {
    orders: Vec<EbayOrder>,
    // v1: una sola pagina (limit=50) per giro di sync — un venditore con più di 50
    // ordini nuovi dall'ultima sincronizzazione ne perderebbe una parte finché non
    // si implementa la paginazione seguendo questo cursore. Da chiudere prima che
    // diventi un problema reale (venditori più attivi), non urgente per il primo
    // collegamento.
    #[serde(default)]
    #[allow(dead_code)]
    next: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EbayOrder {
    order_id: String,
    #[serde(default)]
    buyer: Option<EbayBuyer>,
    line_items: Vec<EbayLineItem>,
}

#[derive(Deserialize)]
struct EbayBuyer {
    username: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EbayLineItem {
    #[serde(default)]
    sku: Option<String>,
    title: String,
    quantity: f64,
    line_item_cost: Option<EbayMoney>,
}

#[derive(Deserialize)]
struct EbayMoney {
    value: String,
}

/// Riga di un ordine eBay non ancora abbinata a un prodotto locale.
struct RigaDaAbbinare {
    order_id: String,
    sku: String,
    titolo: String,
    quantita: f64,
    prezzo: f64,
    buyer: String,
}

async fn ebay_sync(State(state): State<AppState>, Json(_b): Json<Value>) -> ApiResult<Json<Value>> {
    let (access_token, ultima_sync) = {
        let conn = tenant_conn(&state)?;
        let conn = conn.lock().unwrap();
        let token = ebay_refresh_token_se_serve(&conn)?;
        let ultima: Option<String> = conn
            .query_row("SELECT ultima_sync FROM marketplace_config WHERE canale='EBAY'", [], |r| r.get(0))
            .optional()?
            .flatten();
        (token, ultima)
    };
    let da = ultima_sync.unwrap_or_else(|| oggi_meno_giorni(30));
    let filtro = format!("creationdate:[{da}T00:00:00.000Z..]");
    let url = format!(
        "https://api.ebay.com/sell/fulfillment/v1/order?filter={}&limit=50",
        urlencoding_semplice(&filtro)
    );
    let resp = client()
        .get(&url)
        .bearer_auth(&access_token)
        .send()
        .await
        .map_err(|e| ApiError::Status(axum::http::StatusCode::BAD_GATEWAY, format!("eBay non raggiungibile: {e}")))?;
    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(ApiError::Status(axum::http::StatusCode::BAD_GATEWAY, format!("eBay ha rifiutato la richiesta: {body}")));
    }
    let dati: EbayOrdersResponse = resp
        .json()
        .await
        .map_err(|e| ApiError::Status(axum::http::StatusCode::BAD_GATEWAY, format!("risposta eBay non valida: {e}")))?;

    let conn = tenant_conn(&state)?;
    let mut guard = conn.lock().unwrap();
    let tx = guard.transaction().map_err(ApiError::from)?;

    let mut importati = 0i64;
    let mut da_abbinare: Vec<RigaDaAbbinare> = Vec::new();

    for ordine in &dati.orders {
        let gia_importato: bool = tx
            .query_row(
                "SELECT 1 FROM vendite_banco WHERE canale='EBAY' AND riferimento_esterno=?1",
                params![ordine.order_id],
                |_| Ok(true),
            )
            .optional()
            .map_err(ApiError::from)?
            .unwrap_or(false);
        if gia_importato {
            continue;
        }
        let buyer = ordine.buyer.as_ref().and_then(|b| b.username.clone()).unwrap_or_else(|| "Acquirente eBay".into());

        let mut righe_mappate: Vec<Value> = Vec::new();
        let mut tutte_mappate = true;
        for li in &ordine.line_items {
            let sku_norm = li.sku.as_deref().unwrap_or("").trim().to_lowercase();
            let prezzo = li.line_item_cost.as_ref().and_then(|m| m.value.parse::<f64>().ok()).unwrap_or(0.0);
            if sku_norm.is_empty() {
                tutte_mappate = false;
                da_abbinare.push(RigaDaAbbinare {
                    order_id: ordine.order_id.clone(),
                    sku: String::new(),
                    titolo: li.title.clone(),
                    quantita: li.quantity,
                    prezzo,
                    buyer: buyer.clone(),
                });
                continue;
            }
            let prodotto_id: Option<i64> = tx
                .query_row(
                    "SELECT prodotto_id FROM marketplace_mapping WHERE canale='EBAY' AND sku_norm=?1",
                    params![sku_norm],
                    |r| r.get(0),
                )
                .optional()
                .map_err(ApiError::from)?;
            match prodotto_id {
                Some(pid) => {
                    let iva_default: f64 = tx
                        .query_row(
                    "SELECT COALESCE(\
                        (SELECT valore FROM aliquote_iva WHERE attiva=1 AND predefinito=1 LIMIT 1), \
                        (SELECT valore FROM aliquote_iva WHERE attiva=1 ORDER BY valore DESC LIMIT 1), \
                        22)",
                    [],
                    |r| r.get(0),
                )
                        .unwrap_or(22.0);
                    righe_mappate.push(json!({
                        "prodottoId": pid,
                        "descrizione": li.title,
                        "quantita": li.quantity,
                        "prezzo": prezzo,
                        "sconto": 0,
                        "iva": iva_default,
                        "unitaMisura": "",
                    }));
                }
                None => {
                    tutte_mappate = false;
                    da_abbinare.push(RigaDaAbbinare {
                        order_id: ordine.order_id.clone(),
                        sku: sku_norm,
                        titolo: li.title.clone(),
                        quantita: li.quantity,
                        prezzo,
                        buyer: buyer.clone(),
                    });
                }
            }
        }
        if tutte_mappate && !righe_mappate.is_empty() {
            let numero = get_next_numero(&tx, "vendite_banco", "vendite_banco", 0).map_err(ApiError::from)?;
            inserisci_vendita(&tx, &numero, Some(&oggi()), &buyer, "ALTRO", "Import ordine eBay", "EBAY", Some(&ordine.order_id), &righe_mappate)
                .map_err(ApiError::from)?;
            importati += 1;
        }
    }

    tx.execute(
        "UPDATE marketplace_config SET ultima_sync=?1 WHERE canale='EBAY'",
        params![oggi()],
    ).map_err(ApiError::from)?;
    tx.commit().map_err(ApiError::from)?;

    let da_abbinare_json: Vec<Value> = da_abbinare
        .iter()
        .map(|r| json!({
            "orderId": r.order_id, "sku": r.sku, "titolo": r.titolo,
            "quantita": r.quantita, "prezzo": num(r.prezzo), "acquirente": r.buyer,
        }))
        .collect();
    Ok(Json(json!({ "importati": importati, "daAbbinare": da_abbinare_json })))
}

async fn ebay_abbina(State(state): State<AppState>, Json(b): Json<Value>) -> ApiResult<Json<Value>> {
    // Corpo atteso: { abbinamenti: [{ orderId, sku, titolo, quantita, prezzo, acquirente, prodottoId }] }
    let abbinamenti = b.get("abbinamenti").and_then(Value::as_array).cloned().unwrap_or_default();
    let conn = tenant_conn(&state)?;
    let mut guard = conn.lock().unwrap();
    let tx = guard.transaction().map_err(ApiError::from)?;

    // Raggruppa per ordine: un ordine può avere più righe da abbinare insieme.
    let mut per_ordine: std::collections::BTreeMap<String, Vec<&Value>> = std::collections::BTreeMap::new();
    for a in &abbinamenti {
        let oid = a.get("orderId").and_then(Value::as_str).unwrap_or("").to_string();
        per_ordine.entry(oid).or_default().push(a);
    }

    let mut importati = 0i64;
    for (order_id, righe) in per_ordine {
        let gia_importato: bool = tx
            .query_row("SELECT 1 FROM vendite_banco WHERE canale='EBAY' AND riferimento_esterno=?1", params![order_id], |_| Ok(true))
            .optional()
            .map_err(ApiError::from)?
            .unwrap_or(false);
        if gia_importato {
            continue;
        }
        let mut righe_json = Vec::new();
        let mut buyer = "Acquirente eBay".to_string();
        for a in righe {
            let sku = a.get("sku").and_then(Value::as_str).unwrap_or("").trim().to_lowercase();
            let prodotto_id = a.get("prodottoId").and_then(Value::as_i64);
            let Some(prodotto_id) = prodotto_id else { continue };
            if !sku.is_empty() {
                tx.execute(
                    "INSERT INTO marketplace_mapping (canale, sku, prodotto_id, sku_norm) VALUES ('EBAY',?1,?2,?3) \
                     ON CONFLICT(canale, sku_norm) DO UPDATE SET prodotto_id=excluded.prodotto_id, sku=excluded.sku",
                    params![a.get("sku").and_then(Value::as_str).unwrap_or(""), prodotto_id, sku],
                ).map_err(ApiError::from)?;
            }
            if let Some(acq) = a.get("acquirente").and_then(Value::as_str) {
                buyer = acq.to_string();
            }
            let iva_default: f64 = tx
                .query_row(
                    "SELECT COALESCE(\
                        (SELECT valore FROM aliquote_iva WHERE attiva=1 AND predefinito=1 LIMIT 1), \
                        (SELECT valore FROM aliquote_iva WHERE attiva=1 ORDER BY valore DESC LIMIT 1), \
                        22)",
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(22.0);
            righe_json.push(json!({
                "prodottoId": prodotto_id,
                "descrizione": a.get("titolo").and_then(Value::as_str).unwrap_or(""),
                "quantita": a.get("quantita").and_then(Value::as_f64).unwrap_or(1.0),
                "prezzo": a.get("prezzo").and_then(Value::as_f64).unwrap_or(0.0),
                "sconto": 0,
                "iva": iva_default,
                "unitaMisura": "",
            }));
        }
        if !righe_json.is_empty() {
            let numero = get_next_numero(&tx, "vendite_banco", "vendite_banco", 0).map_err(ApiError::from)?;
            inserisci_vendita(&tx, &numero, Some(&oggi()), &buyer, "ALTRO", "Import ordine eBay", "EBAY", Some(&order_id), &righe_json)
                .map_err(ApiError::from)?;
            importati += 1;
        }
    }
    tx.commit().map_err(ApiError::from)?;
    Ok(Json(json!({ "importati": importati })))
}

// ── piccoli helper locali (evitano nuove dipendenze per compiti minuscoli) ────

fn oggi_meno_giorni(giorni: i64) -> String {
    // Approssimazione a calendario civile, sufficiente per un cursore "da quando
    // risincronizzare" (non serve precisione al secondo).
    use crate::web::days_of;
    let oggi_str = oggi();
    let Some(g) = days_of(&oggi_str) else { return oggi_str };
    let target = g - giorni;
    civil_from_days(target)
}

/// Converte un numero di giorni "civili" (stesso riferimento di `days_of`) in YYYY-MM-DD.
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

fn uuid_semplice() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{:x}", nanos)
}
