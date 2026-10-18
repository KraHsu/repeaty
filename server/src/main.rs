use repeaty_server::{
    api::{AppState, router},
    db::Database,
    leetcode::LeetCode,
};
use std::{
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let address: SocketAddr = std::env::var("REPEATY_BIND")
        .unwrap_or_else(|_| "127.0.0.1:8080".into())
        .parse()?;
    let origin = std::env::var("REPEATY_ORIGIN").unwrap_or_else(|_| format!("http://{address}"));
    let parsed = reqwest::Url::parse(&origin)?;
    if !["http", "https"].contains(&parsed.scheme())
        || parsed.path() != "/"
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("REPEATY_ORIGIN must be an http(s) origin without a path".into());
    }
    let origin = parsed.origin().ascii_serialization();
    let host = format!(
        "{}{}",
        parsed.host_str().ok_or("Missing origin host")?,
        parsed
            .port()
            .map(|port| format!(":{port}"))
            .unwrap_or_default()
    );
    let token = std::env::var("REPEATY_API_TOKEN").ok();
    if token.as_ref().is_some_and(|s| s.len() < 24)
        || (!address.ip().is_loopback() && token.is_none())
        || (!matches!(parsed.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"))
            && token.is_none())
    {
        return Err(
            "Set REPEATY_API_TOKEN to at least 24 characters before exposing the server".into(),
        );
    }
    let path = std::env::var("REPEATY_DATABASE").unwrap_or_else(|_| "data/repeaty.sqlite3".into());
    if let Some(parent) = Path::new(&path)
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent)?;
    }
    let database = Database::open(Path::new(&path))
        .map_err(|e| format!("Database initialization failed: {e:?}"))?;
    let state = AppState {
        db: Arc::new(Mutex::new(database)),
        leetcode: Arc::new(LeetCode::from_env()?),
        token,
        origin: origin.clone(),
        host,
        enabled_plugins: repeaty_server::plugins::enabled_from_env()?,
    };
    let public_dir =
        PathBuf::from(std::env::var("REPEATY_WEB_DIR").unwrap_or_else(|_| "dist-server".into()));
    let listener = tokio::net::TcpListener::bind(address).await?;
    println!("Repeaty backend: {origin} (SQLite: {path})");
    axum::serve(listener, router(state, public_dir))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
