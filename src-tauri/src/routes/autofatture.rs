//! /api/autofatture — autofattura per acquisti dall'estero (reverse charge).
//!
//! Quando si compra da un fornitore estero l'IVA non la addebita lui: la deve
//! calcolare e versare l'acquirente italiano, emettendo un documento elettronico
//! a proprio carico. È l'autofattura (o "integrazione"), che va allo SdI con
//! TipoDocumento TD17 (servizi), TD18 (beni acquistati in UE) o TD19 (beni che
//! si trovavano già in Italia, art. 17 c.2 DPR 633/72), con il fornitore estero
//! come cedente e la propria azienda come cessionario.
//!
//! Poiché sbagliare qui costa caro — l'importo è quello che si versa all'erario,
//! e la fattura viene rifiutata o va rifatta — il flusso è deliberatamente
//! lento: la bozza si crea (anche leggendo la fattura estera con l'OCR), poi
//! `GET /:id/verifiche` elenca i controlli automatici e le conferme che
//! l'utente deve spuntare una per una, e solo quando tutto è a posto
//! `POST /:id/conferma` chiude il documento e genera l'acquisto collegato
//! (l'autofattura va annotata sia nel registro vendite sia in quello acquisti).

use axum::{
    extract::{Path, State},
    http::header,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

use crate::db::AppState;
use crate::error::{ApiError, ApiResult};
use crate::numerazione::get_next_numero;
use crate::web::{num, oggi, opt_num, str_field, tenant_conn};
use crate::xml::{build_autofattura_pa, country_code_opt};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/nuovo", get(nuovo))
        .route("/da-ocr", post(da_ocr))
        .route("/:id", get(detail).put(update).delete(remove))
        .route("/:id/verifiche", get(verifiche).post(salva_verifiche))
        .route("/:id/conferma", post(conferma))
        .route("/:id/riapri", post(riapri))
        .route("/:id/xml", get(xml))
}

/// Stati UE: decidono se l'operazione è intracomunitaria (TD18 sui beni) oppure
/// extra-UE (dove i beni scontano l'IVA in dogana e resta il TD17 sui servizi).
const UE: [&str; 27] = [
    "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU", "IE", "IT",
    "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK",
];

fn in_ue(paese: &str) -> bool {
    UE.contains(&paese)
}

// ── lettura ──────────────────────────────────────────────────────────────────

const SELECT: &str = "SELECT a.*, f.ragione_sociale AS fornitore_nome, f.stato AS fornitore_stato, \
    f.p_iva AS fornitore_p_iva FROM autofatture a LEFT JOIN fornitori f ON f.id = a.fornitore_id";

async fn list(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let mut stmt = conn.prepare(&format!("{SELECT} ORDER BY a.data DESC, a.id DESC"))?;
    let rows = stmt
        .query_map([], |r| to_dto(&conn, r))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(Value::Array(rows)))
}

async fn detail(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let mut dto = conn
        .query_row(&format!("{SELECT} WHERE a.id=?1"), [id], |r| to_dto(&conn, r))
        .optional()?
        .ok_or_else(|| ApiError::not_found("Autofattura non trovata"))?;
    dto["righe"] = Value::Array(righe(&conn, id)?);
    Ok(Json(dto))
}

/// GET /api/autofatture/nuovo — bozza pronta da compilare: numero libero della
/// propria serie e data di oggi. L'autofattura ha una numerazione sua, separata
/// da quella delle fatture di vendita.
async fn nuovo(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    Ok(Json(json!({
        "numero": get_next_numero(&conn, "autofattura", "autofatture", 0)?,
        "data": oggi(),
        "tipoDocumento": "TD17",
        "valuta": "EUR",
        "cambio": 1.0,
        "stato": "BOZZA",
        "righe": Value::Array(vec![]),
    })))
}

fn to_dto(conn: &Connection, r: &rusqlite::Row) -> rusqlite::Result<Value> {
    let id = r.get::<_, i64>("id")?;
    let (imponibile, imposta) = totali(conn, id)?;
    let paese = r
        .get::<_, Option<String>>("fornitore_stato")
        .ok()
        .flatten()
        .and_then(|s| country_code_opt(&s))
        .unwrap_or("");
    Ok(json!({
        "id": id,
        "numero": r.get::<_, Option<String>>("numero")?,
        "data": r.get::<_, Option<String>>("data")?,
        "tipoDocumento": r.get::<_, Option<String>>("tipo_documento")?,
        "fornitoreId": r.get::<_, Option<i64>>("fornitore_id")?,
        "fornitoreNome": r.get::<_, Option<String>>("fornitore_nome").ok().flatten(),
        "fornitorePaese": paese,
        "fornitorePIva": r.get::<_, Option<String>>("fornitore_p_iva").ok().flatten(),
        "fatturaEsteraNumero": r.get::<_, Option<String>>("fattura_estera_numero")?,
        "fatturaEsteraData": r.get::<_, Option<String>>("fattura_estera_data")?,
        "valuta": r.get::<_, Option<String>>("valuta")?,
        "cambio": opt_num(r.get::<_, Option<f64>>("cambio")?),
        "totaleEstero": opt_num(r.get::<_, Option<f64>>("totale_estero")?),
        "acquistoId": r.get::<_, Option<i64>>("acquisto_id")?,
        "stato": r.get::<_, Option<String>>("stato")?,
        "statoSdi": r.get::<_, Option<String>>("stato_sdi")?,
        "note": r.get::<_, Option<String>>("note")?,
        "verifiche": verifiche_salvate_row(r),
        "imponibile": num(imponibile),
        "imposta": num(imposta),
        "totale": num(arrotonda(imponibile + imposta)),
    }))
}

fn verifiche_salvate_row(r: &rusqlite::Row) -> Value {
    r.get::<_, Option<String>>("verifiche")
        .ok()
        .flatten()
        .filter(|s| !s.trim().is_empty())
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .unwrap_or_else(|| json!({}))
}

