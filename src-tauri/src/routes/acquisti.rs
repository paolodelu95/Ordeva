//! /api/acquisti — fatture d'acquisto (ciclo passivo) con analisi magazzino e
//! generazione arrivo merce. Parità con routes/acquisti.js.

use axum::{
    extract::{Path, State},
    routing::get,
    Json, Router,
};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde_json::{json, Value};

use crate::db::AppState;
use crate::error::{ApiError, ApiResult};
use crate::numerazione::get_next_numero;
use crate::stock::{applica_righe_stock, StockCtx};
use crate::web::{codice_prodotto_libero, num, oggi, opt_num, raw_opt, str_def, tenant_conn};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/:id", get(detail).put(update).delete(remove))
        .route("/:id/print", get(print))
        .route("/:id/stato", axum::routing::patch(patch_stato))
        .route("/:id/analisi-magazzino", get(analisi))
        .route("/:id/genera-arrivo-merce", axum::routing::post(genera_arrivo))
}

const SELECT: &str = "SELECT a.*, f.ragione_sociale as fornitore_nome, tp.nome as tipo_pagamento_nome \
    FROM acquisti a LEFT JOIN fornitori f ON a.fornitore_id = f.id LEFT JOIN tipi_pagamento tp ON a.tipo_pagamento_id = tp.id";

async fn list(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let mut stmt = conn.prepare(&format!("{SELECT} ORDER BY a.data_emissione DESC"))?;
    let rows = stmt.query_map([], |r| to_dto(&conn, r))?.collect::<Result<Vec<_>, _>>()?;
    Ok(Json(Value::Array(rows)))
}

async fn detail(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let dto = conn.query_row(&format!("{SELECT} WHERE a.id=?1"), [id], |r| to_dto(&conn, r)).optional()?;
    let mut dto = dto.ok_or_else(|| ApiError::not_found("Not found"))?;
    dto["righe"] = Value::Array(get_righe(&conn, id)?);
    Ok(Json(dto))
}

async fn create(State(state): State<AppState>, Json(a): Json<Value>) -> ApiResult<Json<Value>> {
    let numero = a.get("numero").and_then(Value::as_str).unwrap_or("");
    let arc = tenant_conn(&state)?;
    let mut guard = arc.lock().unwrap();
    if guard.query_row("SELECT id FROM acquisti WHERE numero=?1", [numero], |_| Ok(())).optional()?.is_some() {
        return Err(ApiError::conflict(format!("Il numero {numero} è già utilizzato da un altro documento")));
    }
    let tx = guard.transaction().map_err(ApiError::from)?;
    tx.execute(
        "INSERT INTO acquisti (numero,data_emissione,fornitore_id,tipo_pagamento_id,note,stato) VALUES (?1,?2,?3,?4,?5,?6)",
        params![
            numero,
            a.get("dataEmissione").and_then(Value::as_str),
            opt_i64(&a, "fornitoreId"),
            opt_i64(&a, "tipoPagamentoId"),
            str_def(&a, "note"),
            a.get("stato").and_then(Value::as_str).unwrap_or("RICEVUTA"),
        ],
    )?;
    let id = tx.last_insert_rowid();
    if let Some(righe) = a.get("righe").and_then(Value::as_array).filter(|r| !r.is_empty()) {
        save_righe(&tx, id, righe)?;
    }
    tx.commit().map_err(ApiError::from)?;
    Ok(Json(json!({ "id": id })))
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(a): Json<Value>,
) -> ApiResult<Json<Value>> {
    let numero = a.get("numero").and_then(Value::as_str).unwrap_or("");
    let arc = tenant_conn(&state)?;
    let mut guard = arc.lock().unwrap();
    if guard.query_row("SELECT id FROM acquisti WHERE numero=?1 AND id!=?2", params![numero, id], |_| Ok(())).optional()?.is_some() {
        return Err(ApiError::conflict(format!("Il numero {numero} è già utilizzato da un altro documento")));
    }
    let tx = guard.transaction().map_err(ApiError::from)?;
    tx.execute(
        "UPDATE acquisti SET numero=?1,data_emissione=?2,fornitore_id=?3,tipo_pagamento_id=?4,note=?5,stato=?6 WHERE id=?7",
        params![
            numero,
            a.get("dataEmissione").and_then(Value::as_str),
            opt_i64(&a, "fornitoreId"),
            opt_i64(&a, "tipoPagamentoId"),
            str_def(&a, "note"),
            a.get("stato").and_then(Value::as_str),
            id,
        ],
    )?;
    tx.execute("DELETE FROM acquisti_righe WHERE acquisto_id=?1", [id])?;
    if let Some(righe) = a.get("righe").and_then(Value::as_array).filter(|r| !r.is_empty()) {
        save_righe(&tx, id, righe)?;
    }
    tx.commit().map_err(ApiError::from)?;
    Ok(Json(json!({ "success": true })))
}

