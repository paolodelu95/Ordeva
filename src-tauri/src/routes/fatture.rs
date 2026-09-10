//! /api/fatture — fatture con campi fiscali (ritenuta/cassa/bollo), scarico scorte,
//! generazione da DDT, pagamento immediato e stato SDI. Parità con routes/fatture.js.

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
use crate::fiscale::{calcola_totali_fiscali, fisc_from_row, fisc_values};
use crate::numerazione::get_next_numero;
use crate::stock::{applica_righe_stock, StockCtx};
use crate::web::{num, oggi, opt_num, raw_opt, str_def, tenant_conn};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/da-ddt", axum::routing::post(da_ddt))
        .route("/:id", get(detail).put(update).delete(remove))
        .route("/:id/print", get(print))
        .route("/:id/stato", axum::routing::patch(patch_stato))
        .route("/:id/stato-sdi", axum::routing::patch(patch_stato_sdi))
}

const INS_FATT: &str = "INSERT INTO fatture (numero, data_emissione, cliente_id, ddt_id, note, stato, tipo_pagamento_id, \
    ritenuta_aliquota, ritenuta_causale, ritenuta_tipo, ritenuta_su_cassa, cassa_tipo, cassa_aliquota, cassa_iva, bollo, agente_id, provvigione) \
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)";

async fn list(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT f.*, c.ragione_sociale as cliente_nome FROM fatture f LEFT JOIN clienti c ON f.cliente_id = c.id ORDER BY f.data_emissione DESC",
    )?;
    let rows = stmt.query_map([], |r| to_dto(&conn, r))?.collect::<Result<Vec<_>, _>>()?;
    Ok(Json(Value::Array(rows)))
}

async fn detail(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let dto = conn
        .query_row(
            "SELECT f.*, c.ragione_sociale as cliente_nome FROM fatture f LEFT JOIN clienti c ON f.cliente_id = c.id WHERE f.id=?1",
            [id],
            |r| to_dto(&conn, r),
        )
        .optional()?;
    let mut dto = dto.ok_or_else(|| ApiError::not_found("Not found"))?;
    dto["righe"] = Value::Array(get_righe(&conn, id)?);
    dto["ddtIds"] = Value::Array(get_ddt_ids(&conn, id)?.into_iter().map(Value::from).collect());
    dto["riferimenti"] = Value::Array(get_riferimenti(&conn, id)?);
    Ok(Json(dto))
}

async fn create(State(state): State<AppState>, Json(f): Json<Value>) -> ApiResult<Json<Value>> {
    if f.get("clienteId").and_then(Value::as_i64).filter(|&v| v != 0).is_none() {
        return Err(ApiError::bad_request("Il cliente è obbligatorio"));
    }
    if let Some(e) = valida_righe(f.get("righe")) {
        return Err(ApiError::bad_request(e));
    }
    let numero = f.get("numero").and_then(Value::as_str).unwrap_or("");
    let arc = tenant_conn(&state)?;
    let mut guard = arc.lock().unwrap();
    if guard.query_row("SELECT id FROM fatture WHERE numero=?1", [numero], |_| Ok(())).optional()?.is_some() {
        return Err(ApiError::conflict(format!("Il numero {numero} è già utilizzato da un altro documento")));
    }
    let ddt_ids = ddt_ids_of(&f);
    let tx = guard.transaction().map_err(ApiError::from)?;
    let id = create_tx(&tx, &f, &ddt_ids).map_err(sql_400)?;
    tx.commit().map_err(ApiError::from)?;
    Ok(Json(json!({ "id": id })))
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(f): Json<Value>,
) -> ApiResult<Json<Value>> {
    if f.get("clienteId").and_then(Value::as_i64).filter(|&v| v != 0).is_none() {
        return Err(ApiError::bad_request("Il cliente è obbligatorio"));
    }
    if let Some(e) = valida_righe(f.get("righe")) {
        return Err(ApiError::bad_request(e));
    }
    let numero = f.get("numero").and_then(Value::as_str).unwrap_or("");
    let arc = tenant_conn(&state)?;
    let mut guard = arc.lock().unwrap();
    if guard.query_row("SELECT id FROM fatture WHERE numero=?1 AND id!=?2", params![numero, id], |_| Ok(())).optional()?.is_some() {
        return Err(ApiError::conflict(format!("Il numero {numero} è già utilizzato da un altro documento")));
    }
    let ddt_ids = ddt_ids_of(&f);
    let tx = guard.transaction().map_err(ApiError::from)?;
    update_tx(&tx, id, &f, &ddt_ids).map_err(sql_400)?;
    tx.commit().map_err(ApiError::from)?;
    Ok(Json(json!({ "success": true })))
}

