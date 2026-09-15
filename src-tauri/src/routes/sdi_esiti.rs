//! /api/sdi-esiti — che fine hanno fatto le fatture trasmesse.
//!
//! Dopo l'invio lo SdI risponde con un file di notifica, che l'intermediario (o
//! la PEC) recapita a chi ha emesso: ricevuta di consegna, scarto con l'elenco
//! degli errori, mancata consegna, e per la PA l'accettazione o il rifiuto.
//! Senza leggerle, una fattura scartata resta "inviata" per sempre — e una
//! fattura scartata è una fattura NON emessa, con la sanzione che ne segue.
//!
//! Qui le notifiche si importano dal file, come già si fa per le fatture
//! passive: nessun account, nessuna API, nessuna chiave. Il documento a cui la
//! notifica si riferisce si ritrova dal nome del file trasmesso (che è quello
//! che generiamo noi) oppure dall'identificativo SdI già registrato all'invio.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use axum::body::Bytes;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

use crate::db::AppState;
use crate::error::{ApiError, ApiResult};
use crate::web::{oggi, tenant_conn};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(elenco))
        .route("/importa", post(importa))
        .route("/:tipo/:id", get(per_documento))
}

/// Le tabelle che possono ricevere una notifica, con la sigla usata nell'API.
const DOCUMENTI: [(&str, &str); 3] = [
    ("FATTURA", "fatture"),
    ("NOTA_CREDITO", "note_credito"),
    ("AUTOFATTURA", "autofatture"),
];

fn tabella(tipo: &str) -> Option<&'static str> {
    DOCUMENTI.iter().find(|(t, _)| *t == tipo).map(|(_, tab)| *tab)
}

/// Stato del documento corrispondente a ciascuna notifica. Sono le stesse
/// etichette che la schermata "Fatture elettroniche" già sa mostrare.
fn stato_da_tipo(tipo: &str, esito_committente: &str) -> &'static str {
    match tipo {
        "RC" => "CONSEGNATA",
        "NS" => "SCARTATA",
        "MC" => "MANCATA_CONSEGNA",
        "DT" => "DECORRENZA_TERMINI",
        "AT" => "NON_RECAPITABILE",
        // L'esito del committente vale solo per la PA: EC01 accetta, EC02 rifiuta.
        "NE" => {
            if esito_committente.eq_ignore_ascii_case("EC02") {
                "RIFIUTATA"
            } else {
                "ACCETTATA"
            }
        }
        _ => "INVIATA",
    }
}

/// Da quale radice XML si riconosce il tipo di notifica. Il nome del file
/// (`..._RC_001.xml`) è solo un aiuto: l'XML è la fonte attendibile.
fn tipo_da_radice(radice: &str) -> Option<&'static str> {
    match radice {
        "RicevutaConsegna" => Some("RC"),
        "NotificaScarto" => Some("NS"),
        "NotificaMancataConsegna" => Some("MC"),
        "NotificaEsito" => Some("NE"),
        "NotificaDecorrenzaTermini" => Some("DT"),
        "AttestazioneTrasmissioneFattura" => Some("AT"),
        _ => None,
    }
}

fn testo(n: roxmltree::Node, nome: &str) -> String {
    n.descendants()
        .find(|d| d.is_element() && d.tag_name().name() == nome)
        .and_then(|d| d.text())
        .unwrap_or_default()
        .trim()
        .to_string()
}

