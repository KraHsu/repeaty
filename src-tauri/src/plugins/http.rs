use super::{Permissions, Plugins, Result, secrets::Snapshot};
use base64::{Engine as _, engine::general_purpose::STANDARD};
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
const BODY_LIMIT: usize = 32 * 1024 * 1024;
const PART_LIMIT: usize = 25 * 1024 * 1024;
const RESPONSE_LIMIT: usize = 8 * 1024 * 1024;
fn render(template: &str, secret: &Snapshot, xml: bool) -> Result<String> {
    let mut output = String::new();
    let limit = if xml { BODY_LIMIT } else { 32768 };
    let append = |output: &mut String, value: &str| -> Result<()> {
        if output
            .len()
            .checked_add(value.len())
            .is_none_or(|length| length > limit)
        {
            return Err("plugin-limit".into());
        }
        output.push_str(value);
        Ok(())
    };
    let mut rest = template;
    while let Some(start) = rest.find("{{") {
        append(&mut output, &rest[..start])?;
        let end = rest[start + 2..].find("}}").ok_or("invalid-data")? + start + 2;
        let field = &rest[start + 2..end];
        let value = secret.values.get(field).ok_or("invalid-data")?;
        if xml {
            append(
                &mut output,
                &value
                    .replace('&', "&amp;")
                    .replace('<', "&lt;")
                    .replace('>', "&gt;")
                    .replace('"', "&quot;")
                    .replace('\'', "&apos;"),
            )?;
        } else {
            append(&mut output, value)?;
        }
        rest = &rest[end + 2..];
    }
    append(&mut output, rest)?;
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
    let mut secret_body = None;
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
        if let Some(templates) = secret.get("headers") {
            for (name, template) in templates
                .as_object()
                .filter(|v| v.len() <= 16)
                .ok_or("invalid-data")?
            {
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
                let value = render(template.as_str().ok_or("invalid-data")?, &snapshot, false)?;
                headers.insert(
                    name,
                    HeaderValue::from_str(&value).map_err(|_| "invalid-data")?,
                );
            }
        }
        if let Some(body) = secret.get("body") {
            if body["encoding"].as_str() != Some("xml")
                || payload.get("body").is_some_and(|v| !v.is_null())
            {
                return Err("invalid-data".into());
            }
            let template = body["template"]
                .as_str()
                .filter(|v| v.len() <= BODY_LIMIT)
                .ok_or("plugin-limit")?;
            secret_body = Some(render(template, &snapshot, true)?);
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
        .headers(headers)
        .timeout(std::time::Duration::from_secs(60));
    if let Some(body) = secret_body {
        request = request.body(body);
    } else if let Some(body) = payload.get("body").filter(|v| !v.is_null()) {
        if let Some(text) = body.as_str() {
            if text.len() > BODY_LIMIT {
                return Err("plugin-limit".into());
            }
            request = request.body(text.to_owned());
        } else if let Some(value) = body.get("base64") {
            request = request.body(decode(value, BODY_LIMIT)?);
        } else if let Some(parts) = body.get("multipart") {
            let parts = parts
                .as_array()
                .filter(|v| !v.is_empty() && v.len() <= 256)
                .ok_or("invalid-data")?;
            let mut form = reqwest::multipart::Form::new();
            let mut total = 0;
            for part in parts {
                let name = part["name"]
                    .as_str()
                    .filter(|v| !v.is_empty() && v.len() <= 200 && !v.chars().any(char::is_control))
                    .ok_or("invalid-data")?;
                let value = if let Some(text) = part.get("text") {
                    if part.get("base64").is_some() {
                        return Err("invalid-data".into());
                    }
                    let text = text
                        .as_str()
                        .filter(|v| v.len() <= PART_LIMIT)
                        .ok_or("plugin-limit")?;
                    total += text.len();
                    reqwest::multipart::Part::text(text.to_owned())
                } else {
                    let bytes = decode(&part["base64"], PART_LIMIT)?;
                    total += bytes.len();
                    let name = part["filename"]
                        .as_str()
                        .filter(|v| {
                            !v.is_empty()
                                && v.len() <= 240
                                && !v.chars().any(|c| c.is_control() || matches!(c, '/' | '\\'))
                        })
                        .ok_or("invalid-data")?;
                    let mime = part["type"]
                        .as_str()
                        .filter(|v| v.len() <= 120)
                        .ok_or("invalid-data")?;
                    reqwest::multipart::Part::bytes(bytes)
                        .file_name(name.to_owned())
                        .mime_str(mime)
                        .map_err(|_| "invalid-data")?
                };
                // Reserve bounded space for generated MIME framing.
                total += 1024;
                if total > BODY_LIMIT {
                    return Err("plugin-limit".into());
                }
                form = form.part(name.to_owned(), value);
            }
            request = request.multipart(form);
        } else {
            return Err("invalid-data".into());
        }
    }
    Ok(Prepared {
        request,
        plugin: id.to_owned(),
        slot,
        revision,
    })
}
fn decode(value: &Value, limit: usize) -> Result<Vec<u8>> {
    let encoded = value
        .as_str()
        .filter(|v| v.len() <= limit.div_ceil(3) * 4)
        .ok_or("plugin-limit")?;
    let bytes = STANDARD.decode(encoded).map_err(|_| "invalid-data")?;
    if bytes.len() > limit {
        return Err("plugin-limit".into());
    }
    Ok(bytes)
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
        if bytes.len() + chunk.len() > RESPONSE_LIMIT {
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
    use std::sync::Arc;
    fn fixture() -> (tempfile::TempDir, Plugins, Permissions) {
        let directory = tempfile::tempdir().unwrap();
        let host = Plugins::new(directory.path()).unwrap();
        let permissions = Permissions {
            origins: vec!["https://example.org".into()],
            secrets: true,
            files: false,
            models: false,
            network: false,
        };
        host.secrets.lock().unwrap().operation("sample",&permissions,json!({"action":"set","slot":"account","origin":"https://example.org","values":{"session":"private","csrf":"token"}})).unwrap();
        (directory, host, permissions)
    }
    fn request() -> Value {
        json!({"url":"https://example.org/submit","method":"POST","headers":{"content-type":"application/json"},"body":"{}","secret":{"slot":"account","expectedRevision":1,"headers":{"cookie":"SESSION={{session}}; csrf={{csrf}}","x-csrf-token":"{{csrf}}"}}})
    }
    #[test]
    fn credential_rendering_stops_at_each_output_budget_before_later_placeholders() {
        let secret = Snapshot {
            revision: 1,
            origin: "https://example.org".into(),
            values: std::collections::BTreeMap::from([("password".into(), "x".repeat(8192))]),
        };
        for (xml, limit) in [(false, 32768), (true, BODY_LIMIT)] {
            let exact = "{{password}}".repeat(limit / 8192);
            assert_eq!(render(&exact, &secret, xml).unwrap().len(), limit);
            // If interpolation continues past the budget this would instead be invalid-data.
            for overflow in [
                format!("{exact}{{{{password}}}}{{{{missing}}}}"),
                format!("{exact}x{{{{missing}}}}"),
                format!("{exact}x"),
            ] {
                assert_eq!(render(&overflow, &secret, xml).unwrap_err(), "plugin-limit");
            }
        }
    }
    #[test]
    fn xml_credential_budget_counts_escaped_bytes() {
        let secret = Snapshot {
            revision: 1,
            origin: "https://example.org".into(),
            values: std::collections::BTreeMap::from([("password".into(), "&".repeat(8192))]),
        };
        let template = format!(
            "{}{{{{missing}}}}",
            "{{password}}".repeat(BODY_LIMIT / (8192 * "&amp;".len()) + 1)
        );
        assert_eq!(
            render(&template, &secret, true).unwrap_err(),
            "plugin-limit"
        );
    }
    #[test]
    fn xml_credentials_are_escaped_without_exposing_or_mixing_secret_snapshots() {
        let (_directory, host, permissions) = fixture();
        host.secrets.lock().unwrap().operation("sample", &permissions, json!({"action":"set","slot":"account","origin":"https://example.org","values":{"password":"<&>\"'"}})).unwrap();
        let value = json!({"url":"https://example.org/xmlrpc.php","method":"POST","secret":{"slot":"account","expectedRevision":2,"body":{"template":"<string>{{password}}</string>","encoding":"xml"}}});
        let request = prepare(&host, "sample", &permissions, value.clone())
            .unwrap()
            .request
            .build()
            .unwrap();
        assert_eq!(
            request.body().unwrap().as_bytes().unwrap(),
            b"<string>&lt;&amp;&gt;&quot;&apos;</string>"
        );
        let mut conflicting = value.clone();
        conflicting["body"] = json!("body");
        assert!(prepare(&host, "sample", &permissions, conflicting).is_err());
        let mut other_encoding = value;
        other_encoding["secret"]["body"]["encoding"] = json!("raw");
        assert!(prepare(&host, "sample", &permissions, other_encoding).is_err());
        let binary = prepare(
            &host,
            "sample",
            &permissions,
            json!({"url":"https://example.org/upload","method":"POST","body":{"base64":"AP+A"}}),
        )
        .unwrap()
        .request
        .build()
        .unwrap();
        assert_eq!(binary.body().unwrap().as_bytes().unwrap(), &[0, 255, 128]);
    }
    #[tokio::test]
    async fn multipart_upload_uses_binary_bytes_and_bounds_fields_and_paths() {
        let (_directory, host, permissions) = fixture();
        let value = json!({"url":"https://example.org/upload","method":"POST","body":{"multipart":[{"name":"manifest","text":"{\"中文\":1}"},{"name":"file","filename":"image.png","type":"image/png","base64":"AP+A"}]}});
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (send, receive) = tokio::sync::oneshot::channel();
        let send = Arc::new(tokio::sync::Mutex::new(Some(send)));
        let server = tokio::spawn(async move {
            let router = axum::Router::new().route(
                "/",
                axum::routing::post(move |request: axum::extract::Request| {
                    let send = send.clone();
                    async move {
                        let body = axum::body::to_bytes(request.into_body(), 1024 * 1024)
                            .await
                            .unwrap();
                        send.lock()
                            .await
                            .take()
                            .unwrap()
                            .send(body.to_vec())
                            .unwrap();
                        "ok"
                    }
                }),
            );
            axum::serve(listener, router).await.unwrap();
        });
        let mut request = prepare(&host, "sample", &permissions, value.clone())
            .unwrap()
            .request
            .build()
            .unwrap();
        *request.url_mut() = Url::parse(&format!("http://{address}/")).unwrap();
        assert!(
            host.client
                .execute(request)
                .await
                .unwrap()
                .status()
                .is_success()
        );
        let bytes = receive.await.unwrap();
        assert!(bytes.windows(3).any(|bytes| bytes == [0, 255, 128]));
        assert!(String::from_utf8_lossy(&bytes).contains("{\"中文\":1}"));
        server.abort();
        let mut invalid = value.clone();
        invalid["body"]["multipart"][1]["filename"] = json!("../image.png");
        assert!(prepare(&host, "sample", &permissions, invalid).is_err());
        let mut mixed = value;
        mixed["body"]["multipart"][0]["base64"] = json!("eA==");
        assert!(prepare(&host, "sample", &permissions, mixed).is_err());
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
            (vec![b'x'; RESPONSE_LIMIT + 1], "plugin-response-limit"),
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