async fn remove(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let arc = tenant_conn(&state)?;
    let mut guard = arc.lock().unwrap();
    let tx = guard.transaction().map_err(ApiError::from)?;
    let exists = tx.query_row("SELECT 1 FROM fatture WHERE id=?1", [id], |_| Ok(())).optional()?.is_some();
    if exists {
        let snapshot = tx.query_row(
            "SELECT numero, data_emissione, cliente_id, stato, note FROM fatture WHERE id=?1", [id],
            |r| Ok(json!({ "numero": r.get::<_,Option<String>>(0)?, "data_emissione": r.get::<_,Option<String>>(1)?, "cliente_id": r.get::<_,Option<i64>>(2)?, "stato": r.get::<_,Option<String>>(3)?, "note": r.get::<_,Option<String>>(4)? })),
        )?;
        let ddt_ids = get_ddt_ids(&tx, id)?;
        if ddt_ids.is_empty() {
            let righe = get_righe(&tx, id)?;
            if !righe.is_empty() {
                let (fnum, fcid) = tx.query_row("SELECT numero, cliente_id FROM fatture WHERE id=?1", [id], |r| Ok((r.get::<_,Option<String>>(0)?, r.get::<_,Option<i64>>(1)?)))?;
                let ctx = stock_ctx("ELIMINAZIONE", id, &fnum.unwrap_or_default(), fcid, nome_cliente(&tx, fcid), None);
                applica_righe_stock(&tx, &righe, 1, &ctx)?;
            }
        }
        tx.execute("DELETE FROM pagamenti WHERE fattura_id=?1", [id])?;
        tx.execute("UPDATE note_credito SET fattura_id=NULL WHERE fattura_id=?1", [id])?;
        tx.execute("DELETE FROM fatture WHERE id=?1", [id])?;
        audit(&tx, "fattura", id, "DELETE", &snapshot);
    }
    tx.commit().map_err(ApiError::from)?;
    Ok(Json(json!({ "success": true })))
}

async fn da_ddt(State(state): State<AppState>, Json(b): Json<Value>) -> ApiResult<Json<Value>> {
    let items = match b.get("items").and_then(Value::as_array).filter(|a| !a.is_empty()) {
        Some(a) => a.clone(),
        None => return Err(ApiError::bad_request("items richiesto")),
    };
    let arc = tenant_conn(&state)?;
    let mut guard = arc.lock().unwrap();
    let tx = guard.transaction().map_err(ApiError::from)?;
    let mut created: Vec<Value> = Vec::new();
    for item in &items {
        let cliente_id = item.get("clienteId").and_then(Value::as_i64).filter(|&v| v != 0);
        let tipo_pag = item.get("tipoPagamentoId").and_then(Value::as_i64).filter(|&v| v != 0);
        let ddt_ids: Vec<i64> = item.get("ddtIds").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_i64).collect()).unwrap_or_default();
        if ddt_ids.is_empty() {
            continue;
        }
        // DDT validi
        let mut ddts: Vec<(i64, String, String)> = Vec::new();
        for did in &ddt_ids {
            if let Some(d) = tx.query_row("SELECT id, numero, data_emissione FROM ddt WHERE id=?1", [did], |r| Ok((r.get::<_,i64>(0)?, r.get::<_,Option<String>>(1)?.unwrap_or_default(), r.get::<_,Option<String>>(2)?.unwrap_or_default()))).optional()? {
                ddts.push(d);
            }
        }
        if ddts.is_empty() {
            continue;
        }
        let numero = get_next_numero(&tx, "fatture", "fatture", 0)?;
        let oggi = oggi();
        let ddt_nums = ddts.iter().map(|d| d.1.clone()).collect::<Vec<_>>().join(", ");
        let cliente_nome = nome_cliente(&tx, cliente_id);
        tx.execute(INS_FATT, params![numero, oggi, cliente_id, ddts[0].0, format!("Da documenti di trasporto: {ddt_nums}"), "EMESSA", tipo_pag, 0.0, "", "", 0, "", 0.0, 0.0, 0, None::<i64>, None::<f64>])?;
        let fattura_id = tx.last_insert_rowid();
        for (ddt_id, ddt_num, ddt_data) in &ddts {
            tx.execute("INSERT OR IGNORE INTO fatture_ddt (fattura_id, ddt_id) VALUES (?1,?2)", params![fattura_id, ddt_id])?;
            let dmy = ddt_data.split('T').next().unwrap_or("").split('-').collect::<Vec<_>>();
            let rif = if dmy.len() == 3 {
                format!("Riferimento documento di trasporto n. {ddt_num} del {}/{}/{}", dmy[2], dmy[1], dmy[0])
            } else {
                format!("Riferimento documento di trasporto n. {ddt_num}")
            };
            tx.execute(
                "INSERT INTO fatture_righe (fattura_id, prodotto_id, descrizione, quantita, prezzo, sconto, iva, codice_iva, unita_misura, variante_id, variante_taglia, variante_colore, tipo, ddt_id) \
                 VALUES (?1,NULL,?2,0,0,0,0,'','',NULL,'','','NOTA',?3)",
                params![fattura_id, rif, ddt_id],
            )?;
            for r in get_ddt_righe(&tx, *ddt_id)? {
                tx.execute(
                    "INSERT INTO fatture_righe (fattura_id, prodotto_id, descrizione, quantita, prezzo, sconto, iva, codice_iva, unita_misura, variante_id, variante_taglia, variante_colore, tipo, ddt_id) \
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
                    riga_ref_params(fattura_id, &r, *ddt_id),
                )?;
            }
        }
        crea_pagamento_immediato(&tx, fattura_id)?;
        created.push(json!({ "id": fattura_id, "numero": numero, "clienteNome": cliente_nome, "ddtNums": ddt_nums }));
    }
    tx.commit().map_err(ApiError::from)?;
    Ok(Json(json!({ "fatture": created })))
}

