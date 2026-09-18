//! /api/preferenze — copia nel database delle preferenze dell'interfaccia.
//!
//! Tema, lingua, menu, densità, widget della dashboard, colonne delle tabelle e
//! mappature di import vivono nel localStorage della WebView: comodo, ma fuori
//! dal database e quindi fuori dal backup. Il frontend ne tiene qui una copia
//! (vedi PreferenzeSyncService) e, dopo un ripristino, la rilegge per rimettere
//! l'app com'era. Il backend non interpreta i valori: sono stringhe opache.

use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use rusqlite::params;
use serde_json::{json, Map, Value};

use crate::db::AppState;
use crate::error::{ApiError, ApiResult};
use crate::web::tenant_conn;

pub fn routes() -> Router<AppState> {
    Router::new().route("/", get(leggi).put(salva))
}

/// Limiti di buon senso: sono preferenze, non dati. Una mappatura di import o
/// lo stato dei widget stanno ben sotto; un valore enorme è un errore del client.
const MAX_CHIAVI: usize = 500;
const MAX_CHIAVE: usize = 200;
const MAX_VALORE: usize = 256 * 1024;

/// GET /api/preferenze → { chiave: valore, … }
async fn leggi(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let mut st = conn.prepare("SELECT chiave, valore FROM preferenze_ui")?;
    let righe = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    let mut out = Map::new();
    for x in righe {
        let (k, v) = x?;
        out.insert(k, Value::String(v));
    }
    Ok(Json(Value::Object(out)))
}

/// PUT /api/preferenze { chiave: "valore" | null, … }
/// Stringa = crea o aggiorna, null = elimina. Tutto in una transazione.
async fn salva(State(state): State<AppState>, Json(b): Json<Value>) -> ApiResult<Json<Value>> {
    let Some(obj) = b.as_object() else {
        return Err(ApiError::bad_request("Atteso un oggetto chiave → valore"));
    };
    if obj.len() > MAX_CHIAVI {
        return Err(ApiError::bad_request("Troppe preferenze in una sola richiesta"));
    }
    let arc = tenant_conn(&state)?;
    let mut guard = arc.lock().unwrap();
    let tx = guard.transaction().map_err(ApiError::from)?;
    for (k, v) in obj {
        if k.is_empty() || k.len() > MAX_CHIAVE {
            continue;
        }
        match v {
            Value::Null => {
                tx.execute("DELETE FROM preferenze_ui WHERE chiave=?1", params![k])?;
            }
            Value::String(s) if s.len() <= MAX_VALORE => {
                tx.execute(
                    "INSERT INTO preferenze_ui (chiave, valore, updated_at) VALUES (?1, ?2, datetime('now')) \
                     ON CONFLICT(chiave) DO UPDATE SET valore=excluded.valore, updated_at=excluded.updated_at",
                    params![k, s],
                )?;
            }
            // Numeri, oggetti o stringhe troppo lunghe: il client manda solo
            // stringhe (è ciò che contiene il localStorage), il resto si ignora.
            _ => {}
        }
    }
    tx.commit().map_err(ApiError::from)?;
    Ok(Json(json!({ "ok": true })))
}