async fn patch_stato(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(b): Json<Value>,
) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    conn.execute("UPDATE acquisti SET stato=?1 WHERE id=?2", params![b.get("stato").and_then(Value::as_str), id])?;
    Ok(Json(json!({ "success": true })))
}

async fn remove(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    conn.execute("DELETE FROM pagamenti WHERE acquisto_id=?1", [id])?;
    conn.execute("UPDATE arrivi_merce SET acquisto_id=NULL WHERE acquisto_id=?1", [id])?;
    conn.execute("DELETE FROM acquisti WHERE id=?1", [id])?;
    Ok(Json(json!({ "success": true })))
}

async fn print(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let dto = conn
        .query_row(
            "SELECT a.*, f.ragione_sociale as f_nome, f.via as f_via, f.cap as f_cap, f.citta as f_citta, \
                    f.provincia as f_provincia, f.p_iva as f_p_iva, f.email as f_email, tp.nome as tp_nome \
             FROM acquisti a LEFT JOIN fornitori f ON a.fornitore_id = f.id LEFT JOIN tipi_pagamento tp ON a.tipo_pagamento_id = tp.id WHERE a.id=?1",
            [id],
            |r| {
                let mut dto = to_dto(&conn, r)?;
                let g = |k: &str| r.get::<_, Option<String>>(k).ok().flatten();
                dto["fornitore"] = json!({ "ragioneSociale": g("f_nome"), "via": g("f_via"), "cap": g("f_cap"), "citta": g("f_citta"), "provincia": g("f_provincia"), "pIva": g("f_p_iva"), "email": g("f_email") });
                dto["tipoPagamentoNome"] = json!(g("tp_nome").unwrap_or_default());
                Ok(dto)
            },
        )
        .optional()?;
    let mut dto = dto.ok_or_else(|| ApiError::not_found("Not found"))?;
    // La query /print non seleziona fornitore_nome → Node omette del tutto la chiave.
    if let Some(o) = dto.as_object_mut() {
        o.remove("fornitoreNome");
    }
    dto["righe"] = Value::Array(get_righe(&conn, id)?);
    let mut stmt = conn.prepare("SELECT data_pagamento, importo, metodo, note FROM pagamenti WHERE acquisto_id=?1 ORDER BY data_pagamento")?;
    let pagamenti: Vec<Value> = stmt
        .query_map([id], |p| {
            Ok(json!({
                "dataPagamento": p.get::<_, Option<String>>(0)?,
                "importo": opt_num(p.get::<_, Option<f64>>(1)?),
                "metodo": p.get::<_, Option<String>>(2)?,
                "note": p.get::<_, Option<String>>(3)?,
            }))
        })?
        .collect::<Result<_, _>>()?;
    dto["pagamenti"] = Value::Array(pagamenti);
    Ok(Json(dto))
}

