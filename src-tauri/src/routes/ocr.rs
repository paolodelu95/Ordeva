//! /api/ocr — lettura assistita di fatture passive e scontrini, tutta in locale.
//!
//! Nell'edizione SaaS il documento veniva spedito a Mindee con una API key.
//! Qui il testo lo produce il frontend (layer testuale del PDF via pdf.js, oppure
//! OCR in WASM con tesseract.js per scansioni e foto) e il backend fa il resto:
//! riconosce i campi (`crate::ocr_parse`), propone i prodotti a magazzino per
//! ogni riga e infine crea l'acquisto. Nessuna rete, nessun account, nessuna chiave.
//!
//! Le rotte /analizza-righe e /conferma mantengono lo stesso contratto della
//! versione Node, così la pagina "OCR fatture" continua a funzionare com'era.

use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::db::AppState;
use crate::error::{ApiError, ApiResult};
use crate::match_prodotti::{score_candidati, soglia_min, ProdInput};
use crate::ocr_parse;
use crate::web::{self, tenant_conn};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/status", get(status))
        .route("/fattura/testo", post(fattura_testo))
        .route("/fattura/analizza-righe", post(analizza_righe))
        .route("/fattura/conferma", post(conferma))
        .route("/scontrino/testo", post(scontrino_testo))
}

fn norm(s: &str) -> String {
    s.trim().to_lowercase()
}

/// GET /api/ocr/status — il frontend lo interroga per sapere se la lettura è
/// disponibile. In locale lo è sempre: non c'è niente da configurare.
async fn status() -> Json<Value> {
    Json(json!({ "configured": true, "motore": "locale", "richiedeChiave": false }))
}

/// Dati dell'azienda che usa il gestionale: servono a non confondere il
/// destinatario della fattura (cioè l'utente) con il fornitore che l'ha emessa.
fn azienda(conn: &Connection) -> (Option<String>, Option<String>) {
    conn.query_row("SELECT p_iva, ragione_sociale FROM azienda WHERE id=1", [], |r| {
        Ok((
            r.get::<_, Option<String>>(0)?.filter(|s| !s.trim().is_empty()),
            r.get::<_, Option<String>>(1)?.filter(|s| !s.trim().is_empty()),
        ))
    })
    .optional()
    .ok()
    .flatten()
    .unwrap_or((None, None))
}

/// POST /api/ocr/fattura/testo — body { testo }.
/// Riconosce i campi della fattura nel testo estratto dal documento.
async fn fattura_testo(State(state): State<AppState>, Json(b): Json<Value>) -> ApiResult<Json<Value>> {
    let testo = b.get("testo").and_then(Value::as_str).unwrap_or("");
    if testo.trim().len() < 20 {
        return Err(ApiError::bad_request(
            "Testo troppo corto: il documento non è leggibile.",
        ));
    }

    let (piva_azienda, nome_azienda) = {
        let conn = tenant_conn(&state)?;
        let conn = conn.lock().unwrap();
        azienda(&conn)
    };

    let f = ocr_parse::analizza_fattura(testo, piva_azienda.as_deref(), nome_azienda.as_deref());
    // Quante informazioni chiave sono state riconosciute: il frontend la mostra
    // per far capire quanto c'è da rivedere a mano.
    let trovati = [
        !f.fornitore.is_empty(),
        !f.p_iva_fornitore.is_empty(),
        !f.numero.is_empty(),
        !f.data_doc.is_empty(),
        f.totale_lordo > 0.0,
    ]
    .iter()
    .filter(|v| **v)
    .count();

    Ok(Json(json!({
        "ok": true,
        "affidabilita": trovati as f64 / 5.0,
        "suggerito": {
            "fornitore": f.fornitore,
            "pIvaFornitore": f.p_iva_fornitore,
            "dataDoc": if f.data_doc.is_empty() { Value::Null } else { json!(f.data_doc) },
            "numero": f.numero,
            "totaleLordo": web::num(f.totale_lordo),
            "totaleNetto": web::num(f.totale_netto),
            "totaleIva": web::num(f.totale_iva),
            "righe": f.righe,
        },
    })))
}

