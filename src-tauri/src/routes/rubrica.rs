//! /api/rubrica — rubrica telefonica dell'archivio.
//!
//! Un contatto è un numero con un nome e un "tipo" (amministrazione, contabilità,
//! commerciale, …), facoltativamente collegato a un cliente o a un fornitore.
//! Vive nel DB del tenant, quindi è esclusivo dell'archivio in uso come agenda,
//! lavagna e portachiavi.

use axum::extract::{Path, Query, State};
use axum::routing::{get, put};
use axum::{Json, Router};
use rusqlite::params;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::db::AppState;
use crate::error::{ApiError, ApiResult};
use crate::web::tenant_conn;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(lista).post(crea))
        .route("/:id", put(aggiorna).delete(elimina))
}

/// Tipi ammessi. Il valore resta una stringa in chiaro nel DB (leggibile in un
/// export SQL), ma si normalizza qui perché l'elenco dell'interfaccia e i filtri
/// possano contare su un insieme chiuso.
const TIPI: [&str; 8] = [
    "AMMINISTRAZIONE",
    "CONTABILITA",
    "COMMERCIALE",
    "ACQUISTI",
    "MAGAZZINO",
    "DIREZIONE",
    "ASSISTENZA",
    "ALTRO",
];

fn normalizza_tipo(s: &str) -> String {
    // `to_uppercase` (non la variante ASCII) perché "contabilità" ha l'accento:
    // va portato a maiuscolo prima di poterlo sostituire.
    let up = s.trim().to_uppercase().replace('À', "A");
    if TIPI.contains(&up.as_str()) {
        up
    } else {
        "ALTRO".to_string()
    }
}

#[derive(Deserialize)]
struct ContattoReq {
    nome: String,
    #[serde(default)]
    telefono: String,
    #[serde(default)]
    tipo: Option<String>,
    #[serde(default)]
    ruolo: String,
    #[serde(default)]
    email: String,
    #[serde(default)]
    note: String,
    #[serde(rename = "clienteId", default)]
    cliente_id: Option<i64>,
    #[serde(rename = "fornitoreId", default)]
    fornitore_id: Option<i64>,
}

/// Un contatto è legato al massimo a UNA controparte: se arrivano entrambe
/// vince il cliente, così la riga non può contraddirsi.
fn collegamento(b: &ContattoReq) -> (Option<i64>, Option<i64>) {
    let cli = b.cliente_id.filter(|v| *v > 0);
    let forn = b.fornitore_id.filter(|v| *v > 0);
    if cli.is_some() {
        (cli, None)
    } else {
        (None, forn)
    }
}

#[derive(Deserialize)]
struct ListaQuery {
    q: Option<String>,
    tipo: Option<String>,
}

async fn lista(
    State(state): State<AppState>,
    Query(qs): Query<ListaQuery>,
) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();

    // Il nome della controparte arriva dal join: l'elenco deve poterlo mostrare e
    // filtrare senza una seconda chiamata per riga.
    let mut sql = String::from(
        "SELECT r.id, r.nome, r.telefono, r.tipo, r.ruolo, r.email, r.note, \
                r.cliente_id, r.fornitore_id, c.ragione_sociale, f.ragione_sociale \
         FROM rubrica r \
         LEFT JOIN clienti c ON c.id = r.cliente_id \
         LEFT JOIN fornitori f ON f.id = r.fornitore_id \
         WHERE 1=1",
    );
    let mut binds: Vec<String> = Vec::new();

    if let Some(t) = qs.tipo.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        sql.push_str(" AND r.tipo = ?");
        binds.push(normalizza_tipo(t));
    }
    if let Some(q) = qs.q.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        sql.push_str(
            " AND (r.nome LIKE ? OR r.telefono LIKE ? OR r.email LIKE ? \
                   OR r.ruolo LIKE ? OR c.ragione_sociale LIKE ? OR f.ragione_sociale LIKE ?)",
        );
        let like = format!("%{q}%");
        for _ in 0..6 {
            binds.push(like.clone());
        }
    }
    sql.push_str(" ORDER BY r.nome COLLATE NOCASE");

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(binds.iter()), |r| {
        let cliente: Option<String> = r.get(9)?;
        let fornitore: Option<String> = r.get(10)?;
        // Calcolati fuori dal `json!`: un `if/else` come valore dentro la macro
        // si scontra con le graffe che la macro stessa usa per gli oggetti.
        let controparte_nome = cliente.clone().or_else(|| fornitore.clone());
        let controparte_tipo = if cliente.is_some() {
            "CLIENTE"
        } else if fornitore.is_some() {
            "FORNITORE"
        } else {
            ""
        };
        Ok(json!({
            "id": r.get::<_, i64>(0)?,
            "nome": r.get::<_, String>(1)?,
            "telefono": r.get::<_, Option<String>>(2)?.unwrap_or_default(),
            "tipo": r.get::<_, Option<String>>(3)?.unwrap_or_else(|| "ALTRO".into()),
            "ruolo": r.get::<_, Option<String>>(4)?.unwrap_or_default(),
            "email": r.get::<_, Option<String>>(5)?.unwrap_or_default(),
            "note": r.get::<_, Option<String>>(6)?.unwrap_or_default(),
            "clienteId": r.get::<_, Option<i64>>(7)?,
            "fornitoreId": r.get::<_, Option<i64>>(8)?,
            "controparteNome": controparte_nome,
            "controparteTipo": controparte_tipo,
        }))
    })?;
    let mut out = Vec::new();
    for x in rows {
        out.push(x?);
    }
    Ok(Json(Value::Array(out)))
}

