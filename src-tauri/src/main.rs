// Ordeva — edizione offline desktop (Tauri + backend Rust).
// Niente console su Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
// Alcuni `json!()` (es. azienda::to_dto) hanno molti campi e superano il limite
// di espansione macro di default con l'aggiunta di nuovi campi.
#![recursion_limit = "256"]

mod archivi;
mod atrest;
mod audit;
mod auth;
mod backup;
mod config;
mod db;
mod error;
mod fiscale;
mod gemello;
mod jobs;
mod lock;
mod match_prodotti;
mod migrate;
mod moduli;
mod numerazione;
mod ocr_parse;
mod routes;
mod server;
mod stock;
mod web;
mod xml;

// Menu nativo solo su macOS (barra globale in cima allo schermo): su Windows e
// Linux non lo creiamo, quindi questi import servono solo lì.
#[cfg(target_os = "macos")]
use tauri::menu::{MenuBuilder, SubmenuBuilder};
// Emitter (per .emit()) serve ora su tutte le piattaforme: il ritorno OAuth via
// deep-link (vedi setup(), on_open_url) inoltra l'evento "oauth-callback" alla
// webview indipendentemente dal sistema operativo.
use tauri::Emitter;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_window_state::{StateFlags, WindowExt};

use db::AppState;

fn main() {
    tracing_subscriber::fmt().init();

    // In diagnostica (ORDEVA_SELFTEST) l'istanza singola va tolta di mezzo: serve
    // proprio poter aprire una seconda istanza accanto a quella dell'utente, che
    // resta intatta — con DATA_DIR su una cartella separata non si toccano dati.
    let diagnostica = std::env::var_os("ORDEVA_SELFTEST").is_some();

    let mut builder = tauri::Builder::default();
    if !diagnostica {
        // Istanza singola (va registrato per primo): se l'app è già aperta, il secondo
        // avvio non parte e riporta in primo piano la finestra esistente.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }));
    }
    builder
        // Deep-link OS-level per il ritorno OAuth (es. eBay): scheme "ordevaauth://",
        // volutamente diverso da "ordeva://" (già usato per servire l'app) per non
        // confondere i due meccanismi. Su Windows/Linux single-instance intercetta il
        // rilancio con l'URL negli argv; su macOS arriva come evento nativo. In
        // entrambi i casi il plugin lo consegna a `on_open_url` (registrato in setup()).
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        // Autostart: avvio col login del sistema. Il toggle in Impostazioni abilita/disabilita.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        // Protocollo custom `ordeva://`: invece di un server in ascolto su una porta TCP,
        // ogni richiesta della WebView (SPA e /api/*) viene instradata in-process nel
        // Router axum. Niente porta aperta, niente firewall, niente conflitti di porta.
        // Il Router è custodito come managed state da setup() (SharedRouter); qui lo
        // recuperiamo via l'app handle del contesto.
        .register_asynchronous_uri_scheme_protocol(server::SCHEME, |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                // Se il Router è pronto (app sbloccata) instradiamo le richieste in axum;
                // altrimenti il DB è cifrato e in attesa di sblocco: serviamo la pagina di
                // sblocco e gestiamo il POST /__unlock (decifra e avvia l'app).
                let resp = if let Some(router) = app.try_state::<server::SharedRouter>() {
                    server::handle_request(router.0.clone(), request).await
                } else {
                    handle_locked(&app, request).await
                };
                responder.respond(resp);
            });
        })
        .setup(|app| {
            let handle = app.handle().clone();
            // Cartella dati VISIBILE e spostabile (default: Documenti/Ordeva), con
            // priorità env DATA_DIR > config ordeva.json > default. Vedi config.rs.
            let data_dir = config::resolve_data_dir(&handle)
                .map_err(|e| format!("risoluzione cartella dati: {e:#}"))?;
            // Migrazione one-time dalla vecchia cartella nascosta (app_data_dir/data),
            // così aggiornando non si "perdono" i dati passando alla cartella visibile.
            if let Err(e) = config::migrate_legacy_if_needed(&handle, &data_dir) {
                tracing::warn!("migrazione dati legacy fallita: {e:#}");
            }
            // Migrazione one-time dal vecchio formato a due file (auth.db + tenants/) al
            // file unico ordeva.db. Se fallisce è meglio fermarsi (i vecchi file restano).
            db::flatten_to_single_file(&data_dir)
                .map_err(|e| format!("migrazione a file unico: {e:#}"))?;
            config::write_readme(&data_dir);
            let config_path = config::config_path(&handle)
                .map_err(|e| format!("percorso config: {e:#}"))?;
            tracing::info!("DATA_DIR = {:?}", data_dir);

            // SPA: nell'app impacchettata i file Angular sono una risorsa del bundle
            // (indipendente dal DB, quindi qui prima di tutto).
            if std::env::var_os("ORDEVA_SPA_DIR").is_none() {
                if let Ok(res) = app.path().resource_dir() {
                    for cand in ["spa", "spa/browser", "browser", "."] {
                        let dir = res.join(cand);
                        if dir.join("index.html").is_file() {
                            std::env::set_var("ORDEVA_SPA_DIR", &dir);
                            tracing::info!("ORDEVA_SPA_DIR = {:?}", dir);
                            break;
                        }
                    }
                }
            }

            // Finestra principale (sempre creata). Se il DB è cifrato e bloccato il
            // protocollo serve la pagina di sblocco; altrimenti la SPA. Vedi sotto.
            let url = format!("{}://localhost/?v={}", server::SCHEME, env!("CARGO_PKG_VERSION"));
            let window = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(url.parse().expect("url valido")),
            )
            .title("Ordeva")
            .inner_size(1440.0, 900.0)
            .min_inner_size(360.0, 600.0)
            .maximized(true)
            // Sfondo finestra = colore chiaro dell'app (#f8fafc): evita il
            // "lampo" bianco del WebView prima che la SPA dipinga, così l'avvio
            // sembra quello di un programma nativo e non di una pagina che carica.
            .background_color(tauri::window::Color(0xf8, 0xfa, 0xfc, 0xff))
            .build()?;

            // Eventi finestra:
            // - Focused(false): checkpoint del WAL (se il DB è su Dropbox, riduce la
            //   finestra in cui un `.db`+`-wal` disallineato verrebbe sincronizzato).
            // - CloseRequested: chiede conferma e, se confermato, esce davvero.
            //   La conferma è gestita QUI (Rust) e non più in JS: su Windows la
            //   versione JS (onCloseRequested) non bloccava in tempo, così la
            //   finestra si chiudeva prima della conferma e "Annulla" non la
            //   riapriva. prevent_close() blocca sempre; poi: "Chiudi" → uscita
            //   pulita (checkpoint + rilascio lock nell'handler di run), "Annulla"
            //   → la finestra resta aperta.
            // Eventi finestra. Lo stato si recupera a runtime (in fase di sblocco non
            // esiste ancora): Focused(false) → checkpoint WAL; CloseRequested → conferma
            // e uscita (se l'app è avviata), altrimenti lascia chiudere la schermata di
            // sblocco.
            let ev_win = window.clone();
            window.on_window_event(move |event| match event {
                tauri::WindowEvent::Focused(false) => {
                    if let Some(state) = ev_win.app_handle().try_state::<AppState>() {
                        state.flush();
                    }
                }
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    let app = ev_win.app_handle().clone();
                    if app.try_state::<AppState>().is_none() {
                        return; // schermata di sblocco: chiudi senza confermare
                    }
                    api.prevent_close();
                    ev_win.dialog()
                        .message("Vuoi chiudere Ordeva?")
                        .title("Conferma chiusura")
                        .kind(tauri_plugin_dialog::MessageDialogKind::Warning)
                        .buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancelCustom(
                            "Chiudi".to_string(),
                            "Annulla".to_string(),
                        ))
                        .show(move |chiudi| {
                            if chiudi {
                                app.exit(0);
                            }
                        });
                }
                _ => {}
            });

            // Ripristina dimensione/posizione/stato salvati dalla sessione precedente.
            let _ = window.restore_state(StateFlags::all());

            // Avvio: se il DB è cifrato e bloccato, attendiamo lo sblocco (il protocollo
            // serve la pagina di sblocco e gestisce /__unlock → bring_up). Altrimenti
            // portiamo su l'app subito.
            // Multi-archivio: migra l'eventuale DB singolo nel primo archivio, poi decidi.
            archivi::migra_da_singolo(&data_dir)
                .map_err(|e| format!("migrazione archivi: {e:#}"))?;
            // All'avvio si sceglie SEMPRE l'archivio con cui lavorare (e si inserisce la
            // password se quell'archivio è cifrato): mostriamo il selettore. Il protocollo
            // serve la pagina del selettore finché non viene aperto un archivio, poi monta
            // il Router e l'app parte (vedi handle_locked → bring_up).
            // In diagnostica si salta il selettore: l'autotest dev'essere
            // non interattivo, altrimenti non si può eseguire da uno script.
            if std::env::var_os("ORDEVA_SELFTEST").is_some() {
                let archivio = archivi::list(&data_dir).into_iter().next();
                if let Some(a) = archivio {
                    let _ = archivi::set_corrente(&data_dir, &a.slug);
                    let adir = archivi::archivio_dir(&data_dir, &a.slug);
                    tracing::info!("diagnostica: apro l'archivio {} senza selettore", a.slug);
                    bring_up(&handle, adir, config_path, None)
                        .map_err(|e| format!("avvio diagnostica: {e:#}"))?;
                    return Ok(());
                }
                tracing::error!("diagnostica: nessun archivio da aprire");
            }

            tracing::info!("selettore archivi all'avvio");
            app.manage(LockedCtx { root: data_dir, config_path });

            // Su Windows/Linux lo scheme va registrato a runtime (macOS lo dichiara nel
            // bundle via tauri.conf.json ed è già attivo). Best-effort: se fallisce (es.
            // già registrato) non blocca l'avvio.
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Err(e) = app.deep_link().register("ordevaauth") {
                    tracing::warn!("registrazione scheme ordevaauth:// non riuscita: {e:#}");
                }
            }
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let emit_handle = handle.clone();
                app.deep_link().on_open_url(move |event| {
                    // Inoltrato al frontend così com'è: la pagina di Impostazioni che ha
                    // avviato il collegamento eBay resta responsabile di estrarre `code`
                    // dall'URL e chiamare POST /api/marketplace/ebay/exchange-code — tutta
                    // la logica applicativa resta nel Router axum esistente, qui si fa solo
                    // da ponte tra l'evento OS e la webview.
                    let urls: Vec<String> = event.urls().iter().map(|u| u.to_string()).collect();
                    let _ = emit_handle.emit("oauth-callback", urls);
                });
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("errore nell'avvio di Ordeva")
        .run(|app_handle, event| {
            // All'uscita reale (anche via app.exit dalla tray/pulsante): checkpoint finale
            // (un solo .db pulito da sincronizzare) e rilascio del lock di sessione, così
            // l'altro PC può aprire senza avvisi.
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                if let Some(state) = app_handle.try_state::<AppState>() {
                    state.flush();
                    state.release_lock();
                    // NB: il DB di lavoro NON viene più cifrato alla chiusura. La password
                    // dell'archivio è un blocco d'accesso (verifica all'apertura) e cifra i
                    // BACKUP; cifrare+cancellare il file di lavoro veniva scambiato dagli
                    // antivirus per ransomware. Il file resta in chiaro nella sua cartella.
                }
            }
        });
}

