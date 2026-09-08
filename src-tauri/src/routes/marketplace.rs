//! /api/marketplace — import ordini da canali di vendita esterni: eBay, Shopify
//! (poi Amazon).
//!
//! Ambito volutamente ridotto: SOLA LETTURA degli ordini già conclusi, per
//! scaricare il magazzino e alimentare le statistiche — niente gestione
//! annunci, niente invio prezzi/giacenze verso il canale. Ogni ordine
//! importato diventa una riga in `vendite_banco`/`vendite_banco_righe` (stessa
//! tabella della vendita al banco, `canale` a distinguerle), riusando
//! `vendite_banco::inserisci_vendita()` per lo scarico scorte.
//!
//! Due modelli di credenziali diversi, a seconda di cosa richiede il canale:
//! - **eBay** (account di terzi: Ordeva non possiede il negozio) serve un'app
//!   OAuth registrata una volta sola sul developer portal eBay — client
//!   id/secret letti da variabili d'ambiente al momento della build
//!   (`EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_RUNAME`), mai il token
//!   dell'utente finale.
//! - **Shopify** (il negozio è del cliente Ordeva) non serve nessuna app
//!   condivisa: il negoziante crea da solo un Access Token nel proprio pannello
//!   admin e lo incolla in Ordeva — niente OAuth, niente segreto di build.
//!
//! In entrambi i casi il token vive per-utente in `marketplace_config` (mai nel
//! binario) ed è sempre mascherato in uscita, mai il valore vero.

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

/// True se la build è compilata per l'ambiente Sandbox eBay (credenziali di test,
/// ordini finti) invece che Produzione. Deciso a tempo di compilazione come le
/// credenziali stesse — mai a runtime, coerente con `ebay_credenziali()`.
fn ebay_sandbox() -> bool {
    option_env!("EBAY_SANDBOX").map(|v| v.trim() == "1").unwrap_or(false)
}

/// Host per le chiamate di autorizzazione (redirect verso il consenso utente).
fn ebay_auth_host() -> &'static str {
    if ebay_sandbox() { "https://auth.sandbox.ebay.com" } else { "https://auth.ebay.com" }
}

/// Host per le chiamate API (token exchange, ordini).
fn ebay_api_host() -> &'static str {
    if ebay_sandbox() { "https://api.sandbox.ebay.com" } else { "https://api.ebay.com" }
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/configs", get(list_configs))
        .route("/configs/:canale/disconnetti", axum::routing::post(disconnetti))
        .route("/configs/:canale/toggle", axum::routing::post(toggle_attivo))
        .route("/ebay/auth-url", get(ebay_auth_url))
        .route("/ebay/exchange-code", axum::routing::post(ebay_exchange_code))
        .route("/ebay/sync", axum::routing::post(ebay_sync))
        .route("/shopify/connetti", axum::routing::post(shopify_connetti))
        .route("/shopify/sync", axum::routing::post(shopify_sync))
        .route("/abbina", axum::routing::post(marketplace_abbina))
}

fn client() -> reqwest::Client {
    reqwest::Client::builder().timeout(Duration::from_secs(20)).build().unwrap_or_default()
}

