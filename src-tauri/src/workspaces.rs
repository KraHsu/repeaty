use crate::main_window;
use repeaty_workspace::{error::Result as StoreResult, sessions::Sessions};
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;
struct Inner {
    directory: PathBuf,
    sessions: Option<Sessions>,
    subscription: Option<String>,
}
pub struct Workspaces(Arc<Mutex<Inner>>);
impl Workspaces {
    pub fn new(directory: &Path) -> Self {
        Self(Arc::new(Mutex::new(Inner {
            directory: directory.into(),
            sessions: None,
            subscription: None,
        })))
    }
}
#[tauri::command]
pub async fn workspace_watch(
    window: tauri::WebviewWindow,
    state: State<'_, Workspaces>,
    token: String,
    on_change: tauri::ipc::Channel<repeaty_workspace::watch::Changes>,
) -> Result<String, String> {
    main_window(&window)?;
    let expected = token.clone();
    run(&state, move |sessions| sessions.watch_session(&expected)).await?;
    let manager = state.0.clone();
    let id = uuid::Uuid::new_v4().to_string();
    manager.lock().map_err(|_| "storage-error")?.subscription = Some(id.clone());
    let subscription = id.clone();
    tauri::async_runtime::spawn(async move {
        let mut ticks = tokio::time::interval(std::time::Duration::from_millis(150));
        loop {
            ticks.tick().await;
            let manager = manager.clone();
            let subscription = subscription.clone();
            let token = token.clone();
            let event = tauri::async_runtime::spawn_blocking(move || {
                let guard = manager.lock().map_err(|_| ())?;
                if guard.subscription.as_deref() != Some(&subscription) {
                    return Err(());
                }
                guard
                    .sessions
                    .as_ref()
                    .ok_or(())?
                    .changes(&token)
                    .map_err(|_| ())
            })
            .await;
            match event {
                Ok(Ok(Some(event))) => {
                    if on_change.send(event).is_err() {
                        break;
                    }
                }
                Ok(Ok(None)) => {}
                _ => break,
            }
        }
    });
    Ok(id)
}
#[tauri::command]
pub async fn workspace_unwatch(
    window: tauri::WebviewWindow,
    state: State<'_, Workspaces>,
    id: String,
) -> Result<(), String> {
    main_window(&window)?;
    let manager = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = manager.lock().map_err(|_| "storage-error".to_owned())?;
        if guard.subscription.as_deref() == Some(&id) {
            guard.subscription = None;
        }
        Ok(())
    })
    .await
    .map_err(|_| "storage-error".to_owned())?
}
async fn run<T: Send + 'static>(
    state: &Workspaces,
    task: impl FnOnce(&mut Sessions) -> StoreResult<T> + Send + 'static,
) -> Result<T, String> {
    let manager = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = manager.lock().map_err(|_| "storage-error".to_owned())?;
        if guard.sessions.is_none() {
            guard.sessions = Some(Sessions::open(&guard.directory).map_err(|e| e.0.to_owned())?);
        }
        task(guard.sessions.as_mut().ok_or("storage-error")?).map_err(|e| e.0.to_owned())
    })
    .await
    .map_err(|_| "storage-error".to_owned())?
}
#[tauri::command]
pub async fn workspace_status(
    window: tauri::WebviewWindow,
    state: State<'_, Workspaces>,
) -> Result<Value, String> {
    main_window(&window)?;
    run(&state, |s| s.status()).await
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChooseMode {
    Create,
    Open,
}
#[tauri::command]
pub async fn workspace_choose(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, Workspaces>,
    epoch: String,
    mode: ChooseMode,
) -> Result<Option<Value>, String> {
    main_window(&window)?;
    let expected = epoch.clone();
    run(&state, move |s| s.check_epoch(&expected)).await?;
    let selected = tauri::async_runtime::spawn_blocking(move || {
        let mut picker = app.dialog().file();
        if let Ok(home) = app.path().home_dir() {
            picker = picker.set_directory(home);
        }
        picker.blocking_pick_folder()
    })
    .await
    .map_err(|_| "storage-error")?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected.into_path().map_err(|_| "invalid-path")?;
    run(&state, move |s| {
        s.choose(&epoch, &path, matches!(mode, ChooseMode::Create))
    })
    .await
    .map(Some)
}
#[tauri::command]
pub async fn workspace_recent(
    window: tauri::WebviewWindow,
    state: State<'_, Workspaces>,
    epoch: String,
    path: String,
    id: String,
) -> Result<Value, String> {
    main_window(&window)?;
    run(&state, move |s| s.recent(&epoch, &path, &id)).await
}
#[tauri::command]
pub async fn workspace_close(
    window: tauri::WebviewWindow,
    state: State<'_, Workspaces>,
    epoch: String,
) -> Result<Value, String> {
    main_window(&window)?;
    run(&state, move |s| s.close(&epoch)).await
}
#[tauri::command]
pub async fn workspace_restore(
    window: tauri::WebviewWindow,
    state: State<'_, Workspaces>,
    epoch: String,
) -> Result<Value, String> {
    main_window(&window)?;
    run(&state, move |s| s.restore(&epoch)).await
}
#[tauri::command]
pub async fn workspace_read(
    window: tauri::WebviewWindow,
    state: State<'_, Workspaces>,
    token: String,
    request: Value,
) -> Result<Value, String> {
    main_window(&window)?;
    run(&state, move |s| s.read(&token, request)).await
}
#[tauri::command]
pub async fn workspace_write(
    window: tauri::WebviewWindow,
    state: State<'_, Workspaces>,
    token: String,
    request: Value,
) -> Result<Value, String> {
    main_window(&window)?;
    run(&state, move |s| s.write(&token, request)).await
}