/// Stato gestito quando nessun archivio è ancora aperto: il selettore servito dal
/// protocollo elenca gli archivi (sotto `root/archivi`), ne apre uno (sbloccandolo con la
/// password se cifrato) o ne crea uno nuovo, e poi avvia l'app.
struct LockedCtx {
    /// Radice dati (contiene `archivi/`).
    root: std::path::PathBuf,
    config_path: std::path::PathBuf,
}

/// Avvia l'app vera e propria: apre il DB, avvia thread/scheduler, costruisce e registra
/// il Router, la tray e il menu. Chiamata sia all'avvio normale sia dopo lo sblocco.
fn bring_up(
    app: &tauri::AppHandle,
    data_dir: std::path::PathBuf,
    config_path: std::path::PathBuf,
    gate_pw: Option<String>,
) -> anyhow::Result<()> {
    let state = AppState::init(data_dir, config_path)?;
    if let Some(pw) = gate_pw {
        // Archivio protetto: la password cifra i BACKUP (il DB di lavoro resta in chiaro).
        *state.atrest_password.lock().unwrap() = Some(pw.clone());
        if let Ok(salt) = backup::ensure_salt(&state) {
            backup::set_key_from_password(&state, &pw, &salt);
        }
    }
    state.spawn_heartbeat();

    let bk_state = state.clone();
    std::thread::spawn(move || backup::run_if_due(&bk_state));
    jobs::spawn_scheduler(state.clone());

    let router = server::build_router(state.clone());
    app.manage(server::SharedRouter(router));
    app.manage(state.clone());

    if let Err(e) = setup_tray(app, state.clone()) {
        tracing::warn!("tray non disponibile: {e}");
    }
    #[cfg(target_os = "macos")]
    if let Err(e) = setup_menu(app) {
        tracing::warn!("menu nativo non disponibile: {e}");
    }
    Ok(())
}