/// POST /api/ocr/scontrino/testo — body { testo }.
/// Estrae data, importo e negozio per pre-compilare una riga di prima nota.
async fn scontrino_testo(Json(b): Json<Value>) -> ApiResult<Json<Value>> {
    let testo = b.get("testo").and_then(Value::as_str).unwrap_or("");
    if testo.trim().len() < 8 {
        return Err(ApiError::bad_request("Testo troppo corto: lo scontrino non è leggibile."));
    }
    let s = ocr_parse::analizza_scontrino(testo);
    let data = if s.data.is_empty() { web::oggi() } else { s.data };
    Ok(Json(json!({
        "ok": true,
        "suggerito": {
            "data": data,
            "importo": web::num(s.importo),
            "negozio": s.negozio,
            "categoria": "",
            "causale": "",
        },
    })))
}

/// Trova (senza crearlo) un fornitore per P.IVA o ragione sociale.
fn trova_fornitore(conn: &Connection, fornitore: &str, p_iva: &str) -> rusqlite::Result<Option<(i64, String)>> {
    if !p_iva.trim().is_empty() {
        let p = p_iva.trim();
        let con_it = format!("IT{p}");
        if let Some(f) = conn
            .query_row(
                "SELECT id, ragione_sociale FROM fornitori WHERE p_iva=?1 OR p_iva=?2",
                params![p, con_it],
                |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Option<String>>(1)?.unwrap_or_default())),
            )
            .optional()?
        {
            return Ok(Some(f));
        }
    }
    if !fornitore.trim().is_empty() {
        return conn
            .query_row(
                "SELECT id, ragione_sociale FROM fornitori WHERE LOWER(TRIM(ragione_sociale))=?1",
                params![norm(fornitore)],
                |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Option<String>>(1)?.unwrap_or_default())),
            )
            .optional();
    }
    Ok(None)
}

fn load_prod_inputs(conn: &Connection) -> rusqlite::Result<Vec<ProdInput>> {
    let mut stmt = conn.prepare(
        "SELECT id, nome, categoria, codice, descrizione, prezzo_acquisto, quantita FROM prodotti",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(ProdInput {
            id: r.get(0)?,
            nome: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
            categoria: r.get::<_, Option<String>>(2)?.unwrap_or_default(),
            codice: r.get::<_, Option<String>>(3)?.unwrap_or_default(),
            descrizione: r.get::<_, Option<String>>(4)?.unwrap_or_default(),
            prezzo_acquisto: r.get(5)?,
            quantita: r.get(6)?,
        })
    })?;
    rows.collect()
}

