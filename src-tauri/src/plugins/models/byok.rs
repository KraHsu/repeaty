//! OpenAI-compatible chat-completions transport. SSE fragments are bounded before JSON parsing.
use super::{Profile, Request, Result, Run, ToolCall};
use reqwest::{Client, Response, Url};
use serde_json::{Value, json};
use std::{collections::BTreeMap, time::Duration};

const FRAME_LIMIT: usize = 1024 * 1024;

pub(super) fn endpoint(raw: &str) -> Result<Url> {
    if raw.len() > 2048 {
        return Err("invalid-data".into());
    }
    let mut url = Url::parse(raw).map_err(|_| "invalid-data")?;
    let local =
        ["localhost", "127.0.0.1", "[::1]", "::1"].contains(&url.host_str().unwrap_or_default());
    if !(url.scheme() == "https" || url.scheme() == "http" && local)
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("invalid-data".into());
    }
    if !url.path().ends_with('/') {
        url.set_path(&format!("{}/", url.path()));
    }
    Ok(url)
}
fn client() -> Result<Client> {
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|_| "model-network-error".into())
}
fn status(response: &Response) -> Result<()> {
    if response.status().is_success() {
        return Ok(());
    }
    Err(match response.status().as_u16() {
        401 | 403 => "model-auth-required",
        404 => "model-endpoint-unavailable",
        429 => "model-rate-limited",
        300..=399 => "model-redirect-denied",
        400..=499 => "model-request-rejected",
        _ => "model-provider-error",
    }
    .into())
}
async fn limited_json(mut response: Response) -> Result<Value> {
    status(&response)?;
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "model-network-error")? {
        if body.len() + chunk.len() > FRAME_LIMIT {
            return Err("model-output-limit".into());
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body).map_err(|_| "model-invalid-response".into())
}
fn authorize(request: reqwest::RequestBuilder, key: Option<&str>) -> reqwest::RequestBuilder {
    if let Some(key) = key {
        request.bearer_auth(key)
    } else {
        request
    }
}
pub(super) async fn test(profile: &Profile, key: Option<&str>) -> Result<Value> {
    let url = endpoint(profile.endpoint.as_deref().ok_or("invalid-data")?)?
        .join("models")
        .map_err(|_| "invalid-data")?;
    let result = tokio::time::timeout(Duration::from_secs(20), async {
        let response = authorize(client()?.get(url), key)
            .send()
            .await
            .map_err(|_| "model-network-error")?;
        limited_json(response).await
    })
    .await
    .map_err(|_| "model-timeout")?;
    match result {
        Ok(value) => {
            let models = value["data"]
                .as_array()
                .ok_or("model-invalid-response")?
                .iter()
                .take(500)
                .filter_map(|row| {
                    row["id"]
                        .as_str()
                        .filter(|id| !id.is_empty() && id.len() <= 200)
                })
                .map(|id| json!({"id":id,"name":id}))
                .collect::<Vec<_>>();
            Ok(
                json!({"available":true,"authenticated":true,"models":models,"tools":"unknown","images":"unknown"}),
            )
        }
        Err(error) => Ok(
            json!({"available":false,"authenticated":false,"models":[],"tools":"unknown","images":"unknown","error":error}),
        ),
    }
}
fn request_body(profile: &Profile, request: &Request) -> Result<Value> {
    let model = request
        .model
        .as_ref()
        .or(profile.default_model.as_ref())
        .filter(|model| !model.is_empty())
        .ok_or("model-not-selected")?;
    let messages = request.messages.iter().map(|message| {
        let content = if message.images.is_empty() { json!(message.content) } else {
            let mut parts = vec![json!({"type":"text","text":message.content})];
            parts.extend(message.images.iter().map(|image| json!({"type":"image_url","image_url":{"url":format!("data:{};base64,{}", image.mime_type, image.base64)}})));
            Value::Array(parts)
        };
        let mut value = json!({"role":message.role,"content":content});
        if !message.tool_calls.is_empty() {
            value["tool_calls"] = json!(message.tool_calls.iter().map(|call| json!({"id":call.id,"type":"function","function":{"name":call.name,"arguments":call.arguments}})).collect::<Vec<_>>());
        }
        if let Some(id) = &message.tool_call_id { value["tool_call_id"] = json!(id); }
        value
    }).collect::<Vec<_>>();
    let mut body = json!({"model":model,"messages":messages,"stream":true,"stream_options":{"include_usage":true}});
    if !request.tools.is_empty() {
        body["tools"] = json!(request.tools.iter().map(|tool| json!({"type":"function","function":{"name":tool.name,"description":tool.description,"parameters":tool.input_schema}})).collect::<Vec<_>>());
    }
    Ok(body)
}

