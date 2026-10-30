#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod collection;
mod exports;
mod mcp;
mod plugins;
mod window_frame;
mod workspace_backups;
mod workspaces;
use plugins::Plugins;
use std::sync::Arc;
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::Mutex;

struct Desktop {
    plugins: Plugins,
    exports: Mutex<exports::Exporter>,
    mcp: Arc<mcp::Mcp>,
}
fn main_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("library-unavailable".into())
    }
}
#[tauri::command]
async fn window_snap_epoch(window: tauri::WebviewWindow) -> Result<Option<u64>, String> {
    main_window(&window)?;
    window_frame::claim(window).await
}
#[tauri::command]
async fn window_snap_region(
    window: tauri::WebviewWindow,
    epoch: u64,
    rect: Option<window_frame::Region>,
) -> Result<bool, String> {
    main_window(&window)?;
    window_frame::update(window, epoch, rect).await
}
#[tauri::command]
fn mcp_attach(
    window: tauri::WebviewWindow,
    state: State<'_, Desktop>,
    on_request: tauri::ipc::Channel<mcp::BridgeRequest>,
) -> Result<String, String> {
    main_window(&window)?;
    Ok(state.mcp.attach(Arc::new(move |request| {
        on_request.send(request).map_err(|_| ())
    })))
}
#[tauri::command]
fn mcp_workspace(
    window: tauri::WebviewWindow,
    state: State<'_, Desktop>,
    attachment: String,
    workspace: mcp::Workspace,
) -> Result<(), String> {
    main_window(&window)?;
    state
        .mcp
        .workspace(&attachment, workspace)
        .map_err(str::to_owned)
}
#[tauri::command]
fn mcp_reply(
    window: tauri::WebviewWindow,
    state: State<'_, Desktop>,
    id: String,
    scope: String,
    reply: mcp::Reply,
) -> Result<(), String> {
    main_window(&window)?;
    state.mcp.reply(&id, &scope, reply).map_err(str::to_owned)
}
#[tauri::command]
fn mcp_status(
    window: tauri::WebviewWindow,
    state: State<'_, Desktop>,
) -> Result<mcp::Status, String> {
    main_window(&window)?;
    Ok(state.mcp.status())
}
#[tauri::command]
async fn mcp_start(
    window: tauri::WebviewWindow,
    state: State<'_, Desktop>,
) -> Result<mcp::Status, String> {
    main_window(&window)?;
    state.mcp.start().await.map_err(str::to_owned)
}
#[tauri::command]
fn mcp_stop(
    window: tauri::WebviewWindow,
    state: State<'_, Desktop>,
) -> Result<mcp::Status, String> {
    main_window(&window)?;
    Ok(state.mcp.stop())
}
#[tauri::command]
fn mcp_configuration(
    window: tauri::WebviewWindow,
    state: State<'_, Desktop>,
) -> Result<serde_json::Value, String> {
    main_window(&window)?;
    state.mcp.configuration().map_err(str::to_owned)
}
#[tauri::command]
fn mcp_client_configuration(
    window: tauri::WebviewWindow,
    state: State<'_, Desktop>,
    client: mcp::Client,
) -> Result<String, String> {
    main_window(&window)?;
    let executable = std::env::current_exe().map_err(|_| "invalid-data")?;
    state
        .mcp
        .client_configuration(client, &executable)
        .map_err(str::to_owned)
}
#[tauri::command]
async fn plugin_host(
    window: tauri::WebviewWindow,
    state: State<'_, Desktop>,
    workspaces: State<'_, workspaces::Workspaces>,
    token: String,
    id: String,
    operation: String,
    payload: serde_json::Value,
) -> Result<serde_json::Value, String> {
    main_window(&window)?;
    state
        .plugins
        .call(&workspaces, token, id, operation, payload)
        .await
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
    if std::env::args_os()
        .nth(1)
        .is_some_and(|arg| arg == "--mcp-stdio")
    {
        if let Err(error) = mcp::stdio::run(std::env::args_os().skip(2).collect()) {
            eprintln!("Repeaty MCP: {error}");
            std::process::exit(1);
        }
        return;
    }
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
                mcp: Arc::new(mcp::Mcp::with_connection_file(
                    directory.join("mcp.connection.json"),
                )),
                plugins: Plugins::new(&directory)?,
            });
            app.manage(workspaces::Workspaces::new(&directory));
            app.manage(workspace_backups::Backups::new(&directory));
            let collection = collection::Collection::new(&directory)?;
            collection.attach_workspace(app.state::<workspaces::Workspaces>().active_identity());
            app.manage(collection);
            app.manage(collection::Capture::new(&directory)?);
            // Some Wayland environments do not expose a global-hotkey backend. Collection
            // and the rest of the application must remain available there.
            let shortcut_available = app
                .handle()
                .plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(collection::capture_shortcut)
                        .build(),
                )
                .is_ok();
            app.state::<collection::Capture>()
                .set_shortcut_available(shortcut_available);
            let window =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("Repeaty")
                    .decorations(false)
                    .resizable(true)
                    .shadow(true)
                    .inner_size(1280.0, 850.0)
                    .min_inner_size(500.0, 400.0)
                    .on_navigation(|url| {
                        let bundled = matches!(
                            (url.scheme(), url.host_str()),
                            ("tauri", Some("localhost"))
                                | ("http" | "https", Some("tauri.localhost"))
                        );
                        let development = cfg!(debug_assertions)
                            && url.as_str().starts_with("http://localhost:4178/");
                        bundled || development
                    })
                    .on_new_window(|url, _| {
                        let _ = external(url.as_str());
                        tauri::webview::NewWindowResponse::Deny
                    })
                    .on_page_load(|window, payload| {
                        if payload.event() == tauri::webview::PageLoadEvent::Started {
                            window_frame::page_started(&window);
                            window.state::<Desktop>().mcp.detach();
                            window.state::<workspace_backups::Backups>().cancel_all();
                            window.state::<collection::Collection>().invalidate();
                            window.state::<collection::Capture>().invalidate();
                            window
                                .state::<workspaces::Workspaces>()
                                .invalidate_watches();
                        }
                    })
                    .build()?;
            window_frame::install(&window);
            collection::start_capture(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            mcp_attach,
            mcp_workspace,
            mcp_reply,
            mcp_status,
            mcp_start,
            mcp_stop,
            mcp_configuration,
            mcp_client_configuration,
            export_begin,
            export_write,
            export_finish,
            export_cancel,
            plugin_host,
            window_snap_epoch,
            window_snap_region,
            workspaces::workspace_status,
            workspaces::workspace_choose,
            workspaces::workspace_recent,
            workspaces::workspace_close,
            workspaces::workspace_restore,
            workspaces::workspace_read,
            workspaces::workspace_write,
            workspaces::workspace_watch,
            workspaces::workspace_unwatch,
            workspace_backups::workspace_backups,
            workspace_backups::workspace_backup_cancel,
            collection::collection_bind_scope,
            collection::collection_directories,
            collection::collection_directory_choose,
            collection::collection_directory_list,
            collection::collection_directory_read,
            collection::collection_directory_disconnect,
            collection::collection_directory_cancel,
            collection::collection_directory_index,
            collection::collection_directory_search,
            collection::collection_download,
            collection::collection_capture_status,
            collection::collection_capture_configure,
            collection::collection_capture_clipboard,
            collection::collection_capture_take,
            open_external
        ])
        .run(tauri::generate_context!())
        .expect("Unable to start Repeaty");
}
