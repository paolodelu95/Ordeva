//! /api/magazzini — depositi, giacenze per deposito, trasferimenti, scadenze.
//! Parità con routes/magazzini.js.

use std::collections::HashMap;

use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use rusqlite::{params, types::ToSql, OptionalExtension, Row};
use serde_json::{json, Value};

use crate::audit::audit;
use crate::db::AppState;
use crate::error::{ApiError, ApiResult};
use crate::stock::{adj_giacenza, magazzino_default_id};
use crate::web::{fmt_num, oggi, oggi_plus, opt_num, tenant_conn};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/giacenze", get(giacenze))
        .route("/giacenze/prodotto/:id", get(giacenze_prodotto))
        .route("/scadenze", get(scadenze))
        .route("/trasferimento", axum::routing::post(trasferimento))
        .route("/:id", axum::routing::put(update).delete(remove))
}

fn mag_dto(r: &Row) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": r.get::<_, i64>("id")?,
        "codice": r.get::<_, Option<String>>("codice")?.unwrap_or_default(),
        "nome": r.get::<_, Option<String>>("nome")?,
        "indirizzo": r.get::<_, Option<String>>("indirizzo")?.unwrap_or_default(),
        "predefinito": r.get::<_, Option<i64>>("predefinito")? == Some(1),
        "attivo": r.get::<_, Option<i64>>("attivo")? == Some(1),
    }))
}

async fn list(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let mut stmt = conn.prepare("SELECT * FROM magazzini ORDER BY predefinito DESC, nome")?;
    let rows = stmt.query_map([], |r| mag_dto(r))?.collect::<Result<Vec<_>, _>>()?;
    Ok(Json(Value::Array(rows)))
}

async fn create(State(state): State<AppState>, Json(m): Json<Value>) -> ApiResult<Json<Value>> {
    let nome = m.get("nome").and_then(Value::as_str).unwrap_or("").trim().to_string();
    if nome.is_empty() {
        return Err(ApiError::bad_request("Nome obbligatorio"));
    }
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let predefinito = matches!(m.get("predefinito"), Some(v) if truthy(v));
    conn.execute(
        "INSERT INTO magazzini (codice, nome, indirizzo, predefinito, attivo) VALUES (?1,?2,?3,?4,?5)",
        params![
            sdef(&m, "codice"),
            nome,
            sdef(&m, "indirizzo"),
            predefinito as i64,
            if matches!(m.get("attivo"), Some(Value::Bool(false))) { 0 } else { 1 },
        ],
    )?;
    let id = conn.last_insert_rowid();
    if predefinito {
        conn.execute("UPDATE magazzini SET predefinito=0 WHERE id!=?1", [id])?;
    }
    audit(&conn, "magazzino", id, "CREATE", &json!({ "nome": m.get("nome") }));
    Ok(Json(json!({ "id": id })))
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(m): Json<Value>,
) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let cur = conn
        .query_row(
            "SELECT codice, nome, indirizzo, attivo FROM magazzini WHERE id=?1",
            [id],
            |r| {
                Ok((
                    r.get::<_, Option<String>>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<i64>>(3)?,
                ))
            },
        )
        .optional()?;
    let (cod, nome, ind, att) = match cur {
        Some(c) => c,
        None => return Err(ApiError::not_found("Deposito non trovato")),
    };
    // m.x ?? cur.x: usa il valore body se presente e non null, altrimenti il corrente.
    let codice = coalesce(&m, "codice", cod);
    let nome = coalesce(&m, "nome", nome);
    let indirizzo = coalesce(&m, "indirizzo", ind);
    let attivo = match m.get("attivo") {
        Some(v) if !v.is_null() => if truthy(v) { 1 } else { 0 },
        _ => att.unwrap_or(0),
    };
    conn.execute(
        "UPDATE magazzini SET codice=?1, nome=?2, indirizzo=?3, attivo=?4 WHERE id=?5",
        params![codice, nome, indirizzo, attivo, id],
    )?;
    if matches!(m.get("predefinito"), Some(v) if truthy(v)) {
        conn.execute("UPDATE magazzini SET predefinito=0", [])?;
        conn.execute("UPDATE magazzini SET predefinito=1 WHERE id=?1", [id])?;
    }
    audit(&conn, "magazzino", id, "UPDATE", &json!({ "nome": m.get("nome") }));
    Ok(Json(json!({ "success": true })))
}