#[derive(Default)]
struct Fragment {
    id: String,
    name: String,
    arguments: String,
}
#[derive(Default)]
struct Stream {
    pending: Vec<u8>,
    data: String,
    calls: BTreeMap<u64, Fragment>,
    complete: bool,
    terminated: bool,
}
impl Stream {
    fn event(&mut self, run: &Run) -> Result<()> {
        if self.data.is_empty() {
            return Ok(());
        }
        let data = std::mem::take(&mut self.data);
        if data.trim() == "[DONE]" {
            self.complete = true;
            self.terminated = true;
            return Ok(());
        }
        let value: Value = serde_json::from_str(&data).map_err(|_| "model-invalid-response")?;
        if value.get("error").is_some() {
            return Err("model-provider-error".into());
        }
        if let Some(usage) = value.get("usage").filter(|usage| usage.is_object()) {
            run.emit(json!({"type":"usage","inputTokens":usage["prompt_tokens"].as_u64(),"outputTokens":usage["completion_tokens"].as_u64()}))?;
        }
        if let Some(choices) = value["choices"].as_array() {
            for choice in choices {
                if choice["index"].as_u64().unwrap_or(0) != 0 {
                    continue;
                }
                if let Some(text) = choice["delta"]["content"]
                    .as_str()
                    .filter(|text| !text.is_empty())
                {
                    run.emit(json!({"type":"delta","text":text}))?;
                }
                if let Some(calls) = choice["delta"]["tool_calls"].as_array() {
                    for call in calls {
                        let index = call["index"]
                            .as_u64()
                            .filter(|index| *index < 24)
                            .ok_or("model-invalid-response")?;
                        let fragment = self.calls.entry(index).or_default();
                        if let Some(id) = call["id"].as_str() {
                            fragment.id.push_str(id);
                        }
                        if let Some(name) = call["function"]["name"].as_str() {
                            fragment.name.push_str(name);
                        }
                        if let Some(arguments) = call["function"]["arguments"].as_str() {
                            fragment.arguments.push_str(arguments);
                        }
                        if fragment.id.len() > 200
                            || fragment.name.len() > 100
                            || fragment.arguments.len() > 512 * 1024
                        {
                            return Err("model-output-limit".into());
                        }
                    }
                }
                match choice["finish_reason"].as_str() {
                    Some("length") => return Err("model-output-truncated".into()),
                    Some("content_filter") => return Err("model-response-filtered".into()),
                    Some(_) => self.complete = true,
                    None => {}
                }
            }
        }
        Ok(())
    }
    fn push(&mut self, bytes: &[u8], run: &Run) -> Result<()> {
        // Consume lines incrementally instead of appending an arbitrarily large transport chunk.
        for byte in bytes {
            if *byte == b'\n' {
                let raw = std::mem::take(&mut self.pending);
                let line = std::str::from_utf8(&raw)
                    .map_err(|_| "model-invalid-response")?
                    .trim_end_matches('\r');
                if line.is_empty() {
                    self.event(run)?;
                } else if let Some(value) = line.strip_prefix("data:") {
                    if !self.data.is_empty() {
                        self.data.push('\n');
                    }
                    self.data.push_str(value.strip_prefix(' ').unwrap_or(value));
                    if self.data.len() > FRAME_LIMIT {
                        return Err("model-output-limit".into());
                    }
                }
            } else {
                if self.pending.len() >= FRAME_LIMIT {
                    return Err("model-output-limit".into());
                }
                self.pending.push(*byte);
            }
        }
        Ok(())
    }
    fn finish(mut self, request: &Request, run: &Run) -> Result<()> {
        if !self.pending.is_empty() {
            self.push(b"\n", run)?;
        }
        self.event(run)?;
        if !self.complete {
            return Err("model-stream-interrupted".into());
        }
        let mut ids = std::collections::HashSet::new();
        for fragment in self.calls.into_values() {
            if !super::identifier(&fragment.id)
                || !ids.insert(fragment.id.clone())
                || !request.tools.iter().any(|tool| tool.name == fragment.name)
                || !serde_json::from_str::<Value>(&fragment.arguments)
                    .is_ok_and(|value| value.is_object())
            {
                return Err("model-invalid-tool-call".into());
            }
            let call = ToolCall {
                id: fragment.id,
                name: fragment.name,
                arguments: fragment.arguments,
            };
            run.emit(json!({"type":"toolCall","call":call}))?;
        }
        Ok(())
    }
}
pub(super) async fn run(
    profile: &Profile,
    key: Option<&str>,
    request: Request,
    run: &Run,
) -> Result<()> {
    let url = endpoint(profile.endpoint.as_deref().ok_or("invalid-data")?)?
        .join("chat/completions")
        .map_err(|_| "invalid-data")?;
    let body = request_body(profile, &request)?;
    let mut response = authorize(
        client()?
            .post(url)
            .header("Accept", "text/event-stream")
            .json(&body),
        key,
    )
    .send()
    .await
    .map_err(|_| "model-network-error")?;
    status(&response)?;
    if !response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|header| header.to_str().ok())
        .is_some_and(|mime| {
            mime.split(';')
                .next()
                .is_some_and(|mime| mime.trim().eq_ignore_ascii_case("text/event-stream"))
        })
    {
        return Err("model-stream-unsupported".into());
    }
    let mut stream = Stream::default();
    let mut total = 0;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "model-stream-interrupted")?
    {
        total += chunk.len();
        if total > 16 * 1024 * 1024 {
            return Err("model-output-limit".into());
        }
        stream.push(&chunk, run)?;
        if stream.terminated {
            break;
        }
    }
    stream.finish(&request, run)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    fn request() -> Request {
        serde_json::from_value(json!({"profileId":"profile","requestId":"run","messages":[{"role":"user","content":"你好","images":[{"mimeType":"image/png","base64":"aW1hZ2U="}]}],"tools":[{"name":"query","description":"read","inputSchema":{"type":"object"}}]})).unwrap()
    }
    #[test]
    fn endpoints_require_https_except_explicit_loopback_and_no_embedded_credentials() {
        for address in [
            "https://api.example.com/v1",
            "http://127.0.0.1:8000/v1",
            "http://localhost:8000/v1",
            "http://[::1]:8000/v1",
        ] {
            assert!(endpoint(address).is_ok());
        }
        for address in [
            "http://example.com/v1",
            "https://user:secret@example.com/v1",
            "https://example.com/v1?token=private",
            "file:///etc/passwd",
        ] {
            assert!(endpoint(address).is_err());
        }
    }
    #[test]
    fn handles_fragmented_utf8_sse_function_arguments_and_usage_without_losing_text() {
        let run = Run::new();
        let mut stream = Stream::default();
        let events = format!(
            "data: {}\r\n\r\ndata: {}\n\ndata: {}\n\ndata: [DONE]\n\n",
            json!({"choices":[{"delta":{"content":"你好","tool_calls":[{"index":0,"id":"call-1","function":{"name":"query","arguments":"{\"kind\":"}}]}}]}),
            json!({"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"library\"}"}}]},"finish_reason":"tool_calls"}]}),
            json!({"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":4}})
        );
        for byte in events.bytes() {
            stream.push(&[byte], &run).unwrap();
        }
        stream.finish(&request(), &run).unwrap();
        run.finish(Ok(()));
        let result = run.poll(0).unwrap();
        assert_eq!(result["reply"]["text"], "你好");
        assert_eq!(
            result["reply"]["toolCalls"][0]["arguments"],
            "{\"kind\":\"library\"}"
        );
        assert!(
            result["events"]
                .as_array()
                .unwrap()
                .iter()
                .any(|event| event["type"] == "usage")
        );
    }
    #[test]
    fn interruption_and_unregistered_tools_are_errors_and_keep_partial_output() {
        let run = Run::new();
        let mut stream = Stream::default();
        stream
            .push(
                b"data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n",
                &run,
            )
            .unwrap();
        assert_eq!(
            stream.finish(&request(), &run).unwrap_err(),
            "model-stream-interrupted"
        );
        let mut stream = Stream::default();
        let event = format!(
            "data: {}\n\ndata: [DONE]\n\n",
            json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"shell","arguments":"{}"}}]}}]})
        );
        stream.push(event.as_bytes(), &run).unwrap();
        assert_eq!(
            stream.finish(&request(), &run).unwrap_err(),
            "model-invalid-tool-call"
        );
        run.finish(Err("model-stream-interrupted".into()));
        assert_eq!(run.poll(0).unwrap()["reply"]["text"], "partial");
    }
    #[test]
    fn request_includes_multimodal_messages_and_explicit_function_schemas() {
        let profile = Profile {
            id: "profile".into(),
            name: "test".into(),
            kind: "openai-compatible".into(),
            endpoint: Some("https://api.example.com/v1/".into()),
            executable: None,
            default_model: Some("chosen-model".into()),
        };
        let body = request_body(&profile, &request()).unwrap();
        assert_eq!(body["model"], "chosen-model");
        assert_eq!(
            body["messages"][0]["content"][1]["image_url"]["url"],
            "data:image/png;base64,aW1hZ2U="
        );
        assert_eq!(body["tools"][0]["function"]["parameters"]["type"], "object");
    }
    #[tokio::test]
    async fn real_http_sse_uses_bearer_auth_streams_images_and_rejects_redirects() {
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut connection, _) = listener.accept().await.unwrap();
            let mut received = Vec::new();
            let mut buffer = [0; 1024];
            let mut header_end = None;
            let mut content_length = 0;
            loop {
                let count = connection.read(&mut buffer).await.unwrap();
                assert_ne!(count, 0);
                received.extend_from_slice(&buffer[..count]);
                if header_end.is_none()
                    && let Some(end) = received.windows(4).position(|window| window == b"\r\n\r\n")
                {
                    let header = String::from_utf8_lossy(&received[..end]).to_lowercase();
                    assert!(header.contains("authorization: bearer private-test-key"));
                    content_length = header
                        .lines()
                        .find_map(|line| line.strip_prefix("content-length: "))
                        .unwrap()
                        .parse::<usize>()
                        .unwrap();
                    header_end = Some(end + 4);
                }
                if header_end.is_some_and(|end| received.len() >= end + content_length) {
                    break;
                }
            }
            let body: Value = serde_json::from_slice(&received[header_end.unwrap()..]).unwrap();
            assert_eq!(body["messages"][0]["content"][1]["type"], "image_url");
            let content = format!(
                "data: {}\n\ndata: [DONE]\n\n",
                json!({"choices":[{"delta":{"content":"真实流"},"finish_reason":"stop"}]})
            );
            connection.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",content.len(),content).as_bytes()).await.unwrap();
            let (mut connection, _) = listener.accept().await.unwrap();
            let _ = connection.read(&mut buffer).await.unwrap();
            connection.write_all(b"HTTP/1.1 307 Temporary Redirect\r\nLocation: https://example.invalid/steal\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await.unwrap();
        });
        let profile = Profile {
            id: "profile".into(),
            name: "test".into(),
            kind: "openai-compatible".into(),
            endpoint: Some(format!("http://{address}/v1/")),
            executable: None,
            default_model: Some("chosen".into()),
        };
        let stream = Run::new();
        run(&profile, Some("private-test-key"), request(), &stream)
            .await
            .unwrap();
        stream.finish(Ok(()));
        assert_eq!(stream.poll(0).unwrap()["reply"]["text"], "真实流");
        let tested = test(&profile, Some("private-test-key")).await.unwrap();
        assert_eq!(tested["error"], "model-redirect-denied");
        assert_eq!(tested["available"], false);
        server.await.unwrap();
    }
}
