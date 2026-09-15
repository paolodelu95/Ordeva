//! /api/listini — parità con routes/listini.js (listini, prezzi, sezioni, resolve).

use axum::{
    extract::{Path, State},
    routing::{get, put},
    Json, Router,
};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde_json::{json, Map, Value};

use crate::db::AppState;
use crate::error::{ApiError, ApiResult};
use crate::web::{num, opt_num, tenant_conn};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/resolve/:clienteId/:prodottoId", get(resolve))
        .route("/:id", get(detail).put(update).delete(remove))
        .route("/:id/prezzi", get(prezzi_list).post(prezzo_upsert))
        .route("/:id/prezzi/bulk", axum::routing::post(prezzi_bulk))
        .route("/:id/prezzi/:prezzoId", put(prezzo_update).delete(prezzo_remove))
        .route("/:id/sezioni", get(sezioni_list).post(sezione_create))
        .route("/:id/sezioni/:sezioneId", put(sezione_update).delete(sezione_remove))
        .route("/:id/riordina", put(riordina))
}

// ── DTO ──────────────────────────────────────────────────────────────────────

fn listino_dto(r: &Row) -> Value {
    let g = |k: &str| r.get::<_, Option<String>>(k).ok().flatten();
    json!({
        "id": r.get::<_, i64>("id").unwrap_or(0),
        "nome": g("nome"),
        "descrizione": g("descrizione").unwrap_or_default(),
        "scontoDefault": num(r.get::<_, Option<f64>>("sconto_default").ok().flatten().unwrap_or(0.0)),
        "attivo": r.get::<_, Option<i64>>("attivo").ok().flatten().unwrap_or(0) != 0,
        "colonneExtra": parse_json(g("colonne_extra"), json!([])),
        "colonneStandard": parse_json(g("colonne_standard"), json!([])),
        "colonneConfig": parse_json(g("colonne_config"), json!([])),
        "stampaDueColonne": r.get::<_, Option<i64>>("stampa_due_colonne").ok().flatten().unwrap_or(0) != 0,
        "griglia": r.get::<_, Option<i64>>("griglia").ok().flatten().unwrap_or(0) != 0,
        "tema": g("tema").unwrap_or_default(),
        "createdAt": g("created_at"),
    })
}

fn sezione_dto(r: &Row) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": r.get::<_, i64>(0)?,
        "listinoId": r.get::<_, Option<i64>>(1)?,
        "nome": r.get::<_, Option<String>>(2)?,
        "ordine": r.get::<_, Option<i64>>(3)?.unwrap_or(0),
    }))
}

fn prezzo_dto(r: &Row) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": r.get::<_, i64>("id")?,
        "listinoId": r.get::<_, Option<i64>>("listino_id")?,
        "prodottoId": r.get::<_, Option<i64>>("prodotto_id")?,
        "prezzo": opt_num(r.get::<_, Option<f64>>("prezzo")?),
        "sconto": opt_num(r.get::<_, Option<f64>>("sconto")?),
        "ordine": r.get::<_, Option<i64>>("ordine")?.unwrap_or(0),
        "datiExtra": parse_json(r.get::<_, Option<String>>("dati_extra")?, json!({})),
        "stili": parse_json(r.get::<_, Option<String>>("stili")?, json!({})),
        "prodottoCodice": r.get::<_, Option<String>>("prodotto_codice")?,
        "prodottoPrezzoBase": opt_num(r.get::<_, Option<f64>>("prodotto_prezzo_base")?),
        "prodottoIva": opt_num(r.get::<_, Option<f64>>("prodotto_iva")?),
        "prodottoUm": r.get::<_, Option<String>>("prodotto_um")?,
        "prodottoCategoria": r.get::<_, Option<String>>("prodotto_categoria")?,
        "prodottoDescrizione": r.get::<_, Option<String>>("prodotto_descrizione")?,
        "prodottoPeso": opt_num(r.get::<_, Option<f64>>("prodotto_peso")?),
        "prodottoDimensioni": r.get::<_, Option<String>>("prodotto_dimensioni")?.unwrap_or_default(),
    }))
}

// ── LISTINI CRUD ─────────────────────────────────────────────────────────────

async fn list(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT l.*, COUNT(lp.id) AS prezzi_count FROM listini l \
         LEFT JOIN listini_prezzi lp ON lp.listino_id = l.id GROUP BY l.id ORDER BY l.nome",
    )?;
    let rows = stmt
        .query_map([], |r| {
            let mut dto = listino_dto(r);
            dto["prezziCount"] = json!(r.get::<_, i64>("prezzi_count")?);
            Ok(dto)
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(Value::Array(rows)))
}