/// Gestisce le richieste finché nessun archivio è aperto. Endpoint (POST):
/// - `__archivi`: elenco archivi (con flag cifrato);
/// - `__apri` {slug,password}: apre (sblocca se cifrato) e avvia l'app;
/// - `__crea` {nome,password}: crea un nuovo archivio e avvia l'app.
/// Ogni altra richiesta riceve la pagina del selettore.
async fn handle_locked(
    app: &tauri::AppHandle,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<std::borrow::Cow<'static, [u8]>> {
    use std::borrow::Cow;
    let path = request.uri().path().to_string();
    let is_post = request.method() == tauri::http::Method::POST;
    let json = |v: serde_json::Value| {
        tauri::http::Response::builder()
            .status(200)
            .header("Content-Type", "application/json")
            .body(Cow::Owned(serde_json::to_vec(&v).unwrap_or_default()))
            .expect("risposta json valida")
    };
    let body_json = |req: &tauri::http::Request<Vec<u8>>| -> serde_json::Value {
        serde_json::from_slice(req.body()).unwrap_or(serde_json::Value::Null)
    };

    if is_post && path.contains("__archivi") {
        let ctx = app.state::<LockedCtx>();
        return json(serde_json::json!({ "archivi": archivi::list(&ctx.root) }));
    }

    if is_post && path.contains("__apri") {
        let b = body_json(&request);
        let slug = b.get("slug").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let password = b.get("password").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let ctx = app.state::<LockedCtx>();
        let (root, config_path) = (ctx.root.clone(), ctx.config_path.clone());
        let adir = archivi::archivio_dir(&root, &slug);
        // (ok, "password_errata" | messaggio d'errore reale): distinguiamo una password
        // sbagliata (l'utente deve solo riprovare) da un vero fallimento di avvio (bug/
        // I-O/antivirus), che va mostrato per intero invece dello sviante "password errata"
        // — specie quando l'archivio non è nemmeno protetto (vedi ultimo ramo).
        let esito: Result<(), String> = if atrest::is_locked(&adir) {
            // Vecchio modello (file .enc): decifra una volta con la password, poi MIGRA al
            // nuovo modello "blocco d'accesso" (salva l'hash, rimuove il .enc) così da non
            // ri-cifrare più il file di lavoro alla chiusura.
            match atrest::unlock(&adir, &password) {
                Ok(()) => {
                    let _ = archivi::set_pwd(&adir, &password);
                    atrest::remove_enc(&adir);
                    let _ = archivi::risincronizza_cifrati(&root);
                    let _ = archivi::set_corrente(&root, &slug);
                    bring_up(app, adir, config_path, Some(password)).map_err(|e| format!("{e:#}"))
                }
                Err(_) => Err("password_errata".to_string()),
            }
        } else if archivi::has_pwd(&adir) {
            // Protetto (nuovo modello): verifica la password (blocco d'accesso).
            if archivi::verify_pwd(&adir, &password) {
                let _ = archivi::set_corrente(&root, &slug);
                bring_up(app, adir, config_path, Some(password)).map_err(|e| format!("{e:#}"))
            } else {
                Err("password_errata".to_string())
            }
        } else {
            // Non protetto: apri direttamente (niente password in gioco: un fallimento qui
            // non può mai essere "password errata").
            let _ = archivi::set_corrente(&root, &slug);
            bring_up(app, adir, config_path, None).map_err(|e| format!("{e:#}"))
        };
        if let Err(e) = &esito {
            if e != "password_errata" {
                tracing::error!("apertura archivio '{slug}' non riuscita: {e}");
            }
        }
        return json(serde_json::json!({ "ok": esito.is_ok(), "errore": esito.err() }));
    }

    if is_post && path.contains("__crea") {
        let b = body_json(&request);
        let nome = b.get("nome").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
        let password = b.get("password").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let ctx = app.state::<LockedCtx>();
        let (root, config_path) = (ctx.root.clone(), ctx.config_path.clone());
        if nome.is_empty() {
            return json(serde_json::json!({ "ok": false }));
        }
        let esito: Result<(), String> = match archivi::crea(&root, &nome) {
            Ok(a) => {
                let _ = archivi::set_corrente(&root, &a.slug);
                let adir = archivi::archivio_dir(&root, &a.slug);
                let pw = if password.is_empty() {
                    None
                } else {
                    // Protegge il nuovo archivio: salva l'hash (così agli avvii successivi
                    // chiede la password) e aggiorna il flag nell'indice.
                    let _ = archivi::set_pwd(&adir, &password);
                    let _ = archivi::risincronizza_cifrati(&root);
                    Some(password)
                };
                bring_up(app, adir, config_path, pw).map_err(|e| format!("{e:#}"))
            }
            Err(e) => Err(format!("{e:#}")),
        };
        if let Err(e) = &esito {
            tracing::error!("creazione archivio '{nome}' non riuscita: {e}");
        }
        return json(serde_json::json!({ "ok": esito.is_ok(), "errore": esito.err() }));
    }

    tauri::http::Response::builder()
        .status(200)
        .header("Content-Type", "text/html; charset=utf-8")
        .header("Cache-Control", "no-cache")
        .body(Cow::Borrowed(PICKER_HTML.as_bytes()))
        .expect("pagina selettore valida")
}