fn ebay_credenziali() -> Result<(String, String, String), ApiError> {
    // Lette a tempo di compilazione, non a runtime — vedi la stessa nota in
    // google_sync.rs::google_credenziali().
    let client_id = option_env!("EBAY_CLIENT_ID").unwrap_or_default().trim().to_string();
    let client_secret = option_env!("EBAY_CLIENT_SECRET").unwrap_or_default().trim().to_string();
    let runame = option_env!("EBAY_RUNAME").unwrap_or_default().trim().to_string();
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
        "{}/oauth2/authorize?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}",
        ebay_auth_host(),
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
        .post(format!("{}/identity/v1/oauth2/token", ebay_api_host()))
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

// ── Collegamento Shopify ─────────────────────────────────────────────────────
//
// A differenza di eBay/Google, Shopify non richiede un'app OAuth condivisa e
// registrata da Ordeva: il negoziante crea da solo, nel proprio pannello admin
// ("Impostazioni → App e canali di vendita → Sviluppa app"), una "Custom App"
// con un Access Token — lo incolla direttamente qui, niente browser/redirect,
// niente segreto di build. Token e dominio restano per-utente in
// `marketplace_config`, mai nel binario.

const SHOPIFY_API_VERSION: &str = "2024-01";

#[derive(Deserialize)]
struct ShopifyConnettiReq {
    #[serde(rename = "shopDomain")]
    shop_domain: String,
    #[serde(rename = "accessToken")]
    access_token: String,
}

/// Normalizza "nome-negozio" o "nome-negozio.myshopify.com" (con o senza
/// protocollo/slash finale) nella forma canonica "nome-negozio.myshopify.com".
fn normalizza_shop_domain(raw: &str) -> String {
    let s = raw.trim().trim_start_matches("https://").trim_start_matches("http://").trim_end_matches('/');
    if s.ends_with(".myshopify.com") {
        s.to_string()
    } else {
        format!("{s}.myshopify.com")
    }
}

async fn shopify_connetti(State(state): State<AppState>, Json(req): Json<ShopifyConnettiReq>) -> ApiResult<Json<Value>> {
    let shop = normalizza_shop_domain(&req.shop_domain);
    let token = req.access_token.trim().to_string();
    if shop == ".myshopify.com" || token.is_empty() {
        return Err(ApiError::bad_request("Dominio negozio e access token sono obbligatori"));
    }
    // Verifica subito le credenziali con una chiamata leggera, invece di scoprire
    // un token sbagliato solo al primo tentativo di sincronizzazione.
    let resp = client()
        .get(format!("https://{shop}/admin/api/{SHOPIFY_API_VERSION}/shop.json"))
        .header("X-Shopify-Access-Token", &token)
        .send()
        .await
        .map_err(|e| ApiError::Status(axum::http::StatusCode::BAD_GATEWAY, format!("Shopify non raggiungibile: {e}")))?;
    if !resp.status().is_success() {
        return Err(ApiError::Status(axum::http::StatusCode::BAD_GATEWAY, "Dominio o access token Shopify non validi".into()));
    }

    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    conn.execute(
        "INSERT INTO marketplace_config (canale, access_token, account_label, attivo) VALUES ('SHOPIFY',?1,?2,1) \
         ON CONFLICT(canale) DO UPDATE SET access_token=excluded.access_token, account_label=excluded.account_label, attivo=1",
        params![token, shop],
    )?;
    Ok(Json(json!({ "success": true })))
}

fn shopify_credenziali(conn: &Connection) -> ApiResult<(String, String)> {
    let (access, shop, attivo): (Option<String>, Option<String>, i64) = conn
        .query_row("SELECT access_token, account_label, attivo FROM marketplace_config WHERE canale='SHOPIFY'", [], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .optional()?
        .ok_or_else(|| ApiError::bad_request("Shopify non collegato"))?;
    if attivo != 1 {
        return Err(ApiError::bad_request("Sincronizzazione Shopify disattivata dalle impostazioni"));
    }
    let access = access.filter(|s| !s.is_empty()).ok_or_else(|| ApiError::bad_request("Shopify non collegato"))?;
    let shop = shop.filter(|s| !s.is_empty()).ok_or_else(|| ApiError::bad_request("Shopify non collegato"))?;
    Ok((access, shop))
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
        "{}/sell/fulfillment/v1/order?filter={}&limit=50",
        ebay_api_host(),
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

#[derive(Deserialize)]
struct ShopifyOrdersResponse {
    orders: Vec<ShopifyOrder>,
}

#[derive(Deserialize)]
struct ShopifyOrder {
    id: i64,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    customer: Option<ShopifyCustomer>,
    line_items: Vec<ShopifyLineItem>,
}

#[derive(Deserialize)]
struct ShopifyCustomer {
    #[serde(default)]
    first_name: Option<String>,
    #[serde(default)]
    last_name: Option<String>,
}

#[derive(Deserialize)]
struct ShopifyLineItem {
    #[serde(default)]
    sku: Option<String>,
    title: String,
    quantity: f64,
    #[serde(default)]
    price: Option<String>,
}

/// Import ordini Shopify — stesso algoritmo di `ebay_sync` (righe già concluse,
/// SKU noto → vendita diretta, SKU ignoto → raccolto per il dialog di
/// abbinamento), contro l'Admin API REST di Shopify invece che l'API eBay.
/// v1: una sola pagina (limit=250, il massimo Shopify), stessa nota/limite già
/// presente per eBay sulla paginazione.
async fn shopify_sync(State(state): State<AppState>, Json(_b): Json<Value>) -> ApiResult<Json<Value>> {
    let (access_token, shop, ultima_sync) = {
        let conn = tenant_conn(&state)?;
        let conn = conn.lock().unwrap();
        let (access_token, shop) = shopify_credenziali(&conn)?;
        let ultima: Option<String> = conn
            .query_row("SELECT ultima_sync FROM marketplace_config WHERE canale='SHOPIFY'", [], |r| r.get(0))
            .optional()?
            .flatten();
        (access_token, shop, ultima)
    };
    let da = ultima_sync.unwrap_or_else(|| oggi_meno_giorni(30));
    let url = format!(
        "https://{shop}/admin/api/{SHOPIFY_API_VERSION}/orders.json?status=any&financial_status=paid&created_at_min={}T00:00:00Z&limit=250",
        urlencoding_semplice(&da)
    );
    let resp = client()
        .get(&url)
        .header("X-Shopify-Access-Token", &access_token)
        .send()
        .await
        .map_err(|e| ApiError::Status(axum::http::StatusCode::BAD_GATEWAY, format!("Shopify non raggiungibile: {e}")))?;
    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(ApiError::Status(axum::http::StatusCode::BAD_GATEWAY, format!("Shopify ha rifiutato la richiesta: {body}")));
    }
    let dati: ShopifyOrdersResponse = resp
        .json()
        .await
        .map_err(|e| ApiError::Status(axum::http::StatusCode::BAD_GATEWAY, format!("risposta Shopify non valida: {e}")))?;

    let conn = tenant_conn(&state)?;
    let mut guard = conn.lock().unwrap();
    let tx = guard.transaction().map_err(ApiError::from)?;

    let mut importati = 0i64;
    let mut da_abbinare: Vec<RigaDaAbbinare> = Vec::new();

    for ordine in &dati.orders {
        let order_id = ordine.id.to_string();
        let gia_importato: bool = tx
            .query_row(
                "SELECT 1 FROM vendite_banco WHERE canale='SHOPIFY' AND riferimento_esterno=?1",
                params![order_id],
                |_| Ok(true),
            )
            .optional()
            .map_err(ApiError::from)?
            .unwrap_or(false);
        if gia_importato {
            continue;
        }
        let buyer = ordine
            .customer
            .as_ref()
            .map(|c| format!("{} {}", c.first_name.as_deref().unwrap_or(""), c.last_name.as_deref().unwrap_or("")).trim().to_string())
            .filter(|s| !s.is_empty())
            .or_else(|| ordine.email.clone())
            .unwrap_or_else(|| "Acquirente Shopify".into());

        let mut righe_mappate: Vec<Value> = Vec::new();
        let mut tutte_mappate = true;
        for li in &ordine.line_items {
            let sku_norm = li.sku.as_deref().unwrap_or("").trim().to_lowercase();
            let prezzo = li.price.as_deref().and_then(|p| p.parse::<f64>().ok()).unwrap_or(0.0);
            if sku_norm.is_empty() {
                tutte_mappate = false;
                da_abbinare.push(RigaDaAbbinare {
                    order_id: order_id.clone(),
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
                    "SELECT prodotto_id FROM marketplace_mapping WHERE canale='SHOPIFY' AND sku_norm=?1",
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
                        order_id: order_id.clone(),
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
            inserisci_vendita(&tx, &numero, Some(&oggi()), &buyer, "ALTRO", "Import ordine Shopify", "SHOPIFY", Some(&order_id), &righe_mappate)
                .map_err(ApiError::from)?;
            importati += 1;
        }
    }

    tx.execute(
        "UPDATE marketplace_config SET ultima_sync=?1 WHERE canale='SHOPIFY'",
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

/// Nome canale valido per `marketplace_config`/`marketplace_mapping`/`vendite_banco.canale`
/// (stesso elenco dei tre CHECK in tenant.sql). Normalizza in maiuscolo e rifiuta il resto,
/// per non poter mai scrivere un valore che il DB rifiuterebbe comunque.
fn canale_valido(raw: &str) -> ApiResult<String> {
    let c = raw.trim().to_uppercase();
    if matches!(c.as_str(), "EBAY" | "AMAZON" | "SHOPIFY") {
        Ok(c)
    } else {
        Err(ApiError::bad_request(format!("Canale sconosciuto: {raw}")))
    }
}

/// Etichetta leggibile del canale per note/acquirente di default ("Import ordine {..}").
fn canale_label(canale: &str) -> &'static str {
    match canale {
        "EBAY" => "eBay",
        "AMAZON" => "Amazon",
        "SHOPIFY" => "Shopify",
        _ => "marketplace",
    }
}

/// Conferma gli abbinamenti SKU→prodotto per QUALUNQUE canale (eBay, Shopify, ...) e
/// importa le vendite corrispondenti. Unica funzione condivisa: la sola parte
/// specifica per canale è già stata risolta a monte da chi ha popolato `daAbbinare`
/// (`ebay_sync`/`shopify_sync`), qui resta solo scrittura DB, channel-agnostica.
async fn marketplace_abbina(State(state): State<AppState>, Json(b): Json<Value>) -> ApiResult<Json<Value>> {
    // Corpo atteso: { canale, abbinamenti: [{ orderId, sku, titolo, quantita, prezzo, acquirente, prodottoId }] }
    let canale = canale_valido(b.get("canale").and_then(Value::as_str).unwrap_or(""))?;
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
            .query_row("SELECT 1 FROM vendite_banco WHERE canale=?1 AND riferimento_esterno=?2", params![canale, order_id], |_| Ok(true))
            .optional()
            .map_err(ApiError::from)?
            .unwrap_or(false);
        if gia_importato {
            continue;
        }
        let mut righe_json = Vec::new();
        let mut buyer = format!("Acquirente {}", canale_label(&canale));
        for a in righe {
            let sku = a.get("sku").and_then(Value::as_str).unwrap_or("").trim().to_lowercase();
            let prodotto_id = a.get("prodottoId").and_then(Value::as_i64);
            let Some(prodotto_id) = prodotto_id else { continue };
            if !sku.is_empty() {
                tx.execute(
                    "INSERT INTO marketplace_mapping (canale, sku, prodotto_id, sku_norm) VALUES (?1,?2,?3,?4) \
                     ON CONFLICT(canale, sku_norm) DO UPDATE SET prodotto_id=excluded.prodotto_id, sku=excluded.sku",
                    params![canale, a.get("sku").and_then(Value::as_str).unwrap_or(""), prodotto_id, sku],
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
            let nota = format!("Import ordine {}", canale_label(&canale));
            inserisci_vendita(&tx, &numero, Some(&oggi()), &buyer, "ALTRO", &nota, &canale, Some(&order_id), &righe_json)
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