async fn analisi(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    if conn.query_row("SELECT numero FROM acquisti WHERE id=?1", [id], |r| r.get::<_, Option<String>>(0)).optional()?.is_none() {
        return Err(ApiError::not_found("Acquisto non trovato"));
    }
    let numero: Option<String> = conn.query_row("SELECT numero FROM acquisti WHERE id=?1", [id], |r| r.get(0))?;
    // Nota: acquisti_righe NON ha la colonna codice_fornitore (Node la legge via
    // r.* → undefined). Non la selezioniamo: il codice di match viene dalla descrizione.
    let mut stmt = conn.prepare(
        "SELECT r.id, r.prodotto_id, r.descrizione, r.quantita, r.prezzo, r.iva, r.unita_misura, p.codice AS prodotto_codice_existing \
         FROM acquisti_righe r LEFT JOIN prodotti p ON p.id = r.prodotto_id WHERE r.acquisto_id=?1",
    )?;
    let raw = stmt
        .query_map([id], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, Option<i64>>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<f64>>(3)?,
                r.get::<_, Option<f64>>(4)?,
                r.get::<_, Option<f64>>(5)?,
                r.get::<_, Option<String>>(6)?,
                r.get::<_, Option<String>>(7)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut righe = Vec::new();
    let (mut matched, mut unmatched, mut nocode) = (0i64, 0i64, 0i64);
    for (rid, pid, descr, qta, prezzo, iva, um, pcodice) in raw {
        let cf: Option<String> = None;
        if let Some(p) = pid {
            matched += 1;
            righe.push(json!({ "rigaId": rid, "descrizione": descr, "quantita": opt_num(qta), "prezzoAcquisto": opt_num(prezzo), "codiceFornitore": cf.clone().unwrap_or_default(), "stato": "matched", "prodottoId": p, "prodottoCodice": pcodice }));
            continue;
        }
        let codice = cf.clone().filter(|s| !s.is_empty()).or_else(|| descr.clone()).unwrap_or_default().trim().to_string();
        if codice.is_empty() {
            nocode += 1;
            righe.push(json!({ "rigaId": rid, "descrizione": descr, "quantita": opt_num(qta), "prezzoAcquisto": opt_num(prezzo), "codiceFornitore": "", "stato": "noCode" }));
            continue;
        }
        let m = conn
            .query_row(
                "SELECT id, codice, codice_fornitore FROM prodotti WHERE codice_fornitore != '' AND LOWER(codice_fornitore) = LOWER(?1)",
                [&codice],
                |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, Option<String>>(2)?)),
            )
            .optional()?;
        if let Some((mid, mcodice, mcf)) = m {
            matched += 1;
            righe.push(json!({ "rigaId": rid, "descrizione": descr, "quantita": opt_num(qta), "prezzoAcquisto": opt_num(prezzo), "codiceFornitore": mcf, "stato": "matched", "prodottoId": mid, "prodottoCodice": mcodice }));
        } else {
            unmatched += 1;
            let prezzo_v = prezzo.unwrap_or(0.0);
            righe.push(json!({
                "rigaId": rid, "descrizione": descr, "quantita": opt_num(qta), "prezzoAcquisto": opt_num(prezzo),
                "codiceFornitore": codice, "stato": "unmatched",
                "nuovoProdotto": {
                    "codice": codice, "descrizione": descr, "codiceFornitore": codice, "prezzoAcquisto": opt_num(prezzo),
                    "prezzo": num(round2(prezzo_v * 1.30)), "iva": num(iva.unwrap_or(22.0)),
                    "unitaMisura": um.clone().filter(|s| !s.is_empty()).unwrap_or_else(|| "pz".into()),
                    "quantita": 0, "sogliaMinima": 0,
                },
            }));
        }
    }
    Ok(Json(json!({ "acquistoId": id, "numero": numero, "totale": righe.len(), "matched": matched, "unmatched": unmatched, "noCode": nocode, "righe": righe })))
}