async fn print(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let dto = conn
        .query_row(
            "SELECT f.*, c.ragione_sociale as c_nome, c.via as c_via, c.cap as c_cap, c.citta as c_citta, c.provincia as c_provincia, \
                    c.stato as c_stato, c.p_iva as c_p_iva, c.codice_fiscale as c_cod_fiscale, c.email as c_email, c.telefono as c_telefono, \
                    c.pec as c_pec, c.sdi as c_sdi, tp.nome as tp_nome \
             FROM fatture f LEFT JOIN clienti c ON f.cliente_id = c.id LEFT JOIN tipi_pagamento tp ON f.tipo_pagamento_id = tp.id WHERE f.id=?1",
            [id],
            |r| {
                let mut dto = to_dto(&conn, r)?;
                let g = |k: &str| r.get::<_, Option<String>>(k).ok().flatten();
                dto["cliente"] = json!({
                    "ragioneSociale": g("c_nome"), "via": g("c_via"), "cap": g("c_cap"), "citta": g("c_citta"), "provincia": g("c_provincia"),
                    "stato": g("c_stato"), "pIva": g("c_p_iva"), "codFiscale": g("c_cod_fiscale"), "email": g("c_email"), "telefono": g("c_telefono"),
                    "pec": g("c_pec"), "sdi": g("c_sdi"),
                });
                dto["tipoPagamentoNome"] = json!(g("tp_nome").unwrap_or_default());
                Ok(dto)
            },
        )
        .optional()?;
    let mut dto = dto.ok_or_else(|| ApiError::not_found("Not found"))?;
    // Node print: toDto legge cliente_nome (assente nella query print) → chiave omessa.
    if let Some(o) = dto.as_object_mut() {
        o.remove("clienteNome");
    }
    dto["righe"] = Value::Array(get_righe(&conn, id)?);
    dto["riferimenti"] = Value::Array(get_riferimenti(&conn, id)?);
    // DDT collegati, con numero e data: la stampa li usa come intestazione dei
    // gruppi di righe, così una fattura che salda più consegne resta leggibile.
    dto["ddtCollegati"] = Value::Array(get_ddt_collegati(&conn, id)?);
    let mut stmt = conn.prepare("SELECT data_pagamento, importo, metodo, note FROM pagamenti WHERE fattura_id=?1 ORDER BY data_pagamento")?;
    let pag: Vec<Value> = stmt.query_map([id], |p| Ok(json!({ "dataPagamento": p.get::<_,Option<String>>(0)?, "importo": opt_num(p.get::<_,Option<f64>>(1)?), "metodo": p.get::<_,Option<String>>(2)?, "note": p.get::<_,Option<String>>(3)? })))?.collect::<Result<_,_>>()?;
    dto["pagamenti"] = Value::Array(pag);
    Ok(Json(dto))
}

async fn patch_stato(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(b): Json<Value>,
) -> ApiResult<Json<Value>> {
    let stato = b.get("stato").and_then(Value::as_str);
    let arc = tenant_conn(&state)?;
    let mut guard = arc.lock().unwrap();
    let tx = guard.transaction().map_err(ApiError::from)?;
    let before: Option<String> = tx.query_row("SELECT stato FROM fatture WHERE id=?1", [id], |r| r.get(0)).optional()?.flatten();
    tx.execute("UPDATE fatture SET stato=?1 WHERE id=?2", params![stato, id])?;
    if stato == Some("EMESSA") {
        crea_pagamento_immediato(&tx, id)?;
    }
    audit(&tx, "fattura", id, "UPDATE", &json!({ "before": { "stato": before }, "after": { "stato": stato } }));
    tx.commit().map_err(ApiError::from)?;
    Ok(Json(json!({ "success": true })))
}

const STATI_SDI: [&str; 10] = [
    "", "NON_INVIATA", "INVIATA", "CONSEGNATA", "MANCATA_CONSEGNA", "SCARTATA", "ACCETTATA", "RIFIUTATA", "DECORRENZA_TERMINI", "NON_RECAPITABILE",
];

