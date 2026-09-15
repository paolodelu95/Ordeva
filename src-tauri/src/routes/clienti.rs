//! /api/clienti — parità con routes/clienti.js (anagrafica + stats + indirizzi)

use std::collections::HashMap;

use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Json, Router,
};
use rusqlite::{params, OptionalExtension, Row};
use serde_json::{json, Value};

use crate::db::AppState;
use crate::error::{ApiError, ApiResult};
use crate::gemello::{applica_da_cliente, normalize_piva, scollega_cliente};
use crate::routes::fornitori::{import_stato, norm_piva, patch_existing};
use crate::web::{num, raw_opt, str_def, tenant_conn};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/count", get(count))
        .route("/check-piva", get(check_piva))
        .route("/import", post(import))
        .route("/:id", get(detail).put(update).delete(remove))
        .route("/:id/top-prodotti", get(top_prodotti))
        .route("/:id/fatture-insolute", get(fatture_insolute))
        .route("/:id/indirizzi", get(indirizzi_list).post(indirizzi_create))
        .route(
            "/:id/indirizzi/:indId",
            axum::routing::put(indirizzi_update).delete(indirizzi_remove),
        )
}

fn to_dto(r: &Row) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": r.get::<_, i64>("id")?,
        "ragioneSociale": r.get::<_, Option<String>>("ragione_sociale")?,
        "email": r.get::<_, Option<String>>("email")?,
        "telefono": r.get::<_, Option<String>>("telefono")?,
        "cellulare": r.get::<_, Option<String>>("cellulare")?,
        "via": r.get::<_, Option<String>>("via")?,
        "cap": r.get::<_, Option<String>>("cap")?,
        "citta": r.get::<_, Option<String>>("citta")?,
        "provincia": r.get::<_, Option<String>>("provincia")?,
        "stato": r.get::<_, Option<String>>("stato")?,
        "codiceFiscale": r.get::<_, Option<String>>("codice_fiscale")?,
        "pIva": r.get::<_, Option<String>>("p_iva")?,
        "sdi": r.get::<_, Option<String>>("sdi")?,
        "pec": r.get::<_, Option<String>>("pec")?,
        "tipoPagamentoId": r.get::<_, Option<i64>>("tipo_pagamento_id")?,
        "listinoId": r.get::<_, Option<i64>>("listino_id")?,
        "tipoSoggetto": r.get::<_, Option<String>>("tipo_soggetto")?.filter(|s| !s.is_empty()).unwrap_or_else(|| "PRIVATO".into()),
        "cig": r.get::<_, Option<String>>("cig")?.unwrap_or_default(),
        "cup": r.get::<_, Option<String>>("cup")?.unwrap_or_default(),
        "aliquotaIvaId": r.get::<_, Option<i64>>("aliquota_iva_id")?,
        "ancheFornitore": r.get::<_, Option<i64>>("anche_fornitore")? == Some(1),
        "fornitoreCollegatoId": r.get::<_, Option<i64>>("fornitore_collegato_id")?,
        "agenteId": r.get::<_, Option<i64>>("agente_id")?,
        "provvigione": r.get::<_, Option<f64>>("provvigione")?,
    }))
}