async fn genera_arrivo(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(b): Json<Value>,
) -> ApiResult<Json<Value>> {
    let arc = tenant_conn(&state)?;
    let mut guard = arc.lock().unwrap();
    let acq = guard
        .query_row("SELECT fornitore_id, numero FROM acquisti WHERE id=?1", [id], |r| {
            Ok((r.get::<_, Option<i64>>(0)?, r.get::<_, Option<String>>(1)?))
        })
        .optional()?;
    let (fornitore_id, acq_numero) = acq.ok_or_else(|| ApiError::not_found("Acquisto non trovato"))?;
    let auto_crea = matches!(b.get("autoCreaProdotti"), Some(Value::Bool(true)));
    let pers = b.get("personalizzazioni").cloned().unwrap_or_else(|| json!({}));

    // acquisti_righe non ha codice_fornitore (vedi analisi): codice = descrizione.
    let mut stmt = guard.prepare(
        "SELECT r.id, r.prodotto_id, r.descrizione, r.quantita, r.prezzo, r.iva, r.unita_misura \
         FROM acquisti_righe r WHERE r.acquisto_id=?1",
    )?;
    let righe_acq = stmt
        .query_map([id], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, Option<i64>>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<f64>>(3)?,
                r.get::<_, Option<f64>>(4)?,
                r.get::<_, Option<f64>>(5)?,
                r.get::<_, Option<String>>(6)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);
    if righe_acq.is_empty() {
        return Err(ApiError::bad_request("Acquisto senza righe"));
    }

    let tx = guard.transaction().map_err(ApiError::from)?;
    let mut righe_arrivo: Vec<Value> = Vec::new();
    let mut prodotti_creati: Vec<Value> = Vec::new();

    for (rid, prod_id, descr, qta, prezzo, iva, um) in &righe_acq {
        let cf: Option<String> = None;
        let custom = pers.get(rid.to_string());
        let mut prodotto_id = *prod_id;
        if let Some(cp) = custom.and_then(|c| c.get("prodottoId")).and_then(Value::as_i64).filter(|&v| v != 0) {
            prodotto_id = Some(cp);
        } else if prodotto_id.is_none() {
            let codice = cf.clone().filter(|s| !s.is_empty()).or_else(|| descr.clone()).unwrap_or_default().trim().to_string();
            if !codice.is_empty() {
                if let Some(mid) = tx
                    .query_row(
                        "SELECT id FROM prodotti WHERE codice_fornitore != '' AND LOWER(codice_fornitore) = LOWER(?1)",
                        [&codice],
                        |r| r.get::<_, i64>(0),
                    )
                    .optional()?
                {
                    prodotto_id = Some(mid);
                }
            }
            let custom_np = custom.and_then(|c| c.get("nuovoProdotto"));
            if prodotto_id.is_none() && (auto_crea || custom_np.is_some()) {
                let prezzo_v = prezzo.unwrap_or(0.0);
                let np_def = json!({
                    "codice": codice, "descrizione": descr, "codiceFornitore": codice, "prezzoAcquisto": opt_num(*prezzo),
                    "prezzo": num(round2(prezzo_v * 1.30)), "iva": num(iva.unwrap_or(22.0)),
                    "unitaMisura": um.clone().filter(|s| !s.is_empty()).unwrap_or_else(|| "pz".into()),
                    "quantita": 0, "sogliaMinima": 0,
                });
                let np = custom_np.cloned().unwrap_or(np_def);
                // Il codice del fornitore può coincidere con quello di un articolo già
                // a catalogo: in quel caso il nuovo prende il primo suffisso libero.
                let codice_nuovo = codice_prodotto_libero(&tx, &npstr(&np, "codice"));
                tx.execute(
                    "INSERT INTO prodotti (codice, codice_fornitore, prezzo, prezzo_acquisto, quantita, soglia_minima, unita_misura, iva, categoria, descrizione, fornitore_id_preferito) \
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                    params![
                        codice_nuovo,
                        npstr(&np, "codiceFornitore"),
                        np.get("prezzo").and_then(Value::as_f64).unwrap_or(0.0),
                        np.get("prezzoAcquisto").and_then(Value::as_f64).unwrap_or(prezzo_v),
                        np.get("quantita").and_then(Value::as_f64).unwrap_or(0.0),
                        np.get("sogliaMinima").and_then(Value::as_f64).unwrap_or(0.0),
                        npstr_or(&np, "unitaMisura", "pz"),
                        np.get("iva").and_then(Value::as_f64).unwrap_or(22.0),
                        npstr(&np, "categoria"),
                        npstr(&np, "descrizione"),
                        fornitore_id,
                    ],
                )?;
                let new_pid = tx.last_insert_rowid();
                prodotto_id = Some(new_pid);
                prodotti_creati.push(json!({ "id": new_pid, "codice": codice_nuovo, "codiceFornitore": np.get("codiceFornitore") }));
            }
        }
        righe_arrivo.push(json!({
            "prodottoId": prodotto_id,
            "descrizione": descr,
            "codiceFornitore": cf.clone().unwrap_or_default(),
            "quantita": opt_num(*qta),
            "unitaMisura": um.clone().filter(|s| !s.is_empty()).unwrap_or_else(|| "pz".into()),
            "prezzoAcquisto": opt_num(*prezzo),
        }));
    }

    let numero = get_next_numero(&tx, "arrivi_merce", "arrivi_merce", 0)?;
    let today = oggi();
    tx.execute(
        "INSERT INTO arrivi_merce (numero, data, fornitore_id, acquisto_id, numero_documento_fornitore, note, stato) \
         VALUES (?1,?2,?3,?4,?5,'Generato da acquisto','RICEVUTO')",
        params![numero, today, fornitore_id, id, acq_numero.clone().unwrap_or_default()],
    )?;
    let arrivo_id = tx.last_insert_rowid();
    for r in &righe_arrivo {
        tx.execute(
            "INSERT INTO arrivi_merce_righe (arrivo_merce_id, prodotto_id, variante_id, descrizione, codice_fornitore, quantita, unita_misura, prezzo_acquisto, variante_taglia, variante_colore) \
             VALUES (?1,?2,NULL,?3,?4,?5,?6,?7,'','')",
            params![
                arrivo_id,
                r.get("prodottoId").and_then(Value::as_i64),
                r.get("descrizione").and_then(Value::as_str),
                r.get("codiceFornitore").and_then(Value::as_str).unwrap_or(""),
                r.get("quantita").and_then(Value::as_f64),
                r.get("unitaMisura").and_then(Value::as_str).unwrap_or(""),
                r.get("prezzoAcquisto").and_then(Value::as_f64).unwrap_or(0.0),
            ],
        )?;
    }
    let forn_nome = match fornitore_id {
        Some(fid) => tx.query_row("SELECT ragione_sociale FROM fornitori WHERE id=?1", [fid], |r| r.get::<_, Option<String>>(0)).optional()?.flatten().unwrap_or_default(),
        None => String::new(),
    };
    let ctx = StockCtx {
        data: Some(today),
        causale: "ARRIVO_MERCE".into(),
        documento_tipo: "ARRIVO_MERCE".into(),
        documento_id: Some(arrivo_id),
        documento_numero: numero.clone(),
        fornitore_id,
        fornitore_nome: forn_nome,
        note: format!("Generato da acquisto #{id}"),
        ..Default::default()
    };
    applica_righe_stock(&tx, &righe_arrivo, 1, &ctx)?;
    tx.commit().map_err(ApiError::from)?;
    Ok(Json(json!({ "arrivoId": arrivo_id, "numero": numero, "prodottiCreati": prodotti_creati, "righeTotali": righe_arrivo.len() })))
}

