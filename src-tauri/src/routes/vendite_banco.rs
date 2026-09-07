//! /api/vendite-banco — vendita al banco (cassa) con scarico scorte, pagamenti
//! (anche misti) e generazione fattura. Parità con routes/venditeBanco.js.

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
use crate::web::{num, opt_num, raw_opt, str_def, tenant_conn};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/:id", get(detail).delete(remove))
        .route("/:id/print", get(print))
        .route("/:id/genera-fattura", axum::routing::post(genera_fattura))
}

async fn list(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let mut stmt = conn.prepare("SELECT * FROM vendite_banco ORDER BY data DESC, id DESC")?;
    let rows = stmt.query_map([], |r| to_dto(&conn, r))?.collect::<Result<Vec<_>, _>>()?;
    Ok(Json(Value::Array(rows)))
}

async fn detail(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    with_righe(state, id).await
}
async fn print(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    with_righe(state, id).await
}
async fn with_righe(state: AppState, id: i64) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let dto = conn.query_row("SELECT * FROM vendite_banco WHERE id=?1", [id], |r| to_dto(&conn, r)).optional()?;
    let mut dto = dto.ok_or_else(|| ApiError::not_found("Not found"))?;
    dto["righe"] = Value::Array(get_righe(&conn, id)?);
    Ok(Json(dto))
}

async fn create(State(state): State<AppState>, Json(v): Json<Value>) -> ApiResult<Json<Value>> {
    let numero = v.get("numero").and_then(Value::as_str).unwrap_or("");
    let arc = tenant_conn(&state)?;
    let mut guard = arc.lock().unwrap();
    if guard.query_row("SELECT id FROM vendite_banco WHERE numero=?1", [numero], |_| Ok(())).optional()?.is_some() {
        return Err(ApiError::conflict(format!("Il numero {numero} è già utilizzato da un altro documento")));
    }
    // metodo_pagamento da salvare: misti → metodi unici join '+', altrimenti singolo.
    let pagamenti_misti = v.get("pagamenti").and_then(Value::as_array).filter(|a| !a.is_empty()).cloned();
    let metodo_singolo = v.get("metodoPagamento").and_then(Value::as_str).unwrap_or("CONTANTI").to_string();
    let metodo_store = match &pagamenti_misti {
        Some(ps) => {
            let mut seen = Vec::new();
            for p in ps {
                if let Some(m) = p.get("metodo").and_then(Value::as_str) {
                    if !seen.iter().any(|x| x == m) {
                        seen.push(m.to_string());
                    }
                }
            }
            seen.join("+")
        }
        None => metodo_singolo.clone(),
    };
    let cliente_nome = v.get("clienteNome").and_then(Value::as_str).unwrap_or("").to_string();
    let note_base = if cliente_nome.is_empty() {
        format!("Vendita al banco N. {numero}")
    } else {
        format!("Vendita al banco N. {numero} – {cliente_nome}")
    };
    let data = v.get("data").and_then(Value::as_str);
    // conto del pagamento singolo: Node usa il valore GREZZO di metodoPagamento
    // (undefined → BANCA), non quello con default 'CONTANTI'.
    let conto_singolo = if v.get("metodoPagamento").and_then(Value::as_str) == Some("CONTANTI") {
        "CASSA"
    } else {
        "BANCA"
    };

    let tx = guard.transaction().map_err(ApiError::from)?;
    // Come il try/catch di venditeBanco.js: un errore SQL diventa 400 col messaggio.
    let inner = || -> rusqlite::Result<i64> {
        let righe_slice: &[Value] = v.get("righe").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]);
        let vendita_id = inserisci_vendita(&tx, numero, data, &cliente_nome, &metodo_store, &str_def(&v, "note"), "BANCO", None, righe_slice)?;
        match &pagamenti_misti {
            Some(ps) => {
                for p in ps {
                    let metodo = p.get("metodo").and_then(Value::as_str).unwrap_or("");
                    let conto = if metodo == "CONTANTI" { "CASSA" } else { "BANCA" };
                    tx.execute(
                        "INSERT INTO pagamenti (data_pagamento, importo, metodo, tipo, conto, vendita_banco_id, note) VALUES (?1,?2,?3,'ENTRATA',?4,?5,?6)",
                        params![data, p.get("importo").and_then(Value::as_f64), metodo, conto, vendita_id, note_base],
                    )?;
                }
            }
            None => {
                let totale = calcola_totale(&tx, vendita_id)?;
                tx.execute(
                    "INSERT INTO pagamenti (data_pagamento, importo, metodo, tipo, conto, vendita_banco_id, note) VALUES (?1,?2,?3,'ENTRATA',?4,?5,?6)",
                    params![data, totale, metodo_singolo, conto_singolo, vendita_id, note_base],
                )?;
            }
        }
        Ok(vendita_id)
    };
    let vendita_id = inner().map_err(sql_400)?;
    tx.commit().map_err(ApiError::from)?;
    Ok(Json(json!({ "id": vendita_id })))
}

