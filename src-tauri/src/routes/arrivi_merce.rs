//! /api/arrivi-merce — arrivi merce con carico/storno scorte. Parità con routes/arriviMerce.js.

use axum::{
    extract::{Path, State},
    routing::get,
    Json, Router,
};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde_json::{json, Value};

use crate::db::AppState;
use crate::error::{ApiError, ApiResult};
use crate::stock::{applica_righe_stock, StockCtx};
use crate::web::{num, opt_num, tenant_conn};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/from-acquisto/:acquistoId", axum::routing::post(from_acquisto))
        .route("/:id", get(detail).put(update).delete(remove))
        .route("/:id/stato", axum::routing::patch(patch_stato))
}

async fn list(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT am.*, f.ragione_sociale as fornitore_nome FROM arrivi_merce am \
         LEFT JOIN fornitori f ON am.fornitore_id = f.id ORDER BY am.data DESC, am.id DESC",
    )?;
    let ids_dtos = stmt
        .query_map([], |r| to_dto(&conn, r))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(Value::Array(ids_dtos)))
}

async fn detail(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let dto = conn
        .query_row(
            "SELECT am.*, f.ragione_sociale as fornitore_nome FROM arrivi_merce am \
             LEFT JOIN fornitori f ON am.fornitore_id = f.id WHERE am.id=?1",
            [id],
            |r| to_dto(&conn, r),
        )
        .optional()?;
    let mut dto = dto.ok_or_else(|| ApiError::not_found("Not found"))?;
    dto["righe"] = Value::Array(get_righe(&conn, id)?);
    Ok(Json(dto))
}

