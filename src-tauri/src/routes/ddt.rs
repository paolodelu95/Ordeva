//! /api/ddt — documenti di trasporto (cliente/reso fornitore) con scarico scorte,
//! conversione in fattura e stampa. Parità con routes/ddt.js.

use axum::{
    extract::{Path, State},
    routing::get,
    Json, Router,
};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde_json::{json, Value};

use crate::audit::audit;
use crate::db::AppState;
use crate::error::{ApiError, ApiResult};
use crate::numerazione::get_next_numero;
use crate::stock::{applica_righe_stock, check_riordino, StockCtx};
use crate::web::{num, oggi, opt_num, raw_opt, str_def, tenant_conn};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/non-fatturati", get(non_fatturati))
        .route("/:id", get(detail).put(update).delete(remove))
        .route("/:id/print", get(print))
        .route("/:id/to-fattura", axum::routing::post(to_fattura))
        .route("/:id/stato", axum::routing::patch(patch_stato))
}

const SELECT_LIST: &str = "SELECT d.*, c.ragione_sociale as cliente_nome, fo.ragione_sociale as fornitore_nome, \
    f.id as fattura_id, f.numero as fattura_numero \
    FROM ddt d LEFT JOIN clienti c ON d.cliente_id = c.id \
    LEFT JOIN fornitori fo ON d.fornitore_id = fo.id LEFT JOIN fatture f ON f.ddt_id = d.id";

// Il dettaglio (come Node) NON fa la JOIN su fatture: fatturaId/Numero restano null.
const SELECT_DETAIL: &str = "SELECT d.*, c.ragione_sociale as cliente_nome, fo.ragione_sociale as fornitore_nome \
    FROM ddt d LEFT JOIN clienti c ON d.cliente_id = c.id LEFT JOIN fornitori fo ON d.fornitore_id = fo.id";

async fn list(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let mut stmt = conn.prepare(&format!("{SELECT_LIST} ORDER BY d.data_emissione DESC"))?;
    let rows = stmt.query_map([], |r| to_dto(&conn, r))?.collect::<Result<Vec<_>, _>>()?;
    Ok(Json(Value::Array(rows)))
}

async fn non_fatturati(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT d.*, c.ragione_sociale as cliente_nome, c.tipo_pagamento_id as cliente_tipo_pagamento_id \
         FROM ddt d LEFT JOIN clienti c ON d.cliente_id = c.id \
         WHERE d.stato != 'ANNULLATO' AND COALESCE(d.tipo,'CLIENTE') = 'CLIENTE' \
           AND NOT EXISTS (SELECT 1 FROM fatture f WHERE f.ddt_id = d.id) \
           AND NOT EXISTS (SELECT 1 FROM fatture_ddt fd WHERE fd.ddt_id = d.id) \
         ORDER BY d.cliente_id, d.data_emissione",
    )?;
    let rows = stmt
        .query_map([], |r| {
            let mut dto = to_dto(&conn, r)?;
            dto["clienteTipoPagamentoId"] = json!(r.get::<_, Option<i64>>("cliente_tipo_pagamento_id")?);
            Ok(dto)
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(Value::Array(rows)))
}

async fn detail(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let dto = conn
        .query_row(&format!("{SELECT_DETAIL} WHERE d.id=?1"), [id], |r| to_dto(&conn, r))
        .optional()?;
    let mut dto = dto.ok_or_else(|| ApiError::not_found("Not found"))?;
    dto["righe"] = Value::Array(get_righe(&conn, id)?);
    Ok(Json(dto))
}

