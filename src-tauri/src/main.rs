#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod exports;
mod plugins;
use tauri_plugin_dialog::DialogExt;
mod upstream;
use plugins::Plugins;
use std::sync::Arc;
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::Mutex;
use upstream::{Config, Request, Response, Upstream};

struct Desktop {
    upstream: Mutex<Upstream>,
    plugins: Plugins,
    exports: Mutex<exports::Exporter>,
}
#[tauri::command]
async fn desktop_config(state: State<'_, Desktop>) -> Result<Config, String> {
    Ok(state.upstream.lock().await.config.clone())
}
#[tauri::command]
async fn set_endpoint(state: State<'_, Desktop>, endpoint: String) -> Result<(), String> {
    state.upstream.lock().await.set_endpoint(&endpoint)
}
#[tauri::command]
async fn upstream_request(state: State<'_, Desktop>, request: Request) -> Result<Response, String> {
    state.upstream.lock().await.request(request).await
}
#[tauri::command]
async fn local_plugin(
    state: State<'_, Desktop>,
    id: String,
    operation: String,
    payload: serde_json::Value,
) -> Result<serde_json::Value, String> {
    state.plugins.call(&id, operation, payload).await
}
fn external(url: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "invalid-url")?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("invalid-url".into());
    }
    open::that_detached(parsed.as_str()).map_err(|_| "open-failed".into())
}
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    external(&url)
}
#[tauri::command]
async fn export_begin(
    app: tauri::AppHandle,
    state: State<'_, Desktop>,
    filename: String,
) -> Result<Option<String>, String> {
    if filename.len() > 128
        || !filename
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
    {
        return Err("invalid-data".into());
    }
    let mut exports = state.exports.try_lock().map_err(|_| "export-busy")?;
    if exports.active() {
        return Err("export-busy".into());
    }
    let chosen = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_file_name(filename)
            .blocking_save_file()
    })
    .await
    .map_err(|_| "export-failed")?;
    chosen
        .map(|file| exports.begin(file.into_path().map_err(|_| "invalid-path")?))
        .transpose()
}
#[tauri::command]
async fn export_write(
    state: State<'_, Desktop>,
    token: String,
    chunk: String,
) -> Result<(), String> {
    state.exports.lock().await.write(&token, &chunk)
}
#[tauri::command]
async fn export_finish(state: State<'_, Desktop>, token: String) -> Result<(), String> {
    state.exports.lock().await.finish(&token)
}
#[tauri::command]
async fn export_cancel(state: State<'_, Desktop>, token: String) -> Result<(), String> {
    state.exports.lock().await.cancel(&token)
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let directory = app.path().app_data_dir()?;
            std::fs::create_dir_all(&directory)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))?;
            }
            app.manage(Desktop {
                exports: Mutex::new(exports::Exporter::default()),
                upstream: Mutex::new(Upstream::open(&directory.join("desktop.json"))?),
                plugins: Plugins::new(vec![Arc::new(
                    repeaty_leetcode_local::leetcode::LeetCode::open(
                        &directory.join("leetcode.credentials.sqlite3"),
                    )?,
                )])?,
            });
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Repeaty")
                .inner_size(1280.0, 850.0)
                .min_inner_size(720.0, 560.0)
                .on_navigation(|url| {
                    let bundled = matches!(
                        (url.scheme(), url.host_str()),
                        ("tauri", Some("localhost")) | ("http" | "https", Some("tauri.localhost"))
                    );
                    let development = cfg!(debug_assertions)
                        && url.as_str().starts_with("http://localhost:4178/");
                    bundled || development
                })
                .on_new_window(|url, _| {
                    let _ = external(url.as_str());
                    tauri::webview::NewWindowResponse::Deny
                })
                .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            export_begin,
            export_write,
            export_finish,
            export_cancel,
            desktop_config,
            set_endpoint,
            upstream_request,
            local_plugin,
            open_external
        ])
        .run(tauri::generate_context!())
        .expect("Unable to start Repeaty");
}