async fn patch_stato_sdi(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(b): Json<Value>,
) -> ApiResult<Json<Value>> {
    let nuovo = b.get("statoSdi").and_then(Value::as_str).unwrap_or("").to_uppercase();
    if !STATI_SDI.contains(&nuovo.as_str()) {
        let orig = b.get("statoSdi").and_then(Value::as_str).unwrap_or("");
        return Err(ApiError::bad_request(format!("Stato SDI non valido: {orig}")));
    }
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let f = conn
        .query_row("SELECT stato_sdi, data_invio_sdi, id_trasmissione_sdi FROM fatture WHERE id=?1", [id], |r| {
            Ok((r.get::<_,Option<String>>(0)?.unwrap_or_default(), r.get::<_,Option<String>>(1)?.unwrap_or_default(), r.get::<_,Option<String>>(2)?.unwrap_or_default()))
        })
        .optional()?;
    let (old_stato, old_data, old_idt) = f.ok_or_else(|| ApiError::not_found("Fattura non trovata"))?;
    let before = json!({ "statoSdi": old_stato, "dataInvioSdi": old_data, "idTrasmissioneSdi": old_idt });
    let data_invio = match b.get("dataInvioSdi") {
        Some(v) if !v.is_null() => v.as_str().unwrap_or("").to_string(),
        _ => {
            if !nuovo.is_empty() && nuovo != "NON_INVIATA" && old_data.is_empty() {
                oggi()
            } else {
                old_data.clone()
            }
        }
    };
    let id_trasm = match b.get("idTrasmissioneSdi") {
        Some(v) if !v.is_null() => v.as_str().unwrap_or("").to_string(),
        _ => old_idt.clone(),
    };
    let stato_db = if nuovo == "NON_INVIATA" { "" } else { nuovo.as_str() };
    conn.execute("UPDATE fatture SET stato_sdi=?1, data_invio_sdi=?2, id_trasmissione_sdi=?3 WHERE id=?4", params![stato_db, data_invio, id_trasm, id])?;
    audit(&conn, "fattura", id, "UPDATE", &json!({ "before": before, "after": { "statoSdi": nuovo, "dataInvioSdi": data_invio, "idTrasmissioneSdi": id_trasm } }));
    Ok(Json(json!({ "success": true })))
}

// ── tx bodies ────────────────────────────────────────────────────────────────

fn create_tx(tx: &Connection, f: &Value, ddt_ids: &[i64]) -> rusqlite::Result<i64> {
    let (ra, rc, rt, rsc, ct, ca, ci, bo) = fisc_values(f);
    tx.execute(
        INS_FATT,
        params![
            f.get("numero").and_then(Value::as_str).unwrap_or(""),
            f.get("dataEmissione").and_then(Value::as_str),
            f.get("clienteId").and_then(Value::as_i64).filter(|&v| v != 0),
            ddt_ids.first().copied(),
            raw_opt(f, "note"),
            f.get("stato").and_then(Value::as_str).unwrap_or("EMESSA"),
            f.get("tipoPagamentoId").and_then(Value::as_i64).filter(|&v| v != 0),
            ra, rc, rt, rsc, ct, ca, ci, bo,
            f.get("agenteId").and_then(Value::as_i64).filter(|&v| v != 0),
            f.get("provvigione").and_then(Value::as_f64),
        ],
    )?;
    let id = tx.last_insert_rowid();
    if let Some(righe) = f.get("righe").and_then(Value::as_array).filter(|r| !r.is_empty()) {
        save_righe(tx, id, righe)?;
        if ddt_ids.is_empty() {
            let cid = f.get("clienteId").and_then(Value::as_i64).filter(|&v| v != 0);
            let ctx = stock_ctx("FATTURA", id, f.get("numero").and_then(Value::as_str).unwrap_or(""), cid, nome_cliente(tx, cid), f.get("dataEmissione").and_then(Value::as_str).map(str::to_string));
            applica_righe_stock(tx, righe, -1, &ctx)?;
        }
    }
    if !ddt_ids.is_empty() {
        save_ddt_links(tx, id, ddt_ids)?;
    }
    if let Some(rifs) = f.get("riferimenti").and_then(Value::as_array) {
        save_riferimenti(tx, id, rifs)?;
    }
    crea_pagamento_immediato(tx, id)?;
    audit(tx, "fattura", id, "CREATE", &json!({ "numero": f.get("numero").and_then(Value::as_str), "clienteId": f.get("clienteId").and_then(Value::as_i64), "stato": f.get("stato").and_then(Value::as_str).unwrap_or("EMESSA"), "numRighe": righe_len(f) }));
    Ok(id)
}