async fn create(State(state): State<AppState>, Json(d): Json<Value>) -> ApiResult<Json<Value>> {
    let numero = d.get("numero").and_then(Value::as_str).unwrap_or("");
    let arc = tenant_conn(&state)?;
    let mut guard = arc.lock().unwrap();
    if guard.query_row("SELECT id FROM ddt WHERE numero=?1", [numero], |_| Ok(())).optional()?.is_some() {
        return Err(ApiError::conflict(format!("Il numero {numero} è già utilizzato da un altro documento")));
    }
    let is_forn = d.get("tipo").and_then(Value::as_str) == Some("FORNITORE");
    let cliente_id = if is_forn { None } else { opt_i64(&d, "clienteId") };
    let fornitore_id = if is_forn { opt_i64(&d, "fornitoreId") } else { None };
    let stato = d.get("stato").and_then(Value::as_str).unwrap_or("EMESSO").to_string();

    let tx = guard.transaction().map_err(ApiError::from)?;
    insert_ddt(&tx, &d, numero, is_forn, cliente_id, fornitore_id, &stato, None)?;
    let ddt_id = tx.last_insert_rowid();
    if let Some(righe) = d.get("righe").and_then(Value::as_array).filter(|r| !r.is_empty()) {
        save_righe(&tx, ddt_id, righe)?;
        let ctx = StockCtx {
            data: d.get("dataEmissione").and_then(Value::as_str).map(str::to_string),
            causale: "DDT".into(),
            documento_tipo: "DDT".into(),
            documento_id: Some(ddt_id),
            documento_numero: numero.to_string(),
            cliente_id,
            cliente_nome: controparte_nome(&tx, &d, is_forn),
            ..Default::default()
        };
        applica_righe_stock(&tx, righe, -1, &ctx)?;
        let pids: Vec<i64> = righe.iter().filter_map(|r| r.get("prodottoId").and_then(Value::as_i64)).filter(|&v| v != 0).collect();
        check_riordino(&tx, &pids)?;
    }
    audit(&tx, "ddt", ddt_id, "CREATE", &json!({ "numero": numero, "tipo": if is_forn {"FORNITORE"} else {"CLIENTE"}, "clienteId": cliente_id, "fornitoreId": fornitore_id, "stato": stato, "numRighe": d.get("righe").and_then(Value::as_array).map(|a| a.len()).unwrap_or(0) }));
    tx.commit().map_err(ApiError::from)?;
    Ok(Json(json!({ "id": ddt_id })))
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(d): Json<Value>,
) -> ApiResult<Json<Value>> {
    let numero = d.get("numero").and_then(Value::as_str).unwrap_or("");
    let arc = tenant_conn(&state)?;
    let mut guard = arc.lock().unwrap();
    if guard.query_row("SELECT id FROM ddt WHERE numero=?1 AND id!=?2", params![numero, id], |_| Ok(())).optional()?.is_some() {
        return Err(ApiError::conflict(format!("Il numero {numero} è già utilizzato da un altro documento")));
    }
    let tx = guard.transaction().map_err(ApiError::from)?;
    let old = tx
        .query_row("SELECT numero, cliente_id FROM ddt WHERE id=?1", [id], |r| {
            Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<i64>>(1)?))
        })
        .optional()?;
    let vecchie = get_righe(&tx, id)?;
    if !vecchie.is_empty() {
        let (onum, ocid) = old.clone().unwrap_or((None, None));
        let ctx = StockCtx {
            causale: "STORNO".into(),
            documento_tipo: "DDT".into(),
            documento_id: Some(id),
            documento_numero: onum.unwrap_or_default(),
            cliente_id: ocid,
            cliente_nome: nome_cliente(&tx, ocid),
            ..Default::default()
        };
        applica_righe_stock(&tx, &vecchie, 1, &ctx)?;
    }
    let is_forn = d.get("tipo").and_then(Value::as_str) == Some("FORNITORE");
    let cliente_id = if is_forn { None } else { opt_i64(&d, "clienteId") };
    let fornitore_id = if is_forn { opt_i64(&d, "fornitoreId") } else { None };
    let stato = d.get("stato").and_then(Value::as_str).unwrap_or("").to_string();
    insert_ddt(&tx, &d, numero, is_forn, cliente_id, fornitore_id, &stato, Some(id))?;
    tx.execute("DELETE FROM ddt_righe WHERE ddt_id=?1", [id])?;
    if let Some(righe) = d.get("righe").and_then(Value::as_array).filter(|r| !r.is_empty()) {
        save_righe(&tx, id, righe)?;
        let ctx = StockCtx {
            data: d.get("dataEmissione").and_then(Value::as_str).map(str::to_string),
            causale: "DDT".into(),
            documento_tipo: "DDT".into(),
            documento_id: Some(id),
            documento_numero: numero.to_string(),
            cliente_id,
            cliente_nome: controparte_nome(&tx, &d, is_forn),
            ..Default::default()
        };
        applica_righe_stock(&tx, righe, -1, &ctx)?;
    }
    audit(&tx, "ddt", id, "UPDATE", &json!({ "numero": numero }));
    tx.commit().map_err(ApiError::from)?;
    Ok(Json(json!({ "success": true })))
}