/// POST /api/ocr/fattura/analizza-righe — parità con la route Node omonima.
/// body: { fornitore, pIva, numero, righe: [{descrizione, codice?, prezzo?}] }
/// Risolve il fornitore, segnala il documento già caricato e per ogni riga
/// propone i prodotti più probabili (memoria degli abbinamenti + match testuale).
async fn analizza_righe(State(state): State<AppState>, Json(b): Json<Value>) -> ApiResult<Json<Value>> {
    let Some(righe) = b.get("righe").and_then(Value::as_array).cloned() else {
        return Err(ApiError::bad_request("righe mancanti"));
    };
    let fornitore = web::str_field(&b, "fornitore");
    let p_iva = web::str_field(&b, "pIva");
    let numero = web::str_field(&b, "numero");

    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();

    let f = trova_fornitore(&conn, &fornitore, &p_iva)?;
    let fornitore_id = f.as_ref().map(|(id, _)| *id);

    // Anti-duplicato: stesso numero, stesso fornitore.
    let mut duplicato = Value::Null;
    if let (Some(fid), false) = (fornitore_id, numero.trim().is_empty()) {
        if let Some(id) = conn
            .query_row(
                "SELECT id FROM acquisti WHERE numero=?1 AND fornitore_id=?2",
                params![numero.trim(), fid],
                |r| r.get::<_, i64>(0),
            )
            .optional()?
        {
            duplicato = json!({ "acquistoId": id });
        }
    }

    let prodotti = load_prod_inputs(&conn)?;
    let nomi: HashMap<i64, (String, String, String, Option<f64>, Option<f64>)> = prodotti
        .iter()
        .map(|p| {
            (
                p.id,
                (p.nome.clone(), p.codice.clone(), p.categoria.clone(), p.prezzo_acquisto, p.quantita),
            )
        })
        .collect();

    // Abbinamenti già memorizzati per questo fornitore (codice o descrizione → prodotto).
    let alias: HashMap<String, i64> = match fornitore_id {
        Some(fid) => {
            let mut stmt =
                conn.prepare("SELECT codice_norm, prodotto_id FROM fornitore_codice_alias WHERE fornitore_id=?1")?;
            let rows = stmt.query_map([fid], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
            rows.collect::<Result<_, _>>()?
        }
        None => HashMap::new(),
    };

    let mut out = score_candidati(&righe, &prodotti, 5, soglia_min());
    for (i, ris) in out.iter_mut().enumerate() {
        let riga = &righe[i];
        let codice = riga.get("codice").and_then(Value::as_str).unwrap_or("").trim();
        let descrizione = riga.get("descrizione").and_then(Value::as_str).unwrap_or("");
        let chiave = norm(if codice.is_empty() { descrizione } else { codice });
        let Some(pid) = alias.get(&chiave).copied() else { continue };
        let Some((nome, cod, cat, prezzo_acq, qta)) = nomi.get(&pid) else { continue };

        // L'abbinamento memorizzato passa davanti a tutti: è una scelta che
        // l'utente ha già fatto su un documento precedente dello stesso fornitore.
        let forzato = json!({
            "prodottoId": pid,
            "nome": nome,
            "codice": cod,
            "categoria": cat,
            "prezzoAcquistoAttuale": web::opt_num(*prezzo_acq),
            "quantita": web::opt_num(*qta),
            "score": 1.0,
            "fascia": "alta",
            "perche": "già abbinato in precedenza",
            "giaMemorizzato": true,
        });
        let mut lista = vec![forzato];
        if let Some(esistenti) = ris.get("candidati").and_then(Value::as_array) {
            lista.extend(
                esistenti
                    .iter()
                    .filter(|c| c.get("prodottoId").and_then(Value::as_i64) != Some(pid))
                    .cloned(),
            );
        }
        ris["candidati"] = Value::Array(lista);
    }

    Ok(Json(json!({
        "fornitoreId": fornitore_id,
        "fornitoreNome": f.map(|(_, n)| n).unwrap_or_default(),
        "duplicato": duplicato,
        "righe": out,
    })))
}

/// Aggiorna il prezzo d'acquisto del prodotto per quel fornitore (upsert su
/// prodotto_fornitori + campo legacy su prodotti). Da chiamare dentro la transazione.
fn upsert_prezzo_acquisto(
    tx: &rusqlite::Transaction,
    prodotto_id: i64,
    fornitore_id: i64,
    prezzo: Option<f64>,
) -> rusqlite::Result<()> {
    let Some(prezzo) = prezzo.filter(|p| p.is_finite()) else { return Ok(()) };
    let netto = (prezzo * 10000.0).round() / 10000.0;
    let esistente: Option<i64> = tx
        .query_row(
            "SELECT id FROM prodotto_fornitori WHERE prodotto_id=?1 AND fornitore_id=?2",
            params![prodotto_id, fornitore_id],
            |r| r.get(0),
        )
        .optional()?;
    match esistente {
        Some(id) => {
            tx.execute("UPDATE prodotto_fornitori SET prezzo_acquisto=?1 WHERE id=?2", params![netto, id])?;
        }
        None => {
            let is_first = tx
                .query_row("SELECT 1 FROM prodotto_fornitori WHERE prodotto_id=?1 LIMIT 1", [prodotto_id], |_| Ok(()))
                .optional()?
                .is_none();
            tx.execute(
                "INSERT INTO prodotto_fornitori (prodotto_id, fornitore_id, codice_fornitore, prezzo_acquisto, predefinito) \
                 VALUES (?1,?2,'',?3,?4)",
                params![prodotto_id, fornitore_id, netto, is_first as i64],
            )?;
        }
    }
    tx.execute(
        "UPDATE prodotti SET prezzo_acquisto=?1 WHERE id=?2 AND fornitore_id_preferito=?3",
        params![netto, prodotto_id, fornitore_id],
    )?;
    Ok(())
}

/// POST /api/ocr/fattura/conferma — crea l'acquisto con i dati confermati dall'utente.
/// body: { fornitore, pIva, dataDoc, numero, righe: [{descrizione,quantita,prezzo,iva,prodottoId?,codice?}] }
/// Per ogni riga abbinata a un prodotto memorizza l'abbinamento (così il documento
/// successivo dello stesso fornitore parte già collegato) e aggiorna il costo d'acquisto.
async fn conferma(State(state): State<AppState>, Json(b): Json<Value>) -> ApiResult<Json<Value>> {
    let fornitore = web::str_field(&b, "fornitore");
    let p_iva = web::str_field(&b, "pIva");
    let data_doc = web::str_field(&b, "dataDoc");
    let numero = web::str_field(&b, "numero");
    let righe = b.get("righe").and_then(Value::as_array).cloned().unwrap_or_default();
    if fornitore.trim().is_empty() || data_doc.trim().is_empty() || righe.is_empty() {
        return Err(ApiError::bad_request("fornitore, dataDoc e righe sono obbligatori"));
    }

    let conn = tenant_conn(&state)?;
    let mut conn = conn.lock().unwrap();

    // Fornitore: si riusa quello esistente, altrimenti si crea con i dati letti.
    let fornitore_id = match trova_fornitore(&conn, &fornitore, &p_iva)? {
        Some((id, _)) => id,
        None => {
            conn.execute(
                "INSERT INTO fornitori (ragione_sociale, p_iva) VALUES (?1,?2)",
                params![fornitore.trim(), p_iva.trim()],
            )?;
            conn.last_insert_rowid()
        }
    };

    let num_doc = {
        let n = numero.trim().to_string();
        if n.is_empty() {
            format!("OCR-{}", web::oggi().replace('-', ""))
        } else {
            n
        }
    };

    if let Some(id) = conn
        .query_row(
            "SELECT id FROM acquisti WHERE numero=?1 AND fornitore_id=?2",
            params![num_doc, fornitore_id],
            |r| r.get::<_, i64>(0),
        )
        .optional()?
    {
        return Err(ApiError::Body(
            StatusCode::CONFLICT,
            json!({ "error": "Acquisto già presente", "acquistoId": id }),
        ));
    }

    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO acquisti (numero, data_emissione, fornitore_id, note, stato) VALUES (?1,?2,?3,?4,?5)",
        params![num_doc, data_doc.trim(), fornitore_id, "Importato da lettura documento", "RICEVUTA"],
    )?;
    let acquisto_id = tx.last_insert_rowid();

    let mut abbinate = 0i64;
    for r in &righe {
        let descrizione = web::str_field(r, "descrizione");
        let quantita = {
            let q = web::num_or(r, "quantita", 1.0);
            if q > 0.0 { q } else { 1.0 }
        };
        let prezzo = web::num_or(r, "prezzo", 0.0);
        let iva = web::num_or(r, "iva", 22.0);
        let codice = web::str_field(r, "codice");
        let prodotto_id = web::opt_i64(r, "prodottoId").filter(|id| *id > 0);

        tx.execute(
            "INSERT INTO acquisti_righe (acquisto_id, descrizione, quantita, prezzo, iva, prodotto_id, codice_prodotto) \
             VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![acquisto_id, descrizione, quantita, prezzo, iva, prodotto_id, codice.trim()],
        )?;

        if let Some(pid) = prodotto_id {
            abbinate += 1;
            let chiave_orig = if codice.trim().is_empty() { descrizione.clone() } else { codice.trim().to_string() };
            let chiave = norm(&chiave_orig);
            if !chiave.is_empty() {
                tx.execute(
                    "INSERT INTO fornitore_codice_alias (fornitore_id, prodotto_id, codice, codice_norm) VALUES (?1,?2,?3,?4) \
                     ON CONFLICT(fornitore_id, codice_norm) DO UPDATE SET prodotto_id=excluded.prodotto_id, codice=excluded.codice",
                    params![fornitore_id, pid, chiave_orig, chiave],
                )?;
            }
            upsert_prezzo_acquisto(&tx, pid, fornitore_id, Some(prezzo))?;
        }
    }
    tx.commit()?;

    Ok(Json(json!({
        "acquistoId": acquisto_id,
        "fornitoreId": fornitore_id,
        "righe": righe.len(),
        "abbinate": abbinate,
    })))
}