async fn remove(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let m = conn
        .query_row("SELECT predefinito, nome FROM magazzini WHERE id=?1", [id], |r| {
            Ok((r.get::<_, Option<i64>>(0)?, r.get::<_, Option<String>>(1)?))
        })
        .optional()?;
    let (predefinito, nome) = match m {
        Some(x) => x,
        None => return Err(ApiError::not_found("Deposito non trovato")),
    };
    if predefinito == Some(1) {
        return Err(ApiError::bad_request("Non puoi eliminare il deposito predefinito"));
    }
    let giac: f64 = conn.query_row(
        "SELECT COALESCE(SUM(ABS(quantita)),0) FROM giacenze WHERE magazzino_id=?1",
        [id],
        |r| r.get(0),
    )?;
    if giac > 0.0 {
        return Err(ApiError::bad_request(
            "Il deposito contiene giacenze: trasferiscile o azzerale prima.",
        ));
    }
    conn.execute("DELETE FROM magazzini WHERE id=?1", [id])?;
    audit(&conn, "magazzino", id, "DELETE", &json!({ "nome": nome }));
    Ok(Json(json!({ "success": true })))
}

async fn giacenze(
    State(state): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let mut where_ = vec!["1=1".to_string()];
    let mut binds: Vec<rusqlite::types::Value> = Vec::new();
    if let Some(v) = q.get("magazzinoId").filter(|s| !s.is_empty()) {
        where_.push("g.magazzino_id=?".into());
        binds.push(rusqlite::types::Value::Text(v.clone()));
    }
    if let Some(v) = q.get("prodottoId").filter(|s| !s.is_empty()) {
        where_.push("g.prodotto_id=?".into());
        binds.push(rusqlite::types::Value::Text(v.clone()));
    }
    if q.get("soloDisponibili").map(|s| s == "1").unwrap_or(false) {
        where_.push("g.quantita <> 0".into());
    }
    let sql = format!(
        "SELECT g.*, p.codice AS prodotto_codice, p.unita_misura, \
                v.taglia AS variante_taglia, v.colore AS variante_colore, m.nome AS magazzino_nome \
         FROM giacenze g JOIN prodotti p ON p.id = g.prodotto_id \
         LEFT JOIN prodotto_varianti v ON v.id = g.variante_id JOIN magazzini m ON m.id = g.magazzino_id \
         WHERE {} ORDER BY p.codice, m.nome, g.scadenza",
        where_.join(" AND ")
    );
    let mut stmt = conn.prepare(&sql)?;
    let p: Vec<&dyn ToSql> = binds.iter().map(|v| v as &dyn ToSql).collect();
    let rows = stmt
        .query_map(p.as_slice(), |r| {
            Ok(json!({
                "id": r.get::<_, i64>("id")?,
                "prodottoId": r.get::<_, Option<i64>>("prodotto_id")?,
                "prodottoCodice": r.get::<_, Option<String>>("prodotto_codice")?.unwrap_or_default(),
                "unitaMisura": r.get::<_, Option<String>>("unita_misura")?.unwrap_or_default(),
                "varianteId": r.get::<_, Option<i64>>("variante_id")?,
                "varianteTaglia": r.get::<_, Option<String>>("variante_taglia")?.unwrap_or_default(),
                "varianteColore": r.get::<_, Option<String>>("variante_colore")?.unwrap_or_default(),
                "magazzinoId": r.get::<_, Option<i64>>("magazzino_id")?,
                "magazzinoNome": r.get::<_, Option<String>>("magazzino_nome")?,
                "lotto": r.get::<_, Option<String>>("lotto")?.unwrap_or_default(),
                "scadenza": r.get::<_, Option<String>>("scadenza")?.unwrap_or_default(),
                "quantita": opt_num(r.get::<_, Option<f64>>("quantita")?),
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(Value::Array(rows)))
}

async fn giacenze_prodotto(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT g.*, m.nome AS magazzino_nome, v.taglia AS variante_taglia, v.colore AS variante_colore \
         FROM giacenze g JOIN magazzini m ON m.id=g.magazzino_id \
         LEFT JOIN prodotto_varianti v ON v.id=g.variante_id \
         WHERE g.prodotto_id=?1 AND g.quantita <> 0 ORDER BY m.nome, g.scadenza",
    )?;
    let rows = stmt
        .query_map([id], |r| {
            Ok(json!({
                "magazzinoId": r.get::<_, Option<i64>>("magazzino_id")?,
                "magazzinoNome": r.get::<_, Option<String>>("magazzino_nome")?,
                "varianteId": r.get::<_, Option<i64>>("variante_id")?,
                "varianteTaglia": r.get::<_, Option<String>>("variante_taglia")?.unwrap_or_default(),
                "varianteColore": r.get::<_, Option<String>>("variante_colore")?.unwrap_or_default(),
                "lotto": r.get::<_, Option<String>>("lotto")?.unwrap_or_default(),
                "scadenza": r.get::<_, Option<String>>("scadenza")?.unwrap_or_default(),
                "quantita": opt_num(r.get::<_, Option<f64>>("quantita")?),
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(Value::Array(rows)))
}

async fn scadenze(
    State(state): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let giorni: i64 = q.get("giorni").and_then(|s| s.parse().ok()).unwrap_or(30).clamp(0, 3650);
    let limite = oggi_plus(giorni);
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT g.*, p.codice AS prodotto_codice, p.unita_misura, m.nome AS magazzino_nome \
         FROM giacenze g JOIN prodotti p ON p.id=g.prodotto_id JOIN magazzini m ON m.id=g.magazzino_id \
         WHERE g.scadenza <> '' AND g.scadenza <= ?1 AND g.quantita > 0 ORDER BY g.scadenza ASC",
    )?;
    let rows = stmt
        .query_map([limite], |r| {
            Ok(json!({
                "prodottoId": r.get::<_, Option<i64>>("prodotto_id")?,
                "prodottoCodice": r.get::<_, Option<String>>("prodotto_codice")?.unwrap_or_default(),
                "unitaMisura": r.get::<_, Option<String>>("unita_misura")?.unwrap_or_default(),
                "magazzinoId": r.get::<_, Option<i64>>("magazzino_id")?,
                "magazzinoNome": r.get::<_, Option<String>>("magazzino_nome")?,
                "lotto": r.get::<_, Option<String>>("lotto")?.unwrap_or_default(),
                "scadenza": r.get::<_, Option<String>>("scadenza")?,
                "quantita": opt_num(r.get::<_, Option<f64>>("quantita")?),
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(Value::Array(rows)))
}

async fn trasferimento(State(state): State<AppState>, Json(t): Json<Value>) -> ApiResult<Json<Value>> {
    let prodotto_id = t.get("prodottoId").and_then(Value::as_i64).unwrap_or(0);
    let da = t.get("daMagazzinoId").and_then(Value::as_i64).unwrap_or(0);
    let a = t.get("aMagazzinoId").and_then(Value::as_i64).unwrap_or(0);
    let qty = t.get("quantita").and_then(Value::as_f64).unwrap_or(0.0);
    let variante_id = t.get("varianteId").and_then(Value::as_i64).filter(|&v| v != 0);
    let lotto = t.get("lotto").and_then(Value::as_str).unwrap_or("").to_string();
    let scadenza = t.get("scadenza").and_then(Value::as_str).unwrap_or("").to_string();

    if prodotto_id == 0 || da == 0 || a == 0 {
        return Err(ApiError::bad_request("Prodotto e depositi obbligatori"));
    }
    if da == a {
        return Err(ApiError::bad_request("I depositi di origine e destinazione coincidono"));
    }
    if !(qty > 0.0) {
        return Err(ApiError::bad_request("Quantità non valida"));
    }
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let disp: f64 = conn
        .query_row(
            "SELECT COALESCE(quantita,0) FROM giacenze \
             WHERE prodotto_id=?1 AND IFNULL(variante_id,0)=IFNULL(?2,0) AND magazzino_id=?3 AND lotto=?4 AND scadenza=?5",
            params![prodotto_id, variante_id, da, lotto, scadenza],
            |r| r.get(0),
        )
        .optional()?
        .unwrap_or(0.0);
    if disp < qty {
        return Err(ApiError::bad_request(format!(
            "Giacenza insufficiente nel deposito di origine (disponibili {}).",
            fmt_num(disp)
        )));
    }
    let prodotto_codice: String = conn
        .query_row("SELECT codice FROM prodotti WHERE id=?1", [prodotto_id], |r| r.get::<_, Option<String>>(0))
        .optional()?
        .flatten()
        .unwrap_or_default();
    let note: String = t.get("note").and_then(Value::as_str).unwrap_or("").chars().take(500).collect();

    adj_giacenza(&conn, prodotto_id, variante_id, Some(da), &lotto, &scadenza, -qty)?;
    adj_giacenza(&conn, prodotto_id, variante_id, Some(a), &lotto, &scadenza, qty)?;
    conn.execute(
        "INSERT INTO movimenti_magazzino \
         (data, prodotto_id, prodotto_codice, tipo, quantita, causale, note, variante_id, magazzino_id, magazzino_dest_id, lotto, scadenza) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
        params![oggi(), prodotto_id, prodotto_codice, "TRASFERIMENTO", qty, "TRASFERIMENTO", note, variante_id, da, a, lotto, scadenza],
    )?;
    audit(&conn, "magazzino", prodotto_id, "TRASFERIMENTO", &json!({ "da": da, "a": a, "qty": qty, "lotto": lotto, "scadenza": scadenza }));
    Ok(Json(json!({ "success": true })))
}

// helpers
fn sdef(b: &Value, k: &str) -> String {
    b.get(k).and_then(Value::as_str).unwrap_or("").to_string()
}
fn coalesce(b: &Value, k: &str, cur: Option<String>) -> Option<String> {
    match b.get(k) {
        Some(v) if !v.is_null() => v.as_str().map(str::to_string),
        _ => cur,
    }
}
fn truthy(v: &Value) -> bool {
    match v {
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().map(|x| x != 0.0).unwrap_or(true),
        Value::String(s) => !s.is_empty(),
        Value::Null => false,
        _ => true,
    }
}
