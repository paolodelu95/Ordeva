//! /api/fattura-xml — generazione/validazione XML FatturaPA e invio SDI.
//! Parità con routes/fatturaXml.js.

use std::collections::HashSet;

use axum::{
    extract::{Path, State},
    http::header,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use rusqlite::OptionalExtension;
use serde_json::{json, Value};

use crate::db::AppState;
use crate::error::{ApiError, ApiResult};
use crate::web::{num, oggi, tenant_conn};
use crate::xml::{build_fattura_pa, country_code_opt, tipo_fattura};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/:id", get(get_xml))
        .route("/:id/validate", get(validate))
        .route("/:id/invia-sdi", post(invia_sdi))
        .route("/nota-credito/:id", get(get_xml_nota))
        .route("/nota-credito/:id/validate", get(validate_nota))
        .route("/nota-credito/:id/invia-sdi", post(invia_sdi_nota))
}

fn safe_name(numero: &str) -> String {
    numero.chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' }).collect()
}

fn xml_response(xml: String, filename: String) -> Response {
    (
        [
            (header::CONTENT_TYPE, "application/xml; charset=utf-8".to_string()),
            (header::CONTENT_DISPOSITION, format!("attachment; filename=\"{filename}\"")),
        ],
        xml,
    )
        .into_response()
}

async fn get_xml(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Response> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let numero: Option<String> = conn.query_row("SELECT numero FROM fatture WHERE id=?1", [id], |r| r.get(0)).optional()?.flatten();
    let numero = numero.ok_or_else(|| ApiError::not_found("Not found"))?;
    let xml = build_fattura_pa(&conn, id, false).map_err(ApiError::from)?;
    Ok(xml_response(xml, format!("FatturaPA_{}.xml", safe_name(&numero))))
}

async fn get_xml_nota(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Response> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let numero: Option<String> = conn.query_row("SELECT numero FROM note_credito WHERE id=?1", [id], |r| r.get(0)).optional()?.flatten();
    let numero = numero.ok_or_else(|| ApiError::not_found("Not found"))?;
    let xml = build_fattura_pa(&conn, id, true).map_err(ApiError::from)?;
    Ok(xml_response(xml, format!("NotaCredito_{}.xml", safe_name(&numero))))
}

// ── invio SDI ────────────────────────────────────────────────────────────────

async fn invia_sdi(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    invia(state, id, false).await
}
async fn invia_sdi_nota(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    invia(state, id, true).await
}

async fn invia(state: AppState, id: i64, is_nota: bool) -> ApiResult<Json<Value>> {
    // Config SDI + XML costruiti tenendo la connessione solo il minimo indispensabile.
    let (sdi_url, sdi_key, p_iva, numero, xml) = {
        let conn = tenant_conn(&state)?;
        let conn = conn.lock().unwrap();
        let (url, key, piva) = conn.query_row("SELECT sdi_api_url, sdi_api_key, p_iva FROM azienda WHERE id=1", [], |r| {
            Ok((
                r.get::<_, Option<String>>(0)?.unwrap_or_default(),
                r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                r.get::<_, Option<String>>(2)?.unwrap_or_default(),
            ))
        })?;
        if url.is_empty() || key.is_empty() {
            return Err(ApiError::bad_request("API SDI non configurata. Vai in Impostazioni → SDI."));
        }
        let table = if is_nota { "note_credito" } else { "fatture" };
        let numero: Option<String> = conn.query_row(&format!("SELECT numero FROM {table} WHERE id=?1"), [id], |r| r.get(0)).optional()?.flatten();
        let numero = numero.ok_or_else(|| ApiError::not_found(if is_nota { "Nota di credito non trovata" } else { "Fattura non trovata" }))?;
        let xml = build_fattura_pa(&conn, id, is_nota).map_err(ApiError::from)?;
        (url, key, piva, numero, xml)
    };
    let p_iva_clean: String = p_iva.strip_prefix("IT").or_else(|| p_iva.strip_prefix("it")).unwrap_or(&p_iva).chars().filter(|c| !c.is_whitespace()).collect();
    let filename = format!("IT{p_iva_clean}_{}.xml", safe_name(&numero));

    let client = reqwest::Client::new();
    let resp = client
        .post(&sdi_url)
        .header("Content-Type", "application/xml; charset=utf-8")
        .header("Authorization", format!("Bearer {sdi_key}"))
        .header("X-Filename", filename)
        .timeout(std::time::Duration::from_secs(20))
        .body(xml)
        .send()
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;
    if !resp.status().is_success() {
        let err_text = resp.text().await.unwrap_or_default();
        return Err(ApiError::Body(axum::http::StatusCode::BAD_GATEWAY, json!({ "error": format!("Errore API SDI: {err_text}") })));
    }
    let data: Value = resp.json().await.unwrap_or_else(|_| json!({}));
    let id_trasm = data.get("id").or_else(|| data.get("identifier")).or_else(|| data.get("progressivo"))
        .and_then(|v| v.as_str().map(str::to_string).or_else(|| v.as_i64().map(|n| n.to_string())))
        .unwrap_or_else(|| "0".to_string());
    {
        let conn = tenant_conn(&state)?;
        let conn = conn.lock().unwrap();
        let table = if is_nota { "note_credito" } else { "fatture" };
        conn.execute(
            &format!("UPDATE {table} SET stato_sdi='INVIATA', data_invio_sdi=?1, id_trasmissione_sdi=?2 WHERE id=?3"),
            rusqlite::params![oggi(), id_trasm, id],
        )?;
    }
    Ok(Json(json!({ "ok": true, "idTrasmissione": id_trasm })))
}