fn update_tx(tx: &Connection, id: i64, f: &Value, ddt_ids: &[i64]) -> rusqlite::Result<()> {
    let vecchi_ddt = get_ddt_ids(tx, id)?;
    let vecchie = get_righe(tx, id)?;
    if !vecchie.is_empty() && vecchi_ddt.is_empty() {
        let (onum, ocid) = tx.query_row("SELECT numero, cliente_id FROM fatture WHERE id=?1", [id], |r| Ok((r.get::<_,Option<String>>(0)?, r.get::<_,Option<i64>>(1)?))).optional()?.unwrap_or((None, None));
        let ctx = stock_ctx("STORNO", id, &onum.unwrap_or_default(), ocid, nome_cliente(tx, ocid), None);
        applica_righe_stock(tx, &vecchie, 1, &ctx)?;
    }
    let (ra, rc, rt, rsc, ct, ca, ci, bo) = fisc_values(f);
    tx.execute(
        "UPDATE fatture SET numero=?1, data_emissione=?2, cliente_id=?3, ddt_id=?4, note=?5, stato=?6, tipo_pagamento_id=?7, \
         ritenuta_aliquota=?8, ritenuta_causale=?9, ritenuta_tipo=?10, ritenuta_su_cassa=?11, cassa_tipo=?12, cassa_aliquota=?13, cassa_iva=?14, bollo=?15, agente_id=?16, provvigione=?17 WHERE id=?18",
        params![
            f.get("numero").and_then(Value::as_str).unwrap_or(""),
            f.get("dataEmissione").and_then(Value::as_str),
            f.get("clienteId").and_then(Value::as_i64).filter(|&v| v != 0),
            ddt_ids.first().copied(),
            raw_opt(f, "note"),
            f.get("stato").and_then(Value::as_str),
            f.get("tipoPagamentoId").and_then(Value::as_i64).filter(|&v| v != 0),
            ra, rc, rt, rsc, ct, ca, ci, bo,
            f.get("agenteId").and_then(Value::as_i64).filter(|&v| v != 0),
            f.get("provvigione").and_then(Value::as_f64),
            id,
        ],
    )?;
    tx.execute("DELETE FROM fatture_righe WHERE fattura_id=?1", [id])?;
    if let Some(righe) = f.get("righe").and_then(Value::as_array).filter(|r| !r.is_empty()) {
        save_righe(tx, id, righe)?;
        if ddt_ids.is_empty() {
            let cid = f.get("clienteId").and_then(Value::as_i64).filter(|&v| v != 0);
            let ctx = stock_ctx("FATTURA", id, f.get("numero").and_then(Value::as_str).unwrap_or(""), cid, nome_cliente(tx, cid), f.get("dataEmissione").and_then(Value::as_str).map(str::to_string));
            applica_righe_stock(tx, righe, -1, &ctx)?;
        }
    }
    save_ddt_links(tx, id, ddt_ids)?;
    save_riferimenti(tx, id, f.get("riferimenti").and_then(Value::as_array).map(|v| v.as_slice()).unwrap_or(&[]))?;
    if ddt_ids.is_empty() {
        crea_pagamento_immediato(tx, id)?;
    }
    audit(tx, "fattura", id, "UPDATE", &json!({ "numero": f.get("numero").and_then(Value::as_str) }));
    Ok(())
}

// ── helpers ──────────────────────────────────────────────────────────────────

fn ddt_ids_of(f: &Value) -> Vec<i64> {
    if let Some(a) = f.get("ddtIds").and_then(Value::as_array).filter(|a| !a.is_empty()) {
        return a.iter().filter_map(Value::as_i64).collect();
    }
    match f.get("ddtId").and_then(Value::as_i64).filter(|&v| v != 0) {
        Some(d) => vec![d],
        None => vec![],
    }
}

fn valida_righe(righe: Option<&Value>) -> Option<&'static str> {
    let arr = match righe.and_then(Value::as_array) {
        Some(a) if !a.is_empty() => a,
        _ => return Some("Il documento deve contenere almeno una riga"),
    };
    for r in arr {
        if r.get("quantita").and_then(Value::as_f64).unwrap_or(0.0) < 0.0 {
            return Some("La quantità di una riga non può essere negativa");
        }
        if r.get("prezzo").and_then(Value::as_f64).unwrap_or(0.0) < 0.0 {
            return Some("Il prezzo di una riga non può essere negativo");
        }
    }
    None
}

fn stock_ctx(causale: &str, doc_id: i64, doc_num: &str, cliente_id: Option<i64>, cliente_nome: String, data: Option<String>) -> StockCtx {
    StockCtx {
        data,
        causale: causale.into(),
        documento_tipo: "FATTURA".into(),
        documento_id: Some(doc_id),
        documento_numero: doc_num.to_string(),
        cliente_id,
        cliente_nome,
        ..Default::default()
    }
}