async fn create(State(state): State<AppState>, Json(d): Json<Value>) -> ApiResult<Json<Value>> {
    let numero = d.get("numero").and_then(Value::as_str).unwrap_or("");
    let arc = tenant_conn(&state)?;
    let mut guard = arc.lock().unwrap();
    if guard.query_row("SELECT id FROM arrivi_merce WHERE numero=?1", [numero], |_| Ok(())).optional()?.is_some() {
        return Err(ApiError::conflict(format!("Il numero {numero} è già utilizzato da un altro documento")));
    }
    let tx = guard.transaction().map_err(ApiError::from)?;
    let stato = d.get("stato").and_then(Value::as_str).unwrap_or("RICEVUTO").to_string();
    tx.execute(
        "INSERT INTO arrivi_merce (numero, data, fornitore_id, acquisto_id, numero_documento_fornitore, note, stato, magazzino_id) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![
            numero,
            d.get("data").and_then(Value::as_str),
            opt_i64(&d, "fornitoreId"),
            opt_i64(&d, "acquistoId"),
            sdef(&d, "numeroDocumentoFornitore"),
            sdef(&d, "note"),
            stato,
            opt_i64(&d, "magazzinoId"),
        ],
    )?;
    let arrivo_id = tx.last_insert_rowid();
    if let Some(righe) = d.get("righe").and_then(Value::as_array).filter(|r| !r.is_empty()) {
        save_righe(&tx, arrivo_id, righe)?;
        if stato == "RICEVUTO" {
            let ctx = carico_ctx(&tx, &d, arrivo_id, numero);
            applica_righe_stock(&tx, righe, 1, &ctx)?;
        }
    }
    tx.commit().map_err(ApiError::from)?;
    Ok(Json(json!({ "id": arrivo_id })))
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(d): Json<Value>,
) -> ApiResult<Json<Value>> {
    let numero = d.get("numero").and_then(Value::as_str).unwrap_or("");
    let arc = tenant_conn(&state)?;
    let mut guard = arc.lock().unwrap();
    if guard
        .query_row("SELECT id FROM arrivi_merce WHERE numero=?1 AND id!=?2", params![numero, id], |_| Ok(()))
        .optional()?
        .is_some()
    {
        return Err(ApiError::conflict(format!("Il numero {numero} è già utilizzato da un altro documento")));
    }
    let tx = guard.transaction().map_err(ApiError::from)?;
    let old = tx
        .query_row("SELECT numero, fornitore_id, stato FROM arrivi_merce WHERE id=?1", [id], |r| {
            Ok((
                r.get::<_, Option<String>>(0)?,
                r.get::<_, Option<i64>>(1)?,
                r.get::<_, Option<String>>(2)?,
            ))
        })
        .optional()?;
    let vecchie = get_righe(&tx, id)?;
    if !vecchie.is_empty() && old.as_ref().and_then(|o| o.2.as_deref()) == Some("RICEVUTO") {
        let (onum, ofid) = old.as_ref().map(|o| (o.0.clone(), o.1)).unwrap();
        let ctx = StockCtx {
            causale: "STORNO".into(),
            documento_tipo: "ARRIVO_MERCE".into(),
            documento_id: Some(id),
            documento_numero: onum.unwrap_or_default(),
            fornitore_id: ofid,
            fornitore_nome: nome_fornitore(&tx, ofid),
            ..Default::default()
        };
        applica_righe_stock(&tx, &vecchie, -1, &ctx)?;
    }
    let stato = d.get("stato").and_then(Value::as_str).unwrap_or("").to_string();
    tx.execute(
        "UPDATE arrivi_merce SET numero=?1, data=?2, fornitore_id=?3, acquisto_id=?4, \
         numero_documento_fornitore=?5, note=?6, stato=?7, magazzino_id=?8 WHERE id=?9",
        params![
            numero,
            d.get("data").and_then(Value::as_str),
            opt_i64(&d, "fornitoreId"),
            opt_i64(&d, "acquistoId"),
            sdef(&d, "numeroDocumentoFornitore"),
            sdef(&d, "note"),
            stato,
            opt_i64(&d, "magazzinoId"),
            id,
        ],
    )?;
    tx.execute("DELETE FROM arrivi_merce_righe WHERE arrivo_merce_id=?1", [id])?;
    if let Some(righe) = d.get("righe").and_then(Value::as_array).filter(|r| !r.is_empty()) {
        save_righe(&tx, id, righe)?;
        if stato == "RICEVUTO" {
            let ctx = carico_ctx(&tx, &d, id, numero);
            applica_righe_stock(&tx, righe, 1, &ctx)?;
        }
    }
    tx.commit().map_err(ApiError::from)?;
    Ok(Json(json!({ "success": true })))
}

async fn patch_stato(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(b): Json<Value>,
) -> ApiResult<Json<Value>> {
    let nuovo = b.get("stato").and_then(Value::as_str).unwrap_or("").to_string();
    let arc = tenant_conn(&state)?;
    let mut guard = arc.lock().unwrap();
    let tx = guard.transaction().map_err(ApiError::from)?;
    let old = tx
        .query_row("SELECT stato, numero, fornitore_id FROM arrivi_merce WHERE id=?1", [id], |r| {
            Ok((
                r.get::<_, Option<String>>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, Option<i64>>(2)?,
            ))
        })
        .optional()?;
    let (old_stato, onum, ofid) = match old {
        Some(o) => o,
        None => (None, None, None),
    };
    let righe = get_righe(&tx, id)?;
    let base_ctx = |causale: &str, with_data: bool| StockCtx {
        causale: causale.into(),
        documento_tipo: "ARRIVO_MERCE".into(),
        documento_id: Some(id),
        documento_numero: onum.clone().unwrap_or_default(),
        fornitore_id: ofid,
        fornitore_nome: String::new(), // riempito sotto
        data: if with_data { Some(crate::web::oggi()) } else { None },
        ..Default::default()
    };
    if nuovo == "RICEVUTO" && old_stato.as_deref() != Some("RICEVUTO") {
        let mut ctx = base_ctx("ARRIVO_MERCE", true);
        ctx.fornitore_nome = nome_fornitore(&tx, ofid);
        applica_righe_stock(&tx, &righe, 1, &ctx)?;
    } else if nuovo == "ANNULLATO" && old_stato.as_deref() == Some("RICEVUTO") {
        let mut ctx = base_ctx("ANNULLAMENTO", false);
        ctx.fornitore_nome = nome_fornitore(&tx, ofid);
        applica_righe_stock(&tx, &righe, -1, &ctx)?;
    }
    tx.execute("UPDATE arrivi_merce SET stato=?1 WHERE id=?2", params![nuovo, id])?;
    tx.commit().map_err(ApiError::from)?;
    Ok(Json(json!({ "success": true })))
}