// ── validazione pre-invio ────────────────────────────────────────────────────

async fn validate(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    validate_doc(state, id, false).await
}
async fn validate_nota(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    validate_doc(state, id, true).await
}

async fn validate_doc(state: AppState, id: i64, is_nota: bool) -> ApiResult<Json<Value>> {
    let table = if is_nota { "note_credito" } else { "fatture" };
    let righe_table = if is_nota { "note_credito_righe" } else { "fatture_righe" };
    let fk_col = if is_nota { "nota_credito_id" } else { "fattura_id" };
    let doc = if is_nota { "Nota di credito" } else { "Fattura" };

    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let f = conn
        .query_row(
            &format!(
                "SELECT f.numero, f.data_emissione, f.stato, f.stato_sdi, f.note, f.cliente_id, \
                        c.ragione_sociale, c.p_iva, c.codice_fiscale, c.via, c.cap, c.citta, c.provincia, c.sdi, c.pec, c.tipo_soggetto, \
                        f.bollo, c.stato \
                 FROM {table} f LEFT JOIN clienti c ON c.id=f.cliente_id WHERE f.id=?1"
            ),
            [id],
            |r| {
                let s = |i: usize| r.get::<_, Option<String>>(i).map(|o| o.unwrap_or_default());
                Ok(Fatt {
                    numero: s(0)?, data_emissione: s(1)?, stato: s(2)?, stato_sdi: s(3)?, note: s(4)?,
                    cliente_id: r.get::<_, Option<i64>>(5)?,
                    ragione_sociale: s(6)?, p_iva: s(7)?, codice_fiscale: s(8)?, via: s(9)?, cap: s(10)?,
                    citta: s(11)?, provincia: s(12)?, sdi: s(13)?, pec: s(14)?, tipo_soggetto: s(15)?,
                    bollo: r.get::<_, Option<i64>>(16)? == Some(1),
                    c_stato: s(17)?,
                })
            },
        )
        .optional()?;
    let f = f.ok_or_else(|| ApiError::not_found(format!("{doc} non trovata")))?;
    // NB: azienda usa la colonna `indirizzo`, non `via`. Node legge `az.via`
    // (inesistente → undefined → sempre "indirizzo incompleto"): replico lasciando via="".
    let az = conn
        .query_row("SELECT ragione_sociale, p_iva, cap, citta, regime_fiscale, iban, email FROM azienda WHERE id=1", [], |r| {
            let s = |i: usize| r.get::<_, Option<String>>(i).map(|o| o.unwrap_or_default());
            Ok(Az { ragione_sociale: s(0)?, p_iva: s(1)?, via: String::new(), cap: s(2)?, citta: s(3)?, regime_fiscale: s(4)?, iban: s(5)?, email: s(6)? })
        })
        .optional()?
        .unwrap_or_default();

    let mut errors: Vec<String> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();

    let tipo_sogg = if f.tipo_soggetto.is_empty() { "AZIENDA".to_string() } else { f.tipo_soggetto.to_uppercase() };
    let piva_clean = clean_piva(&f.p_iva);
    let cf_clean = clean_cf(&f.codice_fiscale);

    // CLIENTE
    // "Stato" e' un campo libero in anagrafica: qualsiasi valore diverso da
    // vuoto/"Italia" segna il cliente come estero, a prescindere dal fatto che
    // il nome sia tra quelli che sappiamo tradurre in codice ISO (country_code_opt,
    // usato dalla generazione XML). Se non lo riconosciamo avvisiamo qui, perche'
    // altrimenti l'XML ricadrebbe silenziosamente su IT.
    let stato_trim = f.c_stato.trim();
    let is_estero = !stato_trim.is_empty() && stato_trim.to_lowercase() != "italia";
    if is_estero && country_code_opt(stato_trim).is_none() {
        warnings.push(format!(
            "Cliente: stato \"{}\" non riconosciuto — nell'XML verrà scritto come IT finché non usi un nome di stato riconosciuto (es. \"Germania\", \"Francia\", \"Stati Uniti\").",
            f.c_stato
        ));
    }

    if f.cliente_id.is_none() {
        errors.push("Cliente mancante.".into());
    } else {
        if f.ragione_sociale.trim().is_empty() {
            errors.push("Cliente: ragione sociale mancante.".into());
        } else if f.ragione_sociale.chars().count() > 80 {
            errors.push(format!("Cliente: ragione sociale > 80 char ({}).", f.ragione_sociale.chars().count()));
        }
        if piva_clean.is_empty() && cf_clean.is_empty() {
            errors.push("Cliente: serve P.IVA o Codice Fiscale per la fattura elettronica.".into());
        } else {
            if !piva_clean.is_empty() && !is_estero && !is_11_digits(&piva_clean) {
                errors.push(format!("P.IVA cliente non valida: \"{}\" (11 cifre richieste).", f.p_iva));
            }
            if !cf_clean.is_empty() && !is_estero && cf_clean.len() != 11 && cf_clean.len() != 16 {
                errors.push(format!("Codice Fiscale cliente non valido: \"{}\" (deve essere 11 o 16 caratteri).", f.codice_fiscale));
            }
            if !is_estero && cf_clean.len() == 16 && !cf_clean.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()) {
                errors.push(format!("Codice Fiscale \"{}\" contiene caratteri non validi (atteso A-Z, 0-9).", f.codice_fiscale));
            }
        }
        if f.via.trim().is_empty() {
            errors.push("Cliente: indirizzo (via) mancante — obbligatorio per SDI.".into());
        }
        if f.cap.trim().is_empty() {
            errors.push("Cliente: CAP mancante.".into());
        } else if !is_estero && !is_5_digits(f.cap.trim()) {
            errors.push(format!("Cliente: CAP \"{}\" non valido (5 cifre).", f.cap));
        }
        if f.citta.trim().is_empty() {
            errors.push("Cliente: citta mancante.".into());
        }
        if !is_estero && !f.provincia.is_empty() && !is_2_alpha(&f.provincia.trim().to_uppercase()) {
            warnings.push(format!("Cliente: provincia \"{}\" non standard (2 lettere maiuscole).", f.provincia));
        }
        let sdi = f.sdi.trim().to_uppercase();
        let pec = f.pec.trim().to_string();
        if sdi.is_empty() && pec.is_empty() {
            if is_estero {
                warnings.push("Cliente estero senza codice SDI ne PEC: la fattura verra recapitata con destinatario convenzionale XXXXXXX (consultabile dal cassetto fiscale).".into());
            } else {
                warnings.push("Cliente senza codice SDI ne PEC: la fattura verra recapitata con destinatario default 0000000 (consultabile dal cassetto fiscale).".into());
            }
        } else {
            if !sdi.is_empty() {
                if tipo_sogg == "PA" {
                    if sdi.chars().count() != 6 {
                        errors.push(format!("Cliente PA: codice SDI deve essere di 6 caratteri (attuale \"{}\" = {}).", sdi, sdi.chars().count()));
                    }
                } else if sdi != "0000000" && sdi.chars().count() != 7 {
                    errors.push(format!("Cliente B2B/B2C: codice SDI deve essere di 7 caratteri (attuale \"{}\" = {}).", sdi, sdi.chars().count()));
                }
                if !sdi.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()) {
                    errors.push(format!("Codice SDI \"{}\" contiene caratteri non validi.", sdi));
                }
            }
            if !pec.is_empty() && !is_email(&pec) {
                errors.push(format!("PEC cliente non valida: \"{}\".", pec));
            }
        }
        if tipo_sogg == "PRIVATO" && cf_clean.is_empty() {
            warnings.push("Cliente PRIVATO senza Codice Fiscale: di solito necessario per SDI.".into());
        }
    }

    // AZIENDA
    if az.ragione_sociale.trim().is_empty() {
        errors.push("Ragione sociale azienda mancante (Impostazioni → Azienda).".into());
    }
    let piva_az = clean_piva(&az.p_iva);
    if piva_az.is_empty() || !is_11_digits(&piva_az) {
        errors.push("P.IVA azienda mancante o non valida.".into());
    }
    if az.via.trim().is_empty() || az.cap.trim().is_empty() || az.citta.trim().is_empty() {
        errors.push("Indirizzo azienda incompleto (via/CAP/citta) — obbligatorio.".into());
    }
    if !az.cap.is_empty() && !is_5_digits(az.cap.trim()) {
        errors.push(format!("CAP azienda \"{}\" non valido.", az.cap));
    }
    if !az.regime_fiscale.is_empty() && !REGIMI.contains(&az.regime_fiscale.trim().to_uppercase().as_str()) {
        errors.push(format!("Regime fiscale \"{}\" non valido (atteso RF01..RF19).", az.regime_fiscale));
    } else if az.regime_fiscale.is_empty() {
        warnings.push("Regime fiscale azienda non impostato (default RF01 - ordinario).".into());
    }
    if !az.iban.is_empty() && !is_iban(&az.iban.replace(char::is_whitespace, "").to_uppercase()) {
        warnings.push(format!("IBAN azienda \"{}\" formato non valido (atteso ITxx X xxxxx xxxxx xxxxxxxxxxxx).", az.iban));
    }
    if !az.email.is_empty() && !is_email(&az.email) {
        warnings.push(format!("Email azienda \"{}\" non valida.", az.email));
    }

    // INTESTAZIONE
    if f.numero.trim().is_empty() {
        errors.push("Numero documento mancante.".into());
    } else if f.numero.chars().count() > 20 {
        errors.push(format!("Numero documento > 20 caratteri ({}).", f.numero.chars().count()));
    }
    if f.data_emissione.is_empty() {
        errors.push("Data emissione mancante.".into());
    } else if !is_iso_date(&f.data_emissione.chars().take(10).collect::<String>()) {
        errors.push(format!("Data emissione \"{}\" non in formato YYYY-MM-DD.", f.data_emissione));
    } else if f.data_emissione.chars().take(10).collect::<String>().as_str() > oggi().as_str() {
        warnings.push("Data emissione futura.".into());
    }
    if !f.note.is_empty() && f.note.chars().count() > 200 {
        warnings.push(format!("Note > 200 caratteri ({}): SDI tronca il campo Causale.", f.note.chars().count()));
    }

    // RIGHE
    let mut stmt = conn.prepare(&format!(
        "SELECT descrizione, quantita, prezzo, iva, codice_iva, sconto, tipo FROM {righe_table} WHERE {fk_col}=?1 ORDER BY id"
    ))?;
    let righe = stmt
        .query_map([id], |r| {
            Ok((
                r.get::<_, Option<String>>(0)?,
                r.get::<_, Option<f64>>(1)?,
                r.get::<_, Option<f64>>(2)?,
                r.get::<_, Option<f64>>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, Option<f64>>(5)?,
                r.get::<_, Option<String>>(6)?.unwrap_or_default(),
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    if righe.iter().all(|r| r.6 == "NOTA") {
        errors.push("Nessuna riga nel documento.".into());
    }
    let mut totale_calcolato = 0.0;
    let mut natura_mancante: Vec<usize> = Vec::new();
    let mut natura_set: HashSet<usize> = HashSet::new();
    // Bollo virtuale: dovuto (di norma) quando il totale delle operazioni escluse/non
    // soggette/esenti (N1, N2.x, N4 — non N3 "non imponibili" tipo esportazioni, ne
    // N5/N6/N7 che hanno un trattamento diverso) supera 77,47€ e non e' gia' segnato
    // in fattura. E' un avviso, non un blocco: il caso reale ha eccezioni che qui non
    // proviamo a coprire tutte.
    const NATURE_BOLLO: [&str; 5] = ["N1", "N2", "N2.1", "N2.2", "N4"];
    let mut imponibile_bollo = 0.0;
    for (i, (descr, qta, prezzo, iva, codice_iva, sconto, tipo)) in righe.iter().enumerate() {
        let n = i + 1;
        // Righe descrittive ("Riferimento DDT n. …"): non vanno nell'XML come
        // linee, quindi quantità, prezzo e natura non si controllano.
        if tipo == "NOTA" {
            continue;
        }
        // Da 0 € a IVA 0% senza aliquota: è solo testo, la generazione XML la
        // lascia fuori (vedi xml.rs), qui non va segnalata come Natura mancante.
        if iva.unwrap_or(-1.0) == 0.0
            && codice_iva.as_deref().map(str::trim).unwrap_or("").is_empty()
            && qta.unwrap_or(1.0) * prezzo.unwrap_or(0.0) == 0.0
        {
            continue;
        }
        let descr = descr.clone().unwrap_or_default();
        if descr.trim().is_empty() {
            errors.push(format!("Riga {n}: descrizione vuota."));
        } else if descr.chars().count() > 1000 {
            errors.push(format!("Riga {n}: descrizione > 1000 caratteri."));
        }
        if qta.is_none() || qta.unwrap_or(0.0) == 0.0 {
            warnings.push(format!("Riga {n}: quantita zero o mancante."));
        }
        if prezzo.is_none() || prezzo.unwrap_or(0.0) < 0.0 {
            errors.push(format!("Riga {n}: prezzo negativo o mancante."));
        }
        let ivav = iva.unwrap_or(-1.0);
        if iva.is_none() || ivav < 0.0 || ivav > 100.0 {
            errors.push(format!("Riga {n}: IVA fuori range ({}).", js_opt_num(iva)));
        }
        let sc = sconto.unwrap_or(0.0);
        if iva.unwrap_or(-1.0) == 0.0 {
            // Il codice riga (es. "E10", "X15", "RF") e' un mnemonico che punta ad
            // aliquote_iva: la Natura SDI vera e' in aliquote_iva.natura, NON è il
            // codice stesso (prima si confrontava il mnemonico con N1..N7: non
            // coincidono quasi mai, quindi righe con aliquote di serie valide
            // finivano rifiutate qui pur generando un XML corretto).
            let codice = codice_iva.clone().unwrap_or_default();
            let codice_trim = codice.trim();
            if codice_trim.is_empty() {
                if natura_set.insert(n) {
                    natura_mancante.push(n);
                }
            } else {
                let natura_db: Option<String> = conn
                    .query_row("SELECT natura FROM aliquote_iva WHERE codice=?1", [codice_trim], |r| r.get::<_, Option<String>>(0))
                    .optional()?
                    .flatten();
                match natura_db {
                    None => errors.push(format!("Riga {n}: codice IVA \"{}\" non trovato in Anagrafiche → Aliquote IVA.", codice_trim)),
                    Some(nat) if nat.trim().is_empty() => {
                        if natura_set.insert(n) {
                            natura_mancante.push(n);
                        }
                    }
                    Some(nat) => {
                        let nat_up = nat.trim().to_uppercase();
                        if !NATURE.contains(&nat_up.as_str()) && !is_natura_regex(&nat_up) {
                            errors.push(format!("Riga {n}: Natura \"{}\" (da aliquota \"{}\") non riconosciuta (atteso N1..N7).", nat, codice_trim));
                        } else if NATURE_BOLLO.contains(&nat_up.as_str()) {
                            imponibile_bollo += qta.unwrap_or(0.0) * prezzo.unwrap_or(0.0) * (1.0 - sc / 100.0);
                        }
                    }
                }
            }
        }
        if sc < 0.0 || sc > 100.0 {
            errors.push(format!("Riga {n}: sconto fuori range ({}%).", js_num(sc)));
        }
        totale_calcolato += qta.unwrap_or(0.0) * prezzo.unwrap_or(0.0) * (1.0 - sc / 100.0) * (1.0 + iva.unwrap_or(0.0) / 100.0);
    }
    drop(stmt);
    if !natura_mancante.is_empty() {
        let list = natura_mancante.iter().map(|n| n.to_string()).collect::<Vec<_>>().join(", ");
        errors.push(format!("Righe {list}: con IVA 0% serve un'aliquota con Natura impostata (N1=escluse, N2=non soggette, N3=non imponibili, N4=esenti, N6=reverse charge, N7=IVA estera)."));
    }
    if imponibile_bollo > 77.47 && !f.bollo {
        warnings.push(format!(
            "Operazioni escluse/non soggette/esenti per {:.2}€ (> 77,47€): valuta se serve il bollo virtuale (non risulta segnato su questo documento).",
            imponibile_bollo
        ));
    }
    if totale_calcolato == 0.0 {
        warnings.push("Totale fattura zero.".into());
    }

    // TIPO DOCUMENTO (fatture): immediata TD01 o differita TD24
    if !is_nota {
        let tf = tipo_fattura(&conn, id).map_err(ApiError::from)?;
        let data_f: String = f.data_emissione.chars().take(10).collect();
        let dmy = |d: &str| {
            let p: Vec<&str> = d.split('-').collect();
            if p.len() == 3 { format!("{}/{}/{}", p[2], p[1], p[0]) } else { d.to_string() }
        };
        let ddt_datati: Vec<(&str, String)> = tf
            .ddt
            .iter()
            .map(|(n, d)| (n.as_str(), d.chars().take(10).collect::<String>()))
            .filter(|(_, d)| is_iso_date(d))
            .collect();
        for (n, d) in &ddt_datati {
            if d.as_str() > data_f.as_str() {
                warnings.push(format!("DDT n. {n} del {} è successivo alla data della fattura.", dmy(d)));
            }
        }
        let anteriori = ddt_datati.iter().any(|(_, d)| d.as_str() < data_f.as_str());
        if tf.effettivo == "TD24" {
            if tf.ddt.is_empty() {
                warnings.push("Fattura differita (TD24) senza DDT collegati né riferimenti DDT: per una cessione di beni vanno indicati i documenti di trasporto.".into());
            }
            // Termine: entro il 15 del mese successivo alla consegna più vecchia.
            if let Some((n, d)) = ddt_datati.iter().filter(|(_, d)| d.as_str() < data_f.as_str()).min_by(|a, b| a.1.cmp(&b.1)) {
                if let (Ok(y), Ok(m)) = (d[0..4].parse::<i32>(), d[5..7].parse::<u32>()) {
                    let (y2, m2) = if m == 12 { (y + 1, 1) } else { (y, m + 1) };
                    let limite = format!("{y2:04}-{m2:02}-15");
                    if data_f > limite {
                        warnings.push(format!(
                            "Fattura differita emessa oltre il termine: per il DDT n. {n} del {} andava emessa entro il {}.",
                            dmy(d),
                            dmy(&limite)
                        ));
                    }
                }
            }
        } else if tf.scelto == "TD01" && anteriori {
            warnings.push("Hai scelto fattura immediata (TD01) ma ci sono DDT con data precedente alla fattura: di norma è una fattura differita (TD24).".into());
        }
    }

    // STATO
    if f.stato == "ANNULLATA" {
        errors.push(format!("{doc} annullata: non puo essere inviata a SDI."));
    }
    if f.stato_sdi == "INVIATA" {
        warnings.push(format!("{doc} gia inviata a SDI in precedenza."));
    }

    // XML
    let mut xml_valido: Value = Value::Null;
    let mut xml_size = 0i64;
    match build_fattura_pa(&conn, id, is_nota) {
        Ok(xml) => {
            xml_size = xml.len() as i64;
            xml_valido = Value::Bool(true);
        }
        Err(e) => {
            xml_valido = Value::Bool(false);
            errors.push(format!("Errore generazione/parse XML: {e}"));
        }
    }
    if xml_size > 5 * 1024 * 1024 {
        warnings.push(format!("File XML grande ({:.2}MB): SDI max 5MB.", xml_size as f64 / 1024.0 / 1024.0));
    }

    Ok(Json(json!({
        "ok": errors.is_empty(),
        "errors": errors,
        "warnings": warnings,
        "totaleCalcolato": num((totale_calcolato * 100.0).round() / 100.0),
        "xmlValido": xml_valido,
        "xmlSize": xml_size,
    })))
}

// ── strutture + helper validazione ───────────────────────────────────────────

struct Fatt {
    numero: String,
    data_emissione: String,
    stato: String,
    stato_sdi: String,
    note: String,
    cliente_id: Option<i64>,
    ragione_sociale: String,
    p_iva: String,
    codice_fiscale: String,
    via: String,
    cap: String,
    citta: String,
    provincia: String,
    sdi: String,
    pec: String,
    tipo_soggetto: String,
    bollo: bool,
    c_stato: String,
}

#[derive(Default)]
struct Az {
    ragione_sociale: String,
    p_iva: String,
    via: String,
    cap: String,
    citta: String,
    regime_fiscale: String,
    iban: String,
    email: String,
}

const REGIMI: [&str; 18] = ["RF01","RF02","RF04","RF05","RF06","RF07","RF08","RF09","RF10","RF11","RF12","RF13","RF14","RF15","RF16","RF17","RF18","RF19"];
const NATURE: [&str; 24] = ["N1","N2","N2.1","N2.2","N3","N3.1","N3.2","N3.3","N3.4","N3.5","N3.6","N4","N5","N6","N6.1","N6.2","N6.3","N6.4","N6.5","N6.6","N6.7","N6.8","N6.9","N7"];

fn clean_piva(s: &str) -> String {
    let s = s.strip_prefix("IT").or_else(|| s.strip_prefix("it")).unwrap_or(s);
    s.chars().filter(|c| !c.is_whitespace()).collect()
}
fn clean_cf(s: &str) -> String {
    s.chars().filter(|c| !c.is_whitespace()).collect::<String>().to_uppercase()
}
fn is_11_digits(s: &str) -> bool {
    s.len() == 11 && s.bytes().all(|b| b.is_ascii_digit())
}
fn is_5_digits(s: &str) -> bool {
    s.len() == 5 && s.bytes().all(|b| b.is_ascii_digit())
}
fn is_2_alpha(s: &str) -> bool {
    s.len() == 2 && s.bytes().all(|b| b.is_ascii_uppercase())
}
fn is_email(s: &str) -> bool {
    // /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    let parts: Vec<&str> = s.split('@').collect();
    if parts.len() != 2 {
        return false;
    }
    let (local, domain) = (parts[0], parts[1]);
    !local.is_empty()
        && !local.chars().any(|c| c.is_whitespace())
        && domain.contains('.')
        && !domain.chars().any(|c| c.is_whitespace())
        && domain.split('.').next_back().map(|t| !t.is_empty()).unwrap_or(false)
        && domain.split('.').next().map(|t| !t.is_empty()).unwrap_or(false)
}
fn is_iban(s: &str) -> bool {
    // /^IT\d{2}[A-Z]\d{10}[A-Z0-9]{12}$/
    let b = s.as_bytes();
    if b.len() != 27 {
        return false;
    }
    &s[0..2] == "IT"
        && b[2].is_ascii_digit() && b[3].is_ascii_digit()
        && b[4].is_ascii_uppercase()
        && b[5..15].iter().all(u8::is_ascii_digit)
        && b[15..27].iter().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
}
fn is_iso_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10 && b[4] == b'-' && b[7] == b'-'
        && b[0..4].iter().all(u8::is_ascii_digit)
        && b[5..7].iter().all(u8::is_ascii_digit)
        && b[8..10].iter().all(u8::is_ascii_digit)
}
fn is_natura_regex(s: &str) -> bool {
    // /^N\d(\.\d)?$/
    let b = s.as_bytes();
    match b.len() {
        2 => b[0] == b'N' && b[1].is_ascii_digit(),
        4 => b[0] == b'N' && b[1].is_ascii_digit() && b[2] == b'.' && b[3].is_ascii_digit(),
        _ => false,
    }
}
fn js_num(v: f64) -> String {
    if v.fract() == 0.0 { format!("{}", v as i64) } else { format!("{v}") }
}
fn js_opt_num(v: &Option<f64>) -> String {
    match v {
        Some(x) => js_num(*x),
        None => "null".into(),
    }
}
