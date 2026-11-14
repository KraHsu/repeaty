use crate::main_window;
use repeaty_workspace::{error::Result as StoreResult, sessions::Sessions};
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;
struct Inner {
    directory: PathBuf,
    sessions: Option<Sessions>,
    subscription: Option<String>,
    sync_device: Option<String>,
    sync_service: Option<std::sync::Weak<crate::device_sync::SyncService>>,
}
pub type ActiveIdentity = Arc<Mutex<(String, String)>>;
pub struct Workspaces(Arc<Mutex<Inner>>, Arc<AtomicU64>, ActiveIdentity);
impl Workspaces {
    pub fn new(directory: &Path) -> Self {
        Self(
            Arc::new(Mutex::new(Inner {
                directory: directory.into(),
                sessions: None,
                subscription: None,
                sync_device: None,
                sync_service: None,
            })),
            Arc::new(AtomicU64::new(0)),
            Arc::new(Mutex::new((String::new(), String::new()))),
        )
    }
    pub fn invalidate_watches(&self) {
        self.1.fetch_add(1, Ordering::AcqRel);
    }
    pub fn active_identity(&self) -> ActiveIdentity {
        self.2.clone()
    }
    pub fn attach_sync(
        &self,
        service: &Arc<crate::device_sync::SyncService>,
    ) -> Result<(), String> {
        let mut guard = self.0.lock().map_err(|_| "storage-error")?;
        guard.sync_device = Some(
            service.status()?["deviceId"]
                .as_str()
                .ok_or("sync-device-required")?
                .into(),
        );
        guard.sync_service = Some(Arc::downgrade(service));
        Ok(())
    }
    pub fn sync_handler(&self) -> crate::device_sync::Handler {
        let manager = self.0.clone();
        Arc::new(move |scope, method, payload| {
            let mut guard = manager.lock().map_err(|_| "storage-error".to_owned())?;
            let sessions = guard.sessions.as_mut().ok_or("workspace-not-open")?;
            let status = sessions
                .sync_request(&scope.token, "journal/status", Value::Null)
                .map_err(|e| e.0.to_owned())?;
            if status["groupId"] != scope.group_id {
                return Err("sync-wrong-group".into());
            }
            sessions
                .sync_request(&scope.token, method, payload)
                .map_err(|e| e.0.to_owned())
        })
    }
}
/// Serialize plugin filesystem operations with workspace switching and use a held root capability.
pub async fn with_plugin_workspace<T: Send + 'static>(
    state: &Workspaces,
    token: String,
    task: impl FnOnce(cap_std::fs::Dir) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let manager = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = manager.lock().map_err(|_| "storage-error".to_owned())?;
        if guard.sessions.is_none() {
            guard.sessions = Some(Sessions::open(&guard.directory).map_err(|e| e.0.to_owned())?);
        }
        let root = guard
            .sessions
            .as_ref()
            .ok_or("workspace-not-open")?
            .plugin_root(&token)
            .map_err(|e| e.0.to_owned())?;
        task(root)
    })
    .await
    .map_err(|_| "storage-error".to_owned())?
}
#[tauri::command]
pub async fn workspace_watch(
    window: tauri::WebviewWindow,
    state: State<'_, Workspaces>,
    token: String,
    on_change: tauri::ipc::Channel<repeaty_workspace::watch::Changes>,
) -> Result<String, String> {
    main_window(&window)?;
    let manager = state.0.clone();
    let epoch = state.1.clone();
    let generation = epoch.load(Ordering::Acquire);
    let id = uuid::Uuid::new_v4().to_string();
    let registering = manager.clone();
    let expected = token.clone();
    let subscription = id.clone();
    let current = epoch.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = registering.lock().map_err(|_| "storage-error".to_owned())?;
        if current.load(Ordering::Acquire) != generation {
            return Err("stale-workspace-session".to_owned());
        }
        guard
            .sessions
            .as_ref()
            .ok_or("workspace-not-open")?
            .watch_session(&expected)
            .map_err(|e| e.0.to_owned())?;
        guard.subscription = Some(subscription);
        Ok(())
    })
    .await
    .map_err(|_| "storage-error".to_owned())??;
    let subscription = id.clone();
    tauri::async_runtime::spawn(async move {
        let mut ticks = tokio::time::interval(std::time::Duration::from_millis(150));
        loop {
            ticks.tick().await;
            if epoch.load(Ordering::Acquire) != generation {
                break;
            }
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
pub(crate) async fn run<T: Send + 'static>(
    state: &Workspaces,
    task: impl FnOnce(&mut Sessions) -> StoreResult<T> + Send + 'static,
) -> Result<T, String> {
    run_checked(state, move |sessions| {
        task(sessions).map_err(|e| e.0.to_owned())
    })
    .await
}
pub(crate) async fn run_checked<T: Send + 'static>(
    state: &Workspaces,
    task: impl FnOnce(&mut Sessions) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let manager = state.0.clone();
    let identity = state.2.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = manager.lock().map_err(|_| "storage-error".to_owned())?;
        if guard.sessions.is_none() {
            guard.sessions = Some(Sessions::open(&guard.directory).map_err(|e| e.0.to_owned())?);
        }
        let device = guard.sync_device.clone();
        let sessions = guard.sessions.as_mut().ok_or("storage-error")?;
        if let Some(device) = &device {
            sessions
                .sync_bind_device(device)
                .map_err(|e| e.0.to_owned())?;
        }
        let previous = sessions
            .active_identity()
            .map(|(_, token)| token.to_owned());
        let result = task(sessions);
        if let Some(device) = &device {
            // A successful learning commit remains successful. Publication of sync
            // events rechecks and durably advances the device frontier before sending.
            let _ = sessions.sync_bind_device(device);
        }
        let active = sessions
            .active_identity()
            .map(|(id, token)| (format!("local:workspace:{id}"), token.to_owned()))
            .unwrap_or_default();
        *identity.lock().map_err(|_| "storage-error")? = active;
        if previous
            != guard
                .sessions
                .as_ref()
                .and_then(|s| s.active_identity().map(|(_, token)| token.to_owned()))
            && let Some(service) = guard.sync_service.as_ref().and_then(|s| s.upgrade())
        {
            service.deactivate();
        }
        result
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