async fn detail(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    conn.query_row("SELECT * FROM listini WHERE id=?1", [id], |r| Ok(listino_dto(r)))
        .optional()?
        .map(Json)
        .ok_or_else(|| ApiError::not_found("Listino non trovato"))
}

async fn create(State(state): State<AppState>, Json(b): Json<Value>) -> ApiResult<Json<Value>> {
    let nome = b.get("nome").and_then(Value::as_str).unwrap_or("").trim().to_string();
    if nome.is_empty() {
        return Err(ApiError::bad_request("Nome obbligatorio"));
    }
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    conn.execute(
        "INSERT INTO listini (nome, descrizione, sconto_default, attivo, colonne_extra, colonne_standard, colonne_config, stampa_due_colonne, griglia, tema) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![
            nome,
            str_or_empty(&b, "descrizione"),
            num_field(&b, "scontoDefault"),
            attivo_flag(&b),
            sanitize_colonne(b.get("colonneExtra")).to_string(),
            sanitize_colonne_std(b.get("colonneStandard")).to_string(),
            sanitize_colonne_cfg(b.get("colonneConfig")).to_string(),
            flag(&b, "stampaDueColonne"),
            flag(&b, "griglia"),
            truncate(&str_or_empty(&b, "tema"), 30),
        ],
    )
    .map_err(map_unique)?;
    Ok(Json(json!({ "id": conn.last_insert_rowid() })))
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(b): Json<Value>,
) -> ApiResult<Json<Value>> {
    let nome = b.get("nome").and_then(Value::as_str).unwrap_or("").trim().to_string();
    if nome.is_empty() {
        return Err(ApiError::bad_request("Nome obbligatorio"));
    }
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    // campi config assenti = preserva i salvati
    let cur = conn
        .query_row(
            "SELECT colonne_extra, colonne_standard, colonne_config, stampa_due_colonne, griglia, tema FROM listini WHERE id=?1",
            [id],
            |r| {
                Ok((
                    r.get::<_, Option<String>>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<i64>>(3)?,
                    r.get::<_, Option<i64>>(4)?,
                    r.get::<_, Option<String>>(5)?,
                ))
            },
        )
        .optional()?
        .unwrap_or((None, None, None, None, None, None));

    let colonne = match b.get("colonneExtra") {
        None => cur.0.unwrap_or_else(|| "[]".into()),
        v => sanitize_colonne(v).to_string(),
    };
    let colonne_std = match b.get("colonneStandard") {
        None => cur.1.unwrap_or_else(|| "[]".into()),
        v => sanitize_colonne_std(v).to_string(),
    };
    let colonne_cfg = match b.get("colonneConfig") {
        None => cur.2.unwrap_or_else(|| "[]".into()),
        v => sanitize_colonne_cfg(v).to_string(),
    };
    let due = match b.get("stampaDueColonne") {
        None => cur.3.unwrap_or(0),
        _ => flag(&b, "stampaDueColonne"),
    };
    let griglia = match b.get("griglia") {
        None => cur.4.unwrap_or(0),
        _ => flag(&b, "griglia"),
    };
    let tema = match b.get("tema") {
        None => cur.5.unwrap_or_default(),
        _ => truncate(&str_or_empty(&b, "tema"), 30),
    };
    conn.execute(
        "UPDATE listini SET nome=?1, descrizione=?2, sconto_default=?3, attivo=?4, colonne_extra=?5, colonne_standard=?6, colonne_config=?7, stampa_due_colonne=?8, griglia=?9, tema=?10 WHERE id=?11",
        params![
            nome,
            str_or_empty(&b, "descrizione"),
            num_field(&b, "scontoDefault"),
            attivo_flag(&b),
            colonne,
            colonne_std,
            colonne_cfg,
            due,
            griglia,
            tema,
            id,
        ],
    )
    .map_err(map_unique)?;
    Ok(Json(json!({ "success": true })))
}

async fn remove(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    conn.execute("UPDATE clienti SET listino_id=NULL WHERE listino_id=?1", [id])?;
    conn.execute("DELETE FROM listini WHERE id=?1", [id])?;
    Ok(Json(json!({ "success": true })))
}

// ── PREZZI ───────────────────────────────────────────────────────────────────

