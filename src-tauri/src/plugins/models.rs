//! Device-local model providers. Plugins receive bounded events, never provider credentials.
mod byok;
mod codex;
use super::{Result, secrets::Secrets};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    path::Path,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio_util::sync::CancellationToken;

const MAX_INPUT: usize = 16 * 1024 * 1024;
const MAX_EVENTS: usize = 8192;
const MAX_OUTPUT: usize = 4 * 1024 * 1024;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Profile {
    pub id: String,
    pub name: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executable: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_model: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProfileInput {
    id: Option<String>,
    name: String,
    kind: String,
    endpoint: Option<String>,
    executable: Option<String>,
    default_model: Option<String>,
    api_key: Option<String>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Tool {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Image {
    pub mime_type: String,
    pub base64: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Message {
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub images: Vec<Image>,
    #[serde(default)]
    pub tool_calls: Vec<ToolCall>,
    pub tool_call_id: Option<String>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Request {
    pub profile_id: String,
    pub request_id: String,
    pub model: Option<String>,
    pub thread_id: Option<String>,
    pub messages: Vec<Message>,
    pub tools: Vec<Tool>,
}
#[derive(Clone, PartialEq, Eq, Hash)]
pub(super) struct Binding {
    pub token: String,
    pub plugin: String,
    pub activation: String,
}
impl Binding {
    pub fn key(&self) -> String {
        format!("{}\0{}\0{}", self.token, self.plugin, self.activation)
    }
}

#[derive(Default)]
struct RunState {
    events: Vec<Value>,
    bytes: usize,
    text: String,
    calls: Vec<ToolCall>,
    thread: Option<String>,
    done: bool,
}
pub(super) struct Run {
    pub cancel: CancellationToken,
    state: Mutex<RunState>,
    created: Instant,
}
impl Run {
    fn new() -> Self {
        Self {
            cancel: CancellationToken::new(),
            state: Mutex::new(RunState::default()),
            created: Instant::now(),
        }
    }
    pub fn emit(&self, event: Value) -> Result<()> {
        let bytes = serde_json::to_vec(&event)
            .map_err(|_| "model-invalid-response")?
            .len();
        let mut state = self.state.lock().map_err(|_| "model-failed")?;
        if state.done || self.cancel.is_cancelled() {
            return Err("model-cancelled".into());
        }
        if state.bytes + bytes > MAX_OUTPUT || state.events.len() >= MAX_EVENTS {
            return Err("model-output-limit".into());
        }
        match event["type"].as_str() {
            Some("delta") => state
                .text
                .push_str(event["text"].as_str().ok_or("model-invalid-response")?),
            Some("toolCall") => state.calls.push(
                serde_json::from_value(event["call"].clone())
                    .map_err(|_| "model-invalid-response")?,
            ),
            Some("thread") => state.thread = event["threadId"].as_str().map(str::to_owned),
            _ => {}
        }
        state.bytes += bytes;
        state.events.push(event);
        Ok(())
    }
    pub fn finish(&self, result: Result<()>) {
        if let Ok(mut state) = self.state.lock()
            && !state.done
        {
            if let Err(code) = result {
                state
                    .events
                    .push(json!({"type":"error","code":code,"message":code}));
            }
            state.done = true;
        }
    }
    pub fn tool_responded(&self, id: &str) {
        if let Ok(mut state) = self.state.lock() {
            state.calls.retain(|call| call.id != id);
        }
    }
    fn poll(&self, cursor: usize) -> Result<Value> {
        let state = self.state.lock().map_err(|_| "model-failed")?;
        if cursor > state.events.len() {
            return Err("invalid-data".into());
        }
        let end = (cursor + 128).min(state.events.len());
        let mut value = json!({"cursor":end,"events":state.events[cursor..end],"done":state.done && end == state.events.len()});
        if state.done && end == state.events.len() {
            value["reply"] =
                json!({"text":state.text,"toolCalls":state.calls,"threadId":state.thread});
        }
        Ok(value)
    }
}

struct OwnedRun {
    binding: Binding,
    profile: String,
    run: Arc<Run>,
}
#[derive(Default)]
struct ProfileLifecycle {
    retiring: HashSet<String>,
    active: HashMap<String, CancellationToken>,
}
struct OwnedShortCall {
    binding: Binding,
    cancel: CancellationToken,
}
struct ShortCall<'a> {
    models: &'a Models,
    id: String,
    cancel: CancellationToken,
}
impl Drop for ShortCall<'_> {
    fn drop(&mut self) {
        if let Ok(mut calls) = self.models.short_calls.lock() {
            calls.remove(&self.id);
        }
    }
}
pub(super) struct Models {
    secrets: Arc<Mutex<Secrets>>,
    runs: Mutex<HashMap<String, OwnedRun>>,
    disposed: Mutex<HashSet<String>>,
    lifecycle: Mutex<ProfileLifecycle>,
    short_calls: Mutex<HashMap<String, OwnedShortCall>>,
    codex: codex::Manager,
}
impl Models {
    pub fn new(directory: &Path, secrets: Arc<Mutex<Secrets>>) -> Result<Self> {
        Ok(Self {
            secrets,
            runs: Mutex::new(HashMap::new()),
            disposed: Mutex::new(HashSet::new()),
            lifecycle: Mutex::new(ProfileLifecycle::default()),
            short_calls: Mutex::new(HashMap::new()),
            codex: codex::Manager::new(directory.join("models"))?,
        })
    }
    fn profile(&self, id: &str) -> Result<(Profile, Option<String>)> {
        if !identifier(id) {
            return Err("invalid-data".into());
        }
        let snapshot = self
            .secrets
            .lock()
            .map_err(|_| "model-storage-error")?
            .snapshot("@models", id)?
            .ok_or("model-profile-missing")?;
        let profile = serde_json::from_str(
            snapshot
                .values
                .get("profile")
                .ok_or("model-storage-error")?,
        )
        .map_err(|_| "model-storage-error")?;
        Ok((profile, snapshot.values.get("apiKey").cloned()))
    }
    fn public_profile(profile: &Profile, has_key: bool) -> Value {
        let mut value = serde_json::to_value(profile).expect("profile serialization");
        value["hasCredential"] = json!(has_key);
        value
    }
    fn profiles(&self) -> Result<Value> {
        let slots = self
            .secrets
            .lock()
            .map_err(|_| "model-storage-error")?
            .model_slots()?;
        slots
            .iter()
            .map(|id| {
                self.profile(id)
                    .map(|(profile, key)| Self::public_profile(&profile, key.is_some()))
            })
            .collect::<Result<Vec<_>>>()
            .map(Value::Array)
    }
    fn save(&self, input: Value) -> Result<Value> {
        let mut lifecycle = self.lifecycle.lock().map_err(|_| "model-failed")?;
        let input: ProfileInput = serde_json::from_value(input).map_err(|_| "invalid-data")?;
        let id = input.id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        if lifecycle.retiring.contains(&id) {
            return Err("model-profile-busy".into());
        }
        if !identifier(&id)
            || input.name.trim().is_empty()
            || input.name.len() > 120
            || input.default_model.as_ref().is_some_and(|model| {
                model.is_empty() || model.len() > 200 || model.chars().any(char::is_control)
            })
        {
            return Err("invalid-data".into());
        }
        let endpoint = match input.kind.as_str() {
            "openai-compatible" => {
                Some(byok::endpoint(input.endpoint.as_deref().ok_or("invalid-data")?)?.to_string())
            }
            "codex" => None,
            _ => return Err("invalid-data".into()),
        };
        let executable = if input.kind == "codex" {
            input
                .executable
                .filter(|path| !path.is_empty())
                .map(|path| {
                    codex::resolve_executable(Some(&path))
                        .map(|path| path.to_string_lossy().into_owned())
                })
                .transpose()?
        } else {
            None
        };
        let previous = self.profile(&id).ok();
        let key = match input.api_key {
            Some(value) if value.is_empty() => None,
            Some(value) if value.len() <= 8192 && !value.chars().any(char::is_control) => {
                Some(value)
            }
            Some(_) => return Err("invalid-data".into()),
            None => previous.and_then(|(profile, key)| {
                if profile.endpoint == endpoint && profile.kind == input.kind {
                    key
                } else {
                    None
                }
            }),
        };
        if input.kind == "codex" && key.is_some() {
            return Err("invalid-data".into());
        }
        let profile = Profile {
            id: id.clone(),
            name: input.name.trim().into(),
            kind: input.kind,
            endpoint,
            executable,
            default_model: input.default_model,
        };
        let mut values = BTreeMap::from([(
            "profile".into(),
            serde_json::to_string(&profile).map_err(|_| "invalid-data")?,
        )]);
        if let Some(key) = &key {
            values.insert("apiKey".into(), key.clone());
        }
        self.secrets
            .lock()
            .map_err(|_| "model-storage-error")?
            .save_model(&id, Some(values))?;
        if let Some(active) = lifecycle.active.remove(&id) {
            active.cancel();
        }
        self.cancel_profile(&id);
        Ok(Self::public_profile(&profile, key.is_some()))
    }
    fn cancel_profile(&self, id: &str) {
        if let Ok(runs) = self.runs.lock() {
            for value in runs.values().filter(|run| run.profile == id) {
                value.run.cancel.cancel();
            }
        }
        self.codex.remove_profile(id);
    }
    fn owned_run(&self, binding: &Binding, id: &str) -> Result<Arc<Run>> {
        self.runs
            .lock()
            .map_err(|_| "model-failed")?
            .get(id)
            .filter(|run| &run.binding == binding)
            .map(|value| value.run.clone())
            .ok_or_else(|| "model-request-missing".into())
    }
    fn register_run(&self, id: String, value: OwnedRun) -> Result<()> {
        let disposed = self.disposed.lock().map_err(|_| "model-failed")?;
        if disposed.len() >= 4096 || disposed.contains(&value.binding.key()) {
            return Err("model-activation-ended".into());
        }
        let mut runs = self.runs.lock().map_err(|_| "model-failed")?;
        runs.retain(|_, value| value.run.created.elapsed() < Duration::from_secs(900));
        if runs.contains_key(&id) {
            return Err("model-request-conflict".into());
        }
        if runs
            .values()
            .filter(|run| !run.run.state.lock().unwrap().done)
            .count()
            >= 4
        {
            return Err("model-run-limit".into());
        }
        while runs.len() >= 32 {
            let oldest = runs
                .iter()
                .filter(|(_, value)| value.run.state.lock().unwrap().done)
                .min_by_key(|(_, value)| value.run.created)
                .map(|(id, _)| id.clone())
                .ok_or("model-run-limit")?;
            runs.remove(&oldest);
        }
        runs.insert(id, value);
        Ok(())
    }
    fn short_call(&self, binding: &Binding) -> Result<ShortCall<'_>> {
        // Keep registration atomic with activation tombstones, just like stream runs.
        let disposed = self.disposed.lock().map_err(|_| "model-failed")?;
        if disposed.len() >= 4096 || disposed.contains(&binding.key()) {
            return Err("model-activation-ended".into());
        }
        let mut calls = self.short_calls.lock().map_err(|_| "model-failed")?;
        if calls.len() >= 32 {
            return Err("model-run-limit".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let cancel = CancellationToken::new();
        calls.insert(
            id.clone(),
            OwnedShortCall {
                binding: binding.clone(),
                cancel: cancel.clone(),
            },
        );
        Ok(ShortCall {
            models: self,
            id,
            cancel,
        })
    }
    pub async fn call(
        self: &Arc<Self>,
        token: &str,
        plugin: &str,
        operation: &str,
        mut payload: Value,
        identity: crate::workspaces::ActiveIdentity,
    ) -> Result<Value> {
        if serde_json::to_vec(&payload)
            .map_err(|_| "invalid-data")?
            .len()
            > MAX_INPUT
        {
            return Err("model-input-limit".into());
        }
        let activation = payload
            .as_object_mut()
            .and_then(|payload| payload.remove("activationId"))
            .and_then(|value| value.as_str().map(str::to_owned))
            .filter(|id| identifier(id))
            .ok_or("invalid-data")?;
        let binding = Binding {
            token: token.into(),
            plugin: plugin.into(),
            activation,
        };
        if identity.lock().map_err(|_| "workspace-changed")?.1 != token {
            return Err("workspace-changed".into());
        }
        {
            let mut disposed = self.disposed.lock().map_err(|_| "model-failed")?;
            let scope_prefix = format!("{token}\0");
            disposed.retain(|key| key.starts_with(&scope_prefix));
            if operation != "model.dispose"
                && (disposed.len() >= 4096 || disposed.contains(&binding.key()))
            {
                return Err("model-activation-ended".into());
            }
        }
        if operation == "model.dispose" {
            let mut disposed = self.disposed.lock().map_err(|_| "model-failed")?;
            if disposed.len() < 4096 {
                disposed.insert(binding.key());
            }
            drop(disposed);
            if let Ok(runs) = self.runs.lock() {
                for value in runs.values().filter(|run| run.binding == binding) {
                    value.run.cancel.cancel();
                }
            }
            if let Ok(calls) = self.short_calls.lock() {
                for call in calls.values().filter(|call| call.binding == binding) {
                    call.cancel.cancel();
                }
            }
            self.codex.dispose(&binding);
            return Ok(Value::Null);
        }
        match operation {
            "model.profiles.list" => self.profiles(),
            "model.profiles.save" => self.save(payload),
            "model.profiles.remove" => {
                let id = payload["profileId"]
                    .as_str()
                    .filter(|id| identifier(id))
                    .ok_or("invalid-data")?;
                {
                    let mut lifecycle = self.lifecycle.lock().map_err(|_| "model-failed")?;
                    if !lifecycle.retiring.insert(id.into()) {
                        return Err("model-profile-busy".into());
                    }
                    if let Some(active) = lifecycle.active.remove(id) {
                        active.cancel();
                    }
                    self.cancel_profile(id);
                }
                let forgotten = self.codex.forget_profile(id).await;
                let mut lifecycle = self.lifecycle.lock().map_err(|_| "model-failed")?;
                let result = forgotten.and_then(|_| {
                    self.secrets
                        .lock()
                        .map_err(|_| "model-storage-error")?
                        .save_model(id, None)
                });
                lifecycle.retiring.remove(id);
                result.map(|_| Value::Null)
            }
            "model.profiles.test" | "model.account.login" | "model.account.logout" => {
                let call = self.short_call(&binding)?;
                let (profile, key, stop, generation) = {
                    let mut lifecycle = self.lifecycle.lock().map_err(|_| "model-failed")?;
                    let disposed = self.disposed.lock().map_err(|_| "model-failed")?;
                    if disposed.contains(&binding.key()) {
                        return Err("model-activation-ended".into());
                    }
                    let id = payload["profileId"].as_str().ok_or("invalid-data")?;
                    if lifecycle.retiring.contains(id) {
                        return Err("model-profile-busy".into());
                    }
                    let (profile, key) = self.profile(id)?;
                    let generation = self.codex.generation(&binding, &profile)?;
                    let stop = lifecycle.active.entry(id.into()).or_default().clone();
                    (profile, key, stop, generation)
                };
                let work = async {
                    if profile.kind == "codex" {
                        self.codex
                            .account(&binding, &profile, operation, identity.clone(), generation)
                            .await
                    } else if operation == "model.profiles.test" {
                        byok::test(&profile, key.as_deref()).await
                    } else {
                        Err("model-auth-unsupported".into())
                    }
                };
                let result = tokio::select! {
                    biased;
                    _ = call.cancel.cancelled() => Err("model-cancelled".into()),
                    _ = stop.cancelled() => Err("model-cancelled".into()),
                    _ = scope_ended(&binding.token, &identity) => Err("workspace-changed".into()),
                    result = work => result,
                };
                if call.cancel.is_cancelled() || stop.is_cancelled() {
                    return Err("model-cancelled".into());
                }
                if identity.lock().map_err(|_| "workspace-changed")?.1 != binding.token {
                    return Err("workspace-changed".into());
                }
                result
            }
            "model.stream.start" => {
                let request: Request =
                    serde_json::from_value(payload).map_err(|_| "invalid-data")?;
                validate_request(&request)?;
                let run = Arc::new(Run::new());
                let (profile, key, stop) = {
                    let mut lifecycle = self.lifecycle.lock().map_err(|_| "model-failed")?;
                    if lifecycle.retiring.contains(&request.profile_id) {
                        return Err("model-profile-busy".into());
                    }
                    let (profile, key) = self.profile(&request.profile_id)?;
                    self.register_run(
                        request.request_id.clone(),
                        OwnedRun {
                            binding: binding.clone(),
                            profile: profile.id.clone(),
                            run: run.clone(),
                        },
                    )?;
                    let stop = lifecycle
                        .active
                        .entry(profile.id.clone())
                        .or_default()
                        .clone();
                    (profile, key, stop)
                };
                let host = self.clone();
                let request_id = request.request_id.clone();
                tokio::spawn(async move {
                    let work = async {
                        if profile.kind == "codex" {
                            host.codex
                                .run(&binding, &profile, request, run.clone(), identity.clone())
                                .await
                        } else {
                            byok::run(&profile, key.as_deref(), request, &run).await
                        }
                    };
                    let result = tokio::select! {
                        biased;
                        _ = run.cancel.cancelled() => Err("model-cancelled".into()),
                        _ = stop.cancelled() => Err("model-cancelled".into()),
                        _ = scope_ended(&binding.token, &identity) => Err("workspace-changed".into()),
                        result = tokio::time::timeout(Duration::from_secs(600), work) => result.unwrap_or_else(|_| Err("model-timeout".into())),
                    };
                    run.cancel.cancel();
                    run.finish(result);
                });
                Ok(json!({"requestId":request_id}))
            }
            "model.stream.poll" => self
                .owned_run(
                    &binding,
                    payload["requestId"].as_str().ok_or("invalid-data")?,
                )?
                .poll(payload["cursor"].as_u64().ok_or("invalid-data")? as usize),
            "model.stream.cancel" => {
                self.owned_run(
                    &binding,
                    payload["requestId"].as_str().ok_or("invalid-data")?,
                )?
                .cancel
                .cancel();
                Ok(Value::Null)
            }
            "model.stream.respond" => {
                self.owned_run(
                    &binding,
                    payload["requestId"].as_str().ok_or("invalid-data")?,
                )?;
                self.codex.respond(&binding, payload).await
            }
            _ => Err("unknown-operation".into()),
        }
    }
}

async fn scope_ended(token: &str, identity: &crate::workspaces::ActiveIdentity) {
    loop {
        if identity
            .lock()
            .map(|value| value.1 != token)
            .unwrap_or(true)
        {
            return;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

fn identifier(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 100
        && id.as_bytes()[0].is_ascii_alphanumeric()
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte))
}
fn validate_request(request: &Request) -> Result<()> {
    if !identifier(&request.profile_id)
        || !identifier(&request.request_id)
        || request.messages.is_empty()
        || request.messages.len() > 200
        || request.tools.len() > 24
        || request
            .model
            .as_ref()
            .is_some_and(|value| value.is_empty() || value.len() > 200)
        || request
            .thread_id
            .as_ref()
            .is_some_and(|value| !identifier(value))
    {
        return Err("invalid-data".into());
    }
    let mut names = HashSet::new();
    for tool in &request.tools {
        if !identifier(&tool.name)
            || !names.insert(&tool.name)
            || tool.description.len() > 4000
            || !tool.input_schema.is_object()
            || serde_json::to_vec(&tool.input_schema)
                .map_err(|_| "invalid-data")?
                .len()
                > 128 * 1024
        {
            return Err("invalid-data".into());
        }
    }
    let mut images = 0;
    for message in &request.messages {
        images += message.images.len();
        if !["system", "user", "assistant", "tool"].contains(&message.role.as_str())
            || message.content.len() > 512 * 1024
            || images > 3
            || message.tool_calls.len() > 24
            || message.role == "tool"
                && message
                    .tool_call_id
                    .as_ref()
                    .is_none_or(|id| !identifier(id))
        {
            return Err("invalid-data".into());
        }
        for image in &message.images {
            if !["image/png", "image/jpeg", "image/webp"].contains(&image.mime_type.as_str())
                || image.base64.len() > 4 * 1024 * 1024
                || !STANDARD
                    .decode(&image.base64)
                    .is_ok_and(|value| value.len() <= 3 * 1024 * 1024)
            {
                return Err("invalid-data".into());
            }
        }
        for call in &message.tool_calls {
            if !identifier(&call.id) || !identifier(&call.name) || call.arguments.len() > 512 * 1024
            {
                return Err("invalid-data".into());
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn connection_tests_cancel_per_activation_and_workspace_without_stopping_other_owners() {
        let (_directory, models) = fixture();
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let address = listener.local_addr().unwrap();
        let (send, mut accepted) = tokio::sync::mpsc::channel(3);
        let server = tokio::spawn(async move {
            for _ in 0..3 {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut header = Vec::new();
                let mut bytes = [0; 1024];
                while !header.windows(4).any(|value| value == b"\r\n\r\n") {
                    let size = socket.read(&mut bytes).await.unwrap();
                    assert!(size > 0);
                    header.extend_from_slice(&bytes[..size]);
                    assert!(header.len() < 16384);
                }
                assert!(header.starts_with(b"GET /v1/models "));
                send.send(socket).await.unwrap();
            }
        });
        models.save(json!({"id":"profile","name":"Loopback","kind":"openai-compatible","endpoint":format!("http://{address}/v1")})).unwrap();
        let identity = Arc::new(Mutex::new(("library".into(), "scope".into())));
        let start = |activation: &'static str| {
            let models = models.clone();
            let identity = identity.clone();
            tokio::spawn(async move {
                models
                    .call(
                        "scope",
                        "sample",
                        "model.profiles.test",
                        json!({"activationId":activation,"profileId":"profile"}),
                        identity,
                    )
                    .await
            })
        };
        let first = start("one");
        let first_socket = tokio::time::timeout(Duration::from_secs(3), accepted.recv())
            .await
            .unwrap()
            .unwrap();
        let second = start("two");
        let mut second_socket = tokio::time::timeout(Duration::from_secs(3), accepted.recv())
            .await
            .unwrap()
            .unwrap();
        models
            .call(
                "scope",
                "sample",
                "model.dispose",
                json!({"activationId":"one"}),
                identity.clone(),
            )
            .await
            .unwrap();
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(1), first)
                .await
                .unwrap()
                .unwrap()
                .unwrap_err(),
            "model-cancelled"
        );
        assert!(!second.is_finished());
        assert_eq!(models.short_calls.lock().unwrap().len(), 1);
        let body = r#"{"data":[{"id":"fixture"}]}"#;
        second_socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
        let status = tokio::time::timeout(Duration::from_secs(1), second)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(status["available"], true);
        assert_eq!(models.short_calls.lock().unwrap().len(), 0);
        let third = start("three");
        let third_socket = tokio::time::timeout(Duration::from_secs(3), accepted.recv())
            .await
            .unwrap()
            .unwrap();
        identity.lock().unwrap().1 = "new-scope".into();
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(1), third)
                .await
                .unwrap()
                .unwrap()
                .unwrap_err(),
            "workspace-changed"
        );
        assert!(models.short_calls.lock().unwrap().is_empty());
        drop((first_socket, second_socket, third_socket));
        server.await.unwrap();
    }
    #[tokio::test]
    async fn package_removal_and_permission_revocation_still_dispose_existing_runs() {
        let workspace = tempfile::tempdir().unwrap();
        drop(repeaty_workspace::library::Library::create(workspace.path()).unwrap());
        let device = tempfile::tempdir().unwrap();
        let host = crate::plugins::Plugins::new(device.path()).unwrap();
        let workspaces = crate::workspaces::Workspaces::new(device.path());
        let path = workspace.path().to_owned();
        let status = crate::workspaces::run(&workspaces, move |sessions| {
            let epoch = sessions.status()?["epoch"].as_str().unwrap().to_owned();
            sessions.choose(&epoch, &path, false)
        })
        .await
        .unwrap();
        let token = status["active"]["token"].as_str().unwrap().to_owned();
        let package = json!({"manifest":{"id":"sample","name":"Sample","version":"1.0.0","apiVersion":1,"dataVersion":1,"kind":"local","permissions":{"models":true}},"main":"export default {};"});
        for remove in [false, true] {
            host.call(
                &workspaces,
                token.clone(),
                "sample".into(),
                "install".into(),
                package.clone(),
            )
            .await
            .unwrap();
            let run = Arc::new(Run::new());
            let binding = Binding {
                token: token.clone(),
                plugin: "sample".into(),
                activation: format!("activation-{remove}"),
            };
            host.models
                .register_run(
                    format!("request-{remove}"),
                    OwnedRun {
                        binding: binding.clone(),
                        profile: "profile".into(),
                        run: run.clone(),
                    },
                )
                .unwrap();
            if remove {
                host.call(
                    &workspaces,
                    token.clone(),
                    "sample".into(),
                    "remove".into(),
                    Value::Null,
                )
                .await
                .unwrap();
            } else {
                let mut replacement = package.clone();
                replacement["manifest"]["permissions"]["models"] = json!(false);
                host.call(
                    &workspaces,
                    token.clone(),
                    "sample".into(),
                    "install".into(),
                    replacement,
                )
                .await
                .unwrap();
            }
            assert!(
                host.call(
                    &workspaces,
                    token.clone(),
                    "sample".into(),
                    "model.profiles.list".into(),
                    json!({"activationId":binding.activation})
                )
                .await
                .is_err()
            );
            host.call(
                &workspaces,
                token.clone(),
                "sample".into(),
                "model.dispose".into(),
                json!({"activationId":binding.activation}),
            )
            .await
            .unwrap();
            assert!(run.cancel.is_cancelled());
            assert_eq!(
                host.models
                    .register_run(
                        format!("late-{remove}"),
                        OwnedRun {
                            binding,
                            profile: "profile".into(),
                            run: Arc::new(Run::new())
                        }
                    )
                    .unwrap_err(),
                "model-activation-ended"
            );
        }
    }
    #[tokio::test]
    async fn editing_or_removing_profiles_cancels_registered_work_and_blocks_retiring_starts() {
        let (_directory, models) = fixture();
        let profile = json!({"id":"profile","name":"Fixture","kind":"openai-compatible","endpoint":"https://example.org/v1","apiKey":"synthetic"});
        models.save(profile.clone()).unwrap();
        let binding = Binding {
            token: "scope".into(),
            plugin: "sample".into(),
            activation: "one".into(),
        };
        let identity = Arc::new(Mutex::new(("workspace".into(), "scope".into())));
        let stop = {
            let mut lifecycle = models.lifecycle.lock().unwrap();
            lifecycle
                .active
                .entry("profile".into())
                .or_default()
                .clone()
        };
        let run = Arc::new(Run::new());
        models
            .register_run(
                "one".into(),
                OwnedRun {
                    binding: binding.clone(),
                    profile: "profile".into(),
                    run: run.clone(),
                },
            )
            .unwrap();
        models.save(profile).unwrap();
        assert!(stop.is_cancelled());
        assert!(run.cancel.is_cancelled());
        models
            .lifecycle
            .lock()
            .unwrap()
            .retiring
            .insert("profile".into());
        let payload = json!({"activationId":"one","profileId":"profile","requestId":"late","messages":[{"role":"user","content":"hello"}],"tools":[]});
        assert_eq!(
            models
                .call(
                    "scope",
                    "sample",
                    "model.stream.start",
                    payload,
                    identity.clone()
                )
                .await
                .unwrap_err(),
            "model-profile-busy"
        );
        models.lifecycle.lock().unwrap().retiring.remove("profile");
        models
            .call(
                "scope",
                "sample",
                "model.profiles.remove",
                json!({"activationId":"one","profileId":"profile"}),
                identity,
            )
            .await
            .unwrap();
        assert!(models.profile("profile").is_err());
    }
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    fn request() -> Request {
        serde_json::from_value(json!({"profileId":"profile","requestId":"run","messages":[{"role":"user","content":"question"}],"tools":[]})).unwrap()
    }
    fn fixture() -> (tempfile::TempDir, Arc<Models>) {
        let directory = tempfile::tempdir().unwrap();
        let secrets = Arc::new(Mutex::new(
            Secrets::open(&directory.path().join("secrets.sqlite3")).unwrap(),
        ));
        let models = Arc::new(Models::new(directory.path(), secrets).unwrap());
        (directory, models)
    }
    #[test]
    fn profiles_keep_credentials_device_private_and_do_not_reuse_them_for_a_changed_origin() {
        let (directory, models) = fixture();
        let saved = models.save(json!({"id":"profile","name":"My API","kind":"openai-compatible","endpoint":"https://api.example.com/v1","defaultModel":"chosen","apiKey":"private-test-key"})).unwrap();
        assert_eq!(saved["hasCredential"], true);
        assert!(saved.get("apiKey").is_none());
        assert!(
            !models
                .profiles()
                .unwrap()
                .to_string()
                .contains("private-test-key")
        );
        assert_eq!(
            models.profile("profile").unwrap().1.as_deref(),
            Some("private-test-key")
        );
        let updated = models.save(json!({"id":"profile","name":"Renamed","kind":"openai-compatible","endpoint":"https://api.example.com/v1"})).unwrap();
        assert_eq!(updated["hasCredential"], true);
        drop(models);
        let secrets = Arc::new(Mutex::new(
            Secrets::open(&directory.path().join("secrets.sqlite3")).unwrap(),
        ));
        let reopened = Models::new(directory.path(), secrets).unwrap();
        assert_eq!(
            reopened.profile("profile").unwrap().1.as_deref(),
            Some("private-test-key")
        );
        let changed = reopened.save(json!({"id":"profile","name":"New endpoint","kind":"openai-compatible","endpoint":"https://other.example.com/v1"})).unwrap();
        assert_eq!(changed["hasCredential"], false);
    }
    #[test]
    fn input_limits_and_reserved_properties_cannot_be_used_to_select_a_host_command() {
        let mut request = request();
        request.messages[0].images = vec![
            Image {
                mime_type: "image/png".into(),
                base64: STANDARD.encode([0])
            };
            4
        ];
        assert!(validate_request(&request).is_err());
        request.messages[0].images = vec![Image {
            mime_type: "image/svg+xml".into(),
            base64: STANDARD.encode([0]),
        }];
        assert!(validate_request(&request).is_err());
        request.messages[0].images.clear();
        request.tools = vec![
            Tool {
                name: "read".into(),
                description: "read".into(),
                input_schema: json!({"type":"object"})
            };
            2
        ];
        assert!(validate_request(&request).is_err());
        assert!(serde_json::from_value::<Request>(json!({"profileId":"p","requestId":"r","messages":[],"tools":[],"command":"powershell"})).is_err());
    }
    #[test]
    fn event_history_is_bounded_and_errors_preserve_partial_reply() {
        let run = Run::new();
        run.emit(json!({"type":"delta","text":"already streamed"}))
            .unwrap();
        assert!(
            run.emit(json!({"type":"delta","text":"x".repeat(MAX_OUTPUT)}))
                .is_err()
        );
        run.finish(Err("model-output-limit".into()));
        let poll = run.poll(0).unwrap();
        assert_eq!(poll["reply"]["text"], "already streamed");
        assert_eq!(poll["done"], true);
        assert!(run.poll(999).is_err());
        assert!(run.emit(json!({"type":"delta","text":"late"})).is_err());
    }
    #[test]
    fn long_conversations_evict_completed_streams_without_blocking_the_next_turn() {
        let (_directory, models) = fixture();
        let owner = Binding {
            token: "token".into(),
            plugin: "sample".into(),
            activation: "activation".into(),
        };
        for number in 0..80 {
            let run = Arc::new(Run::new());
            models
                .register_run(
                    format!("done-{number}"),
                    OwnedRun {
                        binding: owner.clone(),
                        profile: "profile".into(),
                        run: run.clone(),
                    },
                )
                .unwrap();
            run.finish(Ok(()));
        }
        assert_eq!(models.runs.lock().unwrap().len(), 32);
        assert!(
            models
                .owned_run(&owner, "done-79")
                .unwrap()
                .poll(0)
                .unwrap()["done"]
                .as_bool()
                .unwrap()
        );
        for number in 0..4 {
            models
                .register_run(
                    format!("active-{number}"),
                    OwnedRun {
                        binding: owner.clone(),
                        profile: "profile".into(),
                        run: Arc::new(Run::new()),
                    },
                )
                .unwrap();
        }
        assert_eq!(
            models
                .register_run(
                    "too-many".into(),
                    OwnedRun {
                        binding: owner,
                        profile: "profile".into(),
                        run: Arc::new(Run::new())
                    }
                )
                .unwrap_err(),
            "model-run-limit"
        );
    }
    #[tokio::test]
    async fn run_access_and_disposal_are_bound_to_library_plugin_and_activation() {
        let (_directory, models) = fixture();
        let owner = Binding {
            token: "token".into(),
            plugin: "sample".into(),
            activation: "activation".into(),
        };
        let run = Arc::new(Run::new());
        models.runs.lock().unwrap().insert(
            "request".into(),
            OwnedRun {
                binding: owner.clone(),
                profile: "profile".into(),
                run: run.clone(),
            },
        );
        assert!(models.owned_run(&owner, "request").is_ok());
        for other in [
            Binding {
                token: "other".into(),
                ..owner.clone()
            },
            Binding {
                plugin: "other".into(),
                ..owner.clone()
            },
            Binding {
                activation: "other".into(),
                ..owner.clone()
            },
        ] {
            assert!(models.owned_run(&other, "request").is_err());
        }
        let identity = Arc::new(Mutex::new(("local:scope".into(), "token".into())));
        models
            .call(
                "token",
                "sample",
                "model.dispose",
                json!({"activationId":"activation"}),
                identity.clone(),
            )
            .await
            .unwrap();
        assert!(run.cancel.is_cancelled());
        assert!(
            models
                .call(
                    "token",
                    "sample",
                    "model.profiles.list",
                    json!({"activationId":"activation"}),
                    identity.clone()
                )
                .await
                .is_err()
        );
        assert!(
            models
                .call(
                    "other",
                    "sample",
                    "model.profiles.list",
                    json!({"activationId":"new"}),
                    identity
                )
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn switching_library_stops_a_live_stream_and_preserves_received_text() {
        let (_directory, models) = fixture();
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let address = listener.local_addr().unwrap();
        let (sent, received) = tokio::sync::oneshot::channel();
        let (resume, cancelled) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut input = [0; 16384];
            let count = stream.read(&mut input).await.unwrap();
            assert!(count > 0);
            let event = format!(
                "data: {}\n\n",
                json!({"choices":[{"delta":{"content":"before switch"}}]})
            );
            stream.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n{event}").as_bytes()).await.unwrap();
            let _ = sent.send(());
            cancelled.await.unwrap();
            // Deliver a late frame after cancellation. Transport libraries need not
            // send an immediate TCP FIN when an idle SSE response is dropped.
            let late = format!(
                "data: {}\n\n",
                json!({"choices":[{"delta":{"content":"after switch"}}]})
            );
            let _ = stream.write_all(late.as_bytes()).await;
            stream.shutdown().await.unwrap();
        });
        models.save(json!({"id":"profile","name":"Loopback","kind":"openai-compatible","endpoint":format!("http://{address}/v1"),"defaultModel":"fixture"})).unwrap();
        let identity = Arc::new(Mutex::new(("local:old".into(), "old-token".into())));
        models.call("old-token", "sample", "model.stream.start", json!({"activationId":"active","profileId":"profile","requestId":"request","messages":[{"role":"user","content":"hello"}],"tools":[]}), identity.clone()).await.unwrap();
        received.await.unwrap();
        let binding = Binding {
            token: "old-token".into(),
            plugin: "sample".into(),
            activation: "active".into(),
        };
        let run = models.owned_run(&binding, "request").unwrap();
        tokio::time::timeout(Duration::from_secs(3), async {
            while run.state.lock().unwrap().text.is_empty() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        *identity.lock().unwrap() = ("local:new".into(), "new-token".into());
        tokio::time::timeout(Duration::from_secs(3), async {
            while !run.state.lock().unwrap().done {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        let poll = run.poll(0).unwrap();
        assert_eq!(poll["reply"]["text"], "before switch");
        assert!(
            poll["events"]
                .as_array()
                .unwrap()
                .iter()
                .any(|value| value["code"] == "workspace-changed")
        );
        resume.send(()).unwrap();
        tokio::time::timeout(Duration::from_secs(3), server)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(run.poll(0).unwrap()["reply"]["text"], "before switch");
        // Only the completed-result cache and this test retain the run: the task
        // and its response future have exited, rather than silently streaming on.
        assert_eq!(Arc::strong_count(&run), 2);
    }
}
