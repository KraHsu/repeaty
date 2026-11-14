//! Session-scoped network grants and cancellation. No connector business rules live here.
use super::{Permissions, Result};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub(super) struct Binding {
    token: String,
    plugin: String,
    activation: String,
}
fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
}
impl Binding {
    pub fn from_payload(token: &str, plugin: &str, payload: &Value) -> Result<Self> {
        let activation = payload["activationId"]
            .as_str()
            .filter(|v| identifier(v))
            .ok_or("invalid-data")?;
        Ok(Self {
            token: token.into(),
            plugin: plugin.into(),
            activation: activation.into(),
        })
    }
}
struct Call {
    binding: Binding,
    slot: Option<String>,
    cancel: CancellationToken,
}
#[derive(Default)]
struct State {
    scope: Option<String>,
    grants: HashMap<Binding, HashSet<String>>,
    disposed: HashSet<Binding>,
    cancelled: HashSet<(Binding, String)>,
    calls: HashMap<(Binding, String), Call>,
}
#[derive(Default)]
pub(super) struct Network(Mutex<State>);
pub(super) struct Request {
    host: Arc<Network>,
    key: (Binding, String),
    pub cancel: CancellationToken,
}
impl Drop for Request {
    fn drop(&mut self) {
        if let Ok(mut state) = self.host.0.lock() {
            state.calls.remove(&self.key);
        }
    }
}
impl Network {
    fn current(state: &mut State, binding: &Binding) -> Result<()> {
        match &state.scope {
            Some(scope) if scope != &binding.token => return Err("workspace-changed".into()),
            None => state.scope = Some(binding.token.clone()),
            _ => {}
        }
        if state.disposed.len() >= 4096 || state.disposed.contains(binding) {
            return Err("plugin-activation-ended".into());
        }
        Ok(())
    }
    pub fn scope(&self, token: &str) -> Result<()> {
        let mut state = self.0.lock().map_err(|_| "plugin-network-error")?;
        if state.scope.as_deref() != Some(token) {
            for call in state.calls.values() {
                call.cancel.cancel();
            }
            state.grants.clear();
            state.disposed.clear();
            state.cancelled.clear();
            state.scope = Some(token.into());
        }
        Ok(())
    }
    pub fn authorize(&self, binding: &Binding, origin: &str) -> Result<()> {
        if super::http::origin(origin)? != origin {
            return Err("invalid-data".into());
        }
        let mut state = self.0.lock().map_err(|_| "plugin-network-error")?;
        Self::current(&mut state, binding)?;
        if !state.grants.contains_key(binding) && state.grants.len() >= 128 {
            return Err("plugin-limit".into());
        }
        let grants = state.grants.entry(binding.clone()).or_default();
        if !grants.contains(origin) && grants.len() >= 32 {
            return Err("plugin-limit".into());
        }
        grants.insert(origin.into());
        Ok(())
    }
    pub fn permissions(&self, binding: &Binding, declared: &Permissions) -> Result<Permissions> {
        let mut state = self.0.lock().map_err(|_| "plugin-network-error")?;
        Self::current(&mut state, binding)?;
        let mut permissions = declared.clone();
        if declared.network
            && let Some(origins) = state.grants.get(binding)
        {
            for origin in origins {
                if !permissions.origins.contains(origin) {
                    permissions.origins.push(origin.clone());
                }
            }
        }
        Ok(permissions)
    }
    pub fn register(self: &Arc<Self>, binding: &Binding, payload: &Value) -> Result<Request> {
        let request = payload["requestId"]
            .as_str()
            .filter(|v| identifier(v))
            .ok_or("invalid-data")?;
        let mut state = self.0.lock().map_err(|_| "plugin-network-error")?;
        Self::current(&mut state, binding)?;
        let key = (binding.clone(), request.into());
        if state.cancelled.contains(&key) {
            return Err("plugin-request-cancelled".into());
        }
        if state.calls.contains_key(&key) {
            return Err("plugin-request-conflict".into());
        }
        if state.calls.len() >= 32 {
            return Err("plugin-limit".into());
        }
        let cancel = CancellationToken::new();
        state.calls.insert(
            key.clone(),
            Call {
                binding: binding.clone(),
                slot: payload["secret"]["slot"].as_str().map(str::to_owned),
                cancel: cancel.clone(),
            },
        );
        Ok(Request {
            host: self.clone(),
            key,
            cancel,
        })
    }
    pub fn cancel(&self, binding: &Binding, request: &str) -> Result<()> {
        if !identifier(request) {
            return Err("invalid-data".into());
        }
        let mut state = self.0.lock().map_err(|_| "plugin-network-error")?;
        Self::current(&mut state, binding)?;
        let key = (binding.clone(), request.into());
        if state.cancelled.len() < 4096 {
            state.cancelled.insert(key.clone());
        } else {
            // Fail closed without an unbounded history when one activation repeatedly cancels.
            if state.disposed.len() < 4096 {
                state.disposed.insert(binding.clone());
            }
            state.grants.remove(binding);
            for call in state.calls.values().filter(|call| &call.binding == binding) {
                call.cancel.cancel();
            }
        }
        if let Some(call) = state.calls.get(&key) {
            call.cancel.cancel();
        }
        Ok(())
    }
    pub fn cancel_slot(&self, plugin: &str, slot: &str) {
        if let Ok(state) = self.0.lock() {
            for call in state
                .calls
                .values()
                .filter(|call| call.binding.plugin == plugin && call.slot.as_deref() == Some(slot))
            {
                call.cancel.cancel();
            }
        }
    }
    pub fn dispose(&self, binding: &Binding) {
        if let Ok(mut state) = self.0.lock() {
            if state.disposed.len() < 4096 {
                state.disposed.insert(binding.clone());
            }
            state.grants.remove(binding);
            for call in state.calls.values().filter(|call| &call.binding == binding) {
                call.cancel.cancel();
            }
        }
    }
    pub async fn run<T>(
        &self,
        request: &Request,
        identity: crate::workspaces::ActiveIdentity,
        work: impl Future<Output = Result<T>>,
    ) -> Result<T> {
        let scope = async {
            loop {
                if identity
                    .lock()
                    .map(|v| v.1 != request.key.0.token)
                    .unwrap_or(true)
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        };
        let result = tokio::select! { biased;
            _ = request.cancel.cancelled() => Err("plugin-request-cancelled".into()),
            _ = scope => Err("workspace-changed".into()),
            value = work => value,
        };
        if request.cancel.is_cancelled() {
            return Err("plugin-request-cancelled".into());
        }
        if identity.lock().map_err(|_| "workspace-changed")?.1 != request.key.0.token {
            return Err("workspace-changed".into());
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn binding(activation: &str) -> Binding {
        Binding::from_payload("library", "publisher", &json!({"activationId":activation})).unwrap()
    }
    #[test]
    fn grants_are_origin_exact_and_bound_to_activation_and_permission() {
        let network = Network::default();
        let declared = Permissions {
            network: true,
            ..Default::default()
        };
        let first = binding("one");
        for origin in [
            "http://example.org",
            "https://example.org/path",
            "https://example.org?key=x",
            "https://user@example.org",
        ] {
            assert!(network.authorize(&first, origin).is_err());
        }
        network.authorize(&first, "https://example.org").unwrap();
        assert_eq!(
            network.permissions(&first, &declared).unwrap().origins,
            vec!["https://example.org"]
        );
        assert!(
            network
                .permissions(&binding("two"), &declared)
                .unwrap()
                .origins
                .is_empty()
        );
        assert!(
            network
                .permissions(&first, &Permissions::default())
                .unwrap()
                .origins
                .is_empty()
        );
        network.dispose(&first);
        assert!(network.authorize(&first, "https://example.org").is_err());
        network.scope("new-library").unwrap();
        assert!(network.authorize(&first, "https://example.org").is_err());
        let next =
            Binding::from_payload("new-library", "publisher", &json!({"activationId":"new"}))
                .unwrap();
        network.authorize(&next, "https://new.example").unwrap();
        assert!(network.permissions(&first, &declared).is_err());
        assert_eq!(
            network.permissions(&next, &declared).unwrap().origins,
            vec!["https://new.example"]
        );
    }
    #[test]
    fn cancellation_arriving_before_request_registration_cannot_be_lost() {
        let network = Arc::new(Network::default());
        network.cancel(&binding("one"), "queued").unwrap();
        assert_eq!(
            network
                .register(&binding("one"), &json!({"requestId":"queued"}))
                .err()
                .unwrap(),
            "plugin-request-cancelled"
        );
        assert!(
            network
                .register(&binding("two"), &json!({"requestId":"queued"}))
                .is_ok()
        );
    }
    #[tokio::test]
    async fn dynamic_credentials_require_trusted_declared_network_grants_and_removed_packages_still_cleanup()
     {
        let workspace = tempfile::tempdir().unwrap();
        drop(repeaty_workspace::library::Library::create(workspace.path()).unwrap());
        let device = tempfile::tempdir().unwrap();
        let host = super::super::Plugins::new(device.path()).unwrap();
        let workspaces = crate::workspaces::Workspaces::new(device.path());
        let path = workspace.path().to_owned();
        let status = crate::workspaces::run(&workspaces, move |sessions| {
            let epoch = sessions.status()?["epoch"].as_str().unwrap().to_owned();
            sessions.choose(&epoch, &path, false)
        })
        .await
        .unwrap();
        let token = status["active"]["token"].as_str().unwrap().to_owned();
        let bundle = json!({"manifest":{"id":"publisher","name":"Publisher","version":"1.0.0","apiVersion":1,"dataVersion":1,"kind":"frontend","permissions":{"network":true,"secrets":true}},"main":"export default {};"});
        host.call(
            &workspaces,
            token.clone(),
            "publisher".into(),
            "install".into(),
            bundle.clone(),
        )
        .await
        .unwrap();
        let grant = json!({"activationId":"one","origin":"https://my-blog.example"});
        assert_eq!(
            host.call(
                &workspaces,
                token.clone(),
                "publisher".into(),
                "network.authorize".into(),
                grant.clone()
            )
            .await
            .unwrap_err(),
            "plugin-not-trusted"
        );
        let hash = super::super::Package::parse(bundle, "publisher")
            .unwrap()
            .hash();
        host.call(
            &workspaces,
            token.clone(),
            "publisher".into(),
            "trust".into(),
            json!({"hash":hash}),
        )
        .await
        .unwrap();
        let credential = json!({"activationId":"one","action":"set","slot":"blog","origin":"https://my-blog.example","values":{"token":"private-token"}});
        assert_eq!(
            host.call(
                &workspaces,
                token.clone(),
                "publisher".into(),
                "secrets".into(),
                credential.clone()
            )
            .await
            .unwrap_err(),
            "permission-denied"
        );
        host.call(
            &workspaces,
            token.clone(),
            "publisher".into(),
            "network.authorize".into(),
            grant,
        )
        .await
        .unwrap();
        let result = host
            .call(
                &workspaces,
                token.clone(),
                "publisher".into(),
                "secrets".into(),
                credential.clone(),
            )
            .await
            .unwrap();
        assert!(!result.to_string().contains("private-token"));
        let mut other = credential;
        other["activationId"] = json!("two");
        assert_eq!(
            host.call(
                &workspaces,
                token.clone(),
                "publisher".into(),
                "secrets".into(),
                other
            )
            .await
            .unwrap_err(),
            "permission-denied"
        );
        let binding =
            Binding::from_payload(&token, "publisher", &json!({"activationId":"one"})).unwrap();
        let request = host
            .network
            .register(&binding, &json!({"requestId":"in-flight"}))
            .unwrap();
        host.call(
            &workspaces,
            token.clone(),
            "publisher".into(),
            "remove".into(),
            Value::Null,
        )
        .await
        .unwrap();
        host.call(
            &workspaces,
            token,
            "publisher".into(),
            "http.dispose".into(),
            json!({"activationId":"one"}),
        )
        .await
        .unwrap();
        assert!(request.cancel.is_cancelled());
        assert!(
            host.network
                .register(&binding, &json!({"requestId":"late"}))
                .is_err()
        );
    }
    #[tokio::test]
    async fn cancellation_scopes_and_credential_changes_release_real_network_requests() {
        let network = Arc::new(Network::default());
        let identity = Arc::new(Mutex::new(("library".into(), "library".into())));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let a = network
            .register(
                &binding("one"),
                &json!({"requestId":"a","secret":{"slot":"credential"}}),
            )
            .unwrap();
        let b = network
            .register(&binding("two"), &json!({"requestId":"b"}))
            .unwrap();
        let client = reqwest::Client::new();
        let launch = |request: Request| {
            let host = network.clone();
            let identity = identity.clone();
            let client = client.clone();
            tokio::spawn(async move {
                host.run(&request, identity, async {
                    client
                        .get(format!("http://{address}/"))
                        .send()
                        .await
                        .map(|_| ())
                        .map_err(|_| "network".into())
                })
                .await
            })
        };
        let a = launch(a);
        let b = launch(b);
        let (_socket_a, _) = listener.accept().await.unwrap();
        let (_socket_b, _) = listener.accept().await.unwrap();
        network.cancel_slot("other", "credential");
        assert!(!a.is_finished());
        network.cancel_slot("publisher", "credential");
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(2), a)
                .await
                .unwrap()
                .unwrap()
                .unwrap_err(),
            "plugin-request-cancelled"
        );
        assert!(!b.is_finished());
        identity.lock().unwrap().1 = "other-library".into();
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(2), b)
                .await
                .unwrap()
                .unwrap()
                .unwrap_err(),
            "workspace-changed"
        );
        assert!(network.0.lock().unwrap().calls.is_empty());
        let pending = network
            .register(&binding("one"), &json!({"requestId":"queued"}))
            .unwrap();
        network.dispose(&binding("one"));
        assert!(pending.cancel.is_cancelled());
        assert!(
            network
                .register(&binding("one"), &json!({"requestId":"late"}))
                .is_err()
        );
    }
}