/// POST /api/sdi-esiti/importa — body: l'XML della notifica, oppure
/// `{ "xml": "...", "nomeFile": "..." }`. Ritorna che cosa ha capito e a quale
/// documento l'ha collegata.
async fn importa(State(state): State<AppState>, body: Bytes) -> ApiResult<Json<Value>> {
    let grezzo = String::from_utf8_lossy(&body).to_string();
    let (xml, nome_caricato) = {
        let t = grezzo.trim_start();
        if t.starts_with('{') {
            let v: Value = serde_json::from_str(t).unwrap_or_else(|_| json!({}));
            (
                v.get("xml").and_then(Value::as_str).unwrap_or_default().to_string(),
                v.get("nomeFile").and_then(Value::as_str).unwrap_or_default().to_string(),
            )
        } else {
            (grezzo.clone(), String::new())
        }
    };
    if xml.trim().is_empty() {
        return Err(ApiError::bad_request("XML mancante"));
    }
    if xml.len() > 2_000_000 {
        return Err(ApiError::Status(
            StatusCode::PAYLOAD_TOO_LARGE,
            "File troppo grande (max ~2MB)".into(),
        ));
    }

    let doc = roxmltree::Document::parse(&xml)
        .map_err(|e| ApiError::bad_request(format!("XML non leggibile: {e}")))?;
    let radice = doc.root_element().tag_name().name().to_string();
    let Some(tipo) = tipo_da_radice(&radice) else {
        return Err(ApiError::bad_request(format!(
            "Questo non è un file di notifica dello SdI (elemento radice \"{radice}\"). \
             Le fatture ricevute si importano invece da Fatture elettroniche → Ricevute."
        )));
    };
    let root = doc.root_element();

    let identificativo = testo(root, "IdentificativoSdI");
    let nome_file = {
        let n = testo(root, "NomeFile");
        if n.is_empty() { nome_caricato } else { n }
    };
    let data = {
        let d = [
            testo(root, "DataOraConsegna"),
            testo(root, "DataOraRicezione"),
            testo(root, "DataOraMessaAdisposizione"),
        ]
        .into_iter()
        .find(|s| !s.is_empty())
        .unwrap_or_default();
        // Le date SdI sono ISO con l'ora: per l'elenco basta il giorno.
        d.split('T').next().unwrap_or("").to_string()
    };
    let esito_committente = testo(root, "Esito");

    // Elenco errori dello scarto: sono il motivo, e vanno conservati per intero.
    let mut errori: Vec<Value> = Vec::new();
    for e in root.descendants().filter(|d| d.is_element() && d.tag_name().name() == "Errore") {
        errori.push(json!({
            "codice": testo(e, "Codice"),
            "descrizione": testo(e, "Descrizione"),
            "suggerimento": testo(e, "Suggerimento"),
        }));
    }
    let descrizione = if errori.is_empty() {
        testo(root, "Descrizione")
    } else {
        errori
            .iter()
            .map(|e| {
                let c = e["codice"].as_str().unwrap_or("");
                let d = e["descrizione"].as_str().unwrap_or("");
                if c.is_empty() { d.to_string() } else { format!("{c}: {d}") }
            })
            .collect::<Vec<_>>()
            .join(" · ")
    };

    let arc = tenant_conn(&state)?;
    let conn = arc.lock().unwrap();
    let trovato = collega(&conn, &identificativo, &nome_file)?;

    conn.execute(
        "INSERT OR REPLACE INTO sdi_notifiche \
         (tipo, identificativo_sdi, nome_file, data, descrizione, errori, documento_tipo, documento_id) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![
            tipo,
            identificativo,
            nome_file,
            data,
            descrizione,
            if errori.is_empty() { String::new() } else { Value::Array(errori.clone()).to_string() },
            trovato.as_ref().map(|(t, _)| *t).unwrap_or(""),
            trovato.as_ref().map(|(_, id)| *id),
        ],
    )?;

    let stato = stato_da_tipo(tipo, &esito_committente);
    if let Some((doc_tipo, doc_id)) = &trovato {
        let tab = tabella(doc_tipo).unwrap_or("fatture");
        conn.execute(
            &format!("UPDATE \"{tab}\" SET stato_sdi=?1 WHERE id=?2"),
            params![stato, doc_id],
        )?;
        // L'identificativo assegnato dallo SdI serve a legare le notifiche
        // successive: alla prima che arriva lo si registra sul documento.
        if !identificativo.is_empty() {
            conn.execute(
                &format!("UPDATE \"{tab}\" SET id_trasmissione_sdi=?1 WHERE id=?2 AND COALESCE(id_trasmissione_sdi,'') IN ('','0')"),
                params![identificativo, doc_id],
            )?;
        }
    }

    Ok(Json(json!({
        "tipo": tipo,
        "stato": stato,
        "identificativoSdi": identificativo,
        "nomeFile": nome_file,
        "data": data,
        "descrizione": descrizione,
        "errori": errori,
        "documentoTipo": trovato.as_ref().map(|(t, _)| *t),
        "documentoId": trovato.as_ref().map(|(_, id)| *id),
        // Notifica valida ma non abbinata: l'utente deve sapere che lo stato del
        // documento NON è stato aggiornato, altrimenti crede sia tutto a posto.
        "collegata": trovato.is_some(),
    })))
}