async fn remove(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let arc = tenant_conn(&state)?;
    let mut guard = arc.lock().unwrap();
    let tx = guard.transaction().map_err(ApiError::from)?;
    let ddt = tx
        .query_row("SELECT stato, numero, cliente_id FROM ddt WHERE id=?1", [id], |r| {
            Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, Option<i64>>(2)?))
        })
        .optional()?;
    if let Some((ref st, ref onum, ocid)) = ddt {
        if st.as_deref() != Some("ANNULLATO") {
            let righe = get_righe(&tx, id)?;
            if !righe.is_empty() {
                let ctx = StockCtx {
                    causale: "ELIMINAZIONE".into(),
                    documento_tipo: "DDT".into(),
                    documento_id: Some(id),
                    documento_numero: onum.clone().unwrap_or_default(),
                    cliente_id: ocid,
                    cliente_nome: nome_cliente(&tx, ocid),
                    ..Default::default()
                };
                applica_righe_stock(&tx, &righe, 1, &ctx)?;
            }
        }
    }
    tx.execute("UPDATE fatture SET ddt_id = NULL WHERE ddt_id=?1", [id])?;
    tx.execute("DELETE FROM fatture_ddt WHERE ddt_id=?1", [id])?;
    tx.execute("DELETE FROM ddt_righe WHERE ddt_id=?1", [id])?;
    tx.execute("DELETE FROM ddt WHERE id=?1", [id])?;
    let (onum, ost, ocid) = ddt.map(|(s, n, c)| (n, s, c)).unwrap_or((None, None, None));
    audit(&tx, "ddt", id, "DELETE", &json!({ "numero": onum, "stato": ost, "clienteId": ocid }));
    tx.commit().map_err(ApiError::from)?;
    Ok(Json(json!({ "success": true })))
}

async fn patch_stato(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(b): Json<Value>,
) -> ApiResult<Json<Value>> {
    let stato = b.get("stato").and_then(Value::as_str).unwrap_or("").to_string();
    let arc = tenant_conn(&state)?;
    let mut guard = arc.lock().unwrap();
    let tx = guard.transaction().map_err(ApiError::from)?;
    let vecchio = tx
        .query_row("SELECT stato, numero, cliente_id FROM ddt WHERE id=?1", [id], |r| {
            Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, Option<i64>>(2)?))
        })
        .optional()?;
    let (old_stato, onum, ocid) = vecchio.unwrap_or((None, None, None));
    let righe = get_righe(&tx, id)?;
    let base = |causale: &str| StockCtx {
        causale: causale.into(),
        documento_tipo: "DDT".into(),
        documento_id: Some(id),
        documento_numero: onum.clone().unwrap_or_default(),
        cliente_id: ocid,
        cliente_nome: nome_cliente(&tx, ocid),
        ..Default::default()
    };
    if stato == "ANNULLATO" && old_stato.as_deref() != Some("ANNULLATO") {
        applica_righe_stock(&tx, &righe, 1, &base("ANNULLAMENTO"))?;
    } else if old_stato.as_deref() == Some("ANNULLATO") && stato != "ANNULLATO" {
        applica_righe_stock(&tx, &righe, -1, &base("RIATTIVAZIONE"))?;
    }
    tx.execute("UPDATE ddt SET stato=?1 WHERE id=?2", params![stato, id])?;
    audit(&tx, "ddt", id, "UPDATE", &json!({ "before": { "stato": old_stato }, "after": { "stato": stato } }));
    tx.commit().map_err(ApiError::from)?;
    Ok(Json(json!({ "success": true })))
}