fn arrotonda(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

fn totali(conn: &Connection, id: i64) -> rusqlite::Result<(f64, f64)> {
    let mut stmt =
        conn.prepare("SELECT quantita, prezzo, iva FROM autofatture_righe WHERE autofattura_id=?1")?;
    let mut imponibile = 0.0;
    let mut imposta = 0.0;
    for r in stmt.query_map([id], |r| {
        Ok((
            r.get::<_, Option<f64>>(0)?.unwrap_or(1.0),
            r.get::<_, Option<f64>>(1)?.unwrap_or(0.0),
            r.get::<_, Option<f64>>(2)?.unwrap_or(0.0),
        ))
    })? {
        let (q, p, a) = r?;
        let imp = arrotonda(q * p);
        imponibile += imp;
        imposta += imp * a / 100.0;
    }
    Ok((arrotonda(imponibile), arrotonda(imposta)))
}

fn righe(conn: &Connection, id: i64) -> rusqlite::Result<Vec<Value>> {
    let mut stmt = conn.prepare(
        "SELECT id, descrizione, codice, quantita, unita_misura, prezzo, prezzo_valuta, iva \
         FROM autofatture_righe WHERE autofattura_id=?1 ORDER BY id",
    )?;
    let rows = stmt
        .query_map([id], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "descrizione": r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                "codice": r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                "quantita": opt_num(r.get::<_, Option<f64>>(3)?),
                "unitaMisura": r.get::<_, Option<String>>(4)?.unwrap_or_default(),
                "prezzo": opt_num(r.get::<_, Option<f64>>(5)?),
                "prezzoValuta": opt_num(r.get::<_, Option<f64>>(6)?),
                "iva": opt_num(r.get::<_, Option<f64>>(7)?),
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

// ── scrittura ────────────────────────────────────────────────────────────────

fn campi(b: &Value) -> (String, String, String, Option<i64>, String, String, String, f64, Option<f64>, String) {
    (
        str_field(b, "numero"),
        str_field(b, "data"),
        {
            let t = str_field(b, "tipoDocumento");
            if ["TD17", "TD18", "TD19"].contains(&t.as_str()) { t } else { "TD17".into() }
        },
        b.get("fornitoreId").and_then(Value::as_i64).filter(|&v| v != 0),
        str_field(b, "fatturaEsteraNumero"),
        str_field(b, "fatturaEsteraData"),
        {
            let v = str_field(b, "valuta").to_uppercase();
            if v.is_empty() { "EUR".into() } else { v }
        },
        b.get("cambio").and_then(Value::as_f64).filter(|v| *v > 0.0).unwrap_or(1.0),
        b.get("totaleEstero").and_then(Value::as_f64),
        str_field(b, "note"),
    )
}

async fn create(State(state): State<AppState>, Json(b): Json<Value>) -> ApiResult<Json<Value>> {
    let arc = tenant_conn(&state)?;
    let mut guard = arc.lock().unwrap();
    let id = inserisci(&mut guard, &b)?;
    Ok(Json(json!({ "id": id })))
}

fn inserisci(guard: &mut Connection, b: &Value) -> ApiResult<i64> {
    let (numero, data, tipo, fornitore_id, fe_num, fe_data, valuta, cambio, tot_estero, note) = campi(b);
    let numero = if numero.is_empty() {
        get_next_numero(guard, "autofattura", "autofatture", 0)?
    } else {
        numero
    };
    if guard
        .query_row("SELECT id FROM autofatture WHERE numero=?1", [&numero], |_| Ok(()))
        .optional()?
        .is_some()
    {
        return Err(ApiError::conflict(format!(
            "Il numero {numero} è già usato da un'altra autofattura"
        )));
    }
    let data = if data.is_empty() { oggi() } else { data };
    let tx = guard.transaction().map_err(ApiError::from)?;
    tx.execute(
        "INSERT INTO autofatture (numero,data,tipo_documento,fornitore_id,fattura_estera_numero,\
         fattura_estera_data,valuta,cambio,totale_estero,note,stato) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'BOZZA')",
        params![numero, data, tipo, fornitore_id, fe_num, fe_data, valuta, cambio, tot_estero, note],
    )?;
    let id = tx.last_insert_rowid();
    salva_righe(&tx, id, b, cambio)?;
    tx.commit().map_err(ApiError::from)?;
    Ok(id)
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(b): Json<Value>,
) -> ApiResult<Json<Value>> {
    let arc = tenant_conn(&state)?;
    let mut guard = arc.lock().unwrap();
    solo_se_bozza(&guard, id)?;
    let (numero, data, tipo, fornitore_id, fe_num, fe_data, valuta, cambio, tot_estero, note) = campi(&b);
    if guard
        .query_row("SELECT id FROM autofatture WHERE numero=?1 AND id!=?2", params![numero, id], |_| Ok(()))
        .optional()?
        .is_some()
    {
        return Err(ApiError::conflict(format!(
            "Il numero {numero} è già usato da un'altra autofattura"
        )));
    }
    let tx = guard.transaction().map_err(ApiError::from)?;
    // Cambiare i dati invalida le spunte già messe: vanno rifatte sul documento nuovo.
    tx.execute(
        "UPDATE autofatture SET numero=?1,data=?2,tipo_documento=?3,fornitore_id=?4,\
         fattura_estera_numero=?5,fattura_estera_data=?6,valuta=?7,cambio=?8,totale_estero=?9,\
         note=?10,verifiche='' WHERE id=?11",
        params![numero, data, tipo, fornitore_id, fe_num, fe_data, valuta, cambio, tot_estero, note, id],
    )?;
    tx.execute("DELETE FROM autofatture_righe WHERE autofattura_id=?1", [id])?;
    salva_righe(&tx, id, &b, cambio)?;
    tx.commit().map_err(ApiError::from)?;
    Ok(Json(json!({ "success": true })))
}

fn salva_righe(conn: &Connection, id: i64, b: &Value, cambio: f64) -> ApiResult<()> {
    let Some(righe) = b.get("righe").and_then(Value::as_array) else { return Ok(()) };
    for r in righe {
        // Il prezzo che finisce nell'XML è sempre in euro; se la fattura estera
        // era in valuta si conserva anche l'importo originale, così l'utente può
        // confrontare riga per riga con il documento che ha in mano.
        let in_valuta = r.get("prezzoValuta").and_then(Value::as_f64);
        let prezzo = match r.get("prezzo").and_then(Value::as_f64) {
            Some(p) => p,
            None => arrotonda(in_valuta.unwrap_or(0.0) * cambio),
        };
        conn.execute(
            "INSERT INTO autofatture_righe (autofattura_id,descrizione,codice,quantita,unita_misura,prezzo,prezzo_valuta,iva) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![
                id,
                str_field(r, "descrizione"),
                str_field(r, "codice"),
                r.get("quantita").and_then(Value::as_f64).unwrap_or(1.0),
                str_field(r, "unitaMisura"),
                prezzo,
                in_valuta,
                r.get("iva").and_then(Value::as_f64).unwrap_or(22.0),
            ],
        )?;
    }
    Ok(())
}

async fn remove(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    solo_se_bozza(&conn, id)?;
    conn.execute("DELETE FROM autofatture WHERE id=?1", [id])?;
    Ok(Json(json!({ "success": true })))
}

fn stato_di(conn: &Connection, id: i64) -> ApiResult<String> {
    conn.query_row("SELECT stato FROM autofatture WHERE id=?1", [id], |r| {
        Ok(r.get::<_, Option<String>>(0)?.unwrap_or_default())
    })
    .optional()?
    .ok_or_else(|| ApiError::not_found("Autofattura non trovata"))
}

fn solo_se_bozza(conn: &Connection, id: i64) -> ApiResult<()> {
    if stato_di(conn, id)? == "CONFERMATA" {
        return Err(ApiError::bad_request(
            "L'autofattura è già confermata: riaprila prima di modificarla.",
        ));
    }
    Ok(())
}

// ── OCR: copia la fattura estera "pari pari" ─────────────────────────────────

/// POST /api/autofatture/da-ocr — crea la bozza dalle righe lette dal PDF della
/// fattura estera. Le righe si copiano com'erano: nessun abbinamento a prodotti
/// di magazzino, nessun ritocco alle descrizioni. L'unica cosa che il programma
/// aggiunge è l'aliquota IVA italiana da applicare (proposta, poi confermata).
///
/// body: { fornitoreId?, fornitore?, pIva?, numero, data, valuta?, cambio?,
///         totaleEstero?, ivaPredefinita?, righe: [...] }
async fn da_ocr(State(state): State<AppState>, Json(b): Json<Value>) -> ApiResult<Json<Value>> {
    let arc = tenant_conn(&state)?;
    let mut guard = arc.lock().unwrap();

    let valuta = {
        let v = str_field(&b, "valuta").to_uppercase();
        if v.is_empty() { "EUR".to_string() } else { v }
    };
    let cambio = b.get("cambio").and_then(Value::as_f64).filter(|v| *v > 0.0).unwrap_or(1.0);
    let iva_pred = b.get("ivaPredefinita").and_then(Value::as_f64).unwrap_or(22.0);
    let in_valuta = valuta != "EUR";

    // Le righe dell'OCR portano il prezzo unitario nella valuta del documento.
    let righe_ocr: Vec<Value> = b
        .get("righe")
        .and_then(Value::as_array)
        .map(|v| {
            v.iter()
                .map(|r| {
                    let p = r.get("prezzo").and_then(Value::as_f64).unwrap_or(0.0);
                    json!({
                        "descrizione": str_field(r, "descrizione"),
                        "codice": str_field(r, "codice"),
                        "quantita": r.get("quantita").and_then(Value::as_f64).unwrap_or(1.0),
                        "unitaMisura": str_field(r, "unitaMisura"),
                        "prezzo": arrotonda(if in_valuta { p * cambio } else { p }),
                        "prezzoValuta": if in_valuta { json!(p) } else { Value::Null },
                        // L'IVA sulla fattura estera non c'è (è reverse charge):
                        // quella che si scrive qui è l'aliquota italiana dovuta.
                        "iva": iva_pred,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    // Righe non riconosciute: la bozza si crea lo stesso, con una riga vuota da
    // riempire. Rifiutare qui lasciava l'utente senza niente proprio quando
    // serviva di più — l'anteprima del documento accanto ai campi è il modo per
    // ricopiarle a mano, e i controlli sul totale poi dicono se quadrano.
    let lette = righe_ocr.len();
    let righe_ocr = if righe_ocr.is_empty() {
        vec![json!({
            "descrizione": "", "codice": "", "quantita": 1.0, "unitaMisura": "",
            "prezzo": 0.0, "prezzoValuta": Value::Null, "iva": iva_pred,
        })]
    } else {
        righe_ocr
    };

    let fornitore_id = match b.get("fornitoreId").and_then(Value::as_i64).filter(|&v| v != 0) {
        Some(id) => Some(id),
        None => trova_fornitore(&guard, &str_field(&b, "fornitore"), &str_field(&b, "pIva"))?,
    };

    // La data dell'autofattura è quella di ricezione (fornitori UE) o di
    // effettuazione dell'operazione: si propone oggi, non la data estera.
    let mut bozza = json!({
        "numero": str_field(&b, "numero"),
        "data": oggi(),
        "fornitoreId": fornitore_id,
        "fatturaEsteraNumero": str_field(&b, "numeroEstero"),
        "fatturaEsteraData": str_field(&b, "dataEstera"),
        "valuta": valuta,
        "cambio": cambio,
        "totaleEstero": b.get("totaleEstero").and_then(Value::as_f64),
        "note": str_field(&b, "note"),
        "righe": righe_ocr,
    });
    bozza["numero"] = json!("");
    let (tipo, motivo) = tipo_suggerito(&guard, fornitore_id, bozza["righe"].as_array().unwrap());
    bozza["tipoDocumento"] = json!(tipo);

    let id = inserisci(&mut guard, &bozza)?;
    Ok(Json(json!({
        "id": id,
        "tipoSuggerito": tipo,
        "motivoTipo": motivo,
        // Quante righe sono state riconosciute: zero vuol dire che il documento
        // ha un impianto che il lettore non capisce e vanno scritte a mano.
        "righeLette": lette,
        // Il tipo è una proposta: l'interfaccia la mostra e chiede conferma.
        "daConfermare": true,
    })))
}

fn trova_fornitore(conn: &Connection, nome: &str, p_iva: &str) -> ApiResult<Option<i64>> {
    if !p_iva.trim().is_empty() {
        let pulita: String = p_iva.chars().filter(|c| c.is_alphanumeric()).collect();
        if let Some(id) = conn
            .query_row(
                "SELECT id FROM fornitori WHERE REPLACE(REPLACE(UPPER(p_iva),' ',''),'.','')=?1",
                [pulita.to_uppercase()],
                |r| r.get::<_, i64>(0),
            )
            .optional()?
        {
            return Ok(Some(id));
        }
    }
    if nome.trim().is_empty() {
        return Ok(None);
    }
    Ok(conn
        .query_row(
            "SELECT id FROM fornitori WHERE LOWER(ragione_sociale)=LOWER(?1)",
            [nome.trim()],
            |r| r.get::<_, i64>(0),
        )
        .optional()?)
}

/// Che tipo di autofattura serve, e perché. È una proposta motivata: la scelta
/// dipende da cosa si è comprato, e quello lo sa solo chi ha fatto l'acquisto.
fn tipo_suggerito(conn: &Connection, fornitore_id: Option<i64>, righe: &[Value]) -> (&'static str, &'static str) {
    let paese = fornitore_id
        .and_then(|id| {
            conn.query_row("SELECT stato FROM fornitori WHERE id=?1", [id], |r| {
                Ok(r.get::<_, Option<String>>(0)?.unwrap_or_default())
            })
            .optional()
            .ok()
            .flatten()
        })
        .and_then(|s| country_code_opt(&s))
        .unwrap_or("");

    // Se le righe hanno quantità con unità di misura o un codice articolo, sono
    // quasi sempre beni; le prestazioni di servizio arrivano come voce unica.
    let sembra_merce = righe.iter().any(|r| {
        !r.get("codice").and_then(Value::as_str).unwrap_or("").trim().is_empty()
            || !r.get("unitaMisura").and_then(Value::as_str).unwrap_or("").trim().is_empty()
    });

    if paese.is_empty() {
        return ("TD17", "nazione-sconosciuta");
    }
    if in_ue(paese) {
        if sembra_merce {
            ("TD18", "beni-ue")
        } else {
            ("TD17", "servizi-ue")
        }
    } else if sembra_merce {
        // Sui beni extra-UE l'IVA di norma si assolve in dogana: l'autofattura
        // serve solo se la merce era già in Italia (art. 17 c.2).
        ("TD19", "beni-extra-ue")
    } else {
        ("TD17", "servizi-extra-ue")
    }
}

// ── verifiche ────────────────────────────────────────────────────────────────

/// Le conferme che l'utente deve spuntare a mano. `sempre` false = richiesta
/// solo in certe situazioni (per esempio il cambio, se c'è una valuta estera).
const CONFERME: [(&str, bool); 7] = [
    ("righe-uguali", true),
    ("importi", true),
    ("tipo-documento", true),
    ("aliquote", true),
    ("fornitore-dati", true),
    ("termini", true),
    ("cambio", false),
];

fn controllo(id: &str, esito: &str, params: Value) -> Value {
    json!({ "id": id, "esito": esito, "params": params })
}

/// GET /api/autofatture/:id/verifiche — cosa non torna (controlli automatici) e
/// cosa l'utente deve ancora confermare guardando la fattura estera.
async fn verifiche(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    Ok(Json(calcola_verifiche(&conn, id)?))
}

fn calcola_verifiche(conn: &Connection, id: i64) -> ApiResult<Value> {
    let dto = conn
        .query_row(&format!("{SELECT} WHERE a.id=?1"), [id], |r| to_dto(conn, r))
        .optional()?
        .ok_or_else(|| ApiError::not_found("Autofattura non trovata"))?;
    let righe = righe(conn, id)?;

    let mut c: Vec<Value> = Vec::new();
    let paese = dto["fornitorePaese"].as_str().unwrap_or("");
    let tipo = dto["tipoDocumento"].as_str().unwrap_or("TD17");
    let valuta = dto["valuta"].as_str().unwrap_or("EUR");
    let cambio = dto["cambio"].as_f64().unwrap_or(1.0);

    // 1. il fornitore dev'esserci e dev'essere estero.
    if dto["fornitoreId"].is_null() {
        c.push(controllo("fornitore-mancante", "errore", json!({})));
    } else if paese.is_empty() {
        c.push(controllo("nazione-sconosciuta", "errore", json!({})));
    } else if paese == "IT" {
        c.push(controllo("fornitore-italiano", "errore", json!({})));
    }

    // 2. partita IVA estera: se manca, l'XML ripiega sul codice convenzionale.
    if !dto["fornitoreId"].is_null() && dto["fornitorePIva"].as_str().unwrap_or("").trim().is_empty() {
        c.push(controllo("piva-estera-mancante", "attenzione", json!({})));
    }

    // 3-4. estremi della fattura estera: vanno in DatiFattureCollegate.
    let fe_num = dto["fatturaEsteraNumero"].as_str().unwrap_or("").trim().to_string();
    let fe_data = dto["fatturaEsteraData"].as_str().unwrap_or("").trim().to_string();
    if fe_num.is_empty() {
        c.push(controllo("numero-estero-mancante", "errore", json!({})));
    }
    if fe_data.is_empty() {
        c.push(controllo("data-estera-mancante", "attenzione", json!({})));
    } else {
        let data = dto["data"].as_str().unwrap_or("");
        if fe_data.as_str() > data {
            c.push(controllo("data-estera-futura", "errore", json!({ "estera": fe_data, "data": data })));
        } else if let Some(limite) = entro_il_15(&fe_data) {
            // Le autofatture UE vanno emesse entro il 15 del mese successivo a
            // quello di ricezione della fattura estera.
            if data > limite.as_str() {
                c.push(controllo("fuori-termine", "attenzione", json!({ "limite": limite })));
            }
        }
    }

    // 5. righe e importi.
    if righe.is_empty() {
        c.push(controllo("righe-mancanti", "errore", json!({})));
    }
    if righe.iter().any(|r| r["descrizione"].as_str().unwrap_or("").trim().is_empty()) {
        c.push(controllo("descrizione-vuota", "errore", json!({})));
    }
    if righe.iter().any(|r| r["prezzo"].as_f64().unwrap_or(0.0) <= 0.0) {
        c.push(controllo("prezzo-zero", "attenzione", json!({})));
    }
    if righe.iter().any(|r| r["iva"].as_f64().unwrap_or(0.0) <= 0.0) {
        // Un'aliquota a zero è possibile (operazioni non imponibili) ma è la
        // causa più comune di autofatture sbagliate: va guardata.
        c.push(controllo("iva-zero", "attenzione", json!({})));
    }

    // 6. il totale delle righe deve quadrare con la fattura estera.
    if let Some(tot_estero) = dto["totaleEstero"].as_f64().filter(|v| *v > 0.0) {
        let somma_valuta: f64 = righe
            .iter()
            .map(|r| {
                let q = r["quantita"].as_f64().unwrap_or(1.0);
                let p = r["prezzoValuta"].as_f64().unwrap_or_else(|| r["prezzo"].as_f64().unwrap_or(0.0));
                q * p
            })
            .sum();
        let diff = arrotonda(somma_valuta - tot_estero);
        if diff.abs() > 0.02 {
            c.push(controllo(
                "totale-non-quadra",
                "errore",
                json!({ "righe": arrotonda(somma_valuta), "documento": tot_estero, "differenza": diff }),
            ));
        }
    } else {
        c.push(controllo("totale-estero-mancante", "attenzione", json!({})));
    }

    // 7. valuta e cambio.
    if valuta != "EUR" {
        if cambio <= 0.0 || (cambio - 1.0).abs() < f64::EPSILON {
            c.push(controllo("cambio-sospetto", "errore", json!({ "valuta": valuta, "cambio": cambio })));
        }
        if righe.iter().any(|r| r["prezzoValuta"].is_null()) {
            c.push(controllo("valuta-senza-originale", "attenzione", json!({})));
        }
    }

    // 8. il tipo documento deve stare in piedi con la nazione del fornitore.
    if !paese.is_empty() && paese != "IT" {
        match (tipo, in_ue(paese)) {
            ("TD18", false) => c.push(controllo("td18-extra-ue", "errore", json!({ "paese": paese }))),
            ("TD19", true) => c.push(controllo("td19-in-ue", "attenzione", json!({ "paese": paese }))),
            _ => {}
        }
    }

    // 9. numero doppio nella propria serie.
    let numero = dto["numero"].as_str().unwrap_or("");
    if conn
        .query_row(
            "SELECT id FROM autofatture WHERE numero=?1 AND id!=?2",
            params![numero, id],
            |_| Ok(()),
        )
        .optional()?
        .is_some()
    {
        c.push(controllo("numero-duplicato", "errore", json!({ "numero": numero })));
    }

    // L'XML si genera davvero: se il generatore si lamenta è meglio saperlo ora
    // che dopo lo scarto dello SdI.
    if let Err(e) = build_autofattura_pa(conn, id) {
        c.push(controllo("xml-non-generabile", "errore", json!({ "errore": e.to_string() })));
    }

    let salvate = dto["verifiche"].clone();
    let conferme: Vec<Value> = CONFERME
        .iter()
        .filter(|(id, sempre)| *sempre || (*id == "cambio" && valuta != "EUR"))
        .map(|(id, _)| {
            let fatta = salvate.get(id).and_then(Value::as_str);
            json!({ "id": id, "fatta": fatta.is_some(), "quando": fatta })
        })
        .collect();

    let bloccanti = c.iter().filter(|x| x["esito"] == "errore").count();
    let mancanti: Vec<&str> = conferme
        .iter()
        .filter(|x| !x["fatta"].as_bool().unwrap_or(false))
        .filter_map(|x| x["id"].as_str())
        .collect();

    Ok(json!({
        "controlli": c,
        "conferme": conferme,
        "bloccanti": bloccanti,
        "conferme_mancanti": mancanti,
        "puoConfermare": bloccanti == 0 && mancanti.is_empty(),
        "stato": dto["stato"],
    }))
}

/// Il 15 del mese successivo a `data` (AAAA-MM-GG): termine di emissione.
fn entro_il_15(data: &str) -> Option<String> {
    let mut p = data.split('-');
    let y: i64 = p.next()?.parse().ok()?;
    let m: i64 = p.next()?.parse().ok()?;
    if !(1..=12).contains(&m) {
        return None;
    }
    let (y, m) = if m == 12 { (y + 1, 1) } else { (y, m + 1) };
    Some(format!("{y:04}-{m:02}-15"))
}

/// POST /api/autofatture/:id/verifiche — registra le spunte dell'utente, con
/// data e ora: sono la traccia di chi ha controllato cosa.
async fn salva_verifiche(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(b): Json<Value>,
) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    solo_se_bozza(&conn, id)?;
    let attuali = conn
        .query_row("SELECT verifiche FROM autofatture WHERE id=?1", [id], |r| {
            Ok(r.get::<_, Option<String>>(0)?.unwrap_or_default())
        })
        .optional()?
        .ok_or_else(|| ApiError::not_found("Autofattura non trovata"))?;
    let mut mappa = serde_json::from_str::<Value>(&attuali).unwrap_or_else(|_| json!({}));
    if !mappa.is_object() {
        mappa = json!({});
    }
    // Data e ora locali: la spunta vale come "ho controllato io, in questo momento".
    let quando: String = conn.query_row("SELECT datetime('now','localtime')", [], |r| r.get(0))?;
    let obj = mappa.as_object_mut().unwrap();
    for (id_conferma, _) in CONFERME {
        match b.get(id_conferma).and_then(Value::as_bool) {
            Some(true) => {
                obj.insert(id_conferma.to_string(), json!(quando));
            }
            Some(false) => {
                obj.remove(id_conferma);
            }
            None => {}
        }
    }
    conn.execute(
        "UPDATE autofatture SET verifiche=?1 WHERE id=?2",
        params![mappa.to_string(), id],
    )?;
    Ok(Json(calcola_verifiche(&conn, id)?))
}

// ── conferma ─────────────────────────────────────────────────────────────────

/// POST /api/autofatture/:id/conferma — chiude il documento. Passa solo se non
/// ci sono errori e l'utente ha spuntato tutte le conferme; poi crea l'acquisto
/// collegato, perché l'autofattura va annotata anche nel registro degli acquisti.
async fn conferma(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let arc = tenant_conn(&state)?;
    let mut guard = arc.lock().unwrap();
    solo_se_bozza(&guard, id)?;

    let v = calcola_verifiche(&guard, id)?;
    if !v["puoConfermare"].as_bool().unwrap_or(false) {
        return Err(ApiError::bad_request(
            "Ci sono verifiche non superate: correggi i problemi e spunta tutte le conferme.",
        ));
    }

    let acquisto_id = crea_acquisto_collegato(&mut guard, id)?;
    guard.execute(
        "UPDATE autofatture SET stato='CONFERMATA', acquisto_id=?1 WHERE id=?2",
        params![acquisto_id, id],
    )?;
    Ok(Json(json!({ "success": true, "acquistoId": acquisto_id })))
}

fn crea_acquisto_collegato(guard: &mut Connection, id: i64) -> ApiResult<i64> {
    let (numero, data, fe_num, fornitore_id, tipo): (String, String, String, Option<i64>, String) = guard
        .query_row(
            "SELECT numero, data, fattura_estera_numero, fornitore_id, tipo_documento FROM autofatture WHERE id=?1",
            [id],
            |r| {
                Ok((
                    r.get::<_, Option<String>>(0)?.unwrap_or_default(),
                    r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    r.get::<_, Option<i64>>(3)?,
                    r.get::<_, Option<String>>(4)?.unwrap_or_default(),
                ))
            },
        )?;

    // Il numero dell'acquisto è quello della fattura estera, che è il documento
    // che si conserva; se è già in archivio si distingue con quello interno.
    let base = if fe_num.trim().is_empty() { numero.clone() } else { fe_num.trim().to_string() };
    let mut numero_acq = base.clone();
    if guard
        .query_row("SELECT id FROM acquisti WHERE numero=?1", [&numero_acq], |_| Ok(()))
        .optional()?
        .is_some()
    {
        numero_acq = format!("{base} ({numero})");
    }

    let righe = righe(guard, id)?;
    let tx = guard.transaction().map_err(ApiError::from)?;
    tx.execute(
        "INSERT INTO acquisti (numero,data_emissione,fornitore_id,note,stato) VALUES (?1,?2,?3,?4,'RICEVUTA')",
        params![
            numero_acq,
            data,
            fornitore_id,
            format!("Autofattura {numero} ({tipo}) — reverse charge"),
        ],
    )?;
    let acquisto_id = tx.last_insert_rowid();
    for r in &righe {
        tx.execute(
            "INSERT INTO acquisti_righe (acquisto_id,codice_prodotto,descrizione,quantita,prezzo,iva,unita_misura,tipo) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,'PRODOTTO')",
            params![
                acquisto_id,
                r["codice"].as_str().unwrap_or(""),
                r["descrizione"].as_str().unwrap_or(""),
                r["quantita"].as_f64().unwrap_or(1.0),
                r["prezzo"].as_f64().unwrap_or(0.0),
                r["iva"].as_f64().unwrap_or(0.0),
                r["unitaMisura"].as_str().unwrap_or(""),
            ],
        )?;
    }
    tx.commit().map_err(ApiError::from)?;
    Ok(acquisto_id)
}

/// POST /api/autofatture/:id/riapri — torna in bozza. L'acquisto collegato viene
/// eliminato: verrà rigenerato alla conferma successiva, così non restano
/// registrazioni doppie in contabilità.
async fn riapri(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    if let Some(acq) = conn
        .query_row("SELECT acquisto_id FROM autofatture WHERE id=?1", [id], |r| {
            r.get::<_, Option<i64>>(0)
        })
        .optional()?
        .flatten()
    {
        conn.execute("DELETE FROM acquisti_righe WHERE acquisto_id=?1", [acq])?;
        conn.execute("DELETE FROM acquisti WHERE id=?1", [acq])?;
    }
    conn.execute(
        "UPDATE autofatture SET stato='BOZZA', acquisto_id=NULL WHERE id=?1",
        [id],
    )?;
    Ok(Json(json!({ "success": true })))
}

// ── XML ──────────────────────────────────────────────────────────────────────

async fn xml(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Response> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let numero: String = conn
        .query_row("SELECT numero FROM autofatture WHERE id=?1", [id], |r| {
            Ok(r.get::<_, Option<String>>(0)?.unwrap_or_default())
        })
        .optional()?
        .ok_or_else(|| ApiError::not_found("Autofattura non trovata"))?;
    let xml = build_autofattura_pa(&conn, id).map_err(ApiError::from)?;
    let safe: String = numero
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
        .collect();
    Ok((
        [
            (header::CONTENT_TYPE, "application/xml; charset=utf-8".to_string()),
            (header::CONTENT_DISPOSITION, format!("attachment; filename=\"Autofattura_{safe}.xml\"")),
        ],
        xml,
    )
        .into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Archivio minimo con l'azienda e un fornitore tedesco: la situazione tipo
    /// di un acquisto intracomunitario.
    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(include_str!("../schema/tenant.sql")).unwrap();
        c.execute(
            "INSERT INTO azienda (id, ragione_sociale, p_iva, indirizzo, cap, citta, provincia) \
             VALUES (1,'Rossi Srl','01234567890','Via Roma 1','37100','Verona','VR')",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO fornitori (id, ragione_sociale, p_iva, stato, via, cap, citta) \
             VALUES (1,'Bauer GmbH','DE123456789','Germania','Hauptstr. 5','80331','Muenchen')",
            [],
        )
        .unwrap();
        c
    }

    fn autofattura_valida(c: &Connection) -> i64 {
        c.execute(
            "INSERT INTO autofatture (id,numero,data,tipo_documento,fornitore_id,fattura_estera_numero,\
             fattura_estera_data,valuta,cambio,totale_estero) \
             VALUES (1,'AF-1','2026-09-10','TD18',1,'R-778','2026-09-01','EUR',1,200.0)",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO autofatture_righe (autofattura_id,descrizione,codice,quantita,unita_misura,prezzo,iva) \
             VALUES (1,'Batterie 12V','B12',10,'PZ',20.0,22)",
            [],
        )
        .unwrap();
        1
    }

    /// Un'autofattura completa e coerente non deve avere nulla di bloccante:
    /// restano solo le conferme che deve mettere l'utente.
    #[test]
    fn senza_problemi_restano_solo_le_conferme_dell_utente() {
        let c = db();
        let id = autofattura_valida(&c);
        let v = calcola_verifiche(&c, id).unwrap();
        assert_eq!(v["bloccanti"], 0, "controlli: {}", v["controlli"]);
        assert!(!v["puoConfermare"].as_bool().unwrap());
        assert_eq!(v["conferme"].as_array().unwrap().len(), 6);
    }

    /// Se le righe copiate non fanno il totale scritto sulla fattura estera,
    /// vuol dire che l'OCR ha saltato o duplicato qualcosa: è bloccante.
    #[test]
    fn segnala_le_righe_che_non_quadrano_col_totale_del_documento() {
        let c = db();
        let id = autofattura_valida(&c);
        c.execute("UPDATE autofatture SET totale_estero=250.0 WHERE id=1", []).unwrap();
        let v = calcola_verifiche(&c, id).unwrap();
        let ctrl = v["controlli"].as_array().unwrap();
        let x = ctrl.iter().find(|x| x["id"] == "totale-non-quadra").expect("controllo assente");
        assert_eq!(x["esito"], "errore");
        assert_eq!(x["params"]["differenza"], -50.0);
    }

    /// TD18 vale per i beni acquistati in UE: con un fornitore extra-UE è sbagliato.
    #[test]
    fn td18_con_fornitore_extra_ue_e_un_errore() {
        let c = db();
        let id = autofattura_valida(&c);
        c.execute("UPDATE fornitori SET stato='Svizzera' WHERE id=1", []).unwrap();
        let v = calcola_verifiche(&c, id).unwrap();
        assert!(v["controlli"].as_array().unwrap().iter().any(|x| x["id"] == "td18-extra-ue"));
    }

    /// Il fornitore italiano è l'errore più grave: non c'è nessun reverse charge
    /// da assolvere e l'XML non sarebbe nemmeno generabile.
    #[test]
    fn rifiuta_il_fornitore_italiano() {
        let c = db();
        let id = autofattura_valida(&c);
        c.execute("UPDATE fornitori SET stato='Italia' WHERE id=1", []).unwrap();
        let v = calcola_verifiche(&c, id).unwrap();
        assert!(v["controlli"].as_array().unwrap().iter().any(|x| x["id"] == "fornitore-italiano"));
        assert!(v["bloccanti"].as_u64().unwrap() >= 1);
    }

    /// Emettere l'autofattura oltre il 15 del mese successivo è tardi: si avvisa
    /// ma non si blocca, perché il documento va comunque emesso.
    #[test]
    fn avvisa_se_si_e_fuori_termine() {
        let c = db();
        let id = autofattura_valida(&c);
        c.execute("UPDATE autofatture SET data='2026-10-20' WHERE id=1", []).unwrap();
        let v = calcola_verifiche(&c, id).unwrap();
        let x = v["controlli"].as_array().unwrap().iter().find(|x| x["id"] == "fuori-termine").cloned();
        let x = x.expect("controllo assente");
        assert_eq!(x["esito"], "attenzione");
        assert_eq!(x["params"]["limite"], "2026-10-15");
        assert_eq!(v["bloccanti"], 0);
    }

    #[test]
    fn il_termine_scavalca_l_anno() {
        assert_eq!(entro_il_15("2026-12-03").unwrap(), "2027-01-15");
        assert_eq!(entro_il_15("2026-01-31").unwrap(), "2026-02-15");
        assert!(entro_il_15("").is_none());
    }

    /// La conferma non passa finché l'utente non ha spuntato tutto, e dopo
    /// crea l'acquisto collegato per la doppia annotazione.
    #[test]
    fn la_conferma_richiede_le_spunte_e_genera_l_acquisto() {
        let mut c = db();
        let id = autofattura_valida(&c);
        assert!(!calcola_verifiche(&c, id).unwrap()["puoConfermare"].as_bool().unwrap());

        let spunte: Vec<String> = CONFERME.iter().filter(|(_, s)| *s).map(|(i, _)| i.to_string()).collect();
        let mappa: serde_json::Map<String, Value> =
            spunte.iter().map(|k| (k.clone(), json!("2026-09-10 10:00:00"))).collect();
        c.execute("UPDATE autofatture SET verifiche=?1 WHERE id=1", [Value::Object(mappa).to_string()])
            .unwrap();
        assert!(calcola_verifiche(&c, id).unwrap()["puoConfermare"].as_bool().unwrap());

        let acq = crea_acquisto_collegato(&mut c, id).unwrap();
        let numero: String = c
            .query_row("SELECT numero FROM acquisti WHERE id=?1", [acq], |r| r.get(0))
            .unwrap();
        assert_eq!(numero, "R-778", "l'acquisto porta il numero della fattura estera");
        let righe: i64 = c
            .query_row("SELECT COUNT(*) FROM acquisti_righe WHERE acquisto_id=?1", [acq], |r| r.get(0))
            .unwrap();
        assert_eq!(righe, 1);
    }

    /// Il tipo si propone leggendo nazione e forma delle righe, ma resta una
    /// proposta: chi ha comprato sa se erano beni o servizi.
    #[test]
    fn propone_il_tipo_guardando_nazione_e_righe() {
        let c = db();
        let merce = vec![json!({ "codice": "B12", "unitaMisura": "PZ" })];
        let servizio = vec![json!({ "codice": "", "unitaMisura": "" })];
        assert_eq!(tipo_suggerito(&c, Some(1), &merce).0, "TD18");
        assert_eq!(tipo_suggerito(&c, Some(1), &servizio).0, "TD17");
        c.execute("UPDATE fornitori SET stato='Stati Uniti' WHERE id=1", []).unwrap();
        assert_eq!(tipo_suggerito(&c, Some(1), &servizio).0, "TD17");
        assert_eq!(tipo_suggerito(&c, Some(1), &merce).0, "TD19");
        assert_eq!(tipo_suggerito(&c, None, &merce).0, "TD17");
    }
}

/// Prova del percorso completo, dalla lettura del PDF fino all'XML: passa dal
/// Router vero, quindi verifica anche le rotte e i nomi dei campi JSON su cui
/// si appoggia la pagina.
#[cfg(test)]
mod test_percorso_completo {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use serde_json::{json, Value};
    use tower::ServiceExt;

    use crate::db::AppState;

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
            "ordeva-autofatt-{}-{:?}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        let state = AppState::init(dir.clone(), dir.join("ordeva.json")).unwrap();
        {
            let conn = crate::web::tenant_conn(&state).unwrap();
            let conn = conn.lock().unwrap();
            conn.execute(
                "UPDATE azienda SET ragione_sociale='Rossi Srl', p_iva='01234567890', \
                 indirizzo='Via Roma 1', cap='37100', citta='Verona', provincia='VR' WHERE id=1",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO fornitori (id, ragione_sociale, p_iva, stato, via, cap, citta) \
                 VALUES (1,'Bauer GmbH','DE123456789','Germania','Hauptstr. 5','80331','Muenchen')",
                [],
            )
            .unwrap();
        }
        Prova { state, dir }
    }

    async fn chiama(state: &AppState, metodo: &str, uri: &str, corpo: Option<Value>) -> (StatusCode, String) {
        let router = crate::server::build_router(state.clone());
        let req = Request::builder().method(metodo).uri(uri);
        let req = match corpo {
            Some(v) => req
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&v).unwrap()))
                .unwrap(),
            None => req.body(Body::empty()).unwrap(),
        };
        let res = router.oneshot(req).await.unwrap();
        let stato = res.status();
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        (stato, String::from_utf8_lossy(&bytes).to_string())
    }

    async fn json(state: &AppState, metodo: &str, uri: &str, corpo: Option<Value>) -> Value {
        let (stato, testo) = chiama(state, metodo, uri, corpo).await;
        assert!(stato.is_success(), "{metodo} {uri} → {stato}: {testo}");
        serde_json::from_str(&testo).unwrap_or(Value::Null)
    }

    #[tokio::test]
    async fn dalla_scansione_all_xml() {
        let p = prepara();

        // 1. Le righe lette dalla fattura estera vengono copiate senza ritocchi.
        let creata = json(
            &p.state,
            "POST",
            "/api/autofatture/da-ocr",
            Some(json!({
                "fornitore": "Bauer GmbH",
                "pIva": "DE123456789",
                "numeroEstero": "R-778",
                "dataEstera": "2026-09-01",
                "totaleEstero": 200.0,
                "righe": [
                    { "descrizione": "Batterie 12V 60Ah", "codice": "B12", "quantita": 10, "unitaMisura": "PZ", "prezzo": 20.0 }
                ],
            })),
        )
        .await;
        let id = creata["id"].as_i64().unwrap();
        assert_eq!(creata["tipoSuggerito"], "TD18", "beni da fornitore UE");
        assert_eq!(creata["motivoTipo"], "beni-ue");

        let doc = json(&p.state, "GET", &format!("/api/autofatture/{id}"), None).await;
        assert_eq!(doc["righe"][0]["descrizione"], "Batterie 12V 60Ah");
        assert_eq!(doc["righe"][0]["codice"], "B12");
        assert_eq!(doc["righe"][0]["iva"], 22.0, "l'IVA italiana la mette il programma");
        assert_eq!(doc["totale"], 244.0);
        assert_eq!(doc["fornitoreId"], 1, "il fornitore è stato riconosciuto dalla P.IVA");

        // 2. Senza spunte non si conferma, per quanto tutto quadri.
        let v = json(&p.state, "GET", &format!("/api/autofatture/{id}/verifiche"), None).await;
        assert_eq!(v["bloccanti"], 0, "controlli: {}", v["controlli"]);
        assert_eq!(v["puoConfermare"], false);
        let (stato, testo) = chiama(&p.state, "POST", &format!("/api/autofatture/{id}/conferma"), Some(json!({}))).await;
        assert_eq!(stato, StatusCode::BAD_REQUEST, "{testo}");

        // 3. L'utente spunta una verifica per volta: solo l'ultima sblocca il tasto.
        let ids: Vec<String> = v["conferme"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c["id"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(ids.len(), 6, "in euro il cambio non si chiede");
        for (i, chiave) in ids.iter().enumerate() {
            let r = json(
                &p.state,
                "POST",
                &format!("/api/autofatture/{id}/verifiche"),
                Some(json!({ chiave.as_str(): true })),
            )
            .await;
            let ultima = i + 1 == ids.len();
            assert_eq!(r["puoConfermare"], ultima, "dopo la spunta {chiave}");
        }

        // 4. Conferma: nasce anche l'acquisto, perché l'autofattura va annotata
        //    sia tra le vendite sia tra gli acquisti.
        let esito = json(&p.state, "POST", &format!("/api/autofatture/{id}/conferma"), Some(json!({}))).await;
        let acquisto_id = esito["acquistoId"].as_i64().unwrap();
        let acquisto = json(&p.state, "GET", &format!("/api/acquisti/{acquisto_id}"), None).await;
        assert_eq!(acquisto["numero"], "R-778");
        assert_eq!(acquisto["righe"][0]["descrizione"], "Batterie 12V 60Ah");
        assert_eq!(acquisto["totale"], 244.0);

        // 5. Confermata, l'autofattura non si modifica più.
        let (stato, _) = chiama(&p.state, "PUT", &format!("/api/autofatture/{id}"), Some(json!({ "numero": "X" }))).await;
        assert_eq!(stato, StatusCode::BAD_REQUEST);

        // 6. L'XML esce con le parti invertite e la fattura estera collegata.
        let (stato, xml) = chiama(&p.state, "GET", &format!("/api/autofatture/{id}/xml"), None).await;
        assert!(stato.is_success());
        assert!(xml.contains("<TipoDocumento>TD18</TipoDocumento>"));
        assert!(xml.contains("<Denominazione>Bauer GmbH</Denominazione>"));
        assert!(xml.contains("<IdDocumento>R-778</IdDocumento>"));
        assert!(xml.contains("<ImportoTotaleDocumento>244.00</ImportoTotaleDocumento>"));

        // 7. Riaprendola l'acquisto sparisce: niente doppie registrazioni.
        json(&p.state, "POST", &format!("/api/autofatture/{id}/riapri"), Some(json!({}))).await;
        let (stato, _) = chiama(&p.state, "GET", &format!("/api/acquisti/{acquisto_id}"), None).await;
        assert_eq!(stato, StatusCode::NOT_FOUND);
    }

    /// Se dal documento non esce nessuna riga la bozza si crea lo stesso, con una
    /// riga da riempire: l'utente ha il documento davanti e può ricopiarlo. Prima
    /// riceveva un errore e restava senza niente.
    #[tokio::test]
    async fn senza_righe_lette_crea_comunque_la_bozza() {
        let p = prepara();
        let creata = json(
            &p.state,
            "POST",
            "/api/autofatture/da-ocr",
            Some(json!({
                "fornitore": "Bauer GmbH",
                "numeroEstero": "R-999",
                "dataEstera": "2026-09-01",
                "righe": [],
            })),
        )
        .await;
        assert_eq!(creata["righeLette"], 0);
        let doc = json(&p.state, "GET", &format!("/api/autofatture/{}", creata["id"].as_i64().unwrap()), None).await;
        assert_eq!(doc["righe"].as_array().unwrap().len(), 1);
        assert_eq!(doc["righe"][0]["descrizione"], "");
        assert_eq!(doc["fatturaEsteraNumero"], "R-999", "gli estremi letti restano");
    }

    /// Fattura in dollari: gli importi si registrano in euro, ma quelli originali
    /// restano visibili per il confronto, e il cambio diventa una verifica in più.
    #[tokio::test]
    async fn la_valuta_estera_aggiunge_una_verifica() {
        let p = prepara();
        let creata = json(
            &p.state,
            "POST",
            "/api/autofatture/da-ocr",
            Some(json!({
                "fornitore": "Bauer GmbH",
                "numeroEstero": "US-1",
                "dataEstera": "2026-09-01",
                "valuta": "usd",
                "cambio": 0.9,
                "totaleEstero": 100.0,
                "righe": [{ "descrizione": "Consulenza", "quantita": 1, "prezzo": 100.0 }],
            })),
        )
        .await;
        let id = creata["id"].as_i64().unwrap();
        assert_eq!(creata["tipoSuggerito"], "TD17", "nessun codice né unità: sono servizi");

        let doc = json(&p.state, "GET", &format!("/api/autofatture/{id}"), None).await;
        assert_eq!(doc["valuta"], "USD");
        assert_eq!(doc["righe"][0]["prezzoValuta"], 100.0, "l'importo originale resta");
        assert_eq!(doc["righe"][0]["prezzo"], 90.0, "in euro al cambio indicato");

        let v = json(&p.state, "GET", &format!("/api/autofatture/{id}/verifiche"), None).await;
        let ids: Vec<&str> = v["conferme"].as_array().unwrap().iter().map(|c| c["id"].as_str().unwrap()).collect();
        assert!(ids.contains(&"cambio"), "manca la conferma sul cambio: {ids:?}");
        assert_eq!(v["bloccanti"], 0, "controlli: {}", v["controlli"]);
    }
}