/// Pagina del selettore archivi (standalone, niente Angular): elenca gli archivi, ne apre
/// uno (chiedendo la password se cifrato) o ne crea uno nuovo; al successo ricarica.
const PICKER_HTML: &str = r#"<!doctype html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ordeva — Archivi</title>
<style>
 :root{--brand:#11769b;--brand2:#15a4a2;--ink:#0e2a38;--muted:#64748b;--line:#e6edf2}
 *{box-sizing:border-box} html,body{height:100%}
 body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:var(--ink);
   background:
     radial-gradient(1100px 560px at -5% -10%, #e6f3f5 0%, transparent 55%),
     radial-gradient(900px 560px at 105% 110%, #e6f1f0 0%, transparent 55%),
     linear-gradient(160deg,#f5f9fb,#eef4f6);
   display:flex;align-items:center;justify-content:center;padding:24px}
 .card{position:relative;background:#fff;border:1px solid var(--line);border-radius:22px;
   padding:30px 30px 26px;width:460px;max-width:100%;
   box-shadow:0 24px 60px -18px rgba(5,49,73,.32),0 3px 12px rgba(5,49,73,.05)}
 .brand{display:flex;align-items:center;gap:12px;margin-bottom:20px}
 .logo{width:46px;height:46px;border-radius:14px;display:grid;place-items:center;flex:none;color:#fff;
   font-weight:800;font-size:22px;background:linear-gradient(135deg,var(--brand),var(--brand2));
   box-shadow:0 8px 18px -6px rgba(17,118,155,.6)}
 .brand .wm{font-weight:800;font-size:17px;letter-spacing:-.01em;color:var(--ink)}
 .brand .wm i{font-style:normal;color:var(--brand)}
 h1{font-size:21px;margin:0 0 4px;letter-spacing:-.02em}
 .sub{color:var(--muted);font-size:13.5px;margin:0 0 18px;line-height:1.45}
 #lista{max-height:46vh;overflow:auto;margin:0 -4px;padding:0 4px}
 #lista::-webkit-scrollbar{width:8px}
 #lista::-webkit-scrollbar-thumb{background:#dbe5ea;border-radius:8px}
 .entry{margin-bottom:9px}
 .arc{display:flex;align-items:center;gap:13px;padding:11px 13px;border:1px solid var(--line);
   border-radius:14px;background:#fff;cursor:pointer;transition:border-color .15s,box-shadow .15s}
 .arc:hover{border-color:var(--brand);box-shadow:0 10px 22px -12px rgba(17,118,155,.55)}
 .avatar{width:38px;height:38px;border-radius:11px;flex:none;display:grid;place-items:center;
   color:#fff;font-weight:700;font-size:16px}
 .meta{flex:1;min-width:0}
 .nome{font-weight:600;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
 .tag{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:var(--muted);margin-top:2px}
 .tag svg{width:12px;height:12px}
 .chev{color:#cbd5e1;flex:none;display:flex}
 .arc:hover .chev{color:var(--brand)}
 .pwrow{display:flex;gap:8px;margin:8px 2px 2px}
 input{width:100%;padding:11px 13px;border:1px solid #cbd5e1;border-radius:11px;font-size:14px;
   outline:none;transition:border-color .15s,box-shadow .15s;background:#fff;color:var(--ink)}
 input:focus{border-color:var(--brand);box-shadow:0 0 0 3px rgba(17,118,155,.14)}
 button{padding:11px 16px;border:0;border-radius:11px;color:#fff;font-size:14px;font-weight:700;
   cursor:pointer;white-space:nowrap;background:linear-gradient(135deg,var(--brand),var(--brand2));
   box-shadow:0 8px 16px -8px rgba(17,118,155,.6);transition:filter .15s,opacity .15s}
 button:hover{filter:brightness(1.05)}
 button:disabled{opacity:.6;cursor:default;filter:none}
 .empty{text-align:center;padding:22px 10px;border:1.5px dashed #d6e1e7;border-radius:14px;color:var(--muted)}
 .empty .ic{font-size:30px;line-height:1;margin-bottom:8px}
 .empty p{margin:0;font-size:13.5px;line-height:1.5}
 .new{margin-top:18px;padding-top:18px;border-top:1px solid #eef2f5}
 .new-h{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:800;color:var(--muted);
   text-transform:uppercase;letter-spacing:.05em;margin:0 0 11px}
 .new-h svg{width:14px;height:14px;color:var(--brand)}
 .hint{color:#94a3b8;font-size:11.5px;line-height:1.45;margin:9px 2px 0}
 .err{color:#dc2626;font-size:13px;min-height:16px;margin-top:10px}
</style></head><body>
 <div class="card">
  <div class="brand">
   <div class="logo">O</div>
   <div class="wm">Ord<i>e</i>va</div>
  </div>
  <h1>Bentornato 👋</h1>
  <p class="sub">Scegli l'archivio con cui lavorare. Ogni archivio è un gestionale a sé, con i suoi dati, i suoi backup e la sua password.</p>
  <div id="lista"></div>
  <div class="new">
   <div class="new-h"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"></path></svg> Nuovo archivio</div>
   <input id="nome" placeholder="Nome (es. La mia azienda)">
   <div class="pwrow">
    <input id="npw" type="password" autocomplete="new-password" placeholder="Password (opzionale)">
    <button id="crea">Crea</button>
   </div>
   <p class="hint">La password protegge l'accesso all'archivio e cifra i suoi backup. Lasciala vuota per un archivio senza blocco.</p>
  </div>
  <div class="err" id="e"></div>
 </div>
<script>
 const lista=document.getElementById('lista'),e=document.getElementById('e');
 const post=(u,b)=>fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b||{})}).then(r=>r.json());
 const grad=['linear-gradient(135deg,#11769b,#15a4a2)','linear-gradient(135deg,#2563eb,#0ea5e9)','linear-gradient(135deg,#7c3aed,#a855f7)','linear-gradient(135deg,#059669,#10b981)','linear-gradient(135deg,#f97316,#f59e0b)','linear-gradient(135deg,#e11d48,#f43f5e)'];
 const colorFor=s=>{let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;return grad[h%grad.length];};
 const lockSvg=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="9" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path></svg>`;
 const chevSvg=`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"></path></svg>`;
 function apri(slug,pw,btn){
   e.textContent=''; if(btn){btn.disabled=true;btn.textContent='Apro…';}
   post('/__apri',{slug:slug,password:pw||''}).then(j=>{
     if(j&&j.ok){location.reload();return;}
     e.textContent=(j&&j.errore==='password_errata')?'Password errata.':(j&&j.errore?('Apertura non riuscita: '+j.errore):'Apertura non riuscita.');
     if(btn){btn.disabled=false;btn.textContent='Apri';}
   }).catch(()=>{e.textContent='Errore di apertura.';if(btn){btn.disabled=false;btn.textContent='Apri';}});
 }
 function render(archivi){
   lista.innerHTML='';
   if(!archivi.length){lista.innerHTML=`<div class="empty"><div class="ic">📁</div><p>Non c'è ancora nessun archivio.<br>Creane uno qui sotto per iniziare.</p></div>`;return;}
   for(const a of archivi){
     const entry=document.createElement('div');entry.className='entry';
     const head=document.createElement('div');head.className='arc';
     const av=document.createElement('div');av.className='avatar';av.style.background=colorFor(a.nome||'?');av.textContent=((a.nome||'?').trim()[0]||'?').toUpperCase();
     const meta=document.createElement('div');meta.className='meta';
     const nm=document.createElement('div');nm.className='nome';nm.textContent=a.nome;
     meta.appendChild(nm);
     const tag=document.createElement('div');tag.className='tag';
     tag.innerHTML=a.cifrato?lockSvg+'<span>Protetto da password</span>':'<span>Pronto ad aprirsi</span>';
     meta.appendChild(tag);
     const chev=document.createElement('div');chev.className='chev';chev.innerHTML=chevSvg;
     head.appendChild(av);head.appendChild(meta);head.appendChild(chev);
     entry.appendChild(head);
     if(a.cifrato){
       head.onclick=()=>{
         if(entry.dataset.open)return; entry.dataset.open='1';
         const wrap=document.createElement('div');wrap.className='pwrow';
         wrap.innerHTML=`<input type="password" placeholder="Password"><button>Apri</button>`;
         const inp=wrap.querySelector('input'),btn=wrap.querySelector('button');
         btn.onclick=()=>{ if(!inp.value){inp.focus();return;} apri(a.slug,inp.value,btn); };
         inp.addEventListener('keydown',ev=>{if(ev.key==='Enter')btn.click();});
         entry.appendChild(wrap); inp.focus();
       };
     } else {
       head.onclick=()=>apri(a.slug,'',null);
     }
     lista.appendChild(entry);
   }
 }
 post('/__archivi').then(j=>render((j&&j.archivi)||[])).catch(()=>{e.textContent='Impossibile leggere gli archivi.';});
 document.getElementById('crea').onclick=()=>{
   const nome=document.getElementById('nome').value.trim(),pw=document.getElementById('npw').value||'';
   if(!nome){e.textContent='Dai un nome all\'archivio.';return;}
   const b=document.getElementById('crea');e.textContent='';b.disabled=true;b.textContent='Creo…';
   post('/__crea',{nome:nome,password:pw}).then(j=>{
     if(j&&j.ok){location.reload();return;}
     e.textContent=j&&j.errore?('Creazione non riuscita: '+j.errore):'Creazione non riuscita.';
     b.disabled=false;b.textContent='Crea';
     // L'archivio potrebbe essere stato comunque creato su disco anche se l'avvio è
     // fallito: aggiorniamo la lista così resta visibile e riprovabile da "Apri".
     post('/__archivi').then(k=>render((k&&k.archivi)||[])).catch(()=>{});
   }).catch(()=>{e.textContent='Errore di creazione.';b.disabled=false;b.textContent='Crea';});
 };
</script></body></html>"#;

/// Icona nell'area di notifica (Windows/Linux) / menu bar (macOS) con menu rapido.
/// Chiudendo la finestra l'app resta qui in background; da qui la si riapre o si esce
/// in sicurezza (checkpoint + rilascio lock).
fn setup_tray(app: &tauri::AppHandle, state: AppState) -> tauri::Result<()> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let mostra = MenuItemBuilder::with_id("tray_mostra", "Mostra Ordeva").build(app)?;
    let chiudi =
        MenuItemBuilder::with_id("tray_chiudi", "Chiudi in sicurezza").build(app)?;
    let menu = MenuBuilder::new(app).items(&[&mostra, &chiudi]).build()?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("Ordeva")
        .menu(&menu)
        .show_menu_on_left_click(false);
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder = builder.on_menu_event(move |app, event| match event.id().as_ref() {
        "tray_mostra" => show_main(app),
        "tray_chiudi" => {
            state.flush();
            state.release_lock();
            app.exit(0);
        }
        _ => {}
    });

    builder = builder.on_tray_icon_event(|tray, event| {
        if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        } = event
        {
            show_main(tray.app_handle());
        }
    });

    builder.build(app)?;
    Ok(())
}

/// Mostra e porta in primo piano la finestra principale (dalla tray o da single-instance).
fn show_main<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// Costruisce e installa il menu nativo (File / Modifica / Visualizza / Aiuto).
/// Le voci custom emettono l'evento "menu" con il proprio id verso la WebView.
/// Solo macOS: su Windows/Linux il menu resta assente (vedi setup()).
#[cfg(target_os = "macos")]
fn setup_menu(app: &tauri::AppHandle) -> tauri::Result<()> {
    let file = SubmenuBuilder::new(app, "File")
        .text("new", "Nuovo documento")
        .text("save", "Salva")
        .separator()
        .text("backup", "Backup dati…")
        .separator()
        .quit()
        .build()?;

    let edit = SubmenuBuilder::new(app, "Modifica")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view = SubmenuBuilder::new(app, "Visualizza")
        .text("density", "Densità: Comoda / Compatta")
        .separator()
        .minimize()
        .build()?;

    let help = SubmenuBuilder::new(app, "Aiuto")
        .text("help", "Guida")
        .text("about", "Informazioni su Ordeva")
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[&file, &edit, &view, &help])
        .build()?;
    app.set_menu(menu)?;

    app.on_menu_event(move |app, event| {
        let id = event.id().as_ref().to_string();
        // Le voci predefinite (copy/paste/quit…) sono gestite dal sistema; per
        // quelle custom inoltriamo l'id alla SPA che esegue l'azione.
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.emit("menu", id);
        }
    });

    Ok(())
}