async fn to_fattura(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let arc = tenant_conn(&state)?;
    let mut guard = arc.lock().unwrap();
    let ddt = guard
        .query_row("SELECT tipo, cliente_id, numero FROM ddt WHERE id=?1", [id], |r| {
            Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<i64>>(1)?, r.get::<_, Option<String>>(2)?))
        })
        .optional()?;
    let (tipo, cliente_id, dnum) = ddt.ok_or_else(|| ApiError::not_found("Documento di trasporto non trovato"))?;
    if tipo.as_deref().unwrap_or("CLIENTE") == "FORNITORE" {
        return Err(ApiError::bad_request(
            "Un documento di trasporto verso un fornitore (reso) non può essere convertito in fattura",
        ));
    }
    if let Some(ex_num) = guard
        .query_row("SELECT numero FROM fatture WHERE ddt_id=?1", [id], |r| r.get::<_, Option<String>>(0))
        .optional()?
        .flatten()
    {
        return Err(ApiError::conflict(format!("Documento di trasporto già collegato alla fattura n. {ex_num}")));
    }
    let righe = get_righe(&guard, id)?;
    let tx = guard.transaction().map_err(ApiError::from)?;
    let numero = get_next_numero(&tx, "fatture", "fatture", 0)?;
    let data = oggi();
    let dnum_s = dnum.unwrap_or_default();
    tx.execute(
        "INSERT INTO fatture (numero, data_emissione, cliente_id, ddt_id, note, stato) VALUES (?1,?2,?3,?4,?5,'EMESSA')",
        params![numero, data, cliente_id, id, format!("Da documento di trasporto n. {dnum_s}")],
    )?;
    let fattura_id = tx.last_insert_rowid();
    tx.execute("INSERT OR IGNORE INTO fatture_ddt (fattura_id, ddt_id) VALUES (?1,?2)", params![fattura_id, id])?;
    for r in &righe {
        if crate::web::riga_vuota(r) {
            continue;
        }
        tx.execute(
            "INSERT INTO fatture_righe (fattura_id, prodotto_id, descrizione, quantita, prezzo, sconto, iva, unita_misura, variante_id, variante_taglia, variante_colore) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![
                fattura_id,
                r.get("prodottoId").and_then(Value::as_i64),
                r.get("descrizione").and_then(Value::as_str),
                r.get("quantita").and_then(Value::as_f64),
                r.get("prezzo").and_then(Value::as_f64),
                r.get("sconto").and_then(Value::as_f64).unwrap_or(0.0),
                r.get("iva").and_then(Value::as_f64),
                r.get("unitaMisura").and_then(Value::as_str).unwrap_or(""),
                r.get("varianteId").and_then(Value::as_i64),
                r.get("varianteTaglia").and_then(Value::as_str).unwrap_or(""),
                r.get("varianteColore").and_then(Value::as_str).unwrap_or(""),
            ],
        )?;
    }
    tx.commit().map_err(ApiError::from)?;
    Ok(Json(json!({ "id": fattura_id, "numero": numero })))
}