async fn list(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT c.*,
          (SELECT MAX(f.data_emissione) FROM fatture f WHERE f.cliente_id = c.id) AS ultimo_acquisto,
          (SELECT COALESCE(SUM(fr.quantita * fr.prezzo * (1 - COALESCE(fr.sconto,0)/100) * (1 + fr.iva/100)), 0)
             FROM fatture f
             LEFT JOIN fatture_righe fr ON fr.fattura_id = f.id
             WHERE f.cliente_id = c.id
               AND f.stato != 'ANNULLATA'
               AND f.data_emissione >= date('now','start of year')) AS fatturato_anno,
          (SELECT COUNT(*) FROM fatture f
             LEFT JOIN tipi_pagamento tp ON tp.id = f.tipo_pagamento_id
             WHERE f.cliente_id = c.id
               AND f.stato NOT IN ('PAGATA','ANNULLATA','STORNATA')
               AND date(f.data_emissione, '+' || COALESCE(tp.giorni_scadenza,30) || ' days') < date('now')) AS fatture_insolute
        FROM clienti c
        ORDER BY c.ragione_sociale",
    )?;
    let rows = stmt
        .query_map([], |r| {
            let mut dto = to_dto(r)?;
            let obj = dto.as_object_mut().unwrap();
            let ultimo: Option<String> = r.get("ultimo_acquisto")?;
            obj.insert("ultimoAcquisto".into(), ultimo.map(Value::from).unwrap_or(Value::Null));
            obj.insert("fatturatoAnno".into(), num(r.get::<_, Option<f64>>("fatturato_anno")?.unwrap_or(0.0)));
            obj.insert("fattureInsolute".into(), json!(r.get::<_, Option<i64>>("fatture_insolute")?.unwrap_or(0)));
            Ok(dto)
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(Value::Array(rows)))
}

async fn count(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM clienti", [], |r| r.get(0))?;
    Ok(Json(json!(n)))
}

async fn check_piva(
    State(state): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let piva = match q.get("piva") {
        Some(p) if !p.is_empty() => p.clone(),
        _ => return Ok(Json(json!({ "exists": false }))),
    };
    let clean = normalize_piva(&piva);
    if clean.len() != 11 || !clean.bytes().all(|b| b.is_ascii_digit()) {
        return Ok(Json(json!({ "exists": false })));
    }
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let id = find_by_piva(&conn, &clean, q.get("excludeId").and_then(|s| s.parse().ok()))?;
    Ok(Json(json!({ "exists": id.is_some(), "id": id })))
}

async fn detail(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    conn.query_row("SELECT * FROM clienti WHERE id=?1", [id], |r| to_dto(r))
        .optional()?
        .map(Json)
        .ok_or_else(|| ApiError::not_found("Cliente non trovato"))
}

