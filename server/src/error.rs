use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;

#[derive(Debug)]
pub struct Error(pub StatusCode, pub &'static str);
pub type Result<T> = std::result::Result<T, Error>;
impl Error {
    pub fn invalid() -> Self {
        Self(StatusCode::BAD_REQUEST, "invalid-data")
    }
    pub fn missing() -> Self {
        Self(StatusCode::NOT_FOUND, "not-found")
    }
    pub fn conflict() -> Self {
        Self(StatusCode::CONFLICT, "revision-conflict")
    }
    pub fn internal() -> Self {
        Self(StatusCode::INTERNAL_SERVER_ERROR, "storage-error")
    }
}
impl IntoResponse for Error {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"error": self.1}))).into_response()
    }
}
impl From<rusqlite::Error> for Error {
    fn from(error: rusqlite::Error) -> Self {
        if let rusqlite::Error::SqliteFailure(ref code, _) = error
            && code.code == rusqlite::ErrorCode::ConstraintViolation
        {
            return Self::invalid();
        }
        eprintln!("SQLite operation failed: {error}");
        Self::internal()
    }
}
impl From<serde_json::Error> for Error {
    fn from(_: serde_json::Error) -> Self {
        Self::invalid()
    }
}