async fn remove(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let arc = tenant_conn(&state)?;
    let mut guard = arc.lock().unwrap();
    let tx = guard.transaction().map_err(ApiError::from)?;
    let arrivo = tx
        .query_row("SELECT stato, numero, fornitore_id FROM arrivi_merce WHERE id=?1", [id], |r| {
            Ok((
                r.get::<_, Option<String>>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, Option<i64>>(2)?,
            ))
        })
        .optional()?;
    if let Some((Some(ref st), ref onum, ofid)) = arrivo {
        if st == "RICEVUTO" {
            let righe = get_righe(&tx, id)?;
            if !righe.is_empty() {
                let ctx = StockCtx {
                    causale: "ELIMINAZIONE".into(),
                    documento_tipo: "ARRIVO_MERCE".into(),
                    documento_id: Some(id),
                    documento_numero: onum.clone().unwrap_or_default(),
                    fornitore_id: ofid,
                    fornitore_nome: nome_fornitore(&tx, ofid),
                    ..Default::default()
                };
                applica_righe_stock(&tx, &righe, -1, &ctx)?;
            }
        }
    }
    tx.execute("DELETE FROM arrivi_merce_righe WHERE arrivo_merce_id=?1", [id])?;
    tx.execute("DELETE FROM arrivi_merce WHERE id=?1", [id])?;
    tx.commit().map_err(ApiError::from)?;
    Ok(Json(json!({ "success": true })))
}

