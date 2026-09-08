//! Router /api. Le fasi aggiungono progressivamente i moduli di dominio.
//! Fase 0: me/auth. Fase 1: anagrafiche (in corso — tabelle base completate).

mod acquisti;
mod agenda;
mod agenti;
mod allegati;
mod archivi;
mod aliquote_iva;
mod arrivi_merce;
mod audit;
mod azienda;
mod backup;
mod bug_reports;
mod categorie_prodotto;
mod causali;
mod clienti;
mod comandi;
mod conti_acquisto;
mod crm;
mod ddt;
mod ecommerce;
pub(crate) mod email;
mod fattura_xml;
mod fatture;
pub(crate) mod fatture_ricorrenti;
pub(crate) mod fornitori;
mod google_sync;
mod gruppi;
mod keychain;
mod kit;
mod lavagna;
mod moduli;
mod note_credito;
mod note_rapide;
mod notifications;
mod listini;
mod magazzini;
mod marketplace;
mod me;
mod movimenti_magazzino;
mod ordini;
mod pagamenti;
mod piva;
mod preventivi;
mod prima_nota;
mod prodotti;
mod prodotto_varianti;
mod reports;
mod riconciliazione;
mod riordino;
mod scadenzario;
mod sdi_passive;
mod scadenze_fiscali;
mod setup;
mod sistema;
mod stats;
mod timesheet;
mod tipi_pagamento;
mod unita_misura;
mod utenti;
pub(crate) mod vendite_banco;

use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Json, Router};
use serde_json::{json, Value};

use crate::db::AppState;
use crate::error::{ApiError, ApiResult};
use crate::numerazione::get_next_numero;
use crate::web::tenant_conn;

/// Costruisce il sotto-router montato su `/api`.
pub fn api_router() -> Router<AppState> {
    Router::new()
        .merge(me::routes())
        // Numerazione automatica documenti (parità con la route Node
        // /api/next-number/:tipo): prossimo numero libero, gap-filling, con
        // prefissi e numerazione annuale presi dalle impostazioni azienda.
        .route("/next-number/:tipo", get(next_number))
        // Prezzi già applicati a un prodotto (per cliente e in generale) con il documento
        // in cui compaiono: mostra lo storico prezzi nel form documento. Parità con la
        // route Node /api/prezzi-recenti (mancava nel backend desktop → niente storico).
        .route("/prezzi-recenti", get(prezzi_recenti))
        // Ricerca globale della topbar (clienti, fornitori, prodotti e documenti):
        // parità con la route Node /api/search. Mancava nel backend desktop → la
        // barra di ricerca in alto non restituiva nulla.
        .route("/search", get(search))
        // Anagrafiche (Fase 1)
        .nest("/azienda", azienda::routes())
        .nest("/clienti", clienti::routes())
        .nest("/fornitori", fornitori::routes())
        .nest("/prodotti", prodotti::routes())
        .nest("/listini", listini::routes())
        // Magazzino (Fase 2)
        .nest("/magazzini", magazzini::routes())
        .nest("/movimenti-magazzino", movimenti_magazzino::routes())
        .nest("/arrivi-merce", arrivi_merce::routes())
        .nest("/riordino", riordino::routes())
        // Documenti (Fase 3)
        .nest("/ddt", ddt::routes())
        .nest("/preventivi", preventivi::routes())
        .nest("/ordini", ordini::routes())
        .nest("/acquisti", acquisti::routes())
        .nest("/vendite-banco", vendite_banco::routes())
        .nest("/fatture", fatture::routes())
        .nest("/note-credito", note_credito::routes())
        .nest("/fattura-xml", fattura_xml::routes())
        // Contabilità (Fase 5)
        .nest("/pagamenti", pagamenti::routes())
        .nest("/scadenzario", scadenzario::routes())
        .nest("/scadenze-fiscali", scadenze_fiscali::routes())
        .nest("/prima-nota", prima_nota::routes())
        .nest("/riconciliazione", riconciliazione::routes())
        .nest("/stats", stats::routes())
        .nest("/reports", reports::routes())
        // Trasversali offline (Fase 6)
        .nest("/audit", audit::routes())
        .nest("/notifications", notifications::routes())
        .nest("/note-rapide", note_rapide::routes())
        .nest("/lavagna", lavagna::routes())
        .nest("/kit", kit::routes())
        .nest("/bug-reports", bug_reports::routes())
        .nest("/prodotto-varianti", prodotto_varianti::routes())
        .nest("/moduli", moduli::routes())
        .nest("/gruppi", gruppi::routes())
        .nest("/google", google_sync::routes())
        .nest("/utenti", utenti::routes())
        .nest("/fatture-ricorrenti", fatture_ricorrenti::routes())
        .nest("/agenda", agenda::routes())
        .nest("/agenti", agenti::routes())
        .nest("/allegati", allegati::routes())
        .nest("/crm", crm::routes())
        .nest("/timesheet", timesheet::routes())
        .nest("/sdi-passive", sdi_passive::routes())
        .nest("/comandi", comandi::routes())
        .nest("/email", email::routes())
        .nest("/ecommerce", ecommerce::routes())
        .nest("/marketplace", marketplace::routes())
        .nest("/piva", piva::routes())
        // Offline-only (Fase 6)
        .nest("/setup", setup::routes())
        .nest("/backup", backup::routes())
        .nest("/sistema", sistema::routes())
        .nest("/archivi", archivi::routes())
        .nest("/keychain", keychain::routes())
        // Tabelle base (Fase 1)
        .nest("/unita-misura", unita_misura::routes())
        .nest("/aliquote-iva", aliquote_iva::routes())
        .nest("/causali", causali::routes())
        .nest("/conti-acquisto", conti_acquisto::routes())
        .nest("/categorie-prodotto", categorie_prodotto::routes())
        .nest("/tipi-pagamento", tipi_pagamento::routes())
}