async fn prezzi_list(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT lp.*, p.codice AS prodotto_codice, p.prezzo AS prodotto_prezzo_base, \
                p.iva AS prodotto_iva, p.unita_misura AS prodotto_um, p.categoria AS prodotto_categoria, \
                p.descrizione AS prodotto_descrizione, p.peso AS prodotto_peso, p.dimensioni AS prodotto_dimensioni \
         FROM listini_prezzi lp JOIN prodotti p ON p.id = lp.prodotto_id \
         WHERE lp.listino_id=?1 ORDER BY lp.ordine, p.codice",
    )?;
    let rows = stmt
        .query_map([id], |r| prezzo_dto(r))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(Value::Array(rows)))
}

async fn prezzo_upsert(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(b): Json<Value>,
) -> ApiResult<Json<Value>> {
    let prodotto_id = b.get("prodottoId").and_then(Value::as_i64);
    let prodotto_id = match prodotto_id.filter(|&v| v != 0) {
        Some(p) => p,
        None => return Err(ApiError::bad_request("prodottoId obbligatorio")),
    };
    // datiExtra/stili assenti = preserva i valori già salvati (upsert parziale)
    let extra_json = match b.get("datiExtra") {
        None => None,
        v => Some(sanitize_dati_extra(v).to_string()),
    };
    let stili_json = match b.get("stili") {
        None => None,
        v => Some(sanitize_stili(v).to_string()),
    };
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let ord = next_ordine(&conn, id)?;
    conn.execute(
        "INSERT INTO listini_prezzi (listino_id, prodotto_id, prezzo, sconto, dati_extra, stili, ordine) \
         VALUES (?1, ?2, ?3, ?4, COALESCE(?5, '{}'), COALESCE(?6, '{}'), ?7) \
         ON CONFLICT(listino_id, prodotto_id) DO UPDATE SET \
           prezzo=excluded.prezzo, sconto=excluded.sconto, \
           dati_extra=CASE WHEN ?8 IS NULL THEN dati_extra ELSE excluded.dati_extra END, \
           stili=CASE WHEN ?9 IS NULL THEN stili ELSE excluded.stili END",
        params![
            id,
            prodotto_id,
            opt_real(&b, "prezzo"),
            opt_real(&b, "sconto"),
            extra_json,
            stili_json,
            ord,
            extra_json,
            stili_json,
        ],
    )?;
    Ok(Json(json!({ "id": conn.last_insert_rowid() })))
}

async fn prezzi_bulk(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(b): Json<Value>,
) -> ApiResult<Json<Value>> {
    let ids = b.get("prodottoIds").and_then(Value::as_array).cloned();
    let ids = match ids.filter(|a| !a.is_empty()) {
        Some(a) => a,
        None => return Err(ApiError::bad_request("prodottoIds obbligatorio")),
    };
    let sconto = opt_real(&b, "sconto");
    let arc = tenant_conn(&state)?;
    let mut guard = arc.lock().unwrap();
    if guard.query_row("SELECT 1 FROM listini WHERE id=?1", [id], |_| Ok(())).optional()?.is_none() {
        return Err(ApiError::not_found("Listino non trovato"));
    }
    let mut max_ord = next_ordine(&guard, id)? - 1;
    let tx = guard.transaction().map_err(ApiError::from)?;
    let mut aggiunti = 0i64;
    for pid in ids.iter().take(5000) {
        let p = pid.as_i64().unwrap_or(0);
        if p == 0 {
            continue;
        }
        max_ord += 1;
        let changes = tx.execute(
            "INSERT INTO listini_prezzi (listino_id, prodotto_id, prezzo, sconto, dati_extra, ordine) \
             VALUES (?1, ?2, NULL, ?3, '{}', ?4) ON CONFLICT(listino_id, prodotto_id) DO NOTHING",
            params![id, p, sconto, max_ord],
        )?;
        aggiunti += changes as i64;
    }
    tx.commit().map_err(ApiError::from)?;
    Ok(Json(json!({ "aggiunti": aggiunti })))
}

async fn prezzo_update(
    State(state): State<AppState>,
    Path((id, prezzo_id)): Path<(i64, i64)>,
    Json(b): Json<Value>,
) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    conn.execute(
        "UPDATE listini_prezzi SET prezzo=?1, sconto=?2 WHERE id=?3 AND listino_id=?4",
        params![opt_real(&b, "prezzo"), opt_real(&b, "sconto"), prezzo_id, id],
    )?;
    Ok(Json(json!({ "success": true })))
}

