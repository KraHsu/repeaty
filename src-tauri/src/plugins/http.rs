use super::{Permissions, Plugins, Result, secrets::Snapshot};
use reqwest::{
    Method, Url,
    header::{HeaderMap, HeaderName, HeaderValue},
};
use serde_json::{Value, json};

pub(super) fn origin(raw: &str) -> Result<String> {
    let url = Url::parse(raw).map_err(|_| "invalid-data")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || url.query().is_some()
        || url.path() != "/"
    {
        return Err("invalid-data".into());
    }
    Ok(url.origin().ascii_serialization())
}
fn render(template: &str, secret: &Snapshot) -> Result<String> {
    let mut output = String::new();
    let mut rest = template;
    while let Some(start) = rest.find("{{") {
        output.push_str(&rest[..start]);
        let end = rest[start + 2..].find("}}").ok_or("invalid-data")? + start + 2;
        let field = &rest[start + 2..end];
        output.push_str(secret.values.get(field).ok_or("invalid-data")?);
        rest = &rest[end + 2..];
    }
    output.push_str(rest);
    if output.len() > 32768 {
        return Err("plugin-limit".into());
    }
    Ok(output)
}
pub(super) struct Prepared {
    request: reqwest::RequestBuilder,
    plugin: String,
    slot: Option<String>,
    revision: Option<i64>,
}
pub(super) fn prepare(
    host: &Plugins,
    id: &str,
    permissions: &Permissions,
    payload: Value,
) -> Result<Prepared> {
    let url =
        Url::parse(payload["url"].as_str().ok_or("invalid-data")?).map_err(|_| "invalid-data")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || !permissions
            .origins
            .contains(&url.origin().ascii_serialization())
    {
        return Err("permission-denied".into());
    }
    let method = payload["method"].as_str().unwrap_or("GET");
    if !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].contains(&method) {
        return Err("invalid-data".into());
    }
    let mut headers = HeaderMap::new();
    if let Some(values) = payload.get("headers") {
        let values = values
            .as_object()
            .filter(|v| v.len() <= 64)
            .ok_or("invalid-data")?;
        for (name, value) in values {
            let name = HeaderName::from_bytes(name.as_bytes()).map_err(|_| "invalid-data")?;
            if [
                "host",
                "connection",
                "content-length",
                "proxy-authorization",
            ]
            .contains(&name.as_str())
            {
                return Err("permission-denied".into());
            }
            let value = value
                .as_str()
                .filter(|v| v.len() <= 32768)
                .ok_or("invalid-data")?;
            headers.insert(
                name,
                HeaderValue::from_str(value).map_err(|_| "invalid-data")?,
            );
        }
    }
    let mut slot = None;
    let mut revision = None;
    if let Some(secret) = payload.get("secret") {
        if !permissions.secrets {
            return Err("permission-denied".into());
        }
        let key = secret["slot"].as_str().ok_or("invalid-data")?;
        let snapshot = host
            .secrets
            .lock()
            .map_err(|_| "plugin-storage-error")?
            .snapshot(id, key)?
            .ok_or("credential-unavailable")?;
        if secret
            .get("expectedRevision")
            .is_some_and(|value| value.as_i64() != Some(snapshot.revision))
        {
            return Err("credentials-changed".into());
        }
        if snapshot.origin != url.origin().ascii_serialization() {
            return Err("permission-denied".into());
        }
        let templates = secret["headers"]
            .as_object()
            .filter(|v| v.len() <= 16)
            .ok_or("invalid-data")?;
        for (name, template) in templates {
            let name = HeaderName::from_bytes(name.as_bytes()).map_err(|_| "invalid-data")?;
            if [
                "host",
                "connection",
                "content-length",
                "proxy-authorization",
            ]
            .contains(&name.as_str())
            {
                return Err("permission-denied".into());
            }
            let value = render(template.as_str().ok_or("invalid-data")?, &snapshot)?;
            headers.insert(
                name,
                HeaderValue::from_str(&value).map_err(|_| "invalid-data")?,
            );
        }
        slot = Some(key.to_owned());
        revision = Some(snapshot.revision);
    }
    let mut request = host
        .client
        .request(
            Method::from_bytes(method.as_bytes()).map_err(|_| "invalid-data")?,
            url,
        )
        .headers(headers);
    if let Some(body) = payload.get("body") {
        request = request.body(
            body.as_str()
                .filter(|v| v.len() <= 1024 * 1024)
                .ok_or("invalid-data")?
                .to_owned(),
        );
    }
    Ok(Prepared {
        request,
        plugin: id.to_owned(),
        slot,
        revision,
    })
}
pub(super) async fn send(host: &Plugins, prepared: Prepared) -> Result<Value> {
    let mut response = prepared
        .request
        .send()
        .await
        .map_err(|_| "plugin-network-error")?;
    let status = response.status().as_u16();
    let mut headers = serde_json::Map::new();
    for (name, value) in response.headers() {
        if name.as_str() != "set-cookie"
            && let Ok(value) = value.to_str()
        {
            headers.insert(name.as_str().into(), Value::String(value.into()));
        }
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "plugin-network-error")? {
        if bytes.len() + chunk.len() > 1024 * 1024 {
            return Err("plugin-response-limit".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let current = prepared
        .slot
        .as_deref()
        .map(|slot| {
            host.secrets
                .lock()
                .map_err(|_| "plugin-storage-error")?
                .snapshot(&prepared.plugin, slot)
                .map(|snapshot| snapshot.map(|s| s.revision))
        })
        .transpose()?
        .flatten();
    Ok(
        json!({"status":status,"headers":headers,"body":String::from_utf8(bytes).map_err(|_|"invalid-response")?,"credentialRevision":prepared.revision,"currentCredentialRevision":current}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (tempfile::TempDir, Plugins, Permissions) {
        let directory = tempfile::tempdir().unwrap();
        let host = Plugins::new(directory.path()).unwrap();
        let permissions = Permissions {
            origins: vec!["https://example.org".into()],
            secrets: true,
            files: false,
        };
        host.secrets.lock().unwrap().operation("sample",&permissions,json!({"action":"set","slot":"account","origin":"https://example.org","values":{"session":"private","csrf":"token"}})).unwrap();
        (directory, host, permissions)
    }
    fn request() -> Value {
        json!({"url":"https://example.org/submit","method":"POST","headers":{"content-type":"application/json"},"body":"{}","secret":{"slot":"account","expectedRevision":1,"headers":{"cookie":"SESSION={{session}}; csrf={{csrf}}","x-csrf-token":"{{csrf}}"}}})
    }
    #[test]
    fn binds_secret_headers_to_declared_origin_and_expected_credential_revision() {
        let (_directory, host, permissions) = fixture();
        let request = prepare(&host, "sample", &permissions, request())
            .unwrap()
            .request
            .build()
            .unwrap();
        assert_eq!(request.headers()["cookie"], "SESSION=private; csrf=token");
        assert_eq!(request.headers()["x-csrf-token"], "token");
        assert_eq!(request.body().unwrap().as_bytes().unwrap(), b"{}");
        for url in [
            "http://example.org/",
            "https://evil.example/",
            "https://user@example.org/",
            "https://example.org/#secret",
        ] {
            let mut value = super::tests::request();
            value["url"] = json!(url);
            assert!(prepare(&host, "sample", &permissions, value).is_err());
        }
        let mut stale = super::tests::request();
        stale["secret"]["expectedRevision"] = json!(2);
        assert_eq!(
            prepare(&host, "sample", &permissions, stale).err().unwrap(),
            "credentials-changed"
        );
        assert_eq!(
            prepare(&host, "other", &permissions, super::tests::request())
                .err()
                .unwrap(),
            "credential-unavailable"
        );
        let mut invalid = super::tests::request();
        invalid["secret"]["headers"]["cookie"] = json!("{{missing}}");
        assert!(prepare(&host, "sample", &permissions, invalid).is_err());
        let mut invalid = super::tests::request();
        invalid["headers"]["host"] = json!("elsewhere");
        assert!(prepare(&host, "sample", &permissions, invalid).is_err());
        let mut denied = permissions.clone();
        denied.secrets = false;
        assert!(prepare(&host, "sample", &denied, super::tests::request()).is_err());
    }
    #[tokio::test]
    async fn in_flight_responses_keep_submission_ids_and_report_current_credential_revision() {
        let (_directory, host, permissions) = fixture();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let (arrived, waiting) = tokio::sync::oneshot::channel();
        let (resume, ready) = tokio::sync::oneshot::channel();
        let signal = std::sync::Arc::new(tokio::sync::Mutex::new(Some((arrived, ready))));
        let router = axum::Router::new().route(
            "/",
            axum::routing::get(move || {
                let signal = signal.clone();
                async move {
                    let (arrived, ready) = signal.lock().await.take().unwrap();
                    let _ = arrived.send(());
                    let _ = ready.await;
                    axum::response::Response::builder()
                        .header("set-cookie", "private=value")
                        .body(axum::body::Body::from("{\"submissionId\":42}"))
                        .unwrap()
                }
            }),
        );
        let server = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        let prepared = Prepared {
            request: host.client.get(format!("http://{addr}/")),
            plugin: "sample".into(),
            slot: Some("account".into()),
            revision: Some(1),
        };
        let cloned = host.clone();
        let response = tokio::spawn(async move { send(&cloned, prepared).await });
        waiting.await.unwrap();
        host.secrets.lock().unwrap().operation("sample",&permissions,json!({"action":"set","slot":"account","origin":"https://example.org","values":{"session":"replacement"}})).unwrap();
        resume.send(()).unwrap();
        let result = response.await.unwrap().unwrap();
        assert_eq!(result["body"], "{\"submissionId\":42}");
        assert_eq!(result["credentialRevision"], 1);
        assert_eq!(result["currentCredentialRevision"], 2);
        assert!(result["headers"].get("set-cookie").is_none());
        server.abort();
    }
    #[tokio::test]
    async fn response_body_limits_and_invalid_utf8_are_errors_without_automatic_retry() {
        let (_directory, host, _permissions) = fixture();
        for (body, error) in [
            (vec![b'x'; 1024 * 1024 + 1], "plugin-response-limit"),
            (vec![255], "invalid-response"),
        ] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            let router = axum::Router::new().route(
                "/",
                axum::routing::get(move || {
                    let body = body.clone();
                    async move { body }
                }),
            );
            let server = tokio::spawn(async move {
                axum::serve(listener, router).await.unwrap();
            });
            let prepared = Prepared {
                request: host.client.get(format!("http://{addr}/")),
                plugin: "sample".into(),
                slot: None,
                revision: None,
            };
            assert_eq!(send(&host, prepared).await.unwrap_err(), error);
            server.abort();
        }
    }
}