async fn print(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let row = conn
        .query_row(
            "SELECT d.*, c.ragione_sociale as c_nome, c.via as c_via, c.cap as c_cap, c.citta as c_citta, \
                    c.provincia as c_provincia, c.stato as c_stato, c.p_iva as c_p_iva, c.codice_fiscale as c_cod_fiscale, \
                    c.email as c_email, c.telefono as c_telefono, \
                    fo.ragione_sociale as f_nome, fo.via as f_via, fo.cap as f_cap, fo.citta as f_citta, \
                    fo.provincia as f_provincia, fo.stato as f_stato, fo.p_iva as f_p_iva, fo.email as f_email, fo.telefono as f_telefono \
             FROM ddt d LEFT JOIN clienti c ON d.cliente_id = c.id LEFT JOIN fornitori fo ON d.fornitore_id = fo.id WHERE d.id=?1",
            [id],
            |r| {
                let mut dto = to_dto(&conn, r)?;
                let is_forn = dto["tipo"].as_str() == Some("FORNITORE");
                let g = |k: &str| r.get::<_, Option<String>>(k).ok().flatten();
                dto["righe"] = Value::Null; // riempito dopo
                let cliente = if is_forn {
                    json!({
                        "ragioneSociale": g("f_nome"), "via": g("f_via"), "cap": g("f_cap"),
                        "citta": g("f_citta"), "provincia": g("f_provincia"), "stato": g("f_stato"),
                        "pIva": g("f_p_iva"), "codFiscale": "", "email": g("f_email"), "telefono": g("f_telefono"),
                    })
                } else {
                    json!({
                        "ragioneSociale": g("c_nome"), "via": g("c_via"), "cap": g("c_cap"),
                        "citta": g("c_citta"), "provincia": g("c_provincia"), "stato": g("c_stato"),
                        "pIva": g("c_p_iva"), "codFiscale": g("c_cod_fiscale"), "email": g("c_email"), "telefono": g("c_telefono"),
                    })
                };
                dto["cliente"] = cliente;
                Ok(dto)
            },
        )
        .optional()?;
    let mut dto = row.ok_or_else(|| ApiError::not_found("Not found"))?;
    // La query /print non seleziona cliente_nome: Node omette del tutto la chiave.
    if let Some(o) = dto.as_object_mut() {
        o.remove("clienteNome");
    }
    dto["righe"] = Value::Array(get_righe(&conn, id)?);
    Ok(Json(dto))
}

// ── helpers ──────────────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
fn insert_ddt(
    conn: &Connection,
    d: &Value,
    numero: &str,
    is_forn: bool,
    cliente_id: Option<i64>,
    fornitore_id: Option<i64>,
    stato: &str,
    update_id: Option<i64>,
) -> rusqlite::Result<()> {
    let data = d.get("dataEmissione").and_then(Value::as_str);
    let tipo = if is_forn { "FORNITORE" } else { "CLIENTE" };
    let causale = str_def(d, "causaleTrasporto");
    let note = str_def(d, "note");
    let dora = str_def(d, "dataOraInizioTrasporto");
    let aspetto = str_def(d, "aspettoBeni");
    let porto = str_or(d, "porto", "Franco");
    let colli = d.get("numeroColli").and_then(Value::as_f64).unwrap_or(0.0);
    let peso = d.get("pesoLordo").and_then(Value::as_f64).unwrap_or(0.0);
    let incaricato = str_or(d, "incaricatoTrasporto", "Mittente");
    let vettore = str_def(d, "vettore");
    let destdiv = str_def(d, "destinazioneDiversa");
    let notetr = str_def(d, "noteTrasporto");
    let destid = opt_i64(d, "destinazioneId");
    match update_id {
        None => conn.execute(
            "INSERT INTO ddt (numero, data_emissione, tipo, cliente_id, fornitore_id, causale, note, stato, \
             data_ora_inizio_trasporto, aspetto_beni, porto, numero_colli, peso_lordo, incaricato_trasporto, vettore, \
             destinazione_diversa, note_trasporto, destinazione_id) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)",
            params![numero, data, tipo, cliente_id, fornitore_id, causale, note, stato, dora, aspetto, porto, colli, peso, incaricato, vettore, destdiv, notetr, destid],
        )?,
        Some(id) => conn.execute(
            "UPDATE ddt SET numero=?1, data_emissione=?2, tipo=?3, cliente_id=?4, fornitore_id=?5, causale=?6, note=?7, stato=?8, \
             data_ora_inizio_trasporto=?9, aspetto_beni=?10, porto=?11, numero_colli=?12, peso_lordo=?13, incaricato_trasporto=?14, vettore=?15, \
             destinazione_diversa=?16, note_trasporto=?17, destinazione_id=?18 WHERE id=?19",
            params![numero, data, tipo, cliente_id, fornitore_id, causale, note, stato, dora, aspetto, porto, colli, peso, incaricato, vettore, destdiv, notetr, destid, id],
        )?,
    };
    Ok(())
}

