//! Native picker is the only source of a new ambient directory capability.
use crate::main_window;
use repeaty_workspace::preview::{Scan, Sessions, Status, error_code};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::State;
use tauri_plugin_dialog::DialogExt;

struct Inner {
    directory: PathBuf,
    sessions: Option<Result<Sessions, String>>,
}
pub struct Preview(Arc<Mutex<Inner>>);
impl Preview {
    pub fn new(device_directory: &Path) -> Self {
        Self(Arc::new(Mutex::new(Inner {
            directory: device_directory.to_owned(),
            sessions: None,
        })))
    }
}
async fn run<T: Send + 'static>(
    state: &Preview,
    task: impl FnOnce(&mut Sessions) -> repeaty_workspace::prototype::Result<T> + Send + 'static,
) -> Result<T, String> {
    let manager = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = manager
            .lock()
            .map_err(|_| "workspace-unavailable".to_string())?;
        // Do not touch a remembered disk or open SQLite while creating the app window.
        if guard.sessions.as_ref().is_none_or(|result| result.is_err()) {
            guard.sessions =
                Some(Sessions::open(&guard.directory).map_err(|e| error_code(e.as_ref())));
        }
        let sessions = guard
            .sessions
            .as_mut()
            .ok_or("workspace-unavailable")?
            .as_mut()
            .map_err(|e| e.clone())?;
        task(sessions).map_err(|e| error_code(e.as_ref()))
    })
    .await
    .map_err(|_| "workspace-unavailable".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn failed_lazy_initialization_can_retry_without_restarting_the_client() {
        let parent = tempfile::tempdir().unwrap();
        let directory = parent.path().join("device");
        let state = Preview::new(&directory);
        assert!(run(&state, |sessions| sessions.status()).await.is_err());
        std::fs::create_dir(&directory).unwrap();
        assert!(run(&state, |sessions| sessions.status()).await.is_ok());
    }
}

#[tauri::command]
pub async fn workspace_preview_status(
    window: tauri::WebviewWindow,
    state: State<'_, Preview>,
) -> Result<Status, String> {
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
pub async fn workspace_preview_choose(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, Preview>,
    epoch: String,
    mode: ChooseMode,
) -> Result<Option<Status>, String> {
    main_window(&window)?;
    let before = run(&state, |s| s.status()).await?;
    if before.epoch != epoch {
        return Err("stale-workspace-session".into());
    }
    let selected =
        tauri::async_runtime::spawn_blocking(move || app.dialog().file().blocking_pick_folder())
            .await
            .map_err(|_| "workspace-unavailable")?;
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
pub async fn workspace_preview_recent(
    window: tauri::WebviewWindow,
    state: State<'_, Preview>,
    epoch: String,
    path: String,
    id: String,
) -> Result<Status, String> {
    main_window(&window)?;
    run(&state, move |s| s.recent(&epoch, &path, &id)).await
}
#[tauri::command]
pub async fn workspace_preview_close(
    window: tauri::WebviewWindow,
    state: State<'_, Preview>,
    epoch: String,
) -> Result<Status, String> {
    main_window(&window)?;
    run(&state, move |s| s.close(&epoch)).await
}
#[tauri::command]
pub async fn workspace_preview_restore(
    window: tauri::WebviewWindow,
    state: State<'_, Preview>,
    epoch: String,
) -> Result<Status, String> {
    main_window(&window)?;
    run(&state, move |s| s.restore(&epoch)).await
}
#[tauri::command]
pub async fn workspace_preview_scan(
    window: tauri::WebviewWindow,
    state: State<'_, Preview>,
    token: String,
) -> Result<Scan, String> {
    main_window(&window)?;
    run(&state, move |s| s.scan(&token)).await
}
