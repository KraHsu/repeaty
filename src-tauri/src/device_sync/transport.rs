use super::{Identity, Peer, Result};
use rustls::{
    ClientConfig, RootCertStore, ServerConfig,
    pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer, ServerName},
    server::WebPkiClientVerifier,
};
use serde::{Serialize, de::DeserializeOwned};
use std::{
    net::{IpAddr, SocketAddr},
    sync::Arc,
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    net::TcpStream,
};
use tokio_rustls::{TlsConnector, client::TlsStream};

pub(super) const MAX_FRAME: usize = 64 * 1024 * 1024;
pub(super) const IO_TIMEOUT: Duration = Duration::from_secs(30);
pub(super) const PAIR_TIMEOUT: Duration = Duration::from_secs(300);
pub(super) const SMALL_FRAME: usize = 32 * 1024;

pub(super) fn address(value: &str) -> Result<SocketAddr> {
    let address: SocketAddr = value.parse().map_err(|_| "sync-invalid-address")?;
    let allowed = match address.ip() {
        IpAddr::V4(ip) => ip.is_loopback() || ip.is_private() || ip.is_link_local(),
        IpAddr::V6(ip) => ip.is_loopback() || ip.is_unique_local() || ip.is_unicast_link_local(),
    };
    if !allowed {
        return Err("sync-invalid-address".into());
    }
    Ok(address)
}
fn provider() -> Arc<rustls::crypto::CryptoProvider> {
    Arc::new(rustls::crypto::ring::default_provider())
}
fn certificates(identity: &Identity) -> Vec<CertificateDer<'static>> {
    vec![CertificateDer::from(identity.cert.clone())]
}
fn key(identity: &Identity) -> PrivateKeyDer<'static> {
    PrivatePkcs8KeyDer::from(identity.key.clone()).into()
}
fn roots(certs: impl IntoIterator<Item = Vec<u8>>) -> Result<RootCertStore> {
    let mut roots = RootCertStore::empty();
    for cert in certs {
        roots
            .add(CertificateDer::from(cert))
            .map_err(|_| "sync-invalid-certificate")?;
    }
    Ok(roots)
}
pub(super) fn server(identity: &Identity, peers: &[Peer]) -> Result<Arc<ServerConfig>> {
    // The host's own root makes an empty peer set valid. It never authorizes a request.
    let roots =
        roots(std::iter::once(identity.cert.clone()).chain(peers.iter().map(|p| p.cert.clone())))?;
    let verifier = WebPkiClientVerifier::builder_with_provider(Arc::new(roots), provider())
        .allow_unauthenticated()
        .build()
        .map_err(|_| "sync-tls-error")?;
    let mut config = ServerConfig::builder_with_provider(provider())
        .with_protocol_versions(&[&rustls::version::TLS13])
        .map_err(|_| "sync-tls-error")?
        .with_client_cert_verifier(verifier)
        .with_single_cert(certificates(identity), key(identity))
        .map_err(|_| "sync-identity-error")?;
    config.alpn_protocols = vec![b"repeaty-sync/1".to_vec()];
    config.max_early_data_size = 0;
    config.send_tls13_tickets = 0;
    Ok(Arc::new(config))
}
pub(super) async fn connect(
    identity: &Identity,
    peer: &Peer,
    authenticated: bool,
) -> Result<TlsStream<TcpStream>> {
    let builder = ClientConfig::builder_with_provider(provider())
        .with_protocol_versions(&[&rustls::version::TLS13])
        .map_err(|_| "sync-tls-error")?
        .with_root_certificates(roots([peer.cert.clone()])?);
    let mut config = if authenticated {
        builder
            .with_client_auth_cert(certificates(identity), key(identity))
            .map_err(|_| "sync-identity-error")?
    } else {
        builder.with_no_client_auth()
    };
    config.alpn_protocols = vec![b"repeaty-sync/1".to_vec()];
    config.enable_early_data = false;
    config.resumption = rustls::client::Resumption::disabled();
    let socket = TcpStream::connect(address(&peer.address)?)
        .await
        .map_err(|_| "sync-unreachable")?;
    let stream = TlsConnector::from(Arc::new(config))
        .connect(
            ServerName::try_from("repeaty-sync").expect("fixed SAN"),
            socket,
        )
        .await
        .map_err(|_| "sync-authentication-failed")?;
    let cert = stream
        .get_ref()
        .1
        .peer_certificates()
        .and_then(|chain| chain.first())
        .ok_or("sync-authentication-failed")?;
    if cert.as_ref() != peer.cert
        || stream.get_ref().1.alpn_protocol() != Some(b"repeaty-sync/1".as_slice())
    {
        return Err("sync-authentication-failed".into());
    }
    Ok(stream)
}
pub(super) async fn read<S: AsyncRead + Unpin, T: DeserializeOwned>(
    stream: &mut S,
    limit: usize,
) -> Result<T> {
    let size = stream.read_u32().await.map_err(|_| "sync-disconnected")? as usize;
    if size == 0 || size > limit {
        return Err("sync-message-limit".into());
    }
    let mut bytes = vec![0; size];
    stream
        .read_exact(&mut bytes)
        .await
        .map_err(|_| "sync-disconnected")?;
    serde_json::from_slice(&bytes).map_err(|_| "sync-invalid-message".into())
}
pub(super) async fn write<S: AsyncWrite + Unpin, T: Serialize>(
    stream: &mut S,
    value: &T,
    limit: usize,
) -> Result<()> {
    let bytes = serde_json::to_vec(value).map_err(|_| "sync-invalid-message")?;
    if bytes.len() > limit || bytes.is_empty() {
        return Err("sync-message-limit".into());
    }
    stream
        .write_u32(bytes.len() as u32)
        .await
        .map_err(|_| "sync-disconnected")?;
    stream
        .write_all(&bytes)
        .await
        .map_err(|_| "sync-disconnected")?;
    stream.flush().await.map_err(|_| "sync-disconnected".into())
}