async fn create(State(state): State<AppState>, Json(c): Json<Value>) -> ApiResult<Json<Value>> {
    if str_def(&c, "ragioneSociale").trim().is_empty() {
        return Err(ApiError::bad_request("La ragione sociale è obbligatoria"));
    }
    let piva = norm_piva(&c);
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    if let Some(p) = piva.as_deref().filter(|p| !p.is_empty()) {
        if let Some(dup) = find_by_piva(&conn, p, None)? {
            return Err(ApiError::Body(
                axum::http::StatusCode::CONFLICT,
                json!({ "error": format!("Esiste già un cliente con la P.IVA {p}"), "duplicateId": dup }),
            ));
        }
    }
    conn.execute(
        "INSERT INTO clienti \
         (ragione_sociale, email, telefono, cellulare, via, cap, citta, provincia, stato, codice_fiscale, p_iva, sdi, pec, tipo_pagamento_id, listino_id, tipo_soggetto, cig, cup, aliquota_iva_id, anche_fornitore, agente_id, provvigione) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22)",
        params![
            raw_opt(&c, "ragioneSociale"),
            raw_opt(&c, "email"),
            raw_opt(&c, "telefono"),
            str_def(&c, "cellulare"),
            raw_opt(&c, "via"),
            raw_opt(&c, "cap"),
            raw_opt(&c, "citta"),
            raw_opt(&c, "provincia"),
            raw_opt(&c, "stato"),
            raw_opt(&c, "codiceFiscale"),
            piva,
            str_def(&c, "sdi"),
            str_def(&c, "pec"),
            opt_id(&c, "tipoPagamentoId"),
            opt_id(&c, "listinoId"),
            tipo_soggetto(&c),
            str_def(&c, "cig"),
            str_def(&c, "cup"),
            opt_id(&c, "aliquotaIvaId"),
            flag(&c, "ancheFornitore"),
            opt_id(&c, "agenteId"),
            c.get("provvigione").and_then(Value::as_f64),
        ],
    )?;
    let id = conn.last_insert_rowid();
    applica_da_cliente(&conn, id)?;
    Ok(Json(json!({ "id": id })))
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(c): Json<Value>,
) -> ApiResult<Json<Value>> {
    if str_def(&c, "ragioneSociale").trim().is_empty() {
        return Err(ApiError::bad_request("La ragione sociale è obbligatoria"));
    }
    let piva = norm_piva(&c);
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    if let Some(p) = piva.as_deref().filter(|p| !p.is_empty()) {
        if let Some(dup) = find_by_piva(&conn, p, Some(id))? {
            return Err(ApiError::Body(
                axum::http::StatusCode::CONFLICT,
                json!({ "error": format!("Esiste già un altro cliente con la P.IVA {p}"), "duplicateId": dup }),
            ));
        }
    }
    conn.execute(
        "UPDATE clienti SET ragione_sociale=?1, email=?2, telefono=?3, cellulare=?4, via=?5, cap=?6, \
         citta=?7, provincia=?8, stato=?9, codice_fiscale=?10, p_iva=?11, sdi=?12, pec=?13, tipo_pagamento_id=?14, listino_id=?15, \
         tipo_soggetto=?16, cig=?17, cup=?18, aliquota_iva_id=?19, anche_fornitore=?20, agente_id=?21, provvigione=?22 WHERE id=?23",
        params![
            raw_opt(&c, "ragioneSociale"),
            raw_opt(&c, "email"),
            raw_opt(&c, "telefono"),
            str_def(&c, "cellulare"),
            raw_opt(&c, "via"),
            raw_opt(&c, "cap"),
            raw_opt(&c, "citta"),
            raw_opt(&c, "provincia"),
            raw_opt(&c, "stato"),
            raw_opt(&c, "codiceFiscale"),
            piva,
            str_def(&c, "sdi"),
            str_def(&c, "pec"),
            opt_id(&c, "tipoPagamentoId"),
            opt_id(&c, "listinoId"),
            tipo_soggetto(&c),
            str_def(&c, "cig"),
            str_def(&c, "cup"),
            opt_id(&c, "aliquotaIvaId"),
            flag(&c, "ancheFornitore"),
            opt_id(&c, "agenteId"),
            c.get("provvigione").and_then(Value::as_f64),
            id,
        ],
    )?;
    applica_da_cliente(&conn, id)?;
    Ok(Json(json!({ "success": true })))
}

async fn remove(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let cnt = |t: &str| -> rusqlite::Result<i64> {
        conn.query_row(
            &format!("SELECT COUNT(*) FROM {t} WHERE cliente_id=?1"),
            [id],
            |r| r.get(0),
        )
    };
    let fatture = cnt("fatture")?;
    let ddt = cnt("ddt")?;
    let preventivi = cnt("preventivi")?;
    let ordini = cnt("ordini")?;
    let note_credito = cnt("note_credito")?;
    if fatture + ddt + preventivi + ordini + note_credito > 0 {
        return Err(ApiError::Body(
            axum::http::StatusCode::CONFLICT,
            json!({
                "error": "cliente_ha_documenti",
                "counts": { "fatture": fatture, "ddt": ddt, "preventivi": preventivi, "ordini": ordini, "noteCredito": note_credito }
            }),
        ));
    }
    scollega_cliente(&conn, id)?;
    conn.execute("DELETE FROM clienti WHERE id=?1", [id])?;
    Ok(Json(json!({ "success": true })))
}

