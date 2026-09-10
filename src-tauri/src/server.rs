//! Router HTTP locale (axum) che sostituisce Express: serve /api/* e la SPA Angular,
//! esattamente come faceva server.js. **Niente porta TCP**: la WebView di Tauri carica
//! lo scheme custom `ordeva://` e ogni richiesta viene instradata direttamente in questo
//! Router in-process (vedi `handle_request` + la registrazione del protocollo in main.rs).
//! Così non c'è alcun server in ascolto su una porta (niente conflitti di porta, niente
//! avviso firewall su Windows, niente "sito che gira in locale").

use std::borrow::Cow;
use std::path::PathBuf;

use axum::http::{header::CACHE_CONTROL, HeaderValue};
use axum::{routing::get, Json, Router};
use serde_json::{json, Value};
use tower::ServiceBuilder;
use tower::ServiceExt; // oneshot
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::set_header::SetResponseHeaderLayer;

use crate::db::AppState;
use crate::routes;

/// Scheme custom servito dalla WebView. La SPA carica `ordeva://localhost/` (su Windows
/// Tauri lo espone come `http://ordeva.localhost`). Tenere allineato a main.rs e alle
/// `remote.urls` in capabilities/.
pub const SCHEME: &str = "ordeva";

/// Stato condiviso (managed) che custodisce il Router già costruito, così la closure del
/// protocollo — registrata sul Builder prima di `setup()` — può recuperarlo a runtime.
#[derive(Clone)]
pub struct SharedRouter(pub Router);

/// Costruisce il router completo: /healthz, /api/*, e fallback statico per la SPA.
pub fn build_router(state: AppState) -> Router {
    // "no-store" su TUTTE le risposte /api/*: senza Cache-Control esplicito la
    // WebView (WKWebView su macOS, stesso problema già noto per la SPA statica
    // qui sotto) applica un caching euristico anche alle risposte JSON — un GET
    // ripetuto (es. polling di stato, o semplicemente tornare su una pagina)
    // può restituire una risposta vecchia invece di interrogare di nuovo il
    // backend. Osservato concretamente su google/config: un toggle o una
    // disconnessione sembravano "non salvarsi" perché il GET successivo
    // arrivava dalla cache della WebView, non dal DB aggiornato.
    let api = routes::api_router().with_state(state).layer(SetResponseHeaderLayer::overriding(
        CACHE_CONTROL,
        HeaderValue::from_static("no-store"),
    ));

    // SPA Angular buildata, con fallback su index.html per il routing client-side.
    // .fallback() (non not_found_service) preserva lo status 200, come faceva
    // res.sendFile(index.html) in Express per le rotte non-API.
    //
    // Cache-Control: no-cache su TUTTE le risorse della SPA. La WebView di macOS
    // (WKWebView) altrimenti applica il caching euristico (manca Cache-Control):
    // dopo un aggiornamento riusa la index.html/asset vecchi in cache, che
    // referenziano chunk non più esistenti → UI rotta (placeholder mancanti,
    // pagine che non si aprono) finché non si svuotano i dati. Con "no-cache" la
    // WebView rivalida sempre (304 se invariato, 200 col nuovo dopo l'update).
    let spa = spa_service(&spa_dir());

    Router::new()
        .route("/healthz", get(healthz))
        .nest("/api", api)
        .fallback_service(spa)
        // origin: true del backend Node → in offline è same-origin; restiamo permissivi.
        .layer(CorsLayer::very_permissive())
}

/// Instrada una richiesta del custom protocol nel Router axum, senza rete.
/// Converte la richiesta Tauri (`http::Request<Vec<u8>>`) in una richiesta axum, la passa
/// al Router via `oneshot`, e ritrasforma la risposta in `http::Response<Cow<[u8]>>`,
/// formato atteso dal responder del protocollo.
pub async fn handle_request(
    router: Router,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Cow<'static, [u8]>> {
    let (parts, body) = request.into_parts();
    let axum_req = axum::http::Request::from_parts(parts, axum::body::Body::from(body));

    let response = match router.oneshot(axum_req).await {
        Ok(resp) => resp,
        Err(e) => {
            tracing::error!("router oneshot: {e}");
            return tauri::http::Response::builder()
                .status(500)
                .body(Cow::Borrowed(b"errore interno".as_slice()))
                .expect("risposta 500 valida");
        }
    };

    let (parts, body) = response.into_parts();
    let bytes = match axum::body::to_bytes(body, usize::MAX).await {
        Ok(b) => b.to_vec(),
        Err(e) => {
            tracing::error!("lettura body risposta: {e}");
            Vec::new()
        }
    };
    tauri::http::Response::from_parts(parts, Cow::Owned(bytes))
}