fn save_righe(conn: &Connection, ddt_id: i64, righe: &[Value]) -> rusqlite::Result<()> {
    for r in righe {
        if crate::web::riga_vuota(r) {
            continue;
        }
        conn.execute(
            "INSERT INTO ddt_righe (ddt_id, prodotto_id, codice_prodotto, descrizione, quantita, prezzo, sconto, iva, codice_iva, unita_misura, variante_id, variante_taglia, variante_colore, tipo, scarica_magazzino) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
            params![
                ddt_id,
                opt_i64(r, "prodottoId"),
                str_def(r, "codiceProdotto"),
                raw_opt(r, "descrizione"),
                r.get("quantita").and_then(Value::as_f64),
                r.get("prezzo").and_then(Value::as_f64),
                r.get("sconto").and_then(Value::as_f64).unwrap_or(0.0),
                r.get("iva").and_then(Value::as_f64),
                str_def(r, "codiceIva"),
                str_def(r, "unitaMisura"),
                opt_i64(r, "varianteId"),
                str_def(r, "varianteTaglia"),
                str_def(r, "varianteColore"),
                str_or(r, "tipo", "PRODOTTO"),
                if matches!(r.get("scaricaMagazzino"), Some(Value::Bool(false))) { 0 } else { 1 },
            ],
        )?;
    }
    Ok(())
}