/// Trova il documento a cui la notifica si riferisce. Prima per identificativo
/// SdI (se è già stato registrato), poi per nome del file trasmesso: lo
/// generiamo noi come `IT<piva>_<numero>.xml`, quindi il numero è lì dentro.
fn collega(
    conn: &Connection,
    identificativo: &str,
    nome_file: &str,
) -> ApiResult<Option<(&'static str, i64)>> {
    if !identificativo.is_empty() {
        for (tipo, tab) in DOCUMENTI {
            let trovato: Option<i64> = conn
                .query_row(
                    &format!("SELECT id FROM \"{tab}\" WHERE id_trasmissione_sdi=?1"),
                    [identificativo],
                    |r| r.get(0),
                )
                .optional()?;
            if let Some(id) = trovato {
                return Ok(Some((tipo, id)));
            }
        }
    }
    let Some(numero) = numero_da_nome_file(nome_file) else { return Ok(None) };
    for (tipo, tab) in DOCUMENTI {
        let colonna_data = if tab == "autofatture" { "data" } else { "data_emissione" };
        // Il nome file non distingue "/" e altri segni: il numero è stato
        // ripulito in fase di invio, quindi si confronta ripulito anche qui.
        let trovato: Option<i64> = conn
            .query_row(
                &format!(
                    "SELECT id FROM \"{tab}\" WHERE REPLACE(REPLACE(REPLACE(numero,'/','_'),'.','_'),' ','_')=?1 \
                     ORDER BY {colonna_data} DESC LIMIT 1"
                ),
                [&numero],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(id) = trovato {
            return Ok(Some((tipo, id)));
        }
    }
    Ok(None)
}

/// Dal nome del file trasmesso ricava il numero del documento.
/// `IT01234567890_2026_0001.xml` → `2026_0001`; regge anche il suffisso della
/// notifica (`..._RC_001.xml`) e il progressivo dell'intermediario.
fn numero_da_nome_file(nome: &str) -> Option<String> {
    let base = nome.rsplit('/').next().unwrap_or(nome);
    let base = base.strip_suffix(".xml").or_else(|| base.strip_suffix(".XML")).unwrap_or(base);
    // Via il suffisso di notifica, che lo SdI aggiunge al nome del file inviato.
    let base = {
        let mut b = base.to_string();
        for sig in ["_RC_", "_NS_", "_MC_", "_NE_", "_DT_", "_AT_"] {
            if let Some(pos) = b.find(sig) {
                b.truncate(pos);
                break;
            }
        }
        b
    };
    // Via il prefisso "IT<partita iva>_": quello che resta è il numero.
    let resto = base.split_once('_').map(|(_, r)| r.to_string()).unwrap_or(base);
    if resto.trim().is_empty() {
        None
    } else {
        Some(resto)
    }
}

/// GET /api/sdi-esiti — i documenti trasmessi con il loro esito, e in testa
/// quelli che richiedono un intervento.
async fn elenco(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();

    let mut righe: Vec<Value> = Vec::new();
    for (tipo, tab) in DOCUMENTI {
        let colonna_data = if tab == "autofatture" { "data" } else { "data_emissione" };
        let mut stmt = conn.prepare(&format!(
            "SELECT id, numero, {colonna_data}, COALESCE(stato_sdi,''), COALESCE(data_invio_sdi,'') \
               FROM \"{tab}\" WHERE COALESCE(stato_sdi,'') NOT IN ('','NON_INVIATA')"
        ))?;
        let lette = stmt.query_map([], |r| {
            Ok(json!({
                "documentoTipo": tipo,
                "id": r.get::<_, i64>(0)?,
                "numero": r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                "data": r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                "statoSdi": r.get::<_, String>(3)?,
                "dataInvioSdi": r.get::<_, String>(4)?,
            }))
        })?;
        for r in lette {
            righe.push(r?);
        }
    }

    // Notifiche più recenti per documento: portano il motivo dello scarto.
    for r in righe.iter_mut() {
        let t = r["documentoTipo"].as_str().unwrap_or("");
        let id = r["id"].as_i64().unwrap_or(0);
        let ultima: Option<(String, String, String)> = conn
            .query_row(
                "SELECT tipo, COALESCE(descrizione,''), COALESCE(data,'') FROM sdi_notifiche \
                  WHERE documento_tipo=?1 AND documento_id=?2 ORDER BY id DESC LIMIT 1",
                params![t, id],
                |x| Ok((x.get(0)?, x.get(1)?, x.get(2)?)),
            )
            .optional()?;
        if let Some((tipo_n, descr, data)) = ultima {
            r["ultimaNotifica"] = json!({ "tipo": tipo_n, "descrizione": descr, "data": data });
        }
    }

    // Da sistemare: gli scarti (la fattura non è emessa) e i rifiuti della PA.
    // In coda quelle inviate da oltre una settimana senza ancora una risposta:
    // lo SdI di norma risponde entro cinque giorni.
    let da_sistemare: Vec<Value> = righe
        .iter()
        .filter(|r| matches!(r["statoSdi"].as_str().unwrap_or(""), "SCARTATA" | "RIFIUTATA" | "MANCATA_CONSEGNA"))
        .cloned()
        .collect();
    let limite = crate::web::oggi_plus(-7);
    let senza_risposta: Vec<Value> = righe
        .iter()
        .filter(|r| r["statoSdi"] == "INVIATA")
        .filter(|r| {
            let d = r["dataInvioSdi"].as_str().unwrap_or("");
            !d.is_empty() && d < limite.as_str()
        })
        .cloned()
        .collect();

    righe.sort_by(|a, b| b["data"].as_str().unwrap_or("").cmp(a["data"].as_str().unwrap_or("")));
    Ok(Json(json!({
        "documenti": righe,
        "daSistemare": da_sistemare,
        "senzaRisposta": senza_risposta,
        "oggi": oggi(),
    })))
}

/// GET /api/sdi-esiti/:tipo/:id — tutte le notifiche di un documento, dalla più
/// vecchia alla più recente: è la storia di che cosa è successo.
async fn per_documento(
    State(state): State<AppState>,
    Path((tipo, id)): Path<(String, i64)>,
) -> ApiResult<Json<Value>> {
    if tabella(&tipo).is_none() {
        return Err(ApiError::bad_request("Tipo di documento non valido"));
    }
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT tipo, identificativo_sdi, nome_file, data, descrizione, errori, created_at \
           FROM sdi_notifiche WHERE documento_tipo=?1 AND documento_id=?2 ORDER BY id",
    )?;
    let righe: Vec<Value> = stmt
        .query_map(params![tipo, id], |r| {
            let errori = r.get::<_, Option<String>>(5)?.unwrap_or_default();
            Ok(json!({
                "tipo": r.get::<_, String>(0)?,
                "identificativoSdi": r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                "nomeFile": r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                "data": r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                "descrizione": r.get::<_, Option<String>>(4)?.unwrap_or_default(),
                "errori": serde_json::from_str::<Value>(&errori).unwrap_or(Value::Null),
                "importataIl": r.get::<_, Option<String>>(6)?.unwrap_or_default(),
            }))
        })?
        .collect::<Result<_, _>>()?;
    Ok(Json(Value::Array(righe)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use tower::ServiceExt;

    struct Prova {
        state: AppState,
        dir: std::path::PathBuf,
    }
    impl Drop for Prova {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    fn prepara() -> Prova {
        let dir = std::env::temp_dir().join(format!(
            "ordeva-sdi-{}-{:?}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        let state = AppState::init(dir.clone(), dir.join("ordeva.json")).unwrap();
        {
            let conn = tenant_conn(&state).unwrap();
            let conn = conn.lock().unwrap();
            conn.execute("UPDATE azienda SET p_iva='01234567890' WHERE id=1", []).unwrap();
            // L'archivio nuovo ha già un cliente d'esempio: non gli si va addosso.
            conn.execute("INSERT INTO clienti (id, ragione_sociale) VALUES (900,'Studio Rossi')", []).unwrap();
            conn.execute(
                "INSERT INTO fatture (id, numero, data_emissione, cliente_id, stato, stato_sdi, data_invio_sdi) \
                 VALUES (1,'2026/0001','2026-09-01',900,'EMESSA','INVIATA','2026-09-01')",
                [],
            )
            .unwrap();
        }
        Prova { state, dir }
    }

    async fn posta(state: &AppState, xml: &str) -> (StatusCode, Value) {
        let router = crate::server::build_router(state.clone());
        let req = Request::builder()
            .method("POST")
            .uri("/api/sdi-esiti/importa")
            .header("content-type", "application/xml")
            .body(Body::from(xml.to_string()))
            .unwrap();
        let res = router.oneshot(req).await.unwrap();
        let stato = res.status();
        let b = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        (stato, serde_json::from_slice(&b).unwrap_or(Value::Null))
    }

    fn stato_fattura(p: &Prova) -> String {
        let conn = tenant_conn(&p.state).unwrap();
        let conn = conn.lock().unwrap();
        conn.query_row("SELECT stato_sdi FROM fatture WHERE id=1", [], |r| r.get(0)).unwrap()
    }

    /// Una ricevuta di consegna porta la fattura a "consegnata" e registra
    /// l'identificativo assegnato dallo SdI.
    #[tokio::test]
    async fn la_ricevuta_di_consegna_aggiorna_la_fattura() {
        let p = prepara();
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<RicevutaConsegna>
  <IdentificativoSdI>7654321</IdentificativoSdI>
  <NomeFile>IT01234567890_2026_0001.xml</NomeFile>
  <DataOraRicezione>2026-09-01T10:15:00.000+02:00</DataOraRicezione>
  <DataOraConsegna>2026-09-02T08:30:00.000+02:00</DataOraConsegna>
  <MessageId>12345</MessageId>
</RicevutaConsegna>"#;
        let (stato, r) = posta(&p.state, xml).await;
        assert!(stato.is_success(), "{r}");
        assert_eq!(r["tipo"], "RC");
        assert_eq!(r["collegata"], true);
        assert_eq!(r["data"], "2026-09-02");
        assert_eq!(stato_fattura(&p), "CONSEGNATA");
        let conn = tenant_conn(&p.state).unwrap();
        let conn = conn.lock().unwrap();
        let ident: String = conn.query_row("SELECT id_trasmissione_sdi FROM fatture WHERE id=1", [], |r| r.get(0)).unwrap();
        assert_eq!(ident, "7654321");
    }

    /// Lo scarto è il caso che conta: la fattura NON è emessa, e il motivo va
    /// conservato per intero, codice compreso.
    #[tokio::test]
    async fn lo_scarto_conserva_codice_e_motivo() {
        let p = prepara();
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<NotificaScarto>
  <IdentificativoSdI>7654321</IdentificativoSdI>
  <NomeFile>IT01234567890_2026_0001.xml</NomeFile>
  <DataOraRicezione>2026-09-01T10:15:00.000+02:00</DataOraRicezione>
  <ListaErrori>
    <Errore>
      <Codice>00305</Codice>
      <Descrizione>CodiceDestinatario non valido</Descrizione>
      <Suggerimento>Verificare il codice destinatario del cliente</Suggerimento>
    </Errore>
  </ListaErrori>
</NotificaScarto>"#;
        let (_, r) = posta(&p.state, xml).await;
        assert_eq!(r["tipo"], "NS");
        assert_eq!(stato_fattura(&p), "SCARTATA");
        assert_eq!(r["errori"][0]["codice"], "00305");
        assert!(r["descrizione"].as_str().unwrap().contains("00305"));
        assert!(r["descrizione"].as_str().unwrap().contains("CodiceDestinatario"));

        // La storia del documento resta consultabile.
        let router = crate::server::build_router(p.state.clone());
        let res = router
            .oneshot(Request::builder().uri("/api/sdi-esiti/FATTURA/1").body(Body::empty()).unwrap())
            .await
            .unwrap();
        let b = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let storia: Value = serde_json::from_slice(&b).unwrap();
        assert_eq!(storia.as_array().unwrap().len(), 1);
        assert_eq!(storia[0]["errori"][0]["suggerimento"], "Verificare il codice destinatario del cliente");
    }

    /// L'esito del committente (solo PA) distingue accettazione e rifiuto.
    #[tokio::test]
    async fn distingue_accettazione_e_rifiuto_della_pa() {
        for (esito, atteso) in [("EC01", "ACCETTATA"), ("EC02", "RIFIUTATA")] {
            let p = prepara();
            let xml = format!(
                r#"<?xml version="1.0" encoding="UTF-8"?>
<NotificaEsito>
  <IdentificativoSdI>999</IdentificativoSdI>
  <NomeFile>IT01234567890_2026_0001.xml</NomeFile>
  <EsitoCommittente><Esito>{esito}</Esito></EsitoCommittente>
</NotificaEsito>"#
            );
            let (_, r) = posta(&p.state, &xml).await;
            assert_eq!(r["stato"], atteso, "esito {esito}");
            assert_eq!(stato_fattura(&p), atteso);
        }
    }

    /// Una notifica che non si riesce ad abbinare non deve far credere che sia
    /// tutto a posto: si conserva, ma lo si dice.
    #[tokio::test]
    async fn una_notifica_non_abbinata_lo_dichiara() {
        let p = prepara();
        let xml = r#"<RicevutaConsegna>
  <IdentificativoSdI>111</IdentificativoSdI>
  <NomeFile>IT99999999999_9999_9999.xml</NomeFile>
</RicevutaConsegna>"#;
        let (_, r) = posta(&p.state, xml).await;
        assert_eq!(r["collegata"], false);
        assert!(r["documentoId"].is_null());
        assert_eq!(stato_fattura(&p), "INVIATA", "la fattura non c'entra e non va toccata");
    }

    /// Un XML di fattura non è una notifica: va respinto con una spiegazione,
    /// non salvato come se fosse un esito.
    #[tokio::test]
    async fn rifiuta_un_xml_che_non_e_una_notifica() {
        let p = prepara();
        let (stato, r) = posta(&p.state, "<FatturaElettronica><Body/></FatturaElettronica>").await;
        assert_eq!(stato, StatusCode::BAD_REQUEST);
        assert!(r["error"].as_str().unwrap_or("").contains("notifica"), "{r}");
    }

    /// Reimportare lo stesso file non deve duplicare la storia del documento.
    #[tokio::test]
    async fn reimportare_la_stessa_notifica_non_duplica() {
        let p = prepara();
        let xml = r#"<RicevutaConsegna><IdentificativoSdI>7654321</IdentificativoSdI>
        <NomeFile>IT01234567890_2026_0001.xml</NomeFile></RicevutaConsegna>"#;
        posta(&p.state, xml).await;
        posta(&p.state, xml).await;
        let conn = tenant_conn(&p.state).unwrap();
        let conn = conn.lock().unwrap();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM sdi_notifiche", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn ricava_il_numero_dal_nome_del_file() {
        assert_eq!(numero_da_nome_file("IT01234567890_2026_0001.xml").unwrap(), "2026_0001");
        assert_eq!(numero_da_nome_file("IT01234567890_2026_0001_RC_001.xml").unwrap(), "2026_0001");
        assert_eq!(numero_da_nome_file("/tmp/IT01234567890_AF2026_0003_NS_002.XML").unwrap(), "AF2026_0003");
    }
}