async fn crea(State(state): State<AppState>, Json(b): Json<ContattoReq>) -> ApiResult<Json<Value>> {
    let nome = b.nome.trim();
    if nome.is_empty() {
        return Err(ApiError::bad_request("Nome contatto mancante"));
    }
    let telefono = b.telefono.trim();
    if telefono.is_empty() && b.email.trim().is_empty() {
        return Err(ApiError::bad_request("Serve almeno un numero di telefono o un'email"));
    }
    let tipo = normalizza_tipo(b.tipo.as_deref().unwrap_or("ALTRO"));
    let (cli, forn) = collegamento(&b);

    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    conn.execute(
        "INSERT INTO rubrica (nome, telefono, tipo, ruolo, email, note, cliente_id, fornitore_id) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![nome, telefono, tipo, b.ruolo.trim(), b.email.trim(), b.note.trim(), cli, forn],
    )?;
    Ok(Json(json!({ "id": conn.last_insert_rowid() })))
}

async fn aggiorna(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(b): Json<ContattoReq>,
) -> ApiResult<Json<Value>> {
    let nome = b.nome.trim();
    if nome.is_empty() {
        return Err(ApiError::bad_request("Nome contatto mancante"));
    }
    let telefono = b.telefono.trim();
    if telefono.is_empty() && b.email.trim().is_empty() {
        return Err(ApiError::bad_request("Serve almeno un numero di telefono o un'email"));
    }
    let tipo = normalizza_tipo(b.tipo.as_deref().unwrap_or("ALTRO"));
    let (cli, forn) = collegamento(&b);

    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let n = conn.execute(
        "UPDATE rubrica SET nome=?1, telefono=?2, tipo=?3, ruolo=?4, email=?5, note=?6, \
         cliente_id=?7, fornitore_id=?8, updated_at=datetime('now') WHERE id=?9",
        params![nome, telefono, tipo, b.ruolo.trim(), b.email.trim(), b.note.trim(), cli, forn, id],
    )?;
    if n == 0 {
        return Err(ApiError::not_found("Contatto non trovato"));
    }
    Ok(Json(json!({ "ok": true })))
}

async fn elimina(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    conn.execute("DELETE FROM rubrica WHERE id=?1", params![id])?;
    Ok(Json(json!({ "ok": true })))
}

#[cfg(test)]
mod tests {
    use super::normalizza_tipo;

    #[test]
    fn tipo_normalizzato_o_altro() {
        assert_eq!(normalizza_tipo("amministrazione"), "AMMINISTRAZIONE");
        assert_eq!(normalizza_tipo(" Contabilità "), "CONTABILITA");
        assert_eq!(normalizza_tipo("CONTABILITA"), "CONTABILITA");
        // Un valore sconosciuto non deve finire nel DB: diventa ALTRO, così i
        // filtri dell'elenco restano su un insieme chiuso.
        assert_eq!(normalizza_tipo("reparto vendite"), "ALTRO");
        assert_eq!(normalizza_tipo(""), "ALTRO");
    }
}