async fn genera_fattura(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(b): Json<Value>,
) -> ApiResult<Json<Value>> {
    let arc = tenant_conn(&state)?;
    let mut guard = arc.lock().unwrap();
    let vendita = guard
        .query_row("SELECT data, note FROM vendite_banco WHERE id=?1", [id], |r| {
            Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?))
        })
        .optional()?;
    let (vdata, vnote) = vendita.ok_or_else(|| ApiError::not_found("Vendita non trovata"))?;
    let cliente_id = b.get("clienteId").and_then(Value::as_i64).filter(|&v| v != 0);
    let righe = get_righe(&guard, id)?;
    let tx = guard.transaction().map_err(ApiError::from)?;
    let numero = get_next_numero(&tx, "fatture", "fatture", 0)?;
    tx.execute(
        "INSERT INTO fatture (numero, data_emissione, cliente_id, ddt_id, note, stato, tipo_pagamento_id) VALUES (?1,?2,?3,NULL,?4,'PAGATA',NULL)",
        params![numero, vdata, cliente_id, vnote.unwrap_or_default()],
    )?;
    let fattura_id = tx.last_insert_rowid();
    for r in &righe {
        tx.execute(
            "INSERT INTO fatture_righe (fattura_id, prodotto_id, descrizione, quantita, prezzo, sconto, iva, unita_misura, variante_id, variante_taglia, variante_colore) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            (
                fattura_id,
                r.get("prodottoId").and_then(Value::as_i64),
                r.get("descrizione").and_then(Value::as_str).map(str::to_string),
                r.get("quantita").and_then(Value::as_f64),
                r.get("prezzo").and_then(Value::as_f64),
                r.get("sconto").and_then(Value::as_f64).unwrap_or(0.0),
                r.get("iva").and_then(Value::as_f64),
                r.get("unitaMisura").and_then(Value::as_str).unwrap_or("").to_string(),
                r.get("varianteId").and_then(Value::as_i64),
                r.get("varianteTaglia").and_then(Value::as_str).unwrap_or("").to_string(),
                r.get("varianteColore").and_then(Value::as_str).unwrap_or("").to_string(),
            ),
        )?;
    }
    tx.commit().map_err(ApiError::from)?;
    Ok(Json(json!({ "id": fattura_id, "numero": numero })))
}

async fn remove(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let arc = tenant_conn(&state)?;
    let mut guard = arc.lock().unwrap();
    let tx = guard.transaction().map_err(ApiError::from)?;
    let vendita = tx
        .query_row("SELECT numero, cliente_nome FROM vendite_banco WHERE id=?1", [id], |r| {
            Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?))
        })
        .optional()?;
    let righe = get_righe(&tx, id)?;
    if !righe.is_empty() {
        let (vnum, vcli) = vendita.unwrap_or((None, None));
        let ctx = StockCtx {
            causale: "ELIMINAZIONE".into(),
            documento_tipo: "VENDITA_BANCO".into(),
            documento_id: Some(id),
            documento_numero: vnum.unwrap_or_default(),
            cliente_nome: vcli.unwrap_or_default(),
            ..Default::default()
        };
        applica_righe_stock(&tx, &righe, 1, &ctx)?;
    }
    tx.execute("DELETE FROM pagamenti WHERE vendita_banco_id=?1", [id])?;
    tx.execute("DELETE FROM vendite_banco WHERE id=?1", [id])?;
    tx.commit().map_err(ApiError::from)?;
    Ok(Json(json!({ "success": true })))
}

// ── helpers ──────────────────────────────────────────────────────────────────

/// Inserisce intestazione + righe di una vendita e scarica lo stock — condiviso
/// tra la `create()` HTTP (vendita al banco, canale="BANCO") e l'import ordini
/// marketplace (`routes/marketplace.rs`, canale="EBAY"/"AMAZON"). Non tocca
/// `pagamenti`: per gli import da marketplace l'incasso è gestito dal
/// marketplace stesso, non dalla cassa locale.
pub fn inserisci_vendita(
    conn: &Connection,
    numero: &str,
    data: Option<&str>,
    cliente_nome: &str,
    metodo_pagamento: &str,
    note: &str,
    canale: &str,
    riferimento_esterno: Option<&str>,
    righe: &[Value],
) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO vendite_banco (numero, data, cliente_nome, metodo_pagamento, note, stato, canale, riferimento_esterno) \
         VALUES (?1,?2,?3,?4,?5,'EMESSA',?6,?7)",
        params![numero, data, cliente_nome, metodo_pagamento, note, canale, riferimento_esterno],
    )?;
    let vendita_id = conn.last_insert_rowid();
    if !righe.is_empty() {
        save_righe(conn, vendita_id, righe)?;
        let causale = if canale == "BANCO" { "VENDITA_BANCO".to_string() } else { format!("IMPORT_{canale}") };
        let ctx = StockCtx {
            data: data.map(str::to_string),
            causale,
            documento_tipo: "VENDITA_BANCO".into(),
            documento_id: Some(vendita_id),
            documento_numero: numero.to_string(),
            cliente_nome: cliente_nome.to_string(),
            ..Default::default()
        };
        applica_righe_stock(conn, righe, -1, &ctx)?;
    }
    Ok(vendita_id)
}

