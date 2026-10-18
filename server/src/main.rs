use repeaty_server::{
    api::{AppState, router},
    auth::{AuthStore, private_directory},
    db::Database,
};
use std::{
    io::Read,
    net::SocketAddr,
    path::{Path, PathBuf},
};

fn admin(directory: &Path, args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    private_directory(directory)?;
    private_directory(&directory.join("users"))?;
    let mut auth = AuthStore::open(&directory.join("accounts.sqlite3"))
        .map_err(|e| format!("Account storage: {e:?}"))?;
    let name = args
        .get(1)
        .ok_or("Usage: create-user USER | reset-password USER | import-library USER OLD.sqlite3")?;
    match args[0].as_str() {
        "create-user" | "reset-password" => {
            eprintln!(
                "Read password from standard input (12–128 bytes). Stop the service before administration."
            );
            let mut password = String::new();
            std::io::stdin().take(130).read_to_string(&mut password)?;
            let password = password.trim_end_matches(['\r', '\n']);
            if args[0] == "create-user" {
                auth.create(name, password)
                    .map_err(|e| format!("Cannot create account: {}", e.1))?;
            } else {
                let user = auth
                    .find(name)
                    .map_err(|e| format!("Account lookup: {e:?}"))?
                    .ok_or("Unknown account")?;
                auth.reset_password(&user, password)
                    .map_err(|e| format!("Cannot reset password: {}", e.1))?;
            }
        }
        "import-library" => {
            let user = auth
                .find(name)
                .map_err(|e| format!("Account lookup: {e:?}"))?
                .ok_or("Create the account first")?;
            let source = Path::new(args.get(2).ok_or("Missing source SQLite path")?);
            let target = directory.join("users").join(format!("{}.sqlite3", user.id));
            if target.exists() {
                return Err("Target library already exists; refusing to overwrite it".into());
            }
            let from = rusqlite::Connection::open_with_flags(
                source,
                rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
            )?;
            // SQLite's backup API includes committed WAL pages. Never copy credentials.
            from.backup(rusqlite::MAIN_DB, &target, None)?;
            Database::open(&target)
                .and_then(|mut db| db.load())
                .map_err(|e| format!("Imported library failed validation: {e:?}"))?;
        }
        _ => return Err("Unknown administration command".into()),
    }
    println!("Done.");
    Ok(())
}
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let directory =
        PathBuf::from(std::env::var("REPEATY_DATA_DIR").unwrap_or_else(|_| "data".into()));
    let args: Vec<_> = std::env::args().skip(1).collect();
    if !args.is_empty() {
        return admin(&directory, &args);
    }
    if std::env::var_os("REPEATY_DATABASE").is_some()
        || std::env::var_os("REPEATY_API_TOKEN").is_some()
    {
        return Err("Legacy shared-library configuration detected. Follow docs/server.md to migrate to accounts; set REPEATY_DATA_DIR and remove REPEATY_DATABASE / REPEATY_API_TOKEN.".into());
    }
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
    if parsed.scheme() == "http"
        && !matches!(parsed.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"))
    {
        return Err("Public deployments require an HTTPS REPEATY_ORIGIN".into());
    }
    let origin = parsed.origin().ascii_serialization();
    let host = origin
        .split("://")
        .nth(1)
        .ok_or("Missing origin host")?
        .to_string();
    let registration = match std::env::var("REPEATY_REGISTRATION").as_deref() {
        Ok("closed") => false,
        Ok("open") | Err(_) => true,
        _ => return Err("REPEATY_REGISTRATION must be open or closed".into()),
    };
    let state = AppState::open(directory, origin.clone(), host, registration)
        .map_err(|e| format!("Initialization failed: {e:?}"))?;
    let public_dir =
        PathBuf::from(std::env::var("REPEATY_WEB_DIR").unwrap_or_else(|_| "dist-server".into()));
    let listener = tokio::net::TcpListener::bind(address).await?;
    println!("Repeaty backend: {origin}");
    axum::serve(listener, router(state, public_dir))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