fn save_righe(conn: &Connection, fattura_id: i64, righe: &[Value]) -> rusqlite::Result<()> {
    for r in righe {
        conn.execute(
            "INSERT INTO fatture_righe (fattura_id, prodotto_id, codice_prodotto, descrizione, quantita, prezzo, sconto, iva, codice_iva, unita_misura, variante_id, variante_taglia, variante_colore, tipo, scarica_magazzino) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
            params![
                fattura_id,
                r.get("prodottoId").and_then(Value::as_i64).filter(|&v| v != 0),
                str_def(r, "codiceProdotto"),
                raw_opt(r, "descrizione"),
                r.get("quantita").and_then(Value::as_f64),
                r.get("prezzo").and_then(Value::as_f64),
                r.get("sconto").and_then(Value::as_f64).unwrap_or(0.0),
                r.get("iva").and_then(Value::as_f64),
                str_def(r, "codiceIva"),
                str_def(r, "unitaMisura"),
                r.get("varianteId").and_then(Value::as_i64).filter(|&v| v != 0),
                str_def(r, "varianteTaglia"),
                str_def(r, "varianteColore"),
                str_or(r, "tipo", "PRODOTTO"),
                if matches!(r.get("scaricaMagazzino"), Some(Value::Bool(false))) { 0 } else { 1 },
            ],
        )?;
    }
    Ok(())
}

/// Parametri di una riga copiata da un DDT. `ddt_id` in coda: è quello che, in
/// stampa, permette di raggruppare le righe sotto il documento di trasporto da
/// cui arrivano, invece di lasciarle in un elenco unico.
fn riga_ref_params<'a>(fattura_id: i64, r: &'a Value, ddt_id: i64) -> impl rusqlite::Params + 'a {
    (
        fattura_id,
        r.get("prodottoId").and_then(Value::as_i64).filter(|&v| v != 0),
        r.get("descrizione").and_then(Value::as_str).map(str::to_string),
        r.get("quantita").and_then(Value::as_f64),
        r.get("prezzo").and_then(Value::as_f64),
        r.get("sconto").and_then(Value::as_f64).unwrap_or(0.0),
        r.get("iva").and_then(Value::as_f64),
        r.get("codiceIva").and_then(Value::as_str).unwrap_or("").to_string(),
        r.get("unitaMisura").and_then(Value::as_str).unwrap_or("").to_string(),
        r.get("varianteId").and_then(Value::as_i64).filter(|&v| v != 0),
        r.get("varianteTaglia").and_then(Value::as_str).unwrap_or("").to_string(),
        r.get("varianteColore").and_then(Value::as_str).unwrap_or("").to_string(),
        r.get("tipo").and_then(Value::as_str).filter(|s| !s.is_empty()).unwrap_or("PRODOTTO").to_string(),
        ddt_id,
    )
}