async fn prezzo_remove(
    State(state): State<AppState>,
    Path((id, prezzo_id)): Path<(i64, i64)>,
) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    conn.execute("DELETE FROM listini_prezzi WHERE id=?1 AND listino_id=?2", params![prezzo_id, id])?;
    Ok(Json(json!({ "success": true })))
}

// ── SEZIONI ──────────────────────────────────────────────────────────────────

async fn sezioni_list(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id, listino_id, nome, ordine FROM listini_sezioni WHERE listino_id=?1 ORDER BY ordine, id",
    )?;
    let rows = stmt
        .query_map([id], |r| sezione_dto(r))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(Value::Array(rows)))
}

async fn sezione_create(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(b): Json<Value>,
) -> ApiResult<Json<Value>> {
    let nome = b.get("nome").and_then(Value::as_str).unwrap_or("").trim().to_string();
    if nome.is_empty() {
        return Err(ApiError::bad_request("Nome obbligatorio"));
    }
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    if conn.query_row("SELECT 1 FROM listini WHERE id=?1", [id], |_| Ok(())).optional()?.is_none() {
        return Err(ApiError::not_found("Listino non trovato"));
    }
    let ord = next_ordine(&conn, id)?;
    conn.execute(
        "INSERT INTO listini_sezioni (listino_id, nome, ordine) VALUES (?1, ?2, ?3)",
        params![id, truncate(&nome, 80), ord],
    )?;
    Ok(Json(json!({ "id": conn.last_insert_rowid() })))
}

async fn sezione_update(
    State(state): State<AppState>,
    Path((id, sezione_id)): Path<(i64, i64)>,
    Json(b): Json<Value>,
) -> ApiResult<Json<Value>> {
    let nome = b.get("nome").and_then(Value::as_str).unwrap_or("").trim().to_string();
    if nome.is_empty() {
        return Err(ApiError::bad_request("Nome obbligatorio"));
    }
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    conn.execute(
        "UPDATE listini_sezioni SET nome=?1 WHERE id=?2 AND listino_id=?3",
        params![truncate(&nome, 80), sezione_id, id],
    )?;
    Ok(Json(json!({ "success": true })))
}

async fn sezione_remove(
    State(state): State<AppState>,
    Path((id, sezione_id)): Path<(i64, i64)>,
) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    conn.execute("DELETE FROM listini_sezioni WHERE id=?1 AND listino_id=?2", params![sezione_id, id])?;
    Ok(Json(json!({ "success": true })))
}

async fn riordina(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(b): Json<Value>,
) -> ApiResult<Json<Value>> {
    let items = match b.get("items").and_then(Value::as_array) {
        Some(a) => a.clone(),
        None => return Err(ApiError::bad_request("items obbligatorio")),
    };
    let arc = tenant_conn(&state)?;
    let mut guard = arc.lock().unwrap();
    let tx = guard.transaction().map_err(ApiError::from)?;
    for (i, it) in items.iter().take(10000).enumerate() {
        let item_id = it.get("id").and_then(Value::as_i64).unwrap_or(0);
        if item_id == 0 {
            continue;
        }
        let pos = (i + 1) as i64;
        if it.get("tipo").and_then(Value::as_str) == Some("sezione") {
            tx.execute(
                "UPDATE listini_sezioni SET ordine=?1 WHERE id=?2 AND listino_id=?3",
                params![pos, item_id, id],
            )?;
        } else {
            tx.execute(
                "UPDATE listini_prezzi SET ordine=?1 WHERE id=?2 AND listino_id=?3",
                params![pos, item_id, id],
            )?;
        }
    }
    tx.commit().map_err(ApiError::from)?;
    Ok(Json(json!({ "success": true })))
}

// ── resolve ──────────────────────────────────────────────────────────────────

