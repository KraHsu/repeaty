use crate::{
    auth::{AuthStore, User, private_directory},
    db::{Commit, Database, MAX_MEDIA, ReadAttempts},
    error::{Error, Result},
};
use axum::{
    Extension, Json, Router,
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
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tower_http::{compression::CompressionLayer, services::ServeDir};

type Libraries = Arc<Mutex<HashMap<String, Arc<Mutex<Database>>>>>;
#[derive(Clone)]
pub struct AppState {
    pub auth: Arc<Mutex<AuthStore>>,
    pub directory: PathBuf,
    libraries: Libraries,
    auth_jobs: Arc<tokio::sync::Semaphore>,
    pub registration: bool,
    pub origin: String,
    pub host: String,
}
impl AppState {
    pub fn open(
        directory: PathBuf,
        origin: String,
        host: String,
        registration: bool,
    ) -> Result<Self> {
        private_directory(&directory).map_err(|_| Error::internal())?;
        private_directory(&directory.join("users")).map_err(|_| Error::internal())?;
        Ok(Self {
            auth: Arc::new(Mutex::new(AuthStore::open(
                &directory.join("accounts.sqlite3"),
            )?)),
            directory,
            libraries: Arc::new(Mutex::new(HashMap::new())),
            auth_jobs: Arc::new(tokio::sync::Semaphore::new(4)),
            registration,
            origin,
            host,
        })
    }
    pub async fn accounts<T: Send + 'static>(
        &self,
        operation: impl FnOnce(&mut AuthStore) -> Result<T> + Send + 'static,
    ) -> Result<T> {
        let permit = self
            .auth_jobs
            .clone()
            .try_acquire_owned()
            .map_err(|_| Error(StatusCode::TOO_MANY_REQUESTS, "rate-limit"))?;
        let auth = self.auth.clone();
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            operation(&mut *auth.lock().map_err(|_| Error::internal())?)
        })
        .await
        .map_err(|_| Error::internal())?
    }
    pub async fn database<T: Send + 'static>(
        &self,
        user: User,
        operation: impl FnOnce(&mut Database) -> Result<T> + Send + 'static,
    ) -> Result<T> {
        let libraries = self.libraries.clone();
        let directory = self.directory.clone();
        tokio::task::spawn_blocking(move || {
            let db = {
                let mut libraries = libraries.lock().map_err(|_| Error::internal())?;
                if !libraries.contains_key(&user.id) {
                    if libraries.len() >= 32 {
                        libraries.retain(|_, db| Arc::strong_count(db) > 1);
                    }
                    let db = Database::open(
                        &directory.join("users").join(format!("{}.sqlite3", user.id)),
                    )?;
                    libraries.insert(user.id.clone(), Arc::new(Mutex::new(db)));
                }
                libraries[&user.id].clone()
            };
            operation(&mut *db.lock().map_err(|_| Error::internal())?)
        })
        .await
        .map_err(|_| Error::internal())?
    }
}
pub fn router(state: AppState, public_dir: PathBuf) -> Router {
    let api = Router::new()
        .route("/status", get(status))
        .route(
            "/auth/register",
            post(register).layer(DefaultBodyLimit::max(4096)),
        )
        .route(
            "/auth/login",
            post(login).layer(DefaultBodyLimit::max(4096)),
        )
        .route("/auth/session", get(session))
        .route("/auth/logout", post(logout))
        .route(
            "/auth/password",
            post(change_password).layer(DefaultBodyLimit::max(4096)),
        )
        .route("/library", get(load))
        .route("/library/summary", get(load_summary))
        .route(
            "/library/attempts",
            post(read_attempts).layer(DefaultBodyLimit::max(4096)),
        )
        .route("/library/commit", post(commit))
        .route("/backups", get(backups).post(backup_now))
        .route("/backups/{id}", get(backup))
        .route(
            "/media/{id}",
            get(media)
                .put(put_media)
                .layer(DefaultBodyLimit::max(MAX_MEDIA)),
        )
        .fallback(|| async { Error::missing() })
        .layer(DefaultBodyLimit::max(64 * 1024 * 1024))
        .route_layer(middleware::from_fn_with_state(state.clone(), protect));
    Router::new()
        .nest("/api", api)
        .fallback_service(ServeDir::new(public_dir))
        .layer(CompressionLayer::new())
        .with_state(state)
}
fn session_token(headers: &HeaderMap) -> String {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::to_owned)
        .unwrap_or_else(|| {
            headers
                .get(header::COOKIE)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| {
                    v.split(';')
                        .find_map(|pair| pair.trim().strip_prefix("repeaty_session="))
                })
                .unwrap_or("")
                .to_owned()
        })
}
async fn protect(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Result<Response> {
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
    if !matches!(
        request.uri().path(),
        "/status" | "/auth/login" | "/auth/register"
    ) {
        let token = session_token(headers);
        let user = state
            .accounts(move |auth| auth.authenticate(&token))
            .await?;
        let library_request = matches!(
            request.uri().path(),
            "/library" | "/library/commit" | "/backups"
        ) || request.uri().path().starts_with("/library/")
            || request.uri().path().starts_with("/media/")
            || request.uri().path().starts_with("/backups/");
        if library_request
            && headers.get("x-repeaty-user").and_then(|v| v.to_str().ok()) != Some(&user.id)
        {
            return Err(Error(StatusCode::CONFLICT, "account-changed"));
        }
        request.extensions_mut().insert(user);
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
async fn status(State(state): State<AppState>) -> Json<Value> {
    Json(
        json!({"edition":"server","version":env!("CARGO_PKG_VERSION"),"apiVersion":6,"historyVersion":1,"authenticationRequired":true,"registration":state.registration}),
    )
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Login {
    username: String,
    password: String,
}
fn cookie(state: &AppState, token: &str, max_age: u32) -> String {
    format!(
        "repeaty_session={token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age={max_age}{}",
        if state.origin.starts_with("https:") {
            "; Secure"
        } else {
            ""
        }
    )
}
async fn sign_in(
    state: AppState,
    headers: HeaderMap,
    input: Login,
    register: bool,
) -> Result<Response> {
    if register && !state.registration {
        return Err(Error(StatusCode::FORBIDDEN, "registration-closed"));
    }
    let (user, token) = state
        .accounts(move |auth| {
            auth.throttle(&input.username)?;
            let user = if register {
                auth.create(&input.username, &input.password)?
            } else {
                auth.login(&input.username, &input.password)?
            };
            let token = auth.issue(&user)?;
            Ok((user, token))
        })
        .await?;
    // Native clients keep bearer sessions in Rust memory. Browser sessions stay HttpOnly.
    if headers
        .get("x-repeaty-session")
        .is_some_and(|v| v == "bearer")
    {
        Ok(Json(json!({"user":user,"token":token})).into_response())
    } else {
        Ok((
            [(header::SET_COOKIE, cookie(&state, &token, 604800))],
            Json(json!({"user":user})),
        )
            .into_response())
    }
}
async fn register(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<Login>,
) -> Result<Response> {
    sign_in(state, headers, input, true).await
}
async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<Login>,
) -> Result<Response> {
    sign_in(state, headers, input, false).await
}
async fn session(Extension(user): Extension<User>) -> Json<Value> {
    Json(json!({"user":user}))
}
async fn logout(State(state): State<AppState>, headers: HeaderMap) -> Result<Response> {
    let token = session_token(&headers);
    state.accounts(move |auth| auth.logout(&token)).await?;
    Ok((
        [(header::SET_COOKIE, cookie(&state, "", 0))],
        StatusCode::NO_CONTENT,
    )
        .into_response())
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PasswordChange {
    current_password: String,
    password: String,
}
async fn change_password(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Json(input): Json<PasswordChange>,
) -> Result<Response> {
    state
        .accounts(move |auth| {
            auth.throttle(&user.username)?;
            auth.change_password(&user, &input.current_password, &input.password)
        })
        .await?;
    Ok((
        [(header::SET_COOKIE, cookie(&state, "", 0))],
        StatusCode::NO_CONTENT,
    )
        .into_response())
}
async fn load(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
) -> Result<Json<Value>> {
    Ok(Json(state.database(user, |db| db.load()).await?))
}
async fn commit(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Json(input): Json<Commit>,
) -> Result<Json<Value>> {
    let revision = state.database(user, |db| db.commit(input)).await?;
    Ok(Json(json!({"revision":revision})))
}
async fn load_summary(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
) -> Result<Json<Value>> {
    Ok(Json(state.database(user, |db| db.load_summary()).await?))
}
async fn read_attempts(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Json(input): Json<ReadAttempts>,
) -> Result<Json<Value>> {
    Ok(Json(
        state
            .database(user, move |db| db.read_attempts(input))
            .await?,
    ))
}
async fn backups(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
) -> Result<Json<Value>> {
    Ok(Json(state.database(user, |db| db.backups()).await?))
}
#[derive(Deserialize)]
struct BackupRequest {
    #[serde(default)]
    force: bool,
}
async fn backup_now(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Json(input): Json<BackupRequest>,
) -> Result<StatusCode> {
    state
        .database(user, move |db| db.backup_now(input.force))
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
async fn backup(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
) -> Result<Json<Value>> {
    Ok(Json(state.database(user, move |db| db.backup(&id)).await?))
}
async fn media(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
) -> Result<Response> {
    let (mime, body) = state.database(user, move |db| db.media(&id)).await?;
    Ok(([(header::CONTENT_TYPE, mime)], body).into_response())
}
async fn put_media(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Extension(user): Extension<User>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode> {
    let mime = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(Error::invalid)?
        .to_string();
    state
        .database(user, move |db| db.put_media(&id, &mime, &body))
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