fn get_ddt_righe(conn: &Connection, ddt_id: i64) -> rusqlite::Result<Vec<Value>> {
    let mut stmt = conn.prepare("SELECT dr.*, p.nome as prodotto_nome FROM ddt_righe dr LEFT JOIN prodotti p ON dr.prodotto_id = p.id WHERE dr.ddt_id=?1")?;
    let rows = stmt
        .query_map([ddt_id], |r| {
            Ok(json!({
                "prodottoId": r.get::<_, Option<i64>>("prodotto_id")?,
                "codiceProdotto": r.get::<_, Option<String>>("codice_prodotto")?.unwrap_or_default(),
                "ddtId": r.get::<_, Option<i64>>("ddt_id")?,
                "descrizione": r.get::<_, Option<String>>("descrizione")?,
                "quantita": opt_num(r.get::<_, Option<f64>>("quantita")?),
                "unitaMisura": r.get::<_, Option<String>>("unita_misura")?,
                "prezzo": opt_num(r.get::<_, Option<f64>>("prezzo")?),
                "sconto": num(r.get::<_, Option<f64>>("sconto")?.unwrap_or(0.0)),
                "iva": opt_num(r.get::<_, Option<f64>>("iva")?),
                "codiceIva": r.get::<_, Option<String>>("codice_iva")?.unwrap_or_default(),
                "varianteId": r.get::<_, Option<i64>>("variante_id")?,
                "varianteTaglia": r.get::<_, Option<String>>("variante_taglia")?.unwrap_or_default(),
                "varianteColore": r.get::<_, Option<String>>("variante_colore")?.unwrap_or_default(),
                "tipo": r.get::<_, Option<String>>("tipo")?.filter(|s| !s.is_empty()).unwrap_or_else(|| "PRODOTTO".into()),
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn save_ddt_links(conn: &Connection, fattura_id: i64, ddt_ids: &[i64]) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM fatture_ddt WHERE fattura_id=?1", [fattura_id])?;
    for d in ddt_ids {
        conn.execute("INSERT OR IGNORE INTO fatture_ddt (fattura_id, ddt_id) VALUES (?1,?2)", params![fattura_id, d])?;
    }
    Ok(())
}

fn get_ddt_ids(conn: &Connection, fattura_id: i64) -> rusqlite::Result<Vec<i64>> {
    let mut stmt = conn.prepare("SELECT ddt_id FROM fatture_ddt WHERE fattura_id=?1")?;
    let rows = stmt.query_map([fattura_id], |r| r.get::<_, i64>(0))?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn save_riferimenti(conn: &Connection, fattura_id: i64, rifs: &[Value]) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM fatture_riferimenti WHERE fattura_id=?1", [fattura_id])?;
    for (i, r) in rifs.iter().enumerate() {
        conn.execute(
            "INSERT INTO fatture_riferimenti (fattura_id, tipo, numero, data, cig, cup, commessa, ordine) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![
                fattura_id,
                str_or(r, "tipo", "ORDINE_ACQUISTO"),
                str_def(r, "numero"),
                str_def(r, "data"),
                str_def(r, "cig"),
                str_def(r, "cup"),
                str_def(r, "commessa"),
                i as i64,
            ],
        )?;
    }
    Ok(())
}

fn get_riferimenti(conn: &Connection, fattura_id: i64) -> rusqlite::Result<Vec<Value>> {
    let mut stmt = conn.prepare("SELECT id, tipo, numero, data, cig, cup, commessa FROM fatture_riferimenti WHERE fattura_id=?1 ORDER BY ordine, id")?;
    let rows = stmt
        .query_map([fattura_id], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "tipo": r.get::<_, Option<String>>(1)?,
                "numero": r.get::<_, Option<String>>(2)?,
                "data": r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                "cig": r.get::<_, Option<String>>(4)?.unwrap_or_default(),
                "cup": r.get::<_, Option<String>>(5)?.unwrap_or_default(),
                "commessa": r.get::<_, Option<String>>(6)?.unwrap_or_default(),
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// DDT collegati alla fattura, in ordine di data: numero e data servono a
/// intestare i gruppi di righe nella stampa.
fn get_ddt_collegati(conn: &Connection, fattura_id: i64) -> rusqlite::Result<Vec<Value>> {
    let mut stmt = conn.prepare(
        "SELECT d.id, d.numero, d.data_emissione FROM fatture_ddt fd \
         JOIN ddt d ON d.id = fd.ddt_id WHERE fd.fattura_id=?1 ORDER BY d.data_emissione, d.id",
    )?;
    let rows = stmt.query_map([fattura_id], |r| {
        Ok(json!({
            "id": r.get::<_, i64>(0)?,
            "numero": r.get::<_, Option<String>>(1)?.unwrap_or_default(),
            "data": r.get::<_, Option<String>>(2)?.unwrap_or_default(),
        }))
    })?;
    rows.collect()
}

fn get_righe(conn: &Connection, fattura_id: i64) -> rusqlite::Result<Vec<Value>> {
    let mut stmt = conn.prepare("SELECT fr.*, p.nome as prodotto_nome FROM fatture_righe fr LEFT JOIN prodotti p ON fr.prodotto_id = p.id WHERE fr.fattura_id=?1")?;
    let rows = stmt
        .query_map([fattura_id], |r| {
            Ok(json!({
                "id": r.get::<_, i64>("id")?,
                "prodottoId": r.get::<_, Option<i64>>("prodotto_id")?,
                "prodottoNome": r.get::<_, Option<String>>("prodotto_nome")?,
                "codiceProdotto": r.get::<_, Option<String>>("codice_prodotto")?.unwrap_or_default(),
                "descrizione": r.get::<_, Option<String>>("descrizione")?,
                "quantita": opt_num(r.get::<_, Option<f64>>("quantita")?),
                "unitaMisura": r.get::<_, Option<String>>("unita_misura")?,
                "prezzo": opt_num(r.get::<_, Option<f64>>("prezzo")?),
                "sconto": num(r.get::<_, Option<f64>>("sconto")?.unwrap_or(0.0)),
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

fn righe_quattro(conn: &Connection, fattura_id: i64) -> rusqlite::Result<Vec<(f64, f64, f64, f64)>> {
    let mut stmt = conn.prepare("SELECT quantita, prezzo, sconto, iva FROM fatture_righe WHERE fattura_id=?1")?;
    let rows = stmt
        .query_map([fattura_id], |r| {
            Ok((
                r.get::<_, Option<f64>>(0)?.unwrap_or(0.0),
                r.get::<_, Option<f64>>(1)?.unwrap_or(0.0),
                r.get::<_, Option<f64>>(2)?.unwrap_or(0.0),
                r.get::<_, Option<f64>>(3)?.unwrap_or(0.0),
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn to_dto(conn: &Connection, r: &Row) -> rusqlite::Result<Value> {
    let id = r.get::<_, i64>("id")?;
    let righe = righe_quattro(conn, id)?;
    let fisc = fisc_from_row(r);
    let t = calcola_totali_fiscali(&righe, &fisc);
    Ok(json!({
        "id": id,
        "numero": r.get::<_, Option<String>>("numero")?,
        "dataEmissione": r.get::<_, Option<String>>("data_emissione")?,
        "clienteId": r.get::<_, Option<i64>>("cliente_id")?,
        "clienteNome": r.get::<_, Option<String>>("cliente_nome").ok().flatten(),
        "ddtId": r.get::<_, Option<i64>>("ddt_id")?,
        "note": r.get::<_, Option<String>>("note")?,
        "stato": r.get::<_, Option<String>>("stato")?,
        "imponibile": num(t.imponibile),
        "totale": num(t.totale),
        "tipoPagamentoId": r.get::<_, Option<i64>>("tipo_pagamento_id")?,
        "agenteId": r.get::<_, Option<i64>>("agente_id")?,
        "provvigione": r.get::<_, Option<f64>>("provvigione")?,
        "ritenutaAliquota": num(fisc.ritenuta_aliquota),
        "ritenutaCausale": fisc.ritenuta_causale,
        "ritenutaTipo": fisc.ritenuta_tipo,
        "ritenutaSuCassa": fisc.ritenuta_su_cassa,
        "cassaTipo": fisc.cassa_tipo,
        "cassaAliquota": num(fisc.cassa_aliquota),
        "cassaIva": num(fisc.cassa_iva),
        "bollo": fisc.bollo,
        "cassaImporto": num(t.cassa_importo),
        "iva": num(t.iva),
        "ritenutaImporto": num(t.ritenuta_importo),
        "bolloImporto": num(t.bollo_importo),
        "nettoAPagare": num(t.netto_a_pagare),
        "statoSdi": r.get::<_, Option<String>>("stato_sdi")?.unwrap_or_default(),
        "dataInvioSdi": r.get::<_, Option<String>>("data_invio_sdi")?.unwrap_or_default(),
        "idTrasmissioneSdi": r.get::<_, Option<String>>("id_trasmissione_sdi")?.unwrap_or_default(),
    }))
}

fn crea_pagamento_immediato(conn: &Connection, fattura_id: i64) -> rusqlite::Result<()> {
    let row = conn
        .query_row("SELECT * FROM fatture WHERE id=?1", [fattura_id], |r| {
            Ok((
                r.get::<_, Option<i64>>("tipo_pagamento_id")?,
                r.get::<_, Option<String>>("data_emissione")?,
                fisc_from_row(r),
            ))
        })
        .optional()?;
    let (tp_id, data_em, fisc) = match row {
        Some(x) => x,
        None => return Ok(()),
    };
    let tp_id = match tp_id {
        Some(t) => t,
        None => return Ok(()),
    };
    let tp = conn
        .query_row("SELECT nome, immediato, conto FROM tipi_pagamento WHERE id=?1", [tp_id], |r| {
            Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<i64>>(1)?, r.get::<_, Option<String>>(2)?))
        })
        .optional()?;
    let (tp_nome, tp_imm, tp_conto) = match tp {
        Some(x) => x,
        None => return Ok(()),
    };
    if tp_imm != Some(1) {
        return Ok(());
    }
    let esiste = conn
        .query_row("SELECT 1 FROM pagamenti WHERE fattura_id=?1 AND tipo='ENTRATA' AND note='Pagamento automatico'", [fattura_id], |_| Ok(()))
        .optional()?
        .is_some();
    if esiste {
        return Ok(());
    }
    let righe = righe_quattro(conn, fattura_id)?;
    let netto = calcola_totali_fiscali(&righe, &fisc).netto_a_pagare;
    if netto <= 0.0 {
        return Ok(());
    }
    conn.execute(
        "INSERT INTO pagamenti (fattura_id, data_pagamento, importo, metodo, note, tipo, tipo_pagamento_id, conto) \
         VALUES (?1,?2,?3,?4,'Pagamento automatico','ENTRATA',?5,?6)",
        params![fattura_id, data_em, netto, tp_nome, tp_id, tp_conto],
    )?;
    conn.execute("UPDATE fatture SET stato='PAGATA' WHERE id=?1", [fattura_id])?;
    Ok(())
}

fn nome_cliente(conn: &Connection, id: Option<i64>) -> String {
    match id {
        Some(i) => conn.query_row("SELECT ragione_sociale FROM clienti WHERE id=?1", [i], |r| r.get::<_, Option<String>>(0)).optional().ok().flatten().flatten().unwrap_or_default(),
        None => String::new(),
    }
}

fn sql_400(e: rusqlite::Error) -> ApiError {
    let msg = match &e {
        rusqlite::Error::SqliteFailure(_, Some(m)) => m.clone(),
        other => other.to_string(),
    };
    ApiError::Status(axum::http::StatusCode::BAD_REQUEST, msg)
}

fn str_or(b: &Value, k: &str, d: &str) -> String {
    let s = str_def(b, k);
    if s.is_empty() { d.to_string() } else { s }
}
fn righe_len(f: &Value) -> usize {
    f.get("righe").and_then(Value::as_array).map(|a| a.len()).unwrap_or(0)
}