// ── helpers ──────────────────────────────────────────────────────────────────

fn save_righe(conn: &Connection, acquisto_id: i64, righe: &[Value]) -> rusqlite::Result<()> {
    for r in righe {
        if crate::web::riga_vuota(r) {
            continue;
        }
        conn.execute(
            "INSERT INTO acquisti_righe (acquisto_id, prodotto_id, codice_prodotto, descrizione, quantita, prezzo, sconto, iva, unita_misura, variante_id, variante_taglia, variante_colore, tipo) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
            params![
                acquisto_id,
                r.get("prodottoId").and_then(Value::as_i64).filter(|&v| v != 0),
                str_def(r, "codiceProdotto"),
                raw_opt(r, "descrizione"),
                r.get("quantita").and_then(Value::as_f64),
                r.get("prezzo").and_then(Value::as_f64),
                r.get("sconto").and_then(Value::as_f64).unwrap_or(0.0),
                r.get("iva").and_then(Value::as_f64),
                str_def(r, "unitaMisura"),
                r.get("varianteId").and_then(Value::as_i64).filter(|&v| v != 0),
                str_def(r, "varianteTaglia"),
                str_def(r, "varianteColore"),
                str_or(r, "tipo", "PRODOTTO"),
            ],
        )?;
    }
    Ok(())
}