async fn resolve(
    State(state): State<AppState>,
    Path((cliente_id, prodotto_id)): Path<(i64, i64)>,
) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let prodotto = conn
        .query_row("SELECT prezzo, iva FROM prodotti WHERE id=?1", [prodotto_id], |r| {
            Ok((r.get::<_, Option<f64>>(0)?, r.get::<_, Option<f64>>(1)?))
        })
        .optional()?;
    let (pprezzo, piva) = match prodotto {
        Some(p) => p,
        None => return Err(ApiError::not_found("Prodotto non trovato")),
    };
    let base = json!({ "prezzo": opt_num(pprezzo), "sconto": num(0.0), "iva": opt_num(piva), "sorgente": "BASE" });

    let listino_id: Option<i64> = conn
        .query_row("SELECT listino_id FROM clienti WHERE id=?1", [cliente_id], |r| r.get::<_, Option<i64>>(0))
        .optional()?
        .flatten();
    let listino_id = match listino_id {
        Some(l) => l,
        None => return Ok(Json(base)),
    };
    let listino = conn
        .query_row(
            "SELECT id, nome, sconto_default FROM listini WHERE id=?1 AND attivo=1",
            [listino_id],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, Option<f64>>(2)?)),
        )
        .optional()?;
    let (lid, lnome, lsconto_def) = match listino {
        Some(l) => l,
        None => return Ok(Json(base)),
    };
    let lp = conn
        .query_row(
            "SELECT prezzo, sconto FROM listini_prezzi WHERE listino_id=?1 AND prodotto_id=?2",
            params![listino_id, prodotto_id],
            |r| Ok((r.get::<_, Option<f64>>(0)?, r.get::<_, Option<f64>>(1)?)),
        )
        .optional()?;

    if let Some((Some(lprezzo), _)) = lp {
        return Ok(Json(json!({
            "prezzo": num(lprezzo), "sconto": num(0.0), "iva": opt_num(piva),
            "sorgente": "LISTINO_OVERRIDE", "listinoId": lid, "listinoNome": lnome
        })));
    }
    let sconto = match lp {
        Some((_, Some(s))) => s,
        _ => lsconto_def.unwrap_or(0.0),
    };
    Ok(Json(json!({
        "prezzo": opt_num(pprezzo), "sconto": num(sconto), "iva": opt_num(piva),
        "sorgente": if sconto > 0.0 { "LISTINO_SCONTO" } else { "BASE" },
        "listinoId": lid, "listinoNome": lnome
    })))
}

// ── helper ───────────────────────────────────────────────────────────────────

fn flag(b: &Value, k: &str) -> i64 {
    if matches!(b.get(k), Some(Value::Bool(true))) { 1 } else { 0 }
}
/// `attivo === false ? 0 : 1` (default 1).
fn attivo_flag(b: &Value) -> i64 {
    if matches!(b.get("attivo"), Some(Value::Bool(false))) { 0 } else { 1 }
}
fn str_or_empty(b: &Value, k: &str) -> String {
    b.get(k).and_then(Value::as_str).unwrap_or("").to_string()
}
/// `+x || 0` → numero o 0.
fn num_field(b: &Value, k: &str) -> f64 {
    b.get(k).and_then(Value::as_f64).unwrap_or(0.0)
}
/// `x == null || x === '' ? null : +x` → REAL nullable.
fn opt_real(b: &Value, k: &str) -> Option<f64> {
    match b.get(k) {
        Some(Value::Number(n)) => n.as_f64(),
        Some(Value::String(s)) if !s.is_empty() => s.parse().ok(),
        _ => None,
    }
}
fn truncate(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}
fn parse_json(s: Option<String>, fallback: Value) -> Value {
    match s {
        Some(s) => serde_json::from_str::<Value>(&s).ok().filter(|v| !v.is_null()).unwrap_or(fallback),
        None => fallback,
    }
}
fn map_unique(e: rusqlite::Error) -> ApiError {
    if let rusqlite::Error::SqliteFailure(err, _) = &e {
        if err.code == rusqlite::ErrorCode::ConstraintViolation {
            return ApiError::conflict("Esiste già un listino con questo nome");
        }
    }
    ApiError::Internal(e.into())
}

fn next_ordine(conn: &Connection, listino_id: i64) -> rusqlite::Result<i64> {
    let a: i64 = conn.query_row(
        "SELECT COALESCE(MAX(ordine),0) FROM listini_prezzi WHERE listino_id=?1",
        [listino_id],
        |r| r.get(0),
    )?;
    let b: i64 = conn.query_row(
        "SELECT COALESCE(MAX(ordine),0) FROM listini_sezioni WHERE listino_id=?1",
        [listino_id],
        |r| r.get(0),
    )?;
    Ok(a.max(b) + 1)
}

// ── sanitizers (colonne/stili/datiExtra) ─────────────────────────────────────

const STD_KEYS: [&str; 8] = ["num", "codice", "prodotto", "dimensioni", "peso", "prezzoBase", "sconto", "prezzo"];
const ALIGNS: [&str; 3] = ["left", "center", "right"];