/// GET /api/next-number/:tipo — prossimo numero documento suggerito al frontend
/// quando si crea un nuovo documento. Mappa il tipo (URL) alla tabella e alla
/// chiave-prefisso, poi delega a get_next_numero (gap-filling + prefisso/annuale).
async fn next_number(
    State(state): State<AppState>,
    Path(tipo): Path<String>,
) -> ApiResult<Json<Value>> {
    // (chiave_prefisso, tabella_sql) — identico alla tableMap di server.js.
    let (prefix_key, table) = match tipo.as_str() {
        "ddt" => ("ddt", "ddt"),
        "fatture" => ("fatture", "fatture"),
        "ordini" => ("ordini", "ordini"),
        "preventivi" => ("preventivi", "preventivi"),
        "note-credito" => ("note_credito", "note_credito"),
        "acquisti" => ("acquisti", "acquisti"),
        "vendite-banco" => ("vendite_banco", "vendite_banco"),
        "arrivi-merce" => ("arrivi_merce", "arrivi_merce"),
        _ => {
            return Err(ApiError::Status(
                axum::http::StatusCode::BAD_REQUEST,
                "tipo non valido".into(),
            ))
        }
    };
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let numero = get_next_numero(&conn, prefix_key, table, 0)?;
    Ok(Json(json!({ "numero": numero })))
}

#[derive(serde::Deserialize)]
struct PrezziRecentiQuery {
    #[serde(rename = "prodottoId")]
    prodotto_id: Option<i64>,
    #[serde(rename = "clienteId")]
    cliente_id: Option<i64>,
}

/// GET /api/prezzi-recenti?prodottoId=..&clienteId=.. — prezzi già applicati a un
/// prodotto in fatture, DDT e preventivi, con cliente e numero documento. Con
/// clienteId filtra su quel cliente (max 5 recenti), senza restituisce lo storico
/// generale su tutti i clienti (max 15). Parità con la route Node omonima.
async fn prezzi_recenti(
    State(state): State<AppState>,
    Query(q): Query<PrezziRecentiQuery>,
) -> ApiResult<Json<Value>> {
    let pid = match q.prodotto_id {
        Some(p) if p > 0 => p,
        _ => return Ok(Json(Value::Array(vec![]))),
    };
    let cid = q.cliente_id;
    let limit: i64 = if cid.is_some() { 5 } else { 10 };

    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();

    // (righe, colonna FK verso il documento, documento, etichetta tipo)
    let sources = [
        ("fatture_righe", "fattura_id", "fatture", "Fattura"),
        ("ddt_righe", "ddt_id", "ddt", "DDT"),
        ("preventivi_righe", "preventivo_id", "preventivi", "Preventivo"),
    ];

    let mut rows: Vec<(String, Value)> = Vec::new();
    for (righe, fk, doc, tipo) in sources {
        let filtro_cliente = if cid.is_some() { " AND d.cliente_id=?" } else { "" };
        let sql = format!(
            "SELECT r.prezzo, r.sconto, r.quantita, d.numero, d.data_emissione, \
                    d.cliente_id, c.ragione_sociale \
             FROM {righe} r JOIN {doc} d ON r.{fk}=d.id \
             LEFT JOIN clienti c ON c.id=d.cliente_id \
             WHERE r.prodotto_id=?{filtro_cliente} \
             ORDER BY d.data_emissione DESC LIMIT ?"
        );
        let mut binds: Vec<i64> = vec![pid];
        if let Some(c) = cid {
            binds.push(c);
        }
        binds.push(limit);

        let mut stmt = conn.prepare(&sql)?;
        let mapped = stmt.query_map(rusqlite::params_from_iter(binds), |row| {
            let prezzo: f64 = row.get::<_, Option<f64>>(0)?.unwrap_or(0.0);
            let sconto: f64 = row.get::<_, Option<f64>>(1)?.unwrap_or(0.0);
            let quantita: Option<f64> = row.get(2)?;
            let numero: Option<String> = row.get(3)?;
            let data: Option<String> = row.get(4)?;
            let cliente_id: Option<i64> = row.get(5)?;
            let cliente_nome: Option<String> = row.get(6)?;
            let key = data.clone().unwrap_or_default();
            let eff = ((prezzo * (1.0 - sconto / 100.0)) * 10000.0).round() / 10000.0;
            let v = json!({
                "prezzo": prezzo,
                "sconto": sconto,
                "prezzoEffettivo": eff,
                "quantita": quantita,
                "numero": numero,
                "dataEmissione": data,
                "tipo": tipo,
                "clienteId": cliente_id,
                "clienteNome": cliente_nome,
            });
            Ok((key, v))
        })?;
        for r in mapped {
            rows.push(r?);
        }
    }

    // Più recenti prima (per data documento), poi taglio come la route Node.
    rows.sort_by(|a, b| b.0.cmp(&a.0));
    let take: usize = if cid.is_some() { 5 } else { 15 };
    let out: Vec<Value> = rows.into_iter().take(take).map(|(_, v)| v).collect();
    Ok(Json(Value::Array(out)))
}