async fn from_acquisto(
    State(state): State<AppState>,
    Path(acquisto_id): Path<i64>,
) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let acq = conn
        .query_row(
            "SELECT a.id, a.fornitore_id, a.numero, a.data_emissione, a.note, f.ragione_sociale as fornitore_nome \
             FROM acquisti a LEFT JOIN fornitori f ON a.fornitore_id = f.id WHERE a.id=?1",
            [acquisto_id],
            |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, Option<i64>>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, Option<String>>(5)?,
                ))
            },
        )
        .optional()?;
    let (aid, afid, anum, adata, anote, afnome) = acq.ok_or_else(|| ApiError::not_found("Acquisto non trovato"))?;

    let mut stmt = conn.prepare(
        "SELECT ar.prodotto_id, ar.variante_id, ar.descrizione, ar.quantita, ar.prezzo, ar.variante_taglia, ar.variante_colore, \
                p.codice as prodotto_codice, p.unita_misura, p.codice_fornitore \
         FROM acquisti_righe ar LEFT JOIN prodotti p ON ar.prodotto_id = p.id WHERE ar.acquisto_id=?1",
    )?;
    let raw_rows = stmt
        .query_map([acquisto_id], |r| {
            Ok((
                r.get::<_, Option<i64>>(0)?,   // prodotto_id
                r.get::<_, Option<i64>>(1)?,   // variante_id
                r.get::<_, Option<String>>(2)?,// descrizione
                r.get::<_, Option<f64>>(3)?,   // quantita
                r.get::<_, Option<f64>>(4)?,   // prezzo
                r.get::<_, Option<String>>(5)?,// variante_taglia
                r.get::<_, Option<String>>(6)?,// variante_colore
                r.get::<_, Option<String>>(7)?,// prodotto_codice
                r.get::<_, Option<String>>(8)?,// unita_misura
                r.get::<_, Option<String>>(9)?,// codice_fornitore
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut righe = Vec::new();
    for (pid, vid, descr, qta, prezzo, vtag, vcol, pcodice, pum, pcf) in raw_rows {
        let mut prodotto_id = pid;
        let mut prodotto_codice = pcodice.clone().unwrap_or_default();
        let mut unita = pum.clone().unwrap_or_default();
        let mut codice_fornitore = pcf.clone().unwrap_or_default();
        if prodotto_id.is_none() {
            if let Some(desc) = descr.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                if let Some((mid, mcodice, mum, mcf)) = conn
                    .query_row(
                        "SELECT id, codice, unita_misura, codice_fornitore FROM prodotti \
                         WHERE codice_fornitore != '' AND LOWER(codice_fornitore) = LOWER(?1)",
                        [desc],
                        |r| {
                            Ok((
                                r.get::<_, i64>(0)?,
                                r.get::<_, Option<String>>(1)?,
                                r.get::<_, Option<String>>(2)?,
                                r.get::<_, Option<String>>(3)?,
                            ))
                        },
                    )
                    .optional()?
                {
                    prodotto_id = Some(mid);
                    prodotto_codice = mcodice.unwrap_or_default();
                    unita = mum.unwrap_or(unita);
                    codice_fornitore = mcf.unwrap_or_default();
                }
            }
        }
        // unitaMisura: unitaMisura || r.unita_misura || ''  (entrambi p.unita_misura → resta uguale)
        let unita_finale = if unita.is_empty() { pum.clone().unwrap_or_default() } else { unita };
        righe.push(json!({
            "prodottoId": prodotto_id,
            "prodottoCodice": prodotto_codice,
            "variante_id": vid,
            "descrizione": descr.unwrap_or_default(),
            "codiceFornitore": codice_fornitore,
            "quantita": opt_num(qta),
            "unitaMisura": unita_finale,
            "prezzoAcquisto": num(prezzo.unwrap_or(0.0)),
            "varianteTaglia": vtag.unwrap_or_default(),
            "varianteColore": vcol.unwrap_or_default(),
        }));
    }

    Ok(Json(json!({
        "fornitoreId": afid,
        "fornitoreNome": afnome,
        "acquistoId": aid,
        "numeroDocumentoFornitore": anum,
        "data": adata,
        "note": anote.unwrap_or_default(),
        "righe": righe,
    })))
}

// ── helpers ──────────────────────────────────────────────────────────────────

fn to_dto(conn: &Connection, r: &Row) -> rusqlite::Result<Value> {
    let id = r.get::<_, i64>("id")?;
    let totale: f64 = conn.query_row(
        "SELECT COALESCE(SUM(quantita * prezzo_acquisto), 0) FROM arrivi_merce_righe WHERE arrivo_merce_id=?1",
        [id],
        |x| x.get(0),
    )?;
    Ok(json!({
        "id": id,
        "numero": r.get::<_, Option<String>>("numero")?,
        "data": r.get::<_, Option<String>>("data")?,
        "fornitoreId": r.get::<_, Option<i64>>("fornitore_id")?,
        "fornitoreNome": r.get::<_, Option<String>>("fornitore_nome")?,
        "acquistoId": r.get::<_, Option<i64>>("acquisto_id")?,
        "numeroDocumentoFornitore": r.get::<_, Option<String>>("numero_documento_fornitore")?.unwrap_or_default(),
        "note": r.get::<_, Option<String>>("note")?,
        "stato": r.get::<_, Option<String>>("stato")?,
        "totale": num(totale),
        "magazzinoId": r.get::<_, Option<i64>>("magazzino_id")?,
    }))
}

fn get_righe(conn: &Connection, arrivo_id: i64) -> rusqlite::Result<Vec<Value>> {
    let mut stmt = conn.prepare(
        "SELECT amr.*, p.codice as prodotto_codice FROM arrivi_merce_righe amr \
         LEFT JOIN prodotti p ON amr.prodotto_id = p.id WHERE amr.arrivo_merce_id=?1",
    )?;
    let rows = stmt
        .query_map([arrivo_id], |r| {
            Ok(json!({
                "id": r.get::<_, i64>("id")?,
                "prodottoId": r.get::<_, Option<i64>>("prodotto_id")?,
                "prodottoCodice": r.get::<_, Option<String>>("prodotto_codice")?.unwrap_or_default(),
                "varianteId": r.get::<_, Option<i64>>("variante_id")?,
                "descrizione": r.get::<_, Option<String>>("descrizione")?,
                "codiceFornitore": r.get::<_, Option<String>>("codice_fornitore")?.unwrap_or_default(),
                "quantita": opt_num(r.get::<_, Option<f64>>("quantita")?),
                "unitaMisura": r.get::<_, Option<String>>("unita_misura")?.unwrap_or_default(),
                "prezzoAcquisto": num(r.get::<_, Option<f64>>("prezzo_acquisto")?.unwrap_or(0.0)),
                "varianteTaglia": r.get::<_, Option<String>>("variante_taglia")?.unwrap_or_default(),
                "varianteColore": r.get::<_, Option<String>>("variante_colore")?.unwrap_or_default(),
                "lotto": r.get::<_, Option<String>>("lotto")?.unwrap_or_default(),
                "scadenza": r.get::<_, Option<String>>("scadenza")?.unwrap_or_default(),
                "magazzinoId": r.get::<_, Option<i64>>("magazzino_id")?,
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn save_righe(conn: &Connection, arrivo_id: i64, righe: &[Value]) -> rusqlite::Result<()> {
    for r in righe {
        conn.execute(
            "INSERT INTO arrivi_merce_righe \
             (arrivo_merce_id, prodotto_id, variante_id, descrizione, codice_fornitore, quantita, unita_misura, prezzo_acquisto, variante_taglia, variante_colore, lotto, scadenza, magazzino_id) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
            params![
                arrivo_id,
                opt_i64(r, "prodottoId"),
                opt_i64(r, "varianteId"),
                sdef(r, "descrizione"),
                sdef(r, "codiceFornitore"),
                r.get("quantita").and_then(Value::as_f64),
                sdef(r, "unitaMisura"),
                r.get("prezzoAcquisto").and_then(Value::as_f64).unwrap_or(0.0),
                sdef(r, "varianteTaglia"),
                sdef(r, "varianteColore"),
                sdef(r, "lotto"),
                sdef(r, "scadenza"),
                opt_i64(r, "magazzinoId"),
            ],
        )?;
    }
    Ok(())
}

fn carico_ctx(conn: &Connection, d: &Value, arrivo_id: i64, numero: &str) -> StockCtx {
    let fid = opt_i64(d, "fornitoreId");
    StockCtx {
        data: d.get("data").and_then(Value::as_str).map(str::to_string),
        causale: "ARRIVO_MERCE".into(),
        documento_tipo: "ARRIVO_MERCE".into(),
        documento_id: Some(arrivo_id),
        documento_numero: numero.to_string(),
        magazzino_id: opt_i64(d, "magazzinoId"),
        fornitore_id: fid,
        fornitore_nome: nome_fornitore(conn, fid),
        ..Default::default()
    }
}

fn nome_fornitore(conn: &Connection, fid: Option<i64>) -> String {
    match fid {
        Some(id) => conn
            .query_row("SELECT ragione_sociale FROM fornitori WHERE id=?1", [id], |r| r.get::<_, Option<String>>(0))
            .optional()
            .ok()
            .flatten()
            .flatten()
            .unwrap_or_default(),
        None => String::new(),
    }
}

fn sdef(b: &Value, k: &str) -> String {
    b.get(k).and_then(Value::as_str).unwrap_or("").to_string()
}
fn opt_i64(b: &Value, k: &str) -> Option<i64> {
    b.get(k).and_then(Value::as_i64).filter(|&v| v != 0)
}
