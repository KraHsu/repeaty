use crate::{
    db::{Commit, Database, MAX_MEDIA},
    error::{Error, Result},
    leetcode::LeetCode,
};
use axum::{
    Json, Router,
    body::Bytes,
    extract::{DefaultBodyLimit, Path, Request, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tower_http::{compression::CompressionLayer, services::ServeDir};

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Mutex<Database>>,
    pub leetcode: Arc<LeetCode>,
    pub token: Option<String>,
    pub origin: String,
    pub host: String,
    pub enabled_plugins: Vec<String>,
}
impl AppState {
    pub async fn database<T: Send + 'static>(
        &self,
        operation: impl FnOnce(&mut Database) -> Result<T> + Send + 'static,
    ) -> Result<T> {
        let db = self.db.clone();
        tokio::task::spawn_blocking(move || {
            operation(&mut *db.lock().map_err(|_| Error::internal())?)
        })
        .await
        .map_err(|_| Error::internal())?
    }
}
pub fn router(state: AppState, public_dir: PathBuf) -> Router {
    let mut plugins = Router::new();
    for plugin in crate::plugins::installed() {
        if state.enabled_plugins.iter().any(|id| id == plugin.id()) {
            plugins = plugins.merge(plugin.routes());
        }
    }
    let api = Router::new()
        .route("/status", get(status))
        .route("/library", get(load))
        .route("/library/commit", post(commit))
        .route("/backups", get(backups).post(backup_now))
        .route("/backups/{id}", get(backup))
        .route(
            "/media/{id}",
            get(media)
                .put(put_media)
                .layer(DefaultBodyLimit::max(MAX_MEDIA)),
        )
        .nest("/plugins", plugins)
        .fallback(|| async { Error::missing() })
        .layer(DefaultBodyLimit::max(64 * 1024 * 1024))
        .route_layer(middleware::from_fn_with_state(state.clone(), protect));
    Router::new()
        .nest("/api", api)
        .fallback_service(ServeDir::new(public_dir))
        .layer(CompressionLayer::new())
        .with_state(state)
}
fn equal_secret(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes()
        .zip(b.bytes())
        .fold(0u8, |diff, (a, b)| diff | (a ^ b))
        == 0
}
async fn protect(State(state): State<AppState>, request: Request, next: Next) -> Result<Response> {
    // Require a non-simple header and a fixed deployment origin, even for loopback.
    // This rejects cross-site forms, CORS probes, and DNS rebinding hosts.
    let headers = request.headers();
    if headers
        .get("x-repeaty-client")
        .and_then(|v| v.to_str().ok())
        != Some("1")
        || headers.get(header::HOST).and_then(|v| v.to_str().ok()) != Some(&state.host)
        || headers
            .get(header::ORIGIN)
            .is_some_and(|v| v.to_str().ok() != Some(&state.origin))
    {
        return Err(Error(StatusCode::FORBIDDEN, "origin-rejected"));
    }
    if request.uri().path() != "/status"
        && let Some(token) = &state.token
    {
        let supplied = headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .unwrap_or("");
        if !equal_secret(token, supplied) {
            return Err(Error(StatusCode::UNAUTHORIZED, "unauthorized"));
        }
    }
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response.headers_mut().insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    Ok(response)
}
async fn status(State(state): State<AppState>) -> Result<Json<Value>> {
    let configured = state.leetcode.configured()?;
    Ok(Json(
        json!({"edition":"server","version":env!("CARGO_PKG_VERSION"),"apiVersion":1,"authenticationRequired":state.token.is_some(),"plugins":state.enabled_plugins.iter().map(|id|json!({"id":id,"configured":if id=="leetcode" {configured.clone()} else {vec![]}})).collect::<Vec<_>>()}),
    ))
}
async fn load(State(state): State<AppState>) -> Result<Json<Value>> {
    Ok(Json(state.database(|db| db.load()).await?))
}
async fn commit(State(state): State<AppState>, Json(input): Json<Commit>) -> Result<Json<Value>> {
    let revision = state.database(|db| db.commit(input)).await?;
    Ok(Json(json!({"revision":revision})))
}
async fn backups(State(state): State<AppState>) -> Result<Json<Value>> {
    Ok(Json(state.database(|db| db.backups()).await?))
}
#[derive(Deserialize)]
struct BackupRequest {
    #[serde(default)]
    force: bool,
}
async fn backup_now(
    State(state): State<AppState>,
    Json(input): Json<BackupRequest>,
) -> Result<StatusCode> {
    state.database(move |db| db.backup_now(input.force)).await?;
    Ok(StatusCode::NO_CONTENT)
}
async fn backup(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Value>> {
    Ok(Json(state.database(move |db| db.backup(&id)).await?))
}
async fn media(State(state): State<AppState>, Path(id): Path<String>) -> Result<Response> {
    let (mime, body) = state.database(move |db| db.media(&id)).await?;
    Ok(([(header::CONTENT_TYPE, mime)], body).into_response())
}
async fn put_media(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode> {
    let mime = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(Error::invalid)?
        .to_string();
    state
        .database(move |db| db.put_media(&id, &mime, &body))
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
