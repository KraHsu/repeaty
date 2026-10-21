use base64::{Engine, engine::general_purpose::STANDARD};
use reqwest::{Client, Url, redirect::Policy};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::{Mutex, RwLock},
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
    config: RwLock<Config>,
    path: PathBuf,
    client: Client,
    token: Mutex<Option<String>>,
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
            config: RwLock::new(config),
            path: path.to_owned(),
            client: Client::builder()
                .timeout(Duration::from_secs(60))
                .redirect(Policy::none())
                .build()?,
            token: Mutex::new(None),
        })
    }
    pub fn config(&self) -> Config {
        self.config
            .read()
            .map(|config| config.clone())
            .unwrap_or_default()
    }
    pub fn endpoint(&self) -> String {
        self.config
            .read()
            .map(|config| config.endpoint.clone())
            .unwrap_or_default()
    }
    pub fn set_endpoint(&self, value: &str) -> Result<(), String> {
        let config = Config {
            endpoint: endpoint(value)?,
        };
        let bytes = serde_json::to_vec(&config).map_err(|_| "storage-error")?;
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
        *self.config.write().map_err(|_| "storage-error")? = config;
        *self.token.lock().map_err(|_| "storage-error")? = None;
        Ok(())
    }
    pub async fn request(&self, request: Request) -> Result<Response, String> {
        let endpoint = self.endpoint();
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
        if let Some(token) = self.token.lock().map_err(|_| "storage-error")?.as_ref() {
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
        if auth && (200..300).contains(&status) {
            let mut value: serde_json::Value =
                serde_json::from_slice(&body).map_err(|_| "invalid-data")?;
            let token = value
                .as_object_mut()
                .and_then(|v| v.remove("token"))
                .and_then(|v| v.as_str().map(str::to_owned))
                .filter(|t| t.len() == 64 && t.bytes().all(|b| b.is_ascii_hexdigit()))
                .ok_or("invalid-data")?;
            *self.token.lock().map_err(|_| "storage-error")? = Some(token);
            body = serde_json::to_vec(&value).map_err(|_| "invalid-data")?;
        }
        if status == 401
            || (matches!(request.path.as_str(), "/auth/logout" | "/auth/password")
                && (200..300).contains(&status))
        {
            *self.token.lock().map_err(|_| "storage-error")? = None;
        }
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
        assert!(client.token.lock().unwrap().is_none());
        assert!(
            !std::fs::read_to_string(dir.path().join("desktop.json"))
                .unwrap()
                .contains("token")
        );
        task.abort();
    }
}
