//! /api/prodotto-varianti — parità con routes/prodottoVarianti.js

use axum::{
    extract::{Path, State},
    routing::get,
    Json, Router,
};
use rusqlite::params;
use serde_json::{json, Value};

use crate::db::AppState;
use crate::error::{ApiError, ApiResult};
use crate::web::{num, tenant_conn};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/barcode/:barcode", get(by_barcode))
        .route("/:prodotto_id", get(by_prodotto))
}

fn variante_dto(r: &rusqlite::Row) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": r.get::<_, i64>("id")?,
        "prodottoId": r.get::<_, i64>("prodotto_id")?,
        "taglia": r.get::<_, Option<String>>("taglia")?,
        "colore": r.get::<_, Option<String>>("colore")?,
        "quantita": num(r.get::<_, Option<f64>>("quantita")?.unwrap_or(0.0)),
        "barcode": r.get::<_, Option<String>>("barcode")?,
    }))
}

fn prodotto_dto(r: &rusqlite::Row) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": r.get::<_, i64>("id")?,
        "descrizione": r.get::<_, Option<String>>("descrizione")?,
        "categoria": r.get::<_, Option<String>>("categoria")?,
        "prezzo": num(r.get::<_, Option<f64>>("prezzo")?.unwrap_or(0.0)),
        "quantita": num(r.get::<_, Option<f64>>("quantita")?.unwrap_or(0.0)),
        "iva": num(r.get::<_, Option<f64>>("iva")?.unwrap_or(0.0)),
        "unitaMisura": r.get::<_, Option<String>>("unita_misura")?,
        "codice": r.get::<_, Option<String>>("codice")?,
        "barcode": r.get::<_, Option<String>>("barcode")?.unwrap_or_default(),
        "haVarianti": r.get::<_, Option<i64>>("ha_varianti")? == Some(1),
    }))
}

async fn by_prodotto(
    State(state): State<AppState>,
    Path(prodotto_id): Path<String>,
) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT * FROM prodotto_varianti WHERE prodotto_id=? ORDER BY taglia, colore")?;
    let rows = stmt
        .query_map(params![prodotto_id], variante_dto)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(Value::Array(rows)))
}

async fn by_barcode(
    State(state): State<AppState>,
    Path(barcode): Path<String>,
) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();

    // variante con quel barcode
    let var = conn.query_row(
        "SELECT * FROM prodotto_varianti WHERE barcode=? LIMIT 1",
        params![barcode],
        |r| Ok((r.get::<_, i64>("prodotto_id")?, variante_dto(r)?)),
    );
    if let Ok((prodotto_id, variante)) = var {
        let prod = conn.query_row(
            "SELECT * FROM prodotti WHERE id=?",
            params![prodotto_id],
            prodotto_dto,
        );
        return match prod {
            Ok(p) => Ok(Json(json!({ "prodotto": p, "variante": variante }))),
            Err(_) => Err(ApiError::Status(axum::http::StatusCode::NOT_FOUND, "Not found".into())),
        };
    }

    // barcode a livello prodotto
    let prod = conn.query_row(
        "SELECT * FROM prodotti WHERE barcode=? LIMIT 1",
        params![barcode],
        prodotto_dto,
    );
    match prod {
        Ok(p) => Ok(Json(json!({ "prodotto": p, "variante": Value::Null }))),
        Err(_) => Err(ApiError::Status(axum::http::StatusCode::NOT_FOUND, "Not found".into())),
    }
}