async fn top_prodotti(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Query(q): Query<HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let limit: i64 = q
        .get("limit")
        .and_then(|s| s.parse().ok())
        .unwrap_or(5)
        .clamp(1, 20);
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT p.id, p.codice, p.descrizione, p.prezzo, p.iva, p.unita_misura,
               COUNT(*) as occorrenze, SUM(fr.quantita) as quantita_totale, MAX(f.data_emissione) as ultima_vendita
        FROM fatture_righe fr
        JOIN fatture f ON f.id = fr.fattura_id
        JOIN prodotti p ON p.id = fr.prodotto_id
        WHERE f.cliente_id = ?1 AND f.stato != 'ANNULLATA'
          AND f.data_emissione >= date('now','-12 months') AND fr.prodotto_id IS NOT NULL
        GROUP BY p.id ORDER BY occorrenze DESC, ultima_vendita DESC LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(params![id, limit], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "codice": r.get::<_, Option<String>>(1)?,
                "descrizione": r.get::<_, Option<String>>(2)?,
                "prezzo": crate::web::opt_num(r.get::<_, Option<f64>>(3)?),
                "iva": crate::web::opt_num(r.get::<_, Option<f64>>(4)?),
                "unitaMisura": r.get::<_, Option<String>>(5)?,
                "occorrenze": r.get::<_, i64>(6)?,
                "quantitaTotale": crate::web::opt_num(r.get::<_, Option<f64>>(7)?),
                "ultimaVendita": r.get::<_, Option<String>>(8)?,
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(Value::Array(rows)))
}

async fn fatture_insolute(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT f.id, f.numero, f.data_emissione, f.stato,
          COALESCE((SELECT SUM(fr.quantita * fr.prezzo * (1 - COALESCE(fr.sconto,0)/100.0) * (1 + fr.iva/100.0))
            FROM fatture_righe fr WHERE fr.fattura_id = f.id), 0) AS totale
        FROM fatture f
        WHERE f.cliente_id = ?1 AND f.stato NOT IN ('PAGATA','ANNULLATA','STORNATA')
        ORDER BY f.data_emissione DESC",
    )?;
    let rows = stmt
        .query_map([id], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "numero": r.get::<_, Option<String>>(1)?,
                "dataEmissione": r.get::<_, Option<String>>(2)?,
                "totale": num(r.get::<_, Option<f64>>(4)?.unwrap_or(0.0)),
                "stato": r.get::<_, Option<String>>(3)?,
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(Value::Array(rows)))
}

async fn import(State(state): State<AppState>, Json(body): Json<Value>) -> ApiResult<Json<Value>> {
    let records = body.as_array().cloned().unwrap_or_default();
    let (mut created, mut updated, mut skipped) = (0i64, 0i64, 0i64);
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    for c in &records {
        if str_def(c, "ragioneSociale").trim().is_empty() {
            skipped += 1;
            continue;
        }
        let piva = norm_piva(c);
        let mut existing: Option<i64> = None;
        if let Some(p) = piva.as_deref().filter(|p| p.len() == 11 && p.bytes().all(|b| b.is_ascii_digit())) {
            existing = find_by_piva(&conn, p, None)?;
        }
        if existing.is_none() {
            let rs = str_def(c, "ragioneSociale").to_lowercase().trim().to_string();
            existing = conn
                .query_row(
                    "SELECT id FROM clienti WHERE LOWER(TRIM(ragione_sociale))=?1",
                    [rs],
                    |r| r.get(0),
                )
                .optional()?;
        }
        match existing {
            Some(id) => {
                if patch_existing(&conn, "clienti", id, c, piva.as_deref())? {
                    updated += 1;
                } else {
                    skipped += 1;
                }
            }
            None => {
                conn.execute(
                    "INSERT INTO clienti (ragione_sociale,email,telefono,cellulare,via,cap,citta,provincia,stato,codice_fiscale,p_iva,sdi,pec) \
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
                    params![
                        str_def(c, "ragioneSociale").trim(),
                        str_def(c, "email"),
                        str_def(c, "telefono"),
                        str_def(c, "cellulare"),
                        str_def(c, "via"),
                        str_def(c, "cap"),
                        str_def(c, "citta"),
                        str_def(c, "provincia"),
                        import_stato(c),
                        str_def(c, "codiceFiscale"),
                        piva.clone().unwrap_or_default(),
                        str_def(c, "sdi"),
                        str_def(c, "pec"),
                    ],
                )?;
                created += 1;
            }
        }
    }
    Ok(Json(json!({ "created": created, "updated": updated, "skipped": skipped })))
}

// ── Indirizzi ────────────────────────────────────────────────────────────────

