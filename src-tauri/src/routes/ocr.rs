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
    extract::{Query, State},
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
        .route("/ddt/conferma", post(conferma_ddt))
        .route("/layout", get(layout_get).post(layout_save))
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

    let tipo = match b.get("tipo").and_then(Value::as_str) {
        // Il tipo si può forzare dall'interfaccia quando il riconoscimento sbaglia.
        Some("DDT") => ocr_parse::TipoDocumento::Ddt,
        Some("FATTURA") => ocr_parse::TipoDocumento::Fattura,
        _ => ocr_parse::riconosci_tipo(testo),
    };
    let f = ocr_parse::analizza_fattura(testo, piva_azienda.as_deref(), nome_azienda.as_deref());
    let riferimenti = if tipo == ocr_parse::TipoDocumento::Fattura {
        ocr_parse::trova_riferimenti_ddt(testo)
    } else {
        Vec::new()
    };
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

    // DDT citati in fattura → arrivi merce già in archivio da collegare. Si
    // cercano per numero del documento del fornitore, tra quelli non ancora
    // legati a un acquisto: quelli fatturati non vanno collegati due volte.
    let (arrivi, layout) = {
        let conn = tenant_conn(&state)?;
        let conn = conn.lock().unwrap();
        let fornitore = trova_fornitore(&conn, &f.fornitore, &f.p_iva_fornitore)?;
        let fid = fornitore.as_ref().map(|(id, _)| *id);
        let mut trovati_arrivi: Vec<Value> = Vec::new();
        for rif in &riferimenti {
            for a in arrivi_per_numero(&conn, fid, &rif.numero)? {
                if !trovati_arrivi.iter().any(|x| x["id"] == a["id"]) {
                    trovati_arrivi.push(a);
                }
            }
        }
        let salvato = layout_riga(&conn, fid, tipo.come_stringa())?;
        let layout = if salvato.is_null() { ruoli_dedotti(&f.righe) } else { salvato };
        (trovati_arrivi, layout)
    };

    Ok(Json(json!({
        "ok": true,
        "tipo": tipo.come_stringa(),
        "affidabilita": trovati as f64 / 5.0,
        "riferimentiDdt": riferimenti.iter().map(|r| json!({ "numero": r.numero, "data": r.data })).collect::<Vec<_>>(),
        "arriviCandidati": arrivi,
        "layoutRighe": layout,
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

/// Arrivi merce del fornitore che riportano quel numero di documento e non sono
/// ancora legati a un acquisto. Sono i candidati da collegare alla fattura.
fn arrivi_per_numero(conn: &Connection, fornitore_id: Option<i64>, numero: &str) -> rusqlite::Result<Vec<Value>> {
    let numero = numero.trim();
    if numero.is_empty() {
        return Ok(Vec::new());
    }
    // Confronto tollerante: i fornitori scrivono "445", "0445", "445/A".
    let like = format!("%{numero}%");
    let mut sql = String::from(
        "SELECT a.id, a.numero, a.data, a.numero_documento_fornitore, a.acquisto_id, \
                (SELECT COUNT(*) FROM arrivi_merce_righe r WHERE r.arrivo_merce_id = a.id) AS righe \
         FROM arrivi_merce a \
         WHERE a.acquisto_id IS NULL AND (a.numero_documento_fornitore LIKE ?1 OR a.numero LIKE ?1)",
    );
    if fornitore_id.is_some() {
        sql.push_str(" AND a.fornitore_id = ?2");
    }
    sql.push_str(" ORDER BY a.data DESC LIMIT 20");

    let mut stmt = conn.prepare(&sql)?;
    let mappa = |r: &rusqlite::Row| -> rusqlite::Result<Value> {
        Ok(json!({
            "id": r.get::<_, i64>(0)?,
            "numero": r.get::<_, Option<String>>(1)?.unwrap_or_default(),
            "data": r.get::<_, Option<String>>(2)?.unwrap_or_default(),
            "numeroDocumentoFornitore": r.get::<_, Option<String>>(3)?.unwrap_or_default(),
            "righe": r.get::<_, i64>(5)?,
        }))
    };
    let righe = match fornitore_id {
        Some(fid) => stmt.query_map(params![like, fid], mappa)?.collect::<Result<Vec<_>, _>>()?,
        None => stmt.query_map(params![like], mappa)?.collect::<Result<Vec<_>, _>>()?,
    };
    Ok(righe)
}

/// Ruoli delle colonne memorizzati per quel fornitore e tipo di documento:
/// ogni fornitore impagina le righe a modo suo, e una volta sistemate le
/// colonne non va rifatto a ogni documento.
fn layout_riga(conn: &Connection, fornitore_id: Option<i64>, tipo: &str) -> rusqlite::Result<Value> {
    let Some(fid) = fornitore_id else { return Ok(Value::Null) };
    let ruoli: Option<String> = conn
        .query_row(
            "SELECT ruoli FROM fornitore_layout_riga WHERE fornitore_id=?1 AND tipo_documento=?2",
            params![fid, tipo],
            |r| r.get(0),
        )
        .optional()?;
    Ok(match ruoli.filter(|r| !r.trim().is_empty()) {
        Some(r) => json!(r.split(',').map(|x| x.trim().to_string()).collect::<Vec<_>>()),
        None => Value::Null,
    })
}

/// Ruoli delle colonne dedotti dalla lettura: si prende la riga con più celle,
/// che è quella dove il documento mostra tutte le colonne. Servono a presentare
/// all'utente come il programma ha interpretato il documento — correggere una
/// tendina già compilata è molto più facile che compilarne una vuota.
fn ruoli_dedotti(righe: &[Value]) -> Value {
    let migliore = righe
        .iter()
        .max_by_key(|r| r.get("celle").and_then(Value::as_array).map(|c| c.len()).unwrap_or(0));
    match migliore.and_then(|r| r.get("ruoli")).filter(|v| !v.is_null()) {
        Some(r) => r.clone(),
        None => Value::Null,
    }
}

/// GET /api/ocr/layout?fornitoreId=..&tipo=.. — ruoli colonne memorizzati.
async fn layout_get(State(state): State<AppState>, Query(q): Query<LayoutQuery>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let tipo = q.tipo.unwrap_or_else(|| "FATTURA".into());
    Ok(Json(json!({ "ruoli": layout_riga(&conn, q.fornitore_id, &tipo)? })))
}

/// POST /api/ocr/layout — body { fornitoreId, tipo, ruoli: [...] }.
/// Memorizza come sono disposte le colonne nei documenti di quel fornitore.
async fn layout_save(State(state): State<AppState>, Json(b): Json<Value>) -> ApiResult<Json<Value>> {
    let Some(fid) = web::opt_i64(&b, "fornitoreId").filter(|v| *v > 0) else {
        return Err(ApiError::bad_request("Serve un fornitore per ricordare le colonne."));
    };
    let tipo = web::str_or(&b, "tipo", "FATTURA");
    let ruoli = b
        .get("ruoli")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(","))
        .unwrap_or_default();

    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    conn.execute(
        "INSERT INTO fornitore_layout_riga (fornitore_id, tipo_documento, ruoli) VALUES (?1,?2,?3) \
         ON CONFLICT(fornitore_id, tipo_documento) DO UPDATE SET ruoli=excluded.ruoli",
        params![fid, tipo, ruoli],
    )?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(serde::Deserialize)]
struct LayoutQuery {
    #[serde(rename = "fornitoreId")]
    fornitore_id: Option<i64>,
    tipo: Option<String>,
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

/// POST /api/ocr/ddt/conferma — crea un ARRIVO MERCE dal DDT letto.
/// body: { fornitore, pIva, dataDoc, numero, righe: [{descrizione,quantita,prezzo,prodottoId?,codice?}] }
///
/// È il gesto che fa entrare la merce in magazzino: le giacenze si muovono qui,
/// non alla fattura. Sui DDT il prezzo spesso manca; quando c'è, aggiorna il
/// costo d'acquisto del prodotto come farebbe la fattura.
async fn conferma_ddt(State(state): State<AppState>, Json(b): Json<Value>) -> ApiResult<Json<Value>> {
    let fornitore = web::str_field(&b, "fornitore");
    let p_iva = web::str_field(&b, "pIva");
    let data_doc = web::str_field(&b, "dataDoc");
    let numero_ddt = web::str_field(&b, "numero");
    let righe = b.get("righe").and_then(Value::as_array).cloned().unwrap_or_default();
    if fornitore.trim().is_empty() || data_doc.trim().is_empty() || righe.is_empty() {
        return Err(ApiError::bad_request("fornitore, dataDoc e righe sono obbligatori"));
    }

    let conn = tenant_conn(&state)?;
    let mut conn = conn.lock().unwrap();

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

    // Stesso DDT letto due volte: l'arrivo esiste già, la merce è già entrata.
    if !numero_ddt.trim().is_empty() {
        if let Some(id) = conn
            .query_row(
                "SELECT id FROM arrivi_merce WHERE numero_documento_fornitore=?1 AND fornitore_id=?2",
                params![numero_ddt.trim(), fornitore_id],
                |r| r.get::<_, i64>(0),
            )
            .optional()?
        {
            return Err(ApiError::Body(
                StatusCode::CONFLICT,
                json!({ "error": "Questo DDT è già stato caricato", "arrivoId": id }),
            ));
        }
    }

    let numero = crate::numerazione::get_next_numero(&conn, "arrivi_merce", "arrivi_merce", 0)?;
    let magazzino_id = crate::stock::magazzino_default_id(&conn)?;

    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO arrivi_merce (numero, data, fornitore_id, numero_documento_fornitore, note, stato, magazzino_id) \
         VALUES (?1,?2,?3,?4,?5,'RICEVUTO',?6)",
        params![
            numero,
            data_doc.trim(),
            fornitore_id,
            numero_ddt.trim(),
            "Importato da lettura DDT",
            magazzino_id
        ],
    )?;
    let arrivo_id = tx.last_insert_rowid();

    let mut abbinate = 0i64;
    let mut righe_stock: Vec<Value> = Vec::new();
    for r in &righe {
        let descrizione = web::str_field(r, "descrizione");
        let quantita = {
            let q = web::num_or(r, "quantita", 1.0);
            if q > 0.0 { q } else { 1.0 }
        };
        let prezzo = web::num_or(r, "prezzo", 0.0);
        let codice = web::str_field(r, "codice");
        let prodotto_id = web::opt_i64(r, "prodottoId").filter(|id| *id > 0);

        tx.execute(
            "INSERT INTO arrivi_merce_righe (arrivo_merce_id, prodotto_id, descrizione, codice_fornitore, quantita, prezzo_acquisto, magazzino_id) \
             VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![arrivo_id, prodotto_id, descrizione, codice.trim(), quantita, prezzo, magazzino_id],
        )?;

        if let Some(pid) = prodotto_id {
            abbinate += 1;
            memorizza_alias(&tx, fornitore_id, pid, &codice, &descrizione)?;
            // Sui DDT il prezzo di solito non c'è: si aggiorna solo quando c'è.
            if prezzo > 0.0 {
                upsert_prezzo_acquisto(&tx, pid, fornitore_id, Some(prezzo))?;
            }
            righe_stock.push(json!({ "prodottoId": pid, "quantita": quantita, "descrizione": descrizione }));
        }
    }

    // Carico a magazzino: è questo che distingue un arrivo merce da una fattura.
    if !righe_stock.is_empty() {
        let ctx = crate::stock::StockCtx {
            data: Some(data_doc.trim().to_string()),
            causale: "ARRIVO_MERCE".into(),
            documento_tipo: "ARRIVO_MERCE".into(),
            documento_id: Some(arrivo_id),
            documento_numero: numero.clone(),
            magazzino_id,
            fornitore_id: Some(fornitore_id),
            fornitore_nome: fornitore.trim().to_string(),
            ..Default::default()
        };
        crate::stock::applica_righe_stock(&tx, &righe_stock, 1, &ctx)?;
    }
    tx.commit()?;

    Ok(Json(json!({
        "arrivoId": arrivo_id,
        "numero": numero,
        "fornitoreId": fornitore_id,
        "righe": righe.len(),
        "abbinate": abbinate,
        "caricateInMagazzino": righe_stock.len(),
    })))
}

/// Memorizza l'abbinamento riga → prodotto per i documenti futuri dello stesso
/// fornitore. La chiave è il codice articolo se c'è, altrimenti la descrizione.
fn memorizza_alias(
    tx: &rusqlite::Transaction,
    fornitore_id: i64,
    prodotto_id: i64,
    codice: &str,
    descrizione: &str,
) -> rusqlite::Result<()> {
    let chiave_orig = if codice.trim().is_empty() { descrizione.to_string() } else { codice.trim().to_string() };
    let chiave = norm(&chiave_orig);
    if chiave.is_empty() {
        return Ok(());
    }
    tx.execute(
        "INSERT INTO fornitore_codice_alias (fornitore_id, prodotto_id, codice, codice_norm) VALUES (?1,?2,?3,?4) \
         ON CONFLICT(fornitore_id, codice_norm) DO UPDATE SET prodotto_id=excluded.prodotto_id, codice=excluded.codice",
        params![fornitore_id, prodotto_id, chiave_orig, chiave],
    )?;
    Ok(())
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
/// body: { fornitore, pIva, dataDoc, numero, arrivoId?, caricaMagazzino?, righe: [...] }
///
/// Le giacenze si muovono con l'arrivo merce, non con la fattura. Quindi:
///  - `arrivoId`: la fattura salda un DDT già caricato → l'arrivo si collega
///    all'acquisto e la merce NON entra di nuovo (era già entrata col DDT);
///  - `caricaMagazzino`: nessun DDT da collegare e la merce non è mai entrata →
///    si genera un arrivo merce insieme alla fattura e si carica il magazzino;
///  - nessuno dei due: si registra la sola fattura, come prima.
/// Per ogni riga abbinata a un prodotto memorizza l'abbinamento (così il documento
/// successivo dello stesso fornitore parte già collegato) e aggiorna il costo d'acquisto.
async fn conferma(State(state): State<AppState>, Json(b): Json<Value>) -> ApiResult<Json<Value>> {
    let fornitore = web::str_field(&b, "fornitore");
    let p_iva = web::str_field(&b, "pIva");
    let data_doc = web::str_field(&b, "dataDoc");
    let numero = web::str_field(&b, "numero");
    let righe = b.get("righe").and_then(Value::as_array).cloned().unwrap_or_default();
    let arrivo_da_collegare = web::opt_i64(&b, "arrivoId").filter(|v| *v > 0);
    let carica_magazzino = web::bool_field(&b, "caricaMagazzino");
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
    let mut righe_stock: Vec<Value> = Vec::new();
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
            memorizza_alias(&tx, fornitore_id, pid, &codice, &descrizione)?;
            // I prezzi della fattura aggiornano il costo d'acquisto in magazzino.
            upsert_prezzo_acquisto(&tx, pid, fornitore_id, Some(prezzo))?;
            righe_stock.push(json!({ "prodottoId": pid, "quantita": quantita, "descrizione": descrizione }));
        }
    }

    // La fattura salda un DDT già caricato: si collegano i due documenti, la
    // merce resta quella entrata col DDT.
    let mut arrivo_collegato = Value::Null;
    if let Some(aid) = arrivo_da_collegare {
        let agg = tx.execute(
            "UPDATE arrivi_merce SET acquisto_id=?1 WHERE id=?2 AND acquisto_id IS NULL",
            params![acquisto_id, aid],
        )?;
        if agg > 0 {
            arrivo_collegato = json!(aid);
        }
    }

    // Nessun DDT e l'utente ha chiesto di caricare: l'arrivo lo creiamo qui.
    let mut arrivo_creato = Value::Null;
    if arrivo_da_collegare.is_none() && carica_magazzino && !righe_stock.is_empty() {
        let numero_arrivo = crate::numerazione::get_next_numero(&tx, "arrivi_merce", "arrivi_merce", 0)?;
        let magazzino_id = crate::stock::magazzino_default_id(&tx)?;
        tx.execute(
            "INSERT INTO arrivi_merce (numero, data, fornitore_id, acquisto_id, numero_documento_fornitore, note, stato, magazzino_id) \
             VALUES (?1,?2,?3,?4,?5,?6,'RICEVUTO',?7)",
            params![numero_arrivo, data_doc.trim(), fornitore_id, acquisto_id, num_doc, "Generato dalla lettura della fattura", magazzino_id],
        )?;
        let arrivo_id = tx.last_insert_rowid();
        for r in &righe {
            if let Some(pid) = web::opt_i64(r, "prodottoId").filter(|id| *id > 0) {
                tx.execute(
                    "INSERT INTO arrivi_merce_righe (arrivo_merce_id, prodotto_id, descrizione, codice_fornitore, quantita, prezzo_acquisto, magazzino_id) \
                     VALUES (?1,?2,?3,?4,?5,?6,?7)",
                    params![
                        arrivo_id,
                        pid,
                        web::str_field(r, "descrizione"),
                        web::str_field(r, "codice").trim(),
                        web::num_or(r, "quantita", 1.0),
                        web::num_or(r, "prezzo", 0.0),
                        magazzino_id
                    ],
                )?;
            }
        }
        let ctx = crate::stock::StockCtx {
            data: Some(data_doc.trim().to_string()),
            causale: "ARRIVO_MERCE".into(),
            documento_tipo: "ARRIVO_MERCE".into(),
            documento_id: Some(arrivo_id),
            documento_numero: numero_arrivo,
            magazzino_id,
            fornitore_id: Some(fornitore_id),
            fornitore_nome: fornitore.trim().to_string(),
            ..Default::default()
        };
        crate::stock::applica_righe_stock(&tx, &righe_stock, 1, &ctx)?;
        arrivo_creato = json!(arrivo_id);
    }
    tx.commit()?;

    Ok(Json(json!({
        "acquistoId": acquisto_id,
        "fornitoreId": fornitore_id,
        "righe": righe.len(),
        "abbinate": abbinate,
        "arrivoCollegato": arrivo_collegato,
        "arrivoCreato": arrivo_creato,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(include_str!("../schema/tenant.sql")).unwrap();
        c.execute("INSERT INTO fornitori (id, ragione_sociale, p_iva) VALUES (1,'ACME','00743110157')", [])
            .unwrap();
        c
    }

    /// Un DDT già fatturato non deve ricomparire tra i candidati: collegarlo una
    /// seconda volta significherebbe fatturare due volte la stessa consegna.
    #[test]
    fn propone_solo_gli_arrivi_non_ancora_fatturati() {
        let c = db();
        c.execute(
            "INSERT INTO arrivi_merce (id, numero, data, fornitore_id, numero_documento_fornitore) \
             VALUES (10,'AM-1','2026-09-02',1,'445')",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO acquisti (id, numero, data_emissione, fornitore_id) VALUES (99,'F-1','2026-09-30',1)",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO arrivi_merce (id, numero, data, fornitore_id, numero_documento_fornitore, acquisto_id) \
             VALUES (11,'AM-2','2026-09-03',1,'446',99)",
            [],
        )
        .unwrap();

        let liberi = arrivi_per_numero(&c, Some(1), "445").unwrap();
        assert_eq!(liberi.len(), 1);
        assert_eq!(liberi[0]["id"], 10);

        let fatturato = arrivi_per_numero(&c, Some(1), "446").unwrap();
        assert!(fatturato.is_empty(), "un arrivo già fatturato non va riproposto");
    }

    /// I fornitori scrivono lo stesso numero in modi diversi.
    #[test]
    fn il_numero_del_ddt_si_confronta_con_tolleranza() {
        let c = db();
        c.execute(
            "INSERT INTO arrivi_merce (id, numero, data, fornitore_id, numero_documento_fornitore) \
             VALUES (10,'AM-1','2026-09-02',1,'DDT 445/A')",
            [],
        )
        .unwrap();
        assert_eq!(arrivi_per_numero(&c, Some(1), "445").unwrap().len(), 1);
        assert!(arrivi_per_numero(&c, Some(1), "999").unwrap().is_empty());
    }

    /// I ruoli delle colonne si ricordano per fornitore e tipo di documento.
    #[test]
    fn ricorda_le_colonne_per_fornitore_e_tipo() {
        let c = db();
        assert_eq!(layout_riga(&c, Some(1), "FATTURA").unwrap(), Value::Null);
        c.execute(
            "INSERT INTO fornitore_layout_riga (fornitore_id, tipo_documento, ruoli) \
             VALUES (1,'FATTURA','codice,descrizione,quantita,prezzo')",
            [],
        )
        .unwrap();
        let ruoli = layout_riga(&c, Some(1), "FATTURA").unwrap();
        assert_eq!(ruoli[0], "codice");
        assert_eq!(ruoli[3], "prezzo");
        // Il DDT dello stesso fornitore ha un layout suo.
        assert_eq!(layout_riga(&c, Some(1), "DDT").unwrap(), Value::Null);
    }
}