fn s_trim(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(Value::as_str).map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

fn sanitize_colonne(cols: Option<&Value>) -> Value {
    let arr = cols.and_then(Value::as_array).cloned().unwrap_or_default();
    let out: Vec<Value> = arr
        .iter()
        .filter_map(|c| {
            let key = s_trim(c, "key")?;
            let label = s_trim(c, "label")?;
            Some(json!({ "key": truncate(&key, 40), "label": truncate(&label, 60) }))
        })
        .take(12)
        .collect();
    Value::Array(out)
}

fn sanitize_colonne_std(cols: Option<&Value>) -> Value {
    let arr = cols.and_then(Value::as_array).cloned().unwrap_or_default();
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for c in &arr {
        let key = c.get("key").and_then(Value::as_str).unwrap_or("");
        if !STD_KEYS.contains(&key) || !seen.insert(key.to_string()) {
            continue;
        }
        let label = c.get("label").and_then(Value::as_str).unwrap_or("").trim();
        out.push(json!({
            "key": key,
            "label": truncate(label, 60),
            "visibile": !matches!(c.get("visibile"), Some(Value::Bool(false))),
        }));
    }
    Value::Array(out)
}

fn sanitize_colonne_cfg(cols: Option<&Value>) -> Value {
    let arr = cols.and_then(Value::as_array).cloned().unwrap_or_default();
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for c in &arr {
        let key = match c.get("key").and_then(Value::as_str) {
            Some(k) => truncate(k.trim(), 40),
            None => continue,
        };
        if key.is_empty() || !seen.insert(key.clone()) {
            continue;
        }
        let label = c.get("label").and_then(Value::as_str).unwrap_or("").trim();
        let mut col = Map::new();
        col.insert("key".into(), json!(key));
        col.insert("label".into(), json!(truncate(label, 60)));
        col.insert("visibile".into(), json!(!matches!(c.get("visibile"), Some(Value::Bool(false)))));
        col.insert("tipo".into(), json!(if STD_KEYS.contains(&key.as_str()) { "std" } else { "extra" }));
        if matches!(c.get("bold"), Some(v) if truthy(v)) {
            col.insert("bold".into(), json!(true));
        }
        if matches!(c.get("italic"), Some(v) if truthy(v)) {
            col.insert("italic".into(), json!(true));
        }
        if let Some(al) = c.get("align").and_then(Value::as_str) {
            if ALIGNS.contains(&al) {
                col.insert("align".into(), json!(al));
            }
        }
        out.push(Value::Object(col));
        if out.len() >= 18 {
            break;
        }
    }
    Value::Array(out)
}

fn sanitize_stili(d: Option<&Value>) -> Value {
    let obj = match d.and_then(Value::as_object) {
        Some(o) => o,
        None => return json!({}),
    };
    let mut out = Map::new();
    for (k, v) in obj.iter().take(24) {
        let key = k.trim();
        if key.is_empty() || !v.is_object() {
            continue;
        }
        let mut st = Map::new();
        if matches!(v.get("b"), Some(x) if truthy(x)) {
            st.insert("b".into(), json!(true));
        }
        if matches!(v.get("i"), Some(x) if truthy(x)) {
            st.insert("i".into(), json!(true));
        }
        if matches!(v.get("s"), Some(x) if truthy(x)) {
            st.insert("s".into(), json!(true));
        }
        if let Some(al) = v.get("al").and_then(Value::as_str) {
            if ALIGNS.contains(&al) {
                st.insert("al".into(), json!(al));
            }
        }
        if !st.is_empty() {
            out.insert(truncate(key, 40), Value::Object(st));
        }
    }
    Value::Object(out)
}

fn sanitize_dati_extra(d: Option<&Value>) -> Value {
    let obj = match d.and_then(Value::as_object) {
        Some(o) => o,
        None => return json!({}),
    };
    let mut out = Map::new();
    for (k, v) in obj.iter().take(12) {
        let key = k.trim();
        if key.is_empty() {
            continue;
        }
        let s = match v {
            Value::String(s) => s.clone(),
            Value::Number(n) => n.to_string(),
            Value::Bool(b) => b.to_string(),
            Value::Null => String::new(),
            _ => String::new(),
        };
        out.insert(truncate(key, 40), json!(truncate(&s, 200)));
    }
    Value::Object(out)
}

fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().map(|x| x != 0.0).unwrap_or(true),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}
