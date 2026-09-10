//! Tipo errore unificato per le route. Mappa gli errori sullo stesso formato JSON
//! del backend Node (`{ "error": "..." }`) e mantiene la parità di status code:
//! violazione UNIQUE → 400 "Valore duplicato" (come l'error handler di server.js).

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

pub type ApiResult<T> = Result<T, ApiError>;

// Debug serve ai test delle route, che chiamano gli helper e fanno unwrap.
#[derive(Debug)]
pub enum ApiError {
    Status(StatusCode, String),
    /// Risposta con body JSON arbitrario (es. 409 con `duplicateId`, o `counts`).
    Body(StatusCode, serde_json::Value),
    Internal(anyhow::Error),
}

impl ApiError {
    pub fn bad_request(msg: impl Into<String>) -> Self {
        ApiError::Status(StatusCode::BAD_REQUEST, msg.into())
    }
    pub fn not_found(msg: impl Into<String>) -> Self {
        ApiError::Status(StatusCode::NOT_FOUND, msg.into())
    }
    pub fn conflict(msg: impl Into<String>) -> Self {
        ApiError::Status(StatusCode::CONFLICT, msg.into())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, msg) = match self {
            ApiError::Status(s, m) => (s, m),
            ApiError::Body(s, body) => return (s, Json(body)).into_response(),
            ApiError::Internal(e) => {
                tracing::error!("errore interno: {e:#}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Errore interno".to_string(),
                )
            }
        };
        (status, Json(json!({ "error": msg }))).into_response()
    }
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ApiError::Status(s, m) => write!(f, "{s}: {m}"),
            ApiError::Body(s, body) => write!(f, "{s}: {body}"),
            ApiError::Internal(e) => write!(f, "{e:#}"),
        }
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(e: anyhow::Error) -> Self {
        ApiError::Internal(e)
    }
}

impl From<rusqlite::Error> for ApiError {
    fn from(e: rusqlite::Error) -> Self {
        if let rusqlite::Error::SqliteFailure(err, _) = &e {
            if err.code == rusqlite::ErrorCode::ConstraintViolation {
                return ApiError::Status(StatusCode::BAD_REQUEST, "Valore duplicato".into());
            }
        }
        ApiError::Internal(e.into())
    }
}
