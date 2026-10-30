//! Explicit LAN pairing and authenticated, bounded RPC. Library semantics belong to Handler.
//! Device keys and grants live in app_data_dir; the network never opens a learning database.
#[path = "device_sync/identity.rs"]
mod identity;
#[path = "device_sync/transport.rs"]
mod transport;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use identity::{Identity, Store};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, VecDeque},
    future::Future,
    path::Path,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    net::{TcpListener, TcpStream},
    sync::{Semaphore, oneshot},
};
use tokio_rustls::TlsAcceptor;
use tokio_util::sync::CancellationToken;
use transport::{IO_TIMEOUT, MAX_FRAME, PAIR_TIMEOUT, SMALL_FRAME};

pub type Result<T> = std::result::Result<T, String>;
pub type Handler = Arc<dyn Fn(Scope, &str, Value) -> Result<Value> + Send + Sync>;
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scope {
    pub token: String,
    pub group_id: String,
}

#[derive(Clone)]
struct Peer {
    id: String,
    name: String,
    address: String,
    cert: Vec<u8>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Invitation {
    pub version: u32,
    pub group_id: String,
    pub epoch: String,
    pub device_id: String,
    pub name: String,
    pub address: String,
    pub certificate: String,
    pub ticket: String,
    pub expires_at: u64,
}
#[derive(Clone)]
struct Context {
    scope: Scope,
    epoch: String,
    cancel: CancellationToken,
}
struct Pending {
    peer: Peer,
    expires: u64,
    answer: oneshot::Sender<bool>,
}
struct PendingGuard {
    service: std::sync::Weak<SyncService>,
    id: String,
}
impl Drop for PendingGuard {
    fn drop(&mut self) {
        if let Some(service) = self.service.upgrade()
            && let Ok(mut state) = service.lock()
        {
            state.pending.remove(&self.id);
        }
    }
}
struct Listener {
    address: String,
    cancel: CancellationToken,
}
struct State {
    store: Store,
    scope: Option<Scope>,
    epoch: String,
    operations: CancellationToken,
    listener: Option<Listener>,
    paused: bool,
    invitations: HashMap<String, u64>,
    pending: HashMap<String, Pending>,
    errors: VecDeque<String>,
}
pub struct SyncService {
    identity: Identity,
    state: Mutex<State>,
    handler: Handler,
    incoming: Arc<Semaphore>,
    outgoing: Arc<Semaphore>,
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn name_valid(value: &str) -> bool {
    !value.trim().is_empty()
        && value.len() <= 80
        && !value.chars().any(|c| {
            c.is_control()
                || ('\u{202a}'..='\u{202e}').contains(&c)
                || ('\u{2066}'..='\u{2069}').contains(&c)
        })
}
fn group_valid(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_:./".contains(&c))
}
fn method_valid(value: &str) -> bool {
    matches!(
        value,
        "journal/status"
            | "journal/list"
            | "journal/receive"
            | "objects/info"
            | "objects/read"
            | "objects/write"
            | "objects/finish"
    )
}
fn public_error(code: &str) -> String {
    match code {
        "sync-unavailable"
        | "sync-workspace-changed"
        | "sync-paused"
        | "sync-not-listening"
        | "sync-invalid-address"
        | "sync-listen-failed"
        | "sync-cancelled"
        | "sync-timeout"
        | "sync-busy"
        | "sync-invalid-message"
        | "sync-message-limit"
        | "sync-incompatible"
        | "sync-authentication-failed"
        | "sync-unreachable"
        | "sync-disconnected"
        | "sync-pairing-expired"
        | "sync-pairing-rejected"
        | "sync-unknown-peer"
        | "sync-invalid-invitation"
        | "sync-invalid-certificate"
        | "sync-peer-limit"
        | "sync-storage-error"
        | "sync-disk-full"
        | "sync-hash-mismatch"
        | "sync-invalid-object"
        | "sync-object-missing"
        | "sync-object-limit"
        | "sync-object-incomplete"
        | "sync-object-conflict"
        | "sync-unsafe-object"
        | "sync-conflict"
        | "sync-invalid-data"
        | "sync-identity-error"
        | "sync-tls-error"
        | "sync-method-denied" => code.into(),
        _ => "sync-operation-failed".into(),
    }
}
impl State {
    fn current(&self, context: &Context) -> Result<()> {
        if self.scope.as_ref() != Some(&context.scope) || self.epoch != context.epoch {
            return Err("sync-workspace-changed".into());
        }
        if context.cancel.is_cancelled() {
            return Err("sync-cancelled".into());
        }
        if self.paused {
            return Err("sync-paused".into());
        }
        Ok(())
    }
    fn cancel_operations(&mut self) {
        self.operations.cancel();
        self.operations = CancellationToken::new();
        self.invitations.clear();
        self.pending.clear();
    }
    fn stop(&mut self) {
        self.cancel_operations();
        if let Some(listener) = self.listener.take() {
            listener.cancel.cancel();
        }
    }
}

impl SyncService {
    pub fn new(directory: &Path, handler: Handler) -> Result<Arc<Self>> {
        let (store, identity) = Store::open(directory)?;
        // Validate the persisted identity before exposing an enabled service.
        transport::server(&identity, &[])?;
        Ok(Arc::new(Self {
            identity,
            handler,
            incoming: Arc::new(Semaphore::new(8)),
            outgoing: Arc::new(Semaphore::new(4)),
            state: Mutex::new(State {
                store,
                scope: None,
                epoch: id(),
                operations: CancellationToken::new(),
                listener: None,
                paused: false,
                invitations: HashMap::new(),
                pending: HashMap::new(),
                errors: VecDeque::new(),
            }),
        }))
    }
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, State>> {
        self.state.lock().map_err(|_| "sync-unavailable".into())
    }
    fn context(&self) -> Result<Context> {
        let state = self.lock()?;
        if state.paused {
            return Err("sync-paused".into());
        }
        Ok(Context {
            scope: state.scope.clone().ok_or("sync-unavailable")?,
            epoch: state.epoch.clone(),
            cancel: state.operations.child_token(),
        })
    }
    fn context_for(&self, expected: &Scope) -> Result<Context> {
        let state = self.lock()?;
        if state.scope.as_ref() != Some(expected) {
            return Err("sync-workspace-changed".into());
        }
        if state.paused {
            return Err("sync-paused".into());
        }
        Ok(Context {
            scope: expected.clone(),
            epoch: state.epoch.clone(),
            cancel: state.operations.child_token(),
        })
    }
    fn current(&self, context: &Context) -> Result<()> {
        self.lock()?.current(context)
    }
    fn peer(&self, context: &Context, peer_id: &str) -> Result<Peer> {
        let state = self.lock()?;
        state.current(context)?;
        state
            .store
            .peers(&context.scope.group_id)?
            .into_iter()
            .find(|p| p.id == peer_id)
            .ok_or("sync-unknown-peer".into())
    }
    fn record(&self, context: &Context, code: &str) {
        if let Ok(mut state) = self.lock() {
            if state.scope.as_ref() != Some(&context.scope) || state.epoch != context.epoch {
                return;
            }
            let code = public_error(code);
            if state.errors.back() != Some(&code) {
                state.errors.push_back(code);
            }
            while state.errors.len() > 8 {
                state.errors.pop_front();
            }
        }
    }
    pub fn activate(&self, scope: Scope) -> Result<Value> {
        if scope.token.is_empty() || scope.token.len() > 256 || !group_valid(&scope.group_id) {
            return Err("sync-invalid-data".into());
        }
        {
            let mut state = self.lock()?;
            if state.scope.as_ref() != Some(&scope) {
                state.stop();
                state.scope = Some(scope);
                state.epoch = id();
                state.paused = false;
                state.errors.clear();
            }
        }
        self.status()
    }
    pub fn deactivate(&self) {
        if let Ok(mut state) = self.lock() {
            state.stop();
            state.scope = None;
            state.epoch = id();
            state.errors.clear();
        }
    }
    pub fn status(&self) -> Result<Value> {
        let mut state = self.lock()?;
        state.pending.retain(|_, p| p.expires > now());
        state.invitations.retain(|_, expiry| *expiry > now());
        let group = state.scope.as_ref().map(|s| s.group_id.clone());
        let peers = match &group {
            Some(group) => state.store.peers(group)?,
            None => vec![],
        };
        Ok(
            json!({"deviceId":self.identity.id,"name":self.identity.name,"enabled":state.listener.is_some(),"listenAddress":state.listener.as_ref().map(|l|l.address.clone()),"group":group,"paused":state.paused,
            "peers":peers.iter().map(|p|json!({"id":p.id,"name":p.name,"address":p.address,"status":if state.paused {"paused"} else {"paired"}})).collect::<Vec<_>>(),
            "pending":state.pending.iter().map(|(id,p)|json!({"id":id,"name":p.peer.name,"requestCode":&p.peer.id[..12]})).collect::<Vec<_>>(),"errors":state.errors}),
        )
    }
    /// Diagnostics deliberately omit identity, address, certificate, scope and library content.
    pub fn diagnostics(&self) -> Result<Value> {
        let state = self.lock()?;
        let peers = match &state.scope {
            Some(scope) => state.store.peers(&scope.group_id)?.len(),
            None => 0,
        };
        Ok(
            json!({"protocol":1,"enabled":state.listener.is_some(),"paused":state.paused,"peerCount":peers,"pendingCount":state.pending.len(),"errors":state.errors}),
        )
    }
    #[cfg(test)]
    pub async fn listen(self: &Arc<Self>, address: &str) -> Result<Value> {
        let context = self.context()?;
        self.listen_context(context, address).await
    }
    pub async fn listen_for(self: &Arc<Self>, expected: Scope, address: &str) -> Result<Value> {
        self.listen_context(self.context_for(&expected)?, address)
            .await
    }
    async fn listen_context(self: &Arc<Self>, context: Context, address: &str) -> Result<Value> {
        let address = transport::address(address)?;
        let listener = TcpListener::bind(address)
            .await
            .map_err(|_| "sync-listen-failed")?;
        let actual = listener
            .local_addr()
            .map_err(|_| "sync-listen-failed")?
            .to_string();
        self.current(&context)?;
        let cancel = CancellationToken::new();
        {
            let mut state = self.lock()?;
            state.current(&context)?;
            // Rebind closes the old listener and every connection before publishing the new address.
            state.stop();
            state.listener = Some(Listener {
                address: actual,
                cancel: cancel.clone(),
            });
        }
        let weak = Arc::downgrade(self);
        let listener_epoch = context.epoch;
        tokio::spawn(async move {
            loop {
                let accepted = tokio::select! { biased; _ = cancel.cancelled() => break, accepted = listener.accept() => accepted };
                let Ok((socket, _)) = accepted else {
                    break;
                };
                let Some(service) = weak.upgrade() else {
                    break;
                };
                let Ok(permit) = service.incoming.clone().try_acquire_owned() else {
                    continue;
                };
                let Ok(context) = service.context() else {
                    continue;
                };
                if cancel.is_cancelled() || context.epoch != listener_epoch {
                    continue;
                }
                tokio::spawn(async move {
                    let _permit = permit;
                    let result = bounded(
                        &context.cancel,
                        PAIR_TIMEOUT,
                        service.serve(context.clone(), socket),
                    )
                    .await;
                    if let Err(error) = result {
                        service.record(&context, &error);
                    }
                });
            }
        });
        self.status()
    }
    pub fn stop(&self) -> Result<Value> {
        self.lock()?.stop();
        self.status()
    }
    pub fn cancel(&self) -> Result<Value> {
        self.lock()?.cancel_operations();
        self.status()
    }
    pub fn pause(&self, paused: bool) -> Result<Value> {
        {
            let mut state = self.lock()?;
            state.cancel_operations();
            state.paused = paused;
        }
        self.status()
    }
    pub fn revoke(&self, peer_id: &str) -> Result<Value> {
        let mut state = self.lock()?;
        let group = state
            .scope
            .as_ref()
            .ok_or("sync-unavailable")?
            .group_id
            .clone();
        state.store.remove(&group, peer_id)?;
        state.cancel_operations();
        drop(state);
        self.status()
    }
    /// Only an explicit host action can obtain a shareable invitation containing a ticket.
    pub fn invite(&self) -> Result<Invitation> {
        let context = self.context()?;
        let mut random = [0u8; 32];
        rustls::crypto::ring::default_provider()
            .secure_random
            .fill(&mut random)
            .map_err(|_| "sync-identity-error")?;
        let ticket = URL_SAFE_NO_PAD.encode(random);
        let mut state = self.lock()?;
        state.current(&context)?;
        let address = state
            .listener
            .as_ref()
            .ok_or("sync-not-listening")?
            .address
            .clone();
        state.invitations.retain(|_, expiry| *expiry > now());
        if state.invitations.len() >= 4 {
            return Err("sync-busy".into());
        }
        let expires_at = now() + PAIR_TIMEOUT.as_secs();
        state
            .invitations
            .insert(digest(ticket.as_bytes()), expires_at);
        Ok(Invitation {
            version: 1,
            group_id: context.scope.group_id,
            epoch: context.epoch,
            device_id: self.identity.id.clone(),
            name: self.identity.name.clone(),
            address,
            certificate: URL_SAFE_NO_PAD.encode(&self.identity.cert),
            ticket,
            expires_at,
        })
    }
    pub fn approve(&self, request_id: &str, approve: bool) -> Result<Value> {
        let context = self.context()?;
        let mut state = self.lock()?;
        state.current(&context)?;
        let pending = state
            .pending
            .remove(request_id)
            .ok_or("sync-pairing-expired")?;
        if pending.expires <= now() {
            return Err("sync-pairing-expired".into());
        }
        if approve {
            if state.store.peers(&context.scope.group_id)?.len() >= 32 {
                return Err("sync-peer-limit".into());
            }
            state.store.save(&context.scope.group_id, &pending.peer)?;
        }
        let _ = pending.answer.send(approve);
        drop(state);
        self.status()
    }
    /// Both peers listen explicitly. The incoming address is never inferred from public services.
    #[cfg(test)]
    pub async fn join(self: &Arc<Self>, invitation: Invitation) -> Result<Value> {
        let context = self.context()?;
        self.join_context(context, invitation).await
    }
    pub async fn join_for(
        self: &Arc<Self>,
        expected: Scope,
        invitation: Invitation,
    ) -> Result<Value> {
        self.join_context(self.context_for(&expected)?, invitation)
            .await
    }
    async fn join_context(
        self: &Arc<Self>,
        context: Context,
        invitation: Invitation,
    ) -> Result<Value> {
        let result = bounded(
            &context.cancel,
            PAIR_TIMEOUT,
            self.join_inner(&context, invitation),
        )
        .await;
        if let Err(error) = &result {
            self.record(&context, error);
        }
        result
    }
    async fn join_inner(&self, context: &Context, invitation: Invitation) -> Result<Value> {
        if invitation.version != 1 {
            return Err("sync-incompatible".into());
        }
        if invitation.group_id != context.scope.group_id
            || invitation.expires_at <= now()
            || invitation.expires_at > now() + PAIR_TIMEOUT.as_secs() + 30
            || invitation.epoch.len() > 128
            || invitation.ticket.len() != 43
            || invitation.certificate.len() > 12000
        {
            return Err("sync-invalid-invitation".into());
        }
        let cert = URL_SAFE_NO_PAD
            .decode(&invitation.certificate)
            .map_err(|_| "sync-invalid-invitation")?;
        let peer = Peer {
            id: invitation.device_id,
            name: invitation.name,
            address: invitation.address,
            cert,
        };
        validate_peer(&peer)?;
        if peer.id == self.identity.id {
            return Err("sync-invalid-invitation".into());
        }
        let address = self
            .lock()?
            .listener
            .as_ref()
            .ok_or("sync-not-listening")?
            .address
            .clone();
        let _permit = self
            .outgoing
            .clone()
            .try_acquire_owned()
            .map_err(|_| "sync-busy")?;
        let mut stream = bounded(
            &context.cancel,
            IO_TIMEOUT,
            transport::connect(&self.identity, &peer, false),
        )
        .await?;
        let request = Request::Pair {
            version: 1,
            group_id: context.scope.group_id.clone(),
            target_epoch: invitation.epoch.clone(),
            source_epoch: context.epoch.clone(),
            ticket: invitation.ticket,
            certificate: URL_SAFE_NO_PAD.encode(&self.identity.cert),
            name: self.identity.name.clone(),
            address,
        };
        bounded(
            &context.cancel,
            IO_TIMEOUT,
            transport::write(&mut stream, &request, SMALL_FRAME),
        )
        .await?;
        let reply: Reply = transport::read(&mut stream, SMALL_FRAME).await?;
        match reply {
            Reply::Paired {
                group_id,
                source_epoch,
                target_epoch,
            } if group_id == context.scope.group_id
                && source_epoch == context.epoch
                && target_epoch == invitation.epoch =>
            {
                self.current(context)?;
                let state = self.lock()?;
                state.current(context)?;
                if state.store.peers(&context.scope.group_id)?.len() >= 32 {
                    return Err("sync-peer-limit".into());
                }
                state.store.save(&context.scope.group_id, &peer)?;
                drop(state);
                self.status()
            }
            Reply::Error { code } => Err(public_error(&code)),
            _ => Err("sync-invalid-message".into()),
        }
    }
    #[cfg(test)]
    pub async fn peer_request(
        self: &Arc<Self>,
        peer_id: &str,
        method: &str,
        payload: Value,
    ) -> Result<Value> {
        if !method_valid(method) {
            return Err("sync-method-denied".into());
        }
        let context = self.context()?;
        self.peer_request_context(context, peer_id, method, payload)
            .await
    }
    pub async fn peer_request_for(
        self: &Arc<Self>,
        expected: Scope,
        peer_id: &str,
        method: &str,
        payload: Value,
    ) -> Result<Value> {
        if !method_valid(method) {
            return Err("sync-method-denied".into());
        }
        self.peer_request_context(self.context_for(&expected)?, peer_id, method, payload)
            .await
    }
    async fn peer_request_context(
        self: &Arc<Self>,
        context: Context,
        peer_id: &str,
        method: &str,
        payload: Value,
    ) -> Result<Value> {
        let result = bounded(
            &context.cancel,
            IO_TIMEOUT,
            self.request_inner(&context, peer_id, method, payload),
        )
        .await;
        if let Err(error) = &result {
            self.record(&context, error);
        }
        result
    }
    async fn request_inner(
        &self,
        context: &Context,
        peer_id: &str,
        method: &str,
        payload: Value,
    ) -> Result<Value> {
        let _permit = self
            .outgoing
            .clone()
            .try_acquire_owned()
            .map_err(|_| "sync-busy")?;
        let peer = self.peer(context, peer_id)?;
        let mut stream = transport::connect(&self.identity, &peer, true).await?;
        transport::write(
            &mut stream,
            &Request::Hello {
                version: 1,
                group_id: context.scope.group_id.clone(),
            },
            SMALL_FRAME,
        )
        .await?;
        let hello: Reply = transport::read(&mut stream, SMALL_FRAME).await?;
        let target_epoch = match hello {
            Reply::Hello { group_id, epoch } if group_id == context.scope.group_id => epoch,
            Reply::Error { code } => return Err(public_error(&code)),
            _ => return Err("sync-invalid-message".into()),
        };
        let request_id = id();
        transport::write(
            &mut stream,
            &Request::Call {
                version: 1,
                group_id: context.scope.group_id.clone(),
                target_epoch: target_epoch.clone(),
                source_epoch: context.epoch.clone(),
                id: request_id.clone(),
                method: method.into(),
                payload,
            },
            MAX_FRAME,
        )
        .await?;
        let reply: Reply = transport::read(&mut stream, MAX_FRAME).await?;
        self.peer(context, peer_id)?;
        match reply {
            Reply::Result {
                group_id,
                source_epoch,
                target_epoch: reply_target,
                id,
                payload,
            } if group_id == context.scope.group_id
                && source_epoch == context.epoch
                && reply_target == target_epoch
                && id == request_id =>
            {
                Ok(payload)
            }
            Reply::Error { code } => Err(public_error(&code)),
            _ => Err("sync-invalid-message".into()),
        }
    }
    async fn serve(self: &Arc<Self>, context: Context, socket: TcpStream) -> Result<()> {
        let peers = self.lock()?.store.peers(&context.scope.group_id)?;
        let config = transport::server(&self.identity, &peers)?;
        let mut stream = bounded(&context.cancel, IO_TIMEOUT, async {
            TlsAcceptor::from(config)
                .accept(socket)
                .await
                .map_err(|_| "sync-authentication-failed".into())
        })
        .await?;
        if stream.get_ref().1.alpn_protocol() != Some(b"repeaty-sync/1".as_slice()) {
            return Err("sync-incompatible".into());
        }
        let authenticated = stream
            .get_ref()
            .1
            .peer_certificates()
            .and_then(|chain| chain.first())
            .map(|cert| digest(cert.as_ref()));
        let request: Request = bounded(
            &context.cancel,
            IO_TIMEOUT,
            transport::read(&mut stream, SMALL_FRAME),
        )
        .await?;
        let result = async {
            match request {
                Request::Pair { version, group_id, target_epoch, source_epoch, ticket, certificate, name, address } if authenticated.is_none() => {
                    use tokio::io::AsyncReadExt;
                    tokio::select! {
                        result = self.pair(&context, version, &group_id, &target_epoch, &source_epoch, &ticket, &certificate, &name, &address) => result,
                        _ = stream.read_u8() => Err("sync-disconnected".into()),
                    }
                }
                Request::Hello { version, group_id } => {
                    let peer_id = authenticated.ok_or("sync-authentication-failed")?;
                    if version != 1 { return Err("sync-incompatible".into()); }
                    if group_id != context.scope.group_id { return Err("sync-workspace-changed".into()); }
                    self.peer(&context, &peer_id)?;
                    transport::write(&mut stream, &Reply::Hello { group_id, epoch: context.epoch.clone() }, SMALL_FRAME).await?;
                    let call: Request = bounded(&context.cancel, IO_TIMEOUT, transport::read(&mut stream, MAX_FRAME)).await?;
                    self.dispatch(&context, &peer_id, call).await
                }
                _ => Err("sync-authentication-failed".into()),
            }
        }.await;
        let reply = match result {
            Ok(reply) => reply,
            Err(code) => {
                self.record(&context, &code);
                Reply::Error {
                    code: public_error(&code),
                }
            }
        };
        bounded(
            &context.cancel,
            IO_TIMEOUT,
            transport::write(&mut stream, &reply, MAX_FRAME),
        )
        .await
    }
    #[allow(clippy::too_many_arguments)]
    async fn pair(
        self: &Arc<Self>,
        context: &Context,
        version: u32,
        group: &str,
        target_epoch: &str,
        source_epoch: &str,
        ticket: &str,
        certificate: &str,
        name: &str,
        address: &str,
    ) -> Result<Reply> {
        if version != 1 {
            return Err("sync-incompatible".into());
        }
        self.current(context)?;
        if group != context.scope.group_id
            || target_epoch != context.epoch
            || source_epoch.len() > 128
            || source_epoch.is_empty()
        {
            return Err("sync-workspace-changed".into());
        }
        if certificate.len() > 12000 || ticket.len() != 43 {
            return Err("sync-invalid-message".into());
        }
        let cert = URL_SAFE_NO_PAD
            .decode(certificate)
            .map_err(|_| "sync-invalid-certificate")?;
        let peer = Peer {
            id: digest(&cert),
            cert,
            name: name.into(),
            address: address.into(),
        };
        validate_peer(&peer)?;
        if peer.id == self.identity.id {
            return Err("sync-authentication-failed".into());
        }
        let (send, receive) = oneshot::channel();
        let pending_id = id();
        {
            let mut state = self.lock()?;
            state.current(context)?;
            let expiry = state
                .invitations
                .remove(&digest(ticket.as_bytes()))
                .ok_or("sync-pairing-expired")?;
            if expiry <= now() {
                return Err("sync-pairing-expired".into());
            }
            if state.pending.len() >= 8 {
                return Err("sync-busy".into());
            }
            state.pending.insert(
                pending_id.clone(),
                Pending {
                    peer,
                    expires: expiry,
                    answer: send,
                },
            );
        }
        let _pending = PendingGuard {
            service: Arc::downgrade(self),
            id: pending_id,
        };
        let approved = receive.await.unwrap_or(false);
        // A dropped, rejected, expired or cancelled approval never becomes an authorization.
        self.current(context)?;
        if !approved {
            return Err("sync-pairing-rejected".into());
        }
        Ok(Reply::Paired {
            group_id: group.into(),
            source_epoch: source_epoch.into(),
            target_epoch: target_epoch.into(),
        })
    }
    async fn dispatch(&self, context: &Context, peer_id: &str, request: Request) -> Result<Reply> {
        let Request::Call {
            version,
            group_id,
            target_epoch,
            source_epoch,
            id,
            method,
            payload,
        } = request
        else {
            return Err("sync-invalid-message".into());
        };
        if version != 1 {
            return Err("sync-incompatible".into());
        }
        if group_id != context.scope.group_id || target_epoch != context.epoch {
            return Err("sync-workspace-changed".into());
        }
        if source_epoch.is_empty() || source_epoch.len() > 128 || id.is_empty() || id.len() > 128 {
            return Err("sync-invalid-message".into());
        }
        if !method_valid(&method) {
            return Err("sync-method-denied".into());
        }
        self.peer(context, peer_id)?;
        let handler = self.handler.clone();
        let scope = context.scope.clone();
        let payload = tokio::task::spawn_blocking(move || handler(scope, &method, payload))
            .await
            .map_err(|_| "sync-operation-failed")??;
        self.peer(context, peer_id)?;
        Ok(Reply::Result {
            group_id,
            target_epoch,
            source_epoch,
            id,
            payload,
        })
    }
}
impl Drop for SyncService {
    fn drop(&mut self) {
        if let Ok(state) = self.state.get_mut() {
            state.stop();
        }
    }
}

fn validate_peer(peer: &Peer) -> Result<()> {
    if !name_valid(&peer.name)
        || peer.cert.len() > 8192
        || peer.cert.is_empty()
        || digest(&peer.cert) != peer.id
    {
        return Err("sync-invalid-certificate".into());
    }
    let address = transport::address(&peer.address)?;
    if address.port() == 0 {
        return Err("sync-invalid-address".into());
    }
    let mut roots = rustls::RootCertStore::empty();
    roots
        .add(rustls::pki_types::CertificateDer::from(peer.cert.clone()))
        .map_err(|_| "sync-invalid-certificate".into())
}
async fn bounded<T>(
    cancel: &CancellationToken,
    duration: Duration,
    future: impl Future<Output = Result<T>>,
) -> Result<T> {
    tokio::select! {biased; _=cancel.cancelled()=>Err("sync-cancelled".into()), result=tokio::time::timeout(duration,future)=>result.map_err(|_|"sync-timeout")?}
}
#[derive(Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum Request {
    Pair {
        version: u32,
        group_id: String,
        target_epoch: String,
        source_epoch: String,
        ticket: String,
        certificate: String,
        name: String,
        address: String,
    },
    Hello {
        version: u32,
        group_id: String,
    },
    Call {
        version: u32,
        group_id: String,
        target_epoch: String,
        source_epoch: String,
        id: String,
        method: String,
        payload: Value,
    },
}
#[derive(Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum Reply {
    Hello {
        group_id: String,
        epoch: String,
    },
    Paired {
        group_id: String,
        source_epoch: String,
        target_epoch: String,
    },
    Result {
        group_id: String,
        source_epoch: String,
        target_epoch: String,
        id: String,
        payload: Value,
    },
    Error {
        code: String,
    },
}

#[cfg(test)]
#[path = "device_sync/tests.rs"]
mod tests;
