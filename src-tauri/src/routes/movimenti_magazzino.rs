//! /api/movimenti-magazzino — storico movimenti e giacenza storica a data.
//! Parità con routes/movimentiMagazzino.js.

use std::collections::HashMap;

use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use rusqlite::{types::ToSql, types::Value as SqlValue};
use serde_json::{json, Value};

use crate::db::AppState;
use crate::error::{ApiError, ApiResult};
use crate::web::{opt_num, tenant_conn};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list))
        .route("/storico", get(storico))
}

async fn list(
    State(state): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let mut sql = String::from(
        "SELECT m.id, m.data, m.prodotto_id, m.tipo, m.quantita, m.causale, \
                m.documento_tipo, m.documento_id, m.documento_numero, m.cliente_id, m.fornitore_id, m.note, \
                m.variante_taglia, m.variante_colore, \
                COALESCE(p.codice, m.prodotto_codice) AS prodotto_codice, \
                COALESCE(c.ragione_sociale, m.cliente_nome) AS cliente_nome, \
                COALESCE(f.ragione_sociale, m.fornitore_nome) AS fornitore_nome \
         FROM movimenti_magazzino m \
         LEFT JOIN prodotti p ON m.prodotto_id = p.id \
         LEFT JOIN clienti c ON m.cliente_id = c.id \
         LEFT JOIN fornitori f ON m.fornitore_id = f.id WHERE 1=1",
    );
    let mut binds: Vec<SqlValue> = Vec::new();
    let mut add = |cond: &str, val: String, sql: &mut String, binds: &mut Vec<SqlValue>| {
        sql.push_str(cond);
        binds.push(SqlValue::Text(val));
    };
    if let Some(v) = nonempty(&q, "prodottoId") { add(" AND m.prodotto_id=?", v, &mut sql, &mut binds); }
    if let Some(v) = nonempty(&q, "clienteId") { add(" AND m.cliente_id=?", v, &mut sql, &mut binds); }
    if let Some(v) = nonempty(&q, "tipo") { add(" AND m.tipo=?", v, &mut sql, &mut binds); }
    if let Some(v) = nonempty(&q, "causale") { add(" AND m.causale=?", v, &mut sql, &mut binds); }
    if let Some(v) = nonempty(&q, "anno") { add(" AND strftime('%Y', m.data)=?", v, &mut sql, &mut binds); }
    if let Some(v) = nonempty(&q, "mese") {
        let mm = format!("{:0>2}", v);
        add(" AND strftime('%m', m.data)=?", mm, &mut sql, &mut binds);
    }
    if let Some(v) = nonempty(&q, "dataFrom") { add(" AND m.data >= ?", v, &mut sql, &mut binds); }
    if let Some(v) = nonempty(&q, "dataTo") { add(" AND m.data <= ?", v, &mut sql, &mut binds); }
    sql.push_str(" ORDER BY m.data DESC, m.id DESC");

    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let mut stmt = conn.prepare(&sql)?;
    let p: Vec<&dyn ToSql> = binds.iter().map(|v| v as &dyn ToSql).collect();
    let rows = stmt
        .query_map(p.as_slice(), |r| {
            Ok(json!({
                "id": r.get::<_, i64>("id")?,
                "data": r.get::<_, Option<String>>("data")?,
                "prodottoId": r.get::<_, Option<i64>>("prodotto_id")?,
                "prodottoCodice": r.get::<_, Option<String>>("prodotto_codice")?,
                "tipo": r.get::<_, Option<String>>("tipo")?,
                "quantita": opt_num(r.get::<_, Option<f64>>("quantita")?),
                "causale": r.get::<_, Option<String>>("causale")?,
                "documentoTipo": r.get::<_, Option<String>>("documento_tipo")?,
                "documentoId": r.get::<_, Option<i64>>("documento_id")?,
                "documentoNumero": r.get::<_, Option<String>>("documento_numero")?,
                "clienteId": r.get::<_, Option<i64>>("cliente_id")?,
                "clienteNome": r.get::<_, Option<String>>("cliente_nome")?,
                "fornitoreId": r.get::<_, Option<i64>>("fornitore_id")?,
                "fornitoreNome": r.get::<_, Option<String>>("fornitore_nome")?,
                "note": r.get::<_, Option<String>>("note")?,
                "varianteTaglia": r.get::<_, Option<String>>("variante_taglia")?.unwrap_or_default(),
                "varianteColore": r.get::<_, Option<String>>("variante_colore")?.unwrap_or_default(),
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(Value::Array(rows)))
}

async fn storico(
    State(state): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let data = match nonempty(&q, "data") {
        Some(d) => d,
        None => return Err(ApiError::bad_request("Parametro data richiesto (YYYY-MM-DD)")),
    };
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT p.id, p.codice, p.categoria, p.unita_misura, p.soglia_minima, \
           ROUND(p.quantita \
             + COALESCE(SUM(CASE WHEN m.tipo='SCARICO' AND m.data > ?1 THEN m.quantita ELSE 0 END), 0) \
             - COALESCE(SUM(CASE WHEN m.tipo='CARICO'  AND m.data > ?2 THEN m.quantita ELSE 0 END), 0), 4) AS quantita_storica \
         FROM prodotti p LEFT JOIN movimenti_magazzino m ON m.prodotto_id = p.id \
         GROUP BY p.id ORDER BY p.codice",
    )?;
    let rows = stmt
        .query_map([&data, &data], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "codice": r.get::<_, Option<String>>(1)?,
                "categoria": r.get::<_, Option<String>>(2)?,
                "unitaMisura": r.get::<_, Option<String>>(3)?,
                "sogliaMinima": opt_num(r.get::<_, Option<f64>>(4)?),
                "quantita": opt_num(r.get::<_, Option<f64>>(5)?),
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(Value::Array(rows)))
}

fn nonempty(q: &HashMap<String, String>, k: &str) -> Option<String> {
    q.get(k).filter(|s| !s.is_empty()).cloned()
}