async fn indirizzi_list(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id, cliente_id, nome, via, cap, citta, provincia, stato FROM clienti_indirizzi WHERE cliente_id=?1 ORDER BY id",
    )?;
    let rows = stmt
        .query_map([id], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "clienteId": r.get::<_, i64>(1)?,
                "nome": r.get::<_, Option<String>>(2)?,
                "via": r.get::<_, Option<String>>(3)?,
                "cap": r.get::<_, Option<String>>(4)?,
                "citta": r.get::<_, Option<String>>(5)?,
                "provincia": r.get::<_, Option<String>>(6)?,
                "stato": r.get::<_, Option<String>>(7)?,
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(Value::Array(rows)))
}

async fn indirizzi_create(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(a): Json<Value>,
) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    conn.execute(
        "INSERT INTO clienti_indirizzi (cliente_id, nome, via, cap, citta, provincia, stato) VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![
            id,
            str_or_def(&a, "nome", "Sede"),
            str_def(&a, "via"),
            str_def(&a, "cap"),
            str_def(&a, "citta"),
            str_def(&a, "provincia"),
            str_or_def(&a, "stato", "Italia"),
        ],
    )?;
    Ok(Json(json!({ "id": conn.last_insert_rowid() })))
}

async fn indirizzi_update(
    State(state): State<AppState>,
    Path((cliente_id, ind_id)): Path<(i64, i64)>,
    Json(a): Json<Value>,
) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    conn.execute(
        "UPDATE clienti_indirizzi SET nome=?1, via=?2, cap=?3, citta=?4, provincia=?5, stato=?6 WHERE id=?7 AND cliente_id=?8",
        params![
            str_or_def(&a, "nome", "Sede"),
            str_def(&a, "via"),
            str_def(&a, "cap"),
            str_def(&a, "citta"),
            str_def(&a, "provincia"),
            str_or_def(&a, "stato", "Italia"),
            ind_id,
            cliente_id,
        ],
    )?;
    Ok(Json(json!({ "success": true })))
}

async fn indirizzi_remove(
    State(state): State<AppState>,
    Path((cliente_id, ind_id)): Path<(i64, i64)>,
) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    conn.execute("UPDATE ddt SET destinazione_id=NULL WHERE destinazione_id=?1", [ind_id])?;
    conn.execute(
        "DELETE FROM clienti_indirizzi WHERE id=?1 AND cliente_id=?2",
        params![ind_id, cliente_id],
    )?;
    Ok(Json(json!({ "success": true })))
}

// ── helper locali ────────────────────────────────────────────────────────────

fn flag(body: &Value, key: &str) -> i64 {
    if matches!(body.get(key), Some(Value::Bool(true))) {
        1
    } else {
        0
    }
}
/// `x || null` per le FK opzionali (0 e assente → NULL, come `|| null` in JS).
fn opt_id(body: &Value, key: &str) -> Option<i64> {
    body.get(key).and_then(Value::as_i64).filter(|&v| v != 0)
}
fn tipo_soggetto(body: &Value) -> String {
    let s = str_def(body, "tipoSoggetto");
    if s.is_empty() {
        "PRIVATO".to_string()
    } else {
        s
    }
}
fn str_or_def(body: &Value, key: &str, d: &str) -> String {
    let s = str_def(body, key);
    if s.is_empty() {
        d.to_string()
    } else {
        s
    }
}

fn find_by_piva(
    conn: &rusqlite::Connection,
    clean: &str,
    exclude: Option<i64>,
) -> rusqlite::Result<Option<i64>> {
    let it = format!("IT{clean}");
    match exclude {
        Some(ex) => conn
            .query_row(
                "SELECT id FROM clienti WHERE (p_iva=?1 OR p_iva=?2) AND id!=?3",
                params![clean, it, ex],
                |r| r.get(0),
            )
            .optional(),
        None => conn
            .query_row(
                "SELECT id FROM clienti WHERE p_iva=?1 OR p_iva=?2",
                params![clean, it],
                |r| r.get(0),
            )
            .optional(),
    }
}