fn get_righe(conn: &Connection, ddt_id: i64) -> rusqlite::Result<Vec<Value>> {
    let mut stmt = conn.prepare(
        "SELECT dr.*, p.codice as prodotto_codice FROM ddt_righe dr LEFT JOIN prodotti p ON dr.prodotto_id = p.id WHERE dr.ddt_id=?1",
    )?;
    let rows = stmt
        .query_map([ddt_id], |r| {
            Ok(json!({
                "id": r.get::<_, i64>("id")?,
                "prodottoId": r.get::<_, Option<i64>>("prodotto_id")?,
                "prodottoCodice": r.get::<_, Option<String>>("prodotto_codice")?,
                "codiceProdotto": r.get::<_, Option<String>>("codice_prodotto")?.unwrap_or_default(),
                "descrizione": r.get::<_, Option<String>>("descrizione")?,
                "quantita": opt_num(r.get::<_, Option<f64>>("quantita")?),
                "unitaMisura": r.get::<_, Option<String>>("unita_misura")?,
                "prezzo": opt_num(r.get::<_, Option<f64>>("prezzo")?),
                "sconto": opt_num(Some(r.get::<_, Option<f64>>("sconto")?.unwrap_or(0.0))),
                "iva": opt_num(r.get::<_, Option<f64>>("iva")?),
                "codiceIva": r.get::<_, Option<String>>("codice_iva")?.unwrap_or_default(),
                "varianteId": r.get::<_, Option<i64>>("variante_id")?,
                "varianteTaglia": r.get::<_, Option<String>>("variante_taglia")?.unwrap_or_default(),
                "varianteColore": r.get::<_, Option<String>>("variante_colore")?.unwrap_or_default(),
                "tipo": r.get::<_, Option<String>>("tipo")?.filter(|s| !s.is_empty()).unwrap_or_else(|| "PRODOTTO".into()),
                "scaricaMagazzino": r.get::<_, Option<i64>>("scarica_magazzino")? != Some(0),
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn to_dto(conn: &Connection, r: &Row) -> rusqlite::Result<Value> {
    let id = r.get::<_, i64>("id")?;
    let totale: f64 = conn.query_row(
        "SELECT COALESCE(SUM(quantita * prezzo * (1 - COALESCE(sconto,0)/100) * (1 + iva/100)), 0) FROM ddt_righe WHERE ddt_id=?1",
        [id], |x| x.get(0),
    )?;
    let imponibile: f64 = conn.query_row(
        "SELECT COALESCE(SUM(quantita * prezzo * (1 - COALESCE(sconto,0)/100)), 0) FROM ddt_righe WHERE ddt_id=?1",
        [id], |x| x.get(0),
    )?;
    let tipo = r.get::<_, Option<String>>("tipo")?.filter(|s| !s.is_empty()).unwrap_or_else(|| "CLIENTE".into());
    // cliente_nome/fornitore_nome non esistono nella query /print: tolleranti.
    let cliente_nome = r.get::<_, Option<String>>("cliente_nome").ok().flatten();
    let fornitore_nome = r.get::<_, Option<String>>("fornitore_nome").ok().flatten();
    Ok(json!({
        "id": id,
        "numero": r.get::<_, Option<String>>("numero")?,
        "dataEmissione": r.get::<_, Option<String>>("data_emissione")?,
        "tipo": tipo,
        "clienteId": r.get::<_, Option<i64>>("cliente_id")?,
        "clienteNome": cliente_nome,
        "fornitoreId": r.get::<_, Option<i64>>("fornitore_id")?,
        "fornitoreNome": fornitore_nome,
        "controparteNome": if tipo == "FORNITORE" { r.get::<_, Option<String>>("fornitore_nome").ok().flatten().unwrap_or_default() } else { cliente_nome.clone().unwrap_or_default() },
        "causaleTrasporto": r.get::<_, Option<String>>("causale")?.unwrap_or_default(),
        "note": r.get::<_, Option<String>>("note")?,
        "stato": r.get::<_, Option<String>>("stato")?,
        "fatturaId": r.get::<_, Option<i64>>("fattura_id").ok().flatten(),
        "fatturaNumero": r.get::<_, Option<String>>("fattura_numero").ok().flatten(),
        "totale": num(totale),
        "imponibile": num(imponibile),
        "dataOraInizioTrasporto": r.get::<_, Option<String>>("data_ora_inizio_trasporto")?.unwrap_or_default(),
        "aspettoBeni": r.get::<_, Option<String>>("aspetto_beni")?.unwrap_or_default(),
        "porto": r.get::<_, Option<String>>("porto")?.filter(|s| !s.is_empty()).unwrap_or_else(|| "Franco".into()),
        "numeroColli": num(r.get::<_, Option<f64>>("numero_colli")?.unwrap_or(0.0)),
        "pesoLordo": num(r.get::<_, Option<f64>>("peso_lordo")?.unwrap_or(0.0)),
        "incaricatoTrasporto": r.get::<_, Option<String>>("incaricato_trasporto")?.filter(|s| !s.is_empty()).unwrap_or_else(|| "Mittente".into()),
        "vettore": r.get::<_, Option<String>>("vettore")?.unwrap_or_default(),
        "destinazioneDiversa": r.get::<_, Option<String>>("destinazione_diversa")?.unwrap_or_default(),
        "noteTrasporto": r.get::<_, Option<String>>("note_trasporto")?.unwrap_or_default(),
        "destinazioneId": r.get::<_, Option<i64>>("destinazione_id")?,
    }))
}

fn controparte_nome(conn: &Connection, d: &Value, is_forn: bool) -> String {
    if is_forn {
        nome_di(conn, "fornitori", opt_i64(d, "fornitoreId"))
    } else {
        nome_di(conn, "clienti", opt_i64(d, "clienteId"))
    }
}
fn nome_cliente(conn: &Connection, id: Option<i64>) -> String {
    nome_di(conn, "clienti", id)
}
fn nome_di(conn: &Connection, table: &str, id: Option<i64>) -> String {
    match id {
        Some(i) => conn
            .query_row(&format!("SELECT ragione_sociale FROM {table} WHERE id=?1"), [i], |r| r.get::<_, Option<String>>(0))
            .optional()
            .ok()
            .flatten()
            .flatten()
            .unwrap_or_default(),
        None => String::new(),
    }
}

fn str_or(b: &Value, k: &str, d: &str) -> String {
    let s = str_def(b, k);
    if s.is_empty() { d.to_string() } else { s }
}
fn opt_i64(b: &Value, k: &str) -> Option<i64> {
    b.get(k).and_then(Value::as_i64).filter(|&v| v != 0)
}