fn get_righe(conn: &Connection, acquisto_id: i64) -> rusqlite::Result<Vec<Value>> {
    let mut stmt = conn.prepare(
        "SELECT ar.*, p.codice as prodotto_codice FROM acquisti_righe ar LEFT JOIN prodotti p ON ar.prodotto_id = p.id WHERE ar.acquisto_id=?1",
    )?;
    let rows = stmt
        .query_map([acquisto_id], |r| {
            Ok(json!({
                "id": r.get::<_, i64>("id")?,
                "prodottoId": r.get::<_, Option<i64>>("prodotto_id")?,
                "prodottoCodice": r.get::<_, Option<String>>("prodotto_codice")?,
                "codiceProdotto": r.get::<_, Option<String>>("codice_prodotto")?.unwrap_or_default(),
                "descrizione": r.get::<_, Option<String>>("descrizione")?,
                "quantita": opt_num(r.get::<_, Option<f64>>("quantita")?),
                "unitaMisura": r.get::<_, Option<String>>("unita_misura")?,
                "prezzo": opt_num(r.get::<_, Option<f64>>("prezzo")?),
                "sconto": num(r.get::<_, Option<f64>>("sconto")?.unwrap_or(0.0)),
                "iva": opt_num(r.get::<_, Option<f64>>("iva")?),
                "varianteId": r.get::<_, Option<i64>>("variante_id")?,
                "varianteTaglia": r.get::<_, Option<String>>("variante_taglia")?.unwrap_or_default(),
                "varianteColore": r.get::<_, Option<String>>("variante_colore")?.unwrap_or_default(),
                "tipo": r.get::<_, Option<String>>("tipo")?.filter(|s| !s.is_empty()).unwrap_or_else(|| "PRODOTTO".into()),
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn to_dto(conn: &Connection, r: &Row) -> rusqlite::Result<Value> {
    let id = r.get::<_, i64>("id")?;
    let totale: f64 = conn.query_row("SELECT COALESCE(SUM(quantita * prezzo * (1 - COALESCE(sconto,0)/100) * (1 + iva/100)), 0) FROM acquisti_righe WHERE acquisto_id=?1", [id], |x| x.get(0))?;
    let imponibile: f64 = conn.query_row("SELECT COALESCE(SUM(quantita * prezzo * (1 - COALESCE(sconto,0)/100)), 0) FROM acquisti_righe WHERE acquisto_id=?1", [id], |x| x.get(0))?;
    Ok(json!({
        "id": id,
        "numero": r.get::<_, Option<String>>("numero")?,
        "dataEmissione": r.get::<_, Option<String>>("data_emissione")?,
        "fornitoreId": r.get::<_, Option<i64>>("fornitore_id")?,
        "fornitoreNome": r.get::<_, Option<String>>("fornitore_nome").ok().flatten(),
        "tipoPagamentoId": r.get::<_, Option<i64>>("tipo_pagamento_id")?,
        "tipoPagamentoNome": r.get::<_, Option<String>>("tipo_pagamento_nome").ok().flatten(),
        "note": r.get::<_, Option<String>>("note")?,
        "stato": r.get::<_, Option<String>>("stato")?,
        "totale": num(totale),
        "imponibile": num(imponibile),
    }))
}

fn round2(x: f64) -> f64 {
    (x * 100.0).round() / 100.0
}
fn npstr(v: &Value, k: &str) -> String {
    v.get(k).and_then(Value::as_str).unwrap_or("").to_string()
}
fn npstr_or(v: &Value, k: &str, d: &str) -> String {
    let s = npstr(v, k);
    if s.is_empty() { d.to_string() } else { s }
}
fn str_or(b: &Value, k: &str, d: &str) -> String {
    let s = str_def(b, k);
    if s.is_empty() { d.to_string() } else { s }
}
fn opt_i64(b: &Value, k: &str) -> Option<i64> {
    b.get(k).and_then(Value::as_i64).filter(|&v| v != 0)
}