#[derive(serde::Deserialize)]
struct SearchQuery {
    q: Option<String>,
}

/// GET /api/search?q=.. — ricerca globale della topbar su clienti, fornitori, prodotti,
/// fatture, DDT, ordini e preventivi (max 5 per categoria). Ogni risultato è
/// { id, label, tipo, route }. Parità con la route Node /api/search.
async fn search(
    State(state): State<AppState>,
    Query(sq): Query<SearchQuery>,
) -> ApiResult<Json<Value>> {
    let q = sq.q.unwrap_or_default();
    let q = q.trim();
    if q.chars().count() < 2 {
        return Ok(Json(json!({
            "clienti": [], "fornitori": [], "prodotti": [],
            "fatture": [], "ddt": [], "ordini": [], "preventivi": []
        })));
    }
    let like = format!("%{q}%");

    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();

    // Esegue una query "SELECT id, label ..." (bind unico ?1 = like) e la trasforma
    // nell'oggetto che si aspetta la palette: { id, label, tipo, route }.
    let run = |sql: &str, tipo: &str, route: &str| -> ApiResult<Vec<Value>> {
        let mut stmt = conn.prepare(sql)?;
        let mapped = stmt.query_map([like.as_str()], |row| {
            let id: i64 = row.get(0)?;
            let label: Option<String> = row.get(1)?;
            Ok(json!({
                "id": id,
                "label": label.unwrap_or_default(),
                "tipo": tipo,
                "route": route,
            }))
        })?;
        let mut out = Vec::new();
        for r in mapped {
            out.push(r?);
        }
        Ok(out)
    };

    let clienti = run(
        "SELECT id, ragione_sociale FROM clienti \
         WHERE ragione_sociale LIKE ?1 OR p_iva LIKE ?1 OR codice_fiscale LIKE ?1 LIMIT 5",
        "cliente",
        "/clienti",
    )?;
    let fornitori = run(
        "SELECT id, ragione_sociale FROM fornitori \
         WHERE ragione_sociale LIKE ?1 OR p_iva LIKE ?1 LIMIT 5",
        "fornitore",
        "/fornitori",
    )?;
    let prodotti = run(
        "SELECT id, nome FROM prodotti \
         WHERE nome LIKE ?1 OR codice LIKE ?1 OR barcode LIKE ?1 LIMIT 5",
        "prodotto",
        "/prodotti",
    )?;
    let fatture = run(
        "SELECT f.id, f.numero || COALESCE(' – ' || c.ragione_sociale, '') \
         FROM fatture f LEFT JOIN clienti c ON f.cliente_id=c.id \
         WHERE f.numero LIKE ?1 OR c.ragione_sociale LIKE ?1 LIMIT 5",
        "fattura",
        "/fatture",
    )?;
    let ddt = run(
        "SELECT d.id, d.numero || COALESCE(' – ' || c.ragione_sociale, '') \
         FROM ddt d LEFT JOIN clienti c ON d.cliente_id=c.id \
         WHERE d.numero LIKE ?1 OR c.ragione_sociale LIKE ?1 LIMIT 5",
        "ddt",
        "/ddt",
    )?;
    let ordini = run(
        "SELECT o.id, o.numero || COALESCE(' – ' || c.ragione_sociale, '') \
         FROM ordini o LEFT JOIN clienti c ON o.cliente_id=c.id \
         WHERE o.numero LIKE ?1 OR c.ragione_sociale LIKE ?1 LIMIT 5",
        "ordine",
        "/ordini",
    )?;
    let preventivi = run(
        "SELECT p.id, p.numero || COALESCE(' – ' || c.ragione_sociale, '') \
         FROM preventivi p LEFT JOIN clienti c ON p.cliente_id=c.id \
         WHERE p.numero LIKE ?1 OR c.ragione_sociale LIKE ?1 LIMIT 5",
        "preventivo",
        "/preventivi",
    )?;

    Ok(Json(json!({
        "clienti": clienti,
        "fornitori": fornitori,
        "prodotti": prodotti,
        "fatture": fatture,
        "ddt": ddt,
        "ordini": ordini,
        "preventivi": preventivi,
    })))
}