/// GET /healthz — parità con server.js (liveness, niente DB).
/// Espone anche la versione dell'app (fonte unica: Cargo.toml) per il
/// controllo aggiornamenti lato frontend.
async fn healthz() -> Json<Value> {
    Json(json!({ "ok": true, "version": env!("CARGO_PKG_VERSION") }))
}

/// Servizio che serve la SPA da `dir`, con fallback su index.html.
/// Estratto da build_router perché il MIME dei file serviti qui è testabile
/// (e critico: vedi il test in fondo al file).
fn spa_service(dir: &std::path::Path) -> impl tower::Service<
    axum::http::Request<axum::body::Body>,
    Response = axum::http::Response<tower_http::services::fs::ServeFileSystemResponseBody>,
    Error = std::convert::Infallible,
    Future = impl Send,
> + Clone
       + Send
       + 'static {
    ServiceBuilder::new()
        .layer(SetResponseHeaderLayer::overriding(
            CACHE_CONTROL,
            HeaderValue::from_static("no-cache"),
        ))
        .service(ServeDir::new(dir).fallback(ServeFile::new(dir.join("index.html"))))
}

/// Cartella della SPA: override via ORDEVA_SPA_DIR, altrimenti la build Angular del repo.
fn spa_dir() -> PathBuf {
    if let Ok(p) = std::env::var("ORDEVA_SPA_DIR") {
        return PathBuf::from(p);
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("frontend")
        .join("dist")
        .join("frontend")
        .join("browser")
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use tower::ServiceExt;

    /// La lettura dei documenti carica il worker di pdf.js (.mjs) e il core di
    /// Tesseract (.wasm) dagli asset. Se il server li serve con un Content-Type
    /// sbagliato la WebView li rifiuta e l'utente vede solo "impossibile leggere
    /// il documento", senza altra spiegazione.
    #[tokio::test]
    async fn asset_serviti_con_il_mime_giusto() {
        let dir = std::env::temp_dir().join(format!("ordeva-mime-{}", std::process::id()));
        let assets = dir.join("assets");
        std::fs::create_dir_all(&assets).unwrap();
        std::fs::write(dir.join("index.html"), "<html></html>").unwrap();
        std::fs::write(assets.join("pdf.worker.min.mjs"), "export const x = 1;").unwrap();
        std::fs::write(assets.join("tesseract-core.wasm"), b"\0asm").unwrap();
        std::fs::write(assets.join("worker.min.js"), "var x = 1;").unwrap();

        let tipo_di = |percorso: &'static str| {
            let svc = spa_service(&dir);
            async move {
                let res = svc
                    .oneshot(Request::builder().uri(percorso).body(Body::empty()).unwrap())
                    .await
                    .unwrap();
                res.headers()
                    .get(axum::http::header::CONTENT_TYPE)
                    .map(|v| v.to_str().unwrap().to_string())
                    .unwrap_or_default()
            }
        };

        let mjs = tipo_di("/assets/pdf.worker.min.mjs").await;
        let wasm = tipo_di("/assets/tesseract-core.wasm").await;
        let js = tipo_di("/assets/worker.min.js").await;
        let _ = std::fs::remove_dir_all(&dir);

        assert!(
            mjs.contains("javascript"),
            "il worker di pdf.js (.mjs) è servito come `{mjs}`: la WebView rifiuta il modulo e la lettura documenti non parte"
        );
        assert!(wasm.contains("wasm"), "il core di Tesseract (.wasm) è servito come `{wasm}`");
        assert!(js.contains("javascript"), "il worker di Tesseract (.js) è servito come `{js}`");
    }
}