fn save_righe(conn: &Connection, vendita_id: i64, righe: &[Value]) -> rusqlite::Result<()> {
    for r in righe {
        conn.execute(
            "INSERT INTO vendite_banco_righe (vendita_id, prodotto_id, descrizione, quantita, prezzo, sconto, iva, unita_misura, variante_id, variante_taglia, variante_colore) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![
                vendita_id,
                r.get("prodottoId").and_then(Value::as_i64).filter(|&v| v != 0),
                raw_opt(r, "descrizione"),
                r.get("quantita").and_then(Value::as_f64),
                r.get("prezzo").and_then(Value::as_f64),
                r.get("sconto").and_then(Value::as_f64).unwrap_or(0.0),
                r.get("iva").and_then(Value::as_f64),
                str_def(r, "unitaMisura"),
                r.get("varianteId").and_then(Value::as_i64).filter(|&v| v != 0),
                str_def(r, "varianteTaglia"),
                str_def(r, "varianteColore"),
            ],
        )?;
    }
    Ok(())
}

fn get_righe(conn: &Connection, vendita_id: i64) -> rusqlite::Result<Vec<Value>> {
    let mut stmt = conn.prepare(
        "SELECT vr.*, p.nome as prodotto_nome FROM vendite_banco_righe vr LEFT JOIN prodotti p ON vr.prodotto_id = p.id WHERE vr.vendita_id=?1",
    )?;
    let rows = stmt
        .query_map([vendita_id], |r| {
            Ok(json!({
                "id": r.get::<_, i64>("id")?,
                "prodottoId": r.get::<_, Option<i64>>("prodotto_id")?,
                "prodottoNome": r.get::<_, Option<String>>("prodotto_nome")?,
                "descrizione": r.get::<_, Option<String>>("descrizione")?,
                "quantita": opt_num(r.get::<_, Option<f64>>("quantita")?),
                "unitaMisura": r.get::<_, Option<String>>("unita_misura")?,
                "prezzo": opt_num(r.get::<_, Option<f64>>("prezzo")?),
                "sconto": num(r.get::<_, Option<f64>>("sconto")?.unwrap_or(0.0)),
                "iva": opt_num(r.get::<_, Option<f64>>("iva")?),
                "varianteId": r.get::<_, Option<i64>>("variante_id")?,
                "varianteTaglia": r.get::<_, Option<String>>("variante_taglia")?,
                "varianteColore": r.get::<_, Option<String>>("variante_colore")?,
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Mappa un errore SQL su 400 col messaggio grezzo (come `res.status(400).json({error: err.message})`).
fn sql_400(e: rusqlite::Error) -> ApiError {
    let msg = match &e {
        rusqlite::Error::SqliteFailure(_, Some(m)) => m.clone(),
        other => other.to_string(),
    };
    ApiError::Status(axum::http::StatusCode::BAD_REQUEST, msg)
}

fn calcola_totale(conn: &Connection, vendita_id: i64) -> rusqlite::Result<f64> {
    conn.query_row(
        "SELECT COALESCE(SUM(quantita * prezzo * (1 - COALESCE(sconto,0)/100) * (1 + iva/100)), 0) FROM vendite_banco_righe WHERE vendita_id=?1",
        [vendita_id],
        |r| r.get(0),
    )
}

fn to_dto(conn: &Connection, r: &Row) -> rusqlite::Result<Value> {
    let id = r.get::<_, i64>("id")?;
    let totale = calcola_totale(conn, id)?;
    Ok(json!({
        "id": id,
        "numero": r.get::<_, Option<String>>("numero")?,
        "data": r.get::<_, Option<String>>("data")?,
        "clienteNome": r.get::<_, Option<String>>("cliente_nome")?,
        "metodoPagamento": r.get::<_, Option<String>>("metodo_pagamento")?,
        "note": r.get::<_, Option<String>>("note")?,
        "stato": r.get::<_, Option<String>>("stato")?,
        "totale": num(totale),
    }))
}
