use base64::{Engine, engine::general_purpose::STANDARD};
use reqwest::{Client, Url, redirect::Policy};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

const LIMIT: usize = 64 * 1024 * 1024;
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    pub endpoint: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub path: String,
    pub method: String,
    pub content_type: Option<String>,
    pub user_id: Option<String>,
    pub body: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub status: u16,
    pub content_type: String,
    pub body: String,
}
pub struct Upstream {
    // Locks only guard a few fields for the duration of a field access, never a request:
    // a slow media download must not queue every other call behind it.
    session: Mutex<Session>,
    path: PathBuf,
    client: Client,
}
struct Session {
    config: Config,
    token: Option<String>,
    generation: u64,
}
pub fn endpoint(input: &str) -> Result<String, String> {
    let input = input.trim();
    if input.is_empty() {
        return Ok(String::new());
    }
    let url = Url::parse(input).map_err(|_| "invalid-endpoint")?;
    let loopback = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if !(url.scheme() == "https" || (url.scheme() == "http" && loopback))
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err("invalid-endpoint".into());
    }
    Ok(url.origin().ascii_serialization())
}
fn allowed(request: &Request) -> bool {
    match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/status" | "/auth/session" | "/library" | "/library/summary" | "/backups")
        | (
            "POST",
            "/auth/login" | "/auth/register" | "/auth/logout" | "/auth/password"
            | "/library/commit" | "/library/attempts" | "/backups",
        ) => true,
        (method, path) => {
            let id = if matches!(method, "GET" | "PUT") && path.starts_with("/media/") {
                path.strip_prefix("/media/")
            } else if method == "GET" {
                path.strip_prefix("/backups/")
            } else {
                None
            };
            id.is_some_and(|id| {
                !id.is_empty()
                    && id.len() <= 128
                    && id
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
            })
        }
    }
}
impl Upstream {
    pub fn open(path: &Path) -> Result<Self, Box<dyn std::error::Error>> {
        // A damaged settings file must not prevent the window from starting: the user
        // needs the settings page to repair the endpoint. Keep the bad file for diagnosis.
        let config = if path.exists() {
            match std::fs::read(path)
                .map_err(Box::<dyn std::error::Error>::from)
                .and_then(|bytes| {
                    serde_json::from_slice::<Config>(&bytes)
                        .map_err(Box::<dyn std::error::Error>::from)
                })
                .and_then(|config| {
                    endpoint(&config.endpoint)
                        .map_err(|error| Box::<dyn std::error::Error>::from(error.as_str()))
                        .map(|_| config)
                }) {
                Ok(config) => config,
                Err(_) => {
                    let _ = std::fs::rename(path, path.with_extension("invalid"));
                    Config::default()
                }
            }
        } else {
            Config::default()
        };
        Ok(Self {
            session: Mutex::new(Session {
                config,
                token: None,
                generation: 0,
            }),
            path: path.to_owned(),
            client: Client::builder()
                .timeout(Duration::from_secs(60))
                .redirect(Policy::none())
                .build()?,
        })
    }
    pub fn config(&self) -> Config {
        self.session
            .lock()
            .map(|session| session.config.clone())
            .unwrap_or_default()
    }
    pub fn endpoint(&self) -> String {
        self.config().endpoint
    }
    pub fn set_endpoint(&self, value: &str) -> Result<(), String> {
        let config = Config {
            endpoint: endpoint(value)?,
        };
        let bytes = serde_json::to_vec(&config).map_err(|_| "storage-error")?;
        // Keep persistence and the in-memory session in the same order even if two
        // endpoint changes arrive together. No network I/O runs under this lock.
        let mut session = self.session.lock().map_err(|_| "storage-error")?;
        // A unique temporary name that is created rather than followed, then flushed before
        // the rename, so an interrupted write cannot leave a truncated configuration.
        let temp = self.path.with_extension(format!("{}.tmp", uuid_suffix()));
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|_| "storage-error")?;
        use std::io::Write;
        let written = file
            .write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "storage-error");
        drop(file);
        let replaced =
            written.and_then(|_| std::fs::rename(&temp, &self.path).map_err(|_| "storage-error"));
        if replaced.is_err() {
            let _ = std::fs::remove_file(&temp);
            return Err("storage-error".into());
        }
        session.config = config;
        session.token = None;
        session.generation = session.generation.wrapping_add(1);
        Ok(())
    }
    pub async fn request(&self, request: Request) -> Result<Response, String> {
        // Take the destination and its credential together: a switch must never pair
        // the old destination with the new session (or the reverse).
        let (endpoint, token, generation) = {
            let session = self.session.lock().map_err(|_| "storage-error")?;
            (
                session.config.endpoint.clone(),
                session.token.clone(),
                session.generation,
            )
        };
        if !allowed(&request) || endpoint.is_empty() {
            return Err("request-rejected".into());
        }
        let method = reqwest::Method::from_bytes(request.method.as_bytes())
            .map_err(|_| "request-rejected")?;
        let auth = matches!(request.path.as_str(), "/auth/login" | "/auth/register");
        let mut outgoing = self
            .client
            .request(method, format!("{endpoint}/api{}", request.path))
            .header("X-Repeaty-Client", "1");
        if let Some(id) = request.user_id {
            outgoing = outgoing.header("X-Repeaty-User", id);
        }
        if auth {
            outgoing = outgoing.header("X-Repeaty-Session", "bearer");
        }
        if let Some(token) = token {
            outgoing = outgoing.bearer_auth(token);
        }
        if let Some(body) = request.body {
            if body.len() > LIMIT.div_ceil(3) * 4 {
                return Err("request-too-large".into());
            }
            let body = STANDARD.decode(body).map_err(|_| "invalid-data")?;
            if body.len() > LIMIT {
                return Err("request-too-large".into());
            }
            let mime = request.content_type.as_deref().ok_or("invalid-data")?;
            if mime.len() > 128 || mime.contains(['\r', '\n']) {
                return Err("invalid-data".into());
            }
            outgoing = outgoing.header("Content-Type", mime).body(body);
        }
        let mut incoming = outgoing.send().await.map_err(|_| "request-failed")?;
        let status = incoming.status().as_u16();
        if (300..400).contains(&status) {
            return Err("redirect-rejected".into());
        }
        let content_type = incoming
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("application/octet-stream")
            .to_owned();
        let mut body = Vec::new();
        while let Some(chunk) = incoming.chunk().await.map_err(|_| "request-failed")? {
            if body.len() + chunk.len() > LIMIT {
                return Err("response-too-large".into());
            }
            body.extend_from_slice(&chunk);
        }
        let authenticated_token = if auth && (200..300).contains(&status) {
            let mut value: serde_json::Value =
                serde_json::from_slice(&body).map_err(|_| "invalid-data")?;
            let token = value
                .as_object_mut()
                .and_then(|v| v.remove("token"))
                .and_then(|v| v.as_str().map(str::to_owned))
                .filter(|t| t.len() == 64 && t.bytes().all(|b| b.is_ascii_hexdigit()))
                .ok_or("invalid-data")?;
            body = serde_json::to_vec(&value).map_err(|_| "invalid-data")?;
            Some(token)
        } else {
            None
        };
        let mut session = self.session.lock().map_err(|_| "storage-error")?;
        // Endpoint equality alone misses A -> B -> A switches. Reject all retired
        // responses, including successful library reads and stale 401/logout replies.
        if session.generation != generation {
            return Err("request-rejected".into());
        }
        if let Some(token) = authenticated_token {
            session.token = Some(token);
            session.generation = session.generation.wrapping_add(1);
        }
        if (status == 401 && session.token.is_some())
            || (matches!(request.path.as_str(), "/auth/logout" | "/auth/password")
                && (200..300).contains(&status))
        {
            session.token = None;
            session.generation = session.generation.wrapping_add(1);
        }
        drop(session);
        Ok(Response {
            status,
            content_type,
            body: STANDARD.encode(body),
        })
    }
}
fn uuid_suffix() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}
#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        Json, Router,
        http::{HeaderMap, StatusCode},
        routing::{get, post},
    };
    use std::sync::Arc;
    use tokio::sync::Notify;

    fn request(path: &str, method: &str) -> Request {
        Request {
            path: path.into(),
            method: method.into(),
            body: None,
            content_type: None,
            user_id: None,
        }
    }

    struct Server {
        endpoint: String,
        task: tokio::task::JoinHandle<()>,
    }
    impl Server {
        async fn start(app: Router) -> Self {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let endpoint = format!("http://{}", listener.local_addr().unwrap());
            let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
            Self { endpoint, task }
        }
    }
    impl Drop for Server {
        fn drop(&mut self) {
            self.task.abort();
        }
    }

    #[derive(Clone, Default)]
    struct Pending {
        started: Arc<Notify>,
        resume: Arc<Notify>,
    }
    impl Pending {
        async fn wait(&self) {
            self.started.notify_one();
            self.resume.notified().await;
        }
        async fn started(&self) {
            tokio::time::timeout(Duration::from_secs(5), self.started.notified())
                .await
                .expect("upstream request did not reach the server");
        }
    }

    fn session_app(token: char) -> Router {
        session_router().route(
            "/api/auth/login",
            post(move || async move {
                Json(serde_json::json!({"token": token.to_string().repeat(64)}))
            }),
        )
    }

    fn session_router() -> Router {
        Router::new().route(
            "/api/auth/session",
            get(|headers: HeaderMap| async move {
                Json(serde_json::json!({
                    "authorization": headers.get("authorization").map(|v| v.to_str().unwrap())
                }))
            }),
        )
    }

    async fn assert_session(client: &Upstream, token: Option<char>) {
        let response = client
            .request(request("/auth/session", "GET"))
            .await
            .unwrap();
        let body: serde_json::Value =
            serde_json::from_slice(&STANDARD.decode(response.body).unwrap()).unwrap();
        assert_eq!(
            body["authorization"],
            serde_json::json!(
                token.map(|value| format!("Bearer {}", value.to_string().repeat(64)))
            )
        );
    }

    #[tokio::test]
    async fn late_login_cannot_replace_a_new_endpoint_session_or_survive_switching_back() {
        for switch_back in [false, true] {
            let pending = Pending::default();
            let old = Server::start(session_router().route(
                "/api/auth/login",
                post({
                    let pending = pending.clone();
                    move || async move {
                        pending.wait().await;
                        Json(serde_json::json!({"token": "a".repeat(64)}))
                    }
                }),
            ))
            .await;
            let new = Server::start(session_app('b')).await;
            let dir = tempfile::tempdir().unwrap();
            let client = Arc::new(Upstream::open(&dir.path().join("desktop.json")).unwrap());
            client.set_endpoint(&old.endpoint).unwrap();
            let login = tokio::spawn({
                let client = client.clone();
                async move { client.request(request("/auth/login", "POST")).await }
            });
            pending.started().await;
            client.set_endpoint(&new.endpoint).unwrap();
            client
                .request(request("/auth/login", "POST"))
                .await
                .unwrap();
            if switch_back {
                client.set_endpoint(&old.endpoint).unwrap();
            }
            pending.resume.notify_one();
            assert_eq!(
                login.await.unwrap().err().as_deref(),
                Some("request-rejected")
            );
            assert_session(&client, if switch_back { None } else { Some('b') }).await;
        }
    }

    #[tokio::test]
    async fn retired_library_logout_and_password_responses_cannot_change_the_new_session() {
        for (path, status) in [
            ("/library", StatusCode::OK),
            ("/library", StatusCode::UNAUTHORIZED),
            ("/auth/logout", StatusCode::NO_CONTENT),
            ("/auth/password", StatusCode::NO_CONTENT),
        ] {
            let pending = Pending::default();
            let method = if path == "/library" { "GET" } else { "POST" };
            let response = {
                let pending = pending.clone();
                move || async move {
                    pending.wait().await;
                    status
                }
            };
            let route = if method == "GET" {
                get(response)
            } else {
                post(response)
            };
            let old = Server::start(session_app('a').route(&format!("/api{path}"), route)).await;
            let new = Server::start(session_app('b')).await;
            let dir = tempfile::tempdir().unwrap();
            let client = Arc::new(Upstream::open(&dir.path().join("desktop.json")).unwrap());
            client.set_endpoint(&old.endpoint).unwrap();
            client
                .request(request("/auth/login", "POST"))
                .await
                .unwrap();
            let old_request = tokio::spawn({
                let client = client.clone();
                async move { client.request(request(path, method)).await }
            });
            pending.started().await;
            client.set_endpoint(&new.endpoint).unwrap();
            client
                .request(request("/auth/login", "POST"))
                .await
                .unwrap();
            pending.resume.notify_one();
            assert_eq!(
                old_request.await.unwrap().err().as_deref(),
                Some("request-rejected")
            );
            assert_session(&client, Some('b')).await;
        }
    }

    #[tokio::test]
    async fn an_unauthenticated_401_does_not_cancel_parallel_public_requests() {
        let pending = Pending::default();
        let server = Server::start(
            Router::new()
                .route(
                    "/api/auth/session",
                    get(|| async { StatusCode::UNAUTHORIZED }),
                )
                .route(
                    "/api/status",
                    get({
                        let pending = pending.clone();
                        move || async move {
                            pending.wait().await;
                            Json(serde_json::json!({"ok": true}))
                        }
                    }),
                ),
        )
        .await;
        let dir = tempfile::tempdir().unwrap();
        let client = Arc::new(Upstream::open(&dir.path().join("desktop.json")).unwrap());
        client.set_endpoint(&server.endpoint).unwrap();
        let status = tokio::spawn({
            let client = client.clone();
            async move { client.request(request("/status", "GET")).await }
        });
        pending.started().await;
        assert_eq!(
            client
                .request(request("/auth/session", "GET"))
                .await
                .unwrap()
                .status,
            401
        );
        pending.resume.notify_one();
        assert_eq!(status.await.unwrap().unwrap().status, 200);
    }

    #[tokio::test]
    async fn a_new_login_invalidates_old_responses_on_the_same_endpoint() {
        let pending = Pending::default();
        let server = Server::start(session_app('a').route(
            "/api/library",
            get({
                let pending = pending.clone();
                move || async move {
                    pending.wait().await;
                    StatusCode::UNAUTHORIZED
                }
            }),
        ))
        .await;
        let dir = tempfile::tempdir().unwrap();
        let client = Arc::new(Upstream::open(&dir.path().join("desktop.json")).unwrap());
        client.set_endpoint(&server.endpoint).unwrap();
        client
            .request(request("/auth/login", "POST"))
            .await
            .unwrap();
        let old_request = tokio::spawn({
            let client = client.clone();
            async move { client.request(request("/library", "GET")).await }
        });
        pending.started().await;
        // A slow request must not prevent a new login or another request from finishing.
        tokio::time::timeout(
            Duration::from_secs(5),
            client.request(request("/auth/login", "POST")),
        )
        .await
        .expect("a slow upstream request blocked login")
        .unwrap();
        pending.resume.notify_one();
        assert_eq!(
            old_request.await.unwrap().err().as_deref(),
            Some("request-rejected")
        );
        assert_session(&client, Some('a')).await;
    }

    #[test]
    fn endpoints_and_routes_do_not_allow_arbitrary_requests() {
        for invalid in [
            "http://example.com",
            "https://user:pass@example.com",
            "https://example.com/path",
            "https://example.com/?token=x",
            "file:///tmp/db",
        ] {
            assert!(endpoint(invalid).is_err(), "{invalid}");
        }
        assert_eq!(
            endpoint(" https://example.com/ ").unwrap(),
            "https://example.com"
        );
        assert!(endpoint("http://127.0.0.1:8080").is_ok());
        for (method, path) in [("GET", "/library/summary"), ("POST", "/library/attempts")] {
            assert!(allowed(&Request {
                path: path.into(),
                method: method.into(),
                body: None,
                content_type: None,
                user_id: None
            }));
        }
        for path in [
            "/plugins/leetcode",
            "/media/../auth/session",
            "//evil.test",
            "/media/x?token=x",
            "/media/%2e%2e",
            "/library/attempts",
            "/library/summary?user=another",
        ] {
            assert!(!allowed(&Request {
                path: path.into(),
                method: "GET".into(),
                body: None,
                content_type: None,
                user_id: None
            }));
        }
    }
    #[tokio::test]
    async fn keeps_session_in_native_memory_and_never_follows_redirects() {
        use axum::{
            Json, Router,
            http::HeaderMap,
            routing::{get, post},
        };
        let app = Router::new()
            .route(
                "/api/auth/login",
                post(|headers: HeaderMap| async move {
                    assert_eq!(headers["x-repeaty-session"], "bearer");
                    assert!(!headers.contains_key("cookie"));
                    Json(serde_json::json!({"token":"a".repeat(64),"user":{"username":"test"}}))
                }),
            )
            .route(
                "/api/auth/session",
                get(|headers: HeaderMap| async move {
                    assert_eq!(
                        headers["authorization"],
                        format!("Bearer {}", "a".repeat(64))
                    );
                    assert!(!headers.contains_key("cookie"));
                    Json(serde_json::json!({"user":{"username":"test"}}))
                }),
            )
            .route(
                "/api/library",
                get(|| async { axum::response::Redirect::temporary("https://example.com/stolen") }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let dir = tempfile::tempdir().unwrap();
        let client = Upstream::open(&dir.path().join("desktop.json")).unwrap();
        client.set_endpoint(&format!("http://{address}")).unwrap();
        let request = |path: &str, method: &str| Request {
            path: path.into(),
            method: method.into(),
            body: None,
            content_type: None,
            user_id: None,
        };
        let response = client
            .request(request("/auth/login", "POST"))
            .await
            .unwrap();
        let body = String::from_utf8(STANDARD.decode(response.body).unwrap()).unwrap();
        assert!(!body.contains("token"));
        client
            .request(request("/auth/session", "GET"))
            .await
            .unwrap();
        assert_eq!(
            client
                .request(request("/library", "GET"))
                .await
                .err()
                .unwrap(),
            "redirect-rejected"
        );
        client.set_endpoint("").unwrap();
        assert!(client.session.lock().unwrap().token.is_none());
        assert!(
            !std::fs::read_to_string(dir.path().join("desktop.json"))
                .unwrap()
                .contains("token")
        );
        task.abort();
    }
}
