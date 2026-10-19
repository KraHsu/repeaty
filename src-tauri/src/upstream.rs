use base64::{Engine, engine::general_purpose::STANDARD};
use reqwest::{Client, Url, redirect::Policy};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
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
    pub config: Config,
    path: PathBuf,
    client: Client,
    token: Option<String>,
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
        let config = if path.exists() {
            serde_json::from_slice::<Config>(&std::fs::read(path)?)?
        } else {
            Config::default()
        };
        endpoint(&config.endpoint)?;
        Ok(Self {
            config,
            path: path.to_owned(),
            client: Client::builder()
                .timeout(Duration::from_secs(60))
                .redirect(Policy::none())
                .build()?,
            token: None,
        })
    }
    pub fn set_endpoint(&mut self, value: &str) -> Result<(), String> {
        let config = Config {
            endpoint: endpoint(value)?,
        };
        let bytes = serde_json::to_vec(&config).map_err(|_| "storage-error")?;
        let temp = self.path.with_extension("tmp");
        std::fs::write(&temp, bytes)
            .and_then(|_| std::fs::rename(temp, &self.path))
            .map_err(|_| "storage-error")?;
        self.config = config;
        self.token = None;
        Ok(())
    }
    pub async fn request(&mut self, request: Request) -> Result<Response, String> {
        if !allowed(&request) || self.config.endpoint.is_empty() {
            return Err("request-rejected".into());
        }
        let method = reqwest::Method::from_bytes(request.method.as_bytes())
            .map_err(|_| "request-rejected")?;
        let auth = matches!(request.path.as_str(), "/auth/login" | "/auth/register");
        let mut outgoing = self
            .client
            .request(
                method,
                format!("{}/api{}", self.config.endpoint, request.path),
            )
            .header("X-Repeaty-Client", "1");
        if let Some(id) = request.user_id {
            outgoing = outgoing.header("X-Repeaty-User", id);
        }
        if auth {
            outgoing = outgoing.header("X-Repeaty-Session", "bearer");
        }
        if let Some(token) = &self.token {
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
            self.token = Some(token);
            body = serde_json::to_vec(&value).map_err(|_| "invalid-data")?;
        }
        if status == 401
            || (matches!(request.path.as_str(), "/auth/logout" | "/auth/password")
                && (200..300).contains(&status))
        {
            self.token = None;
        }
        Ok(Response {
            status,
            content_type,
            body: STANDARD.encode(body),
        })
    }
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
        let mut client = Upstream::open(&dir.path().join("desktop.json")).unwrap();
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
        assert!(client.token.is_none());
        assert!(
            !std::fs::read_to_string(dir.path().join("desktop.json"))
                .unwrap()
                .contains("token")
        );
        task.abort();
    }
}
