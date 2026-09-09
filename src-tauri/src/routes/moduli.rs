//! /api/moduli — attivazione dei moduli dell'archivio locale.
//! Edizione offline: chi usa l'app è il proprietario dell'archivio, quindi può
//! attivare e disattivare i moduli. I controlli di ruolo ADMIN/SUPERADMIN e le
//! rotte /admin per tenant erano residui dell'edizione SaaS multi-tenant.

use axum::{
    extract::{Path, State},
    routing::{get, put},
    Json, Router,
};
use serde_json::Value;

use crate::auth::CurrentUser;
use crate::db::AppState;
use crate::error::{ApiError, ApiResult};
use crate::moduli;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list))
        .route("/:slug", put(toggle))
}

async fn list(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let user = CurrentUser::local();
    let out = state.with_auth(|c| Ok(moduli::list_tenant_moduli(c, &user.tenant)?))?;
    Ok(Json(Value::Array(out)))
}

async fn toggle(
    State(state): State<AppState>,
    Path(slug): Path<String>,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    let user = CurrentUser::local();
    let attivo = matches!(body.get("attivo"), Some(Value::Bool(true)))
        || matches!(body.get("attivo"), Some(Value::Number(n)) if n.as_f64() != Some(0.0) && n.as_f64().is_some());
    let res = state.with_auth(|c| {
        Ok(moduli::set_tenant_modulo(c, &user.tenant, &slug, attivo))
    })?;
    match res {
        Ok(m) => Ok(Json(m.unwrap_or(Value::Null))),
        Err(msg) => Err(ApiError::Status(axum::http::StatusCode::BAD_REQUEST, msg)),
    }
}
