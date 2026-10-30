use super::{Collection, Result};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use clipboard_rs::{Clipboard, ClipboardContext, ContentFormat, common::RustImage};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    str::FromStr,
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Instant,
};
use tauri::{Emitter, Manager, State};
use tauri_plugin_global_shortcut::{
    GlobalShortcutExt, Modifiers, Shortcut, ShortcutEvent, ShortcutState,
};
#[cfg(target_os = "macos")]
mod macos;
#[cfg(windows)]
mod windows;

const TEXT_LIMIT: usize = 1_000_000;
const IMAGE_LIMIT: usize = 10 * 1024 * 1024;
const TOTAL_LIMIT: usize = 128 * 1024 * 1024;
const FILES_LIMIT: usize = 20;
#[derive(Clone, Copy, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum CaptureMode {
    Selection,
    Clipboard,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CaptureConfiguration {
    pub enabled: bool,
    pub shortcut: String,
    pub mode: CaptureMode,
}
impl Default for CaptureConfiguration {
    fn default() -> Self {
        Self {
            enabled: false,
            shortcut: if cfg!(target_os = "macos") {
                "Alt+A"
            } else {
                "Alt+Shift+C"
            }
            .into(),
            mode: if cfg!(any(windows, target_os = "macos")) {
                CaptureMode::Selection
            } else {
                CaptureMode::Clipboard
            },
        }
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStatus {
    configuration: CaptureConfiguration,
    registered: bool,
    error: Option<String>,
    selection: bool,
    permission: &'static str,
    shortcut_available: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturedFile {
    name: String,
    path: String,
    r#type: String,
    bytes: String,
    size: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturePayload {
    mode: CaptureMode,
    text: Option<String>,
    html: Option<String>,
    files: Vec<CapturedFile>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptureEvent {
    id: String,
    scope: String,
    error: Option<String>,
}
struct Pending {
    id: String,
    scope: String,
    epoch: u64,
    created: Instant,
    payload: CapturePayload,
}
struct CaptureInner {
    configuration: CaptureConfiguration,
    registered: Option<Shortcut>,
    error: Option<String>,
    pending: Option<Pending>,
}
pub struct Capture {
    path: PathBuf,
    inner: Mutex<CaptureInner>,
    busy: AtomicBool,
    shortcut_available: AtomicBool,
}
fn parsed(configuration: &CaptureConfiguration) -> Result<Shortcut> {
    if configuration.shortcut.len() > 100 {
        return Err("capture-shortcut-invalid".into());
    }
    let shortcut =
        Shortcut::from_str(&configuration.shortcut).map_err(|_| "capture-shortcut-invalid")?;
    if !shortcut
        .mods
        .intersects(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SUPER)
    {
        return Err("capture-shortcut-invalid".into());
    }
    if configuration.mode == CaptureMode::Selection && !cfg!(any(windows, target_os = "macos")) {
        return Err("selection-unsupported".into());
    }
    Ok(shortcut)
}
fn permission() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        return macos::permission();
    }
    #[cfg(not(target_os = "macos"))]
    {
        "not-required"
    }
}
impl Capture {
    pub fn new(directory: &Path) -> Result<Self> {
        let path = directory.join("collection-capture.json");
        let directory = cap_std::fs::Dir::open_ambient_dir(directory, cap_std::ambient_authority())
            .map_err(|_| "capture-config-unavailable")?;
        let loaded = (|| -> Result<CaptureConfiguration> {
            let configuration = match super::open_regular(&directory, "collection-capture.json") {
                Ok(file) => {
                    use std::io::Read;
                    let mut bytes = Vec::new();
                    file.take(4097)
                        .read_to_end(&mut bytes)
                        .map_err(|_| "capture-config-unavailable")?;
                    if bytes.len() > 4096 {
                        return Err("capture-config-invalid".into());
                    }
                    serde_json::from_slice(&bytes).map_err(|_| "capture-config-invalid")?
                }
                Err(error) if error == "source-unavailable" => CaptureConfiguration::default(),
                Err(_) => return Err("capture-config-unavailable".into()),
            };
            parsed(&configuration)?;
            Ok(configuration)
        })();
        let (configuration, error) = match loaded {
            Ok(configuration) => (configuration, None),
            Err(error) => (CaptureConfiguration::default(), Some(error)),
        };
        Ok(Self {
            path,
            inner: Mutex::new(CaptureInner {
                configuration,
                registered: None,
                error,
                pending: None,
            }),
            busy: AtomicBool::new(false),
            shortcut_available: AtomicBool::new(false),
        })
    }
    pub fn invalidate(&self) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.pending = None;
        }
    }
    pub fn set_shortcut_available(&self, available: bool) {
        self.shortcut_available.store(available, Ordering::Release);
        if !available && let Ok(mut inner) = self.inner.lock() {
            inner.error = Some("capture-shortcut-unsupported".into());
        }
    }
    fn status(&self) -> Result<CaptureStatus> {
        let inner = self.inner.lock().map_err(|_| "capture-unavailable")?;
        Ok(CaptureStatus {
            configuration: inner.configuration.clone(),
            registered: inner.registered.is_some(),
            error: inner.error.clone(),
            selection: cfg!(any(windows, target_os = "macos")),
            permission: permission(),
            shortcut_available: self.shortcut_available.load(Ordering::Acquire),
        })
    }
    fn save(&self, configuration: &CaptureConfiguration) -> Result<()> {
        let parent = self.path.parent().ok_or("capture-config-unavailable")?;
        let mut temp =
            tempfile::NamedTempFile::new_in(parent).map_err(|_| "capture-config-unavailable")?;
        use std::io::Write;
        temp.write_all(&serde_json::to_vec(configuration).map_err(|_| "capture-config-invalid")?)
            .map_err(|_| "capture-config-unavailable")?;
        temp.as_file()
            .sync_all()
            .map_err(|_| "capture-config-unavailable")?;
        temp.persist(&self.path)
            .map_err(|_| "capture-config-unavailable")?;
        Ok(())
    }
    fn configure(
        &self,
        app: &tauri::AppHandle,
        configuration: CaptureConfiguration,
        save: bool,
    ) -> Result<CaptureStatus> {
        if !self.shortcut_available.load(Ordering::Acquire) {
            return Err("capture-shortcut-unsupported".into());
        }
        let shortcut = parsed(&configuration)?;
        let mut inner = self.inner.lock().map_err(|_| "capture-unavailable")?;
        let old = inner.registered;
        let next = configuration.enabled.then_some(shortcut);
        if next != old
            && let Some(next) = next
        {
            app.global_shortcut()
                .register(next)
                .map_err(|_| "capture-shortcut-unavailable")?;
        }
        if save && let Err(error) = self.save(&configuration) {
            if next != old
                && let Some(next) = next
            {
                let _ = app.global_shortcut().unregister(next);
            }
            return Err(error);
        }
        if old != next
            && let Some(old) = old
        {
            let _ = app.global_shortcut().unregister(old);
        }
        inner.registered = next;
        inner.configuration = configuration;
        inner.error = None;
        drop(inner);
        self.status()
    }
}
pub fn start_capture(app: tauri::AppHandle) {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Capture>();
        let configuration = match state.inner.lock() {
            Ok(inner) if inner.error.is_none() => inner.configuration.clone(),
            _ => return,
        };
        if let Err(error) = state.configure(&app, configuration, false)
            && let Ok(mut inner) = state.inner.lock()
        {
            inner.error = Some(error);
        }
    });
}
fn file_type(path: &str) -> &'static str {
    match path
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "md" | "markdown" => "text/markdown",
        "txt" => "text/plain",
        "html" | "htm" => "text/html",
        "pdf" => "application/pdf",
        "epub" => "application/epub+zip",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
}
fn file_path(raw: &str) -> Result<PathBuf> {
    if raw.starts_with("file:") {
        reqwest::Url::parse(raw)
            .map_err(|_| "unsafe-source-path")?
            .to_file_path()
            .map_err(|_| "unsafe-source-path".into())
    } else {
        Ok(PathBuf::from(raw))
    }
}
fn append_file(
    root: &cap_std::fs::Dir,
    path: &str,
    output_path: String,
    files: &mut Vec<CapturedFile>,
    total: &mut usize,
) -> Result<()> {
    if files.len() >= FILES_LIMIT {
        return Err("capture-file-limit".into());
    }
    let content = super::read_file(root, path, None, None)?;
    *total += content.size as usize;
    if *total > TOTAL_LIMIT {
        return Err("capture-size-limit".into());
    }
    files.push(CapturedFile {
        name: path.rsplit('/').next().ok_or("unsafe-source-path")?.into(),
        r#type: file_type(path).into(),
        path: output_path,
        bytes: content.bytes,
        size: content.size,
    });
    Ok(())
}
fn clipboard_files(paths: Vec<String>) -> Result<Vec<CapturedFile>> {
    if paths.len() > FILES_LIMIT {
        return Err("capture-file-limit".into());
    }
    let mut files = Vec::new();
    let mut total = 0;
    let mut unique = std::collections::HashSet::new();
    for raw in paths {
        let path = file_path(&raw)?;
        if !path.is_absolute()
            || super::linked(&std::fs::symlink_metadata(&path).map_err(super::disk)?)
        {
            return Err("unsafe-source-path".into());
        }
        let path = path.canonicalize().map_err(super::disk)?;
        if !unique.insert(path.clone()) {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or("source-filename-invalid")?;
        super::segments(name)?;
        if path.is_dir() {
            let root = super::open_root(&path)?;
            let mut listing = super::Listing {
                files: vec![],
                skipped: vec![],
                complete: true,
            };
            super::walk(&root, "", 0, &mut 0, &mut listing)?;
            // Do not silently omit oversized documents from a captured directory.
            if listing.skipped.iter().any(|s| s.reason == "file-too-large") {
                return Err("source-file-too-large".into());
            }
            listing.files.sort_by(|a, b| a.path.cmp(&b.path));
            for entry in listing.files {
                append_file(
                    &root,
                    &entry.path,
                    format!("{name}/{}", entry.path),
                    &mut files,
                    &mut total,
                )?;
            }
        } else {
            let parent = path.parent().ok_or("unsafe-source-path")?;
            let root = cap_std::fs::Dir::open_ambient_dir(parent, cap_std::ambient_authority())
                .map_err(super::disk)?;
            append_file(&root, name, name.into(), &mut files, &mut total)?;
        }
    }
    Ok(files)
}
fn clipboard() -> Result<CapturePayload> {
    let clipboard = ClipboardContext::new().map_err(|_| "clipboard-unavailable")?;
    if clipboard.has(ContentFormat::Files) {
        let files = clipboard_files(clipboard.get_files().map_err(|_| "clipboard-read-failed")?)?;
        if files.is_empty() {
            return Err("clipboard-empty".into());
        }
        return Ok(CapturePayload {
            mode: CaptureMode::Clipboard,
            text: None,
            html: None,
            files,
        });
    }
    let text = if clipboard.has(ContentFormat::Text) {
        Some(clipboard.get_text().map_err(|_| "clipboard-read-failed")?)
    } else {
        None
    };
    let html = if clipboard.has(ContentFormat::Html) {
        Some(clipboard.get_html().map_err(|_| "clipboard-read-failed")?)
    } else {
        None
    };
    if text.as_ref().is_some_and(|t| t.len() > TEXT_LIMIT)
        || html.as_ref().is_some_and(|h| h.len() > TEXT_LIMIT)
    {
        return Err("capture-size-limit".into());
    }
    let mut files = vec![];
    if text.as_ref().is_none_or(|text| text.trim().is_empty())
        && clipboard.has(ContentFormat::Image)
    {
        let image = clipboard
            .get_image()
            .map_err(|_| "clipboard-image-invalid")?;
        let (width, height) = image.get_size();
        if width as u64 * height as u64 > 25_000_000 {
            return Err("capture-image-limit".into());
        }
        let png = image.to_png().map_err(|_| "clipboard-image-invalid")?;
        let bytes = png.get_bytes();
        if bytes.len() > IMAGE_LIMIT {
            return Err("capture-image-limit".into());
        }
        files.push(CapturedFile {
            name: "clipboard.png".into(),
            path: "clipboard.png".into(),
            r#type: "image/png".into(),
            bytes: STANDARD.encode(bytes),
            size: bytes.len() as u64,
        });
    }
    if text.as_ref().is_none_or(|t| t.trim().is_empty())
        && html.as_ref().is_none_or(|h| h.trim().is_empty())
        && files.is_empty()
    {
        return Err("clipboard-empty".into());
    }
    Ok(CapturePayload {
        mode: CaptureMode::Clipboard,
        text,
        html,
        files,
    })
}
#[cfg(not(any(windows, target_os = "macos")))]
fn selected_text(_limit: usize) -> Result<String> {
    Err("selection-unsupported".into())
}
#[cfg(target_os = "macos")]
use macos::selection as selected_text;
#[cfg(windows)]
use windows::selection as selected_text;
fn collect(mode: CaptureMode) -> Result<CapturePayload> {
    if mode == CaptureMode::Clipboard {
        return clipboard();
    }
    let text = selected_text(TEXT_LIMIT)?;
    if text.trim().is_empty() {
        return Err("selection-empty".into());
    }
    if text.len() > TEXT_LIMIT {
        return Err("capture-size-limit".into());
    }
    Ok(CapturePayload {
        mode,
        text: Some(text),
        html: None,
        files: vec![],
    })
}
pub fn capture_shortcut(app: &tauri::AppHandle, shortcut: &Shortcut, event: ShortcutEvent) {
    if event.state != ShortcutState::Released {
        return;
    }
    let Some(capture) = app.try_state::<Capture>() else {
        return;
    };
    let mode = match capture.inner.lock() {
        Ok(inner) if inner.registered.as_ref() == Some(shortcut) => inner.configuration.mode,
        _ => return,
    };
    if capture.busy.swap(true, Ordering::AcqRel) {
        return;
    }
    // Bind to the library active at key release, before queuing any blocking work.
    let collection = app.state::<Collection>();
    let (scope, epoch) = match collection.0.lock() {
        Ok(inner) if inner.check(&inner.scope).is_ok() => (inner.scope.clone(), inner.epoch),
        _ => {
            capture.busy.store(false, Ordering::Release);
            return;
        }
    };
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let capture = app.state::<Capture>();
        let collection = app.state::<Collection>();
        let id = uuid::Uuid::new_v4().to_string();
        let pending = capture.inner.lock().is_ok_and(|inner| {
            inner.pending.as_ref().is_some_and(|pending| {
                pending.created.elapsed().as_secs() <= 60
                    && pending.scope == scope
                    && pending.epoch == epoch
            })
        });
        let result = if pending {
            Err("capture-awaiting-save".into())
        } else {
            collect(mode)
        };
        let current = collection
            .0
            .lock()
            .is_ok_and(|inner| inner.check(&scope).is_ok() && inner.epoch == epoch);
        if current {
            let error = match result {
                Ok(payload) => match capture.inner.lock() {
                    Ok(mut inner) => {
                        inner.pending = Some(Pending {
                            id: id.clone(),
                            scope: scope.clone(),
                            epoch,
                            created: Instant::now(),
                            payload,
                        });
                        None
                    }
                    Err(_) => Some("capture-unavailable".into()),
                },
                Err(error) => Some(error),
            };
            if let Some(window) = app.get_webview_window("main") {
                let expires_app = app.clone();
                let expires_id = id.clone();
                if error.is_none() {
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(std::time::Duration::from_secs(60)).await;
                        if let Some(state) = expires_app.try_state::<Capture>()
                            && let Ok(mut inner) = state.inner.lock()
                            && inner
                                .pending
                                .as_ref()
                                .is_some_and(|pending| pending.id == expires_id)
                        {
                            inner.pending = None;
                        }
                    });
                }
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
                let _ = window.emit("repeaty-capture", CaptureEvent { id, scope, error });
            }
        }
        capture.busy.store(false, Ordering::Release);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn requires_modified_shortcuts_and_preserves_configuration_across_restart() {
        let device = tempfile::tempdir().unwrap();
        let state = Capture::new(device.path()).unwrap();
        let configuration = CaptureConfiguration {
            enabled: true,
            shortcut: "Alt+Shift+K".into(),
            mode: CaptureMode::Clipboard,
        };
        assert!(parsed(&configuration).is_ok());
        assert!(
            parsed(&CaptureConfiguration {
                shortcut: "A".into(),
                ..configuration.clone()
            })
            .is_err()
        );
        assert!(
            parsed(&CaptureConfiguration {
                shortcut: "Shift+A".into(),
                ..configuration.clone()
            })
            .is_err()
        );
        state.save(&configuration).unwrap();
        let restored = Capture::new(device.path()).unwrap();
        assert_eq!(
            restored.status().unwrap().configuration.shortcut,
            "Alt+Shift+K"
        );
        assert!(restored.status().unwrap().configuration.enabled);
        assert!(!restored.status().unwrap().registered);
    }
    #[test]
    fn damaged_hotkey_preferences_disable_capture_without_preventing_startup_or_overwriting_them() {
        let device = tempfile::tempdir().unwrap();
        std::fs::write(device.path().join("collection-capture.json"), "broken").unwrap();
        let state = Capture::new(device.path()).unwrap();
        let status = state.status().unwrap();
        assert!(!status.configuration.enabled);
        assert_eq!(status.error.as_deref(), Some("capture-config-invalid"));
        assert_eq!(
            std::fs::read_to_string(device.path().join("collection-capture.json")).unwrap(),
            "broken"
        );
    }
    #[test]
    fn snapshots_selected_files_and_directories_without_modifying_them() {
        let source = tempfile::Builder::new()
            .prefix("repeaty-capture-")
            .tempdir()
            .unwrap();
        std::fs::create_dir(source.path().join("chapters")).unwrap();
        std::fs::write(source.path().join("chapters/中文.md"), "学习材料").unwrap();
        std::fs::create_dir(source.path().join(".obsidian")).unwrap();
        std::fs::write(source.path().join(".obsidian/preferences.json"), "private").unwrap();
        let files = clipboard_files(vec![source.path().to_string_lossy().into_owned()]).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "中文.md");
        assert_eq!(
            STANDARD.decode(&files[0].bytes).unwrap(),
            "学习材料".as_bytes()
        );
        assert_eq!(
            std::fs::read_to_string(source.path().join(".obsidian/preferences.json")).unwrap(),
            "private"
        );
    }
}
#[tauri::command]
pub fn collection_capture_status(
    window: tauri::WebviewWindow,
    state: State<'_, Capture>,
) -> Result<CaptureStatus> {
    crate::main_window(&window)?;
    state.status()
}
#[tauri::command]
pub async fn collection_capture_configure(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    configuration: CaptureConfiguration,
) -> Result<CaptureStatus> {
    crate::main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<Capture>().configure(&app, configuration, true)
    })
    .await
    .map_err(|_| "capture-unavailable")?
}
#[tauri::command]
pub async fn collection_capture_clipboard(
    window: tauri::WebviewWindow,
    state: State<'_, Collection>,
    expected_scope: String,
) -> Result<CapturePayload> {
    crate::main_window(&window)?;
    let manager = state.0.clone();
    let epoch = manager
        .lock()
        .map_err(|_| "capture-unavailable")?
        .check(&expected_scope)?;
    let payload = tauri::async_runtime::spawn_blocking(clipboard)
        .await
        .map_err(|_| "capture-unavailable")??;
    if manager
        .lock()
        .map_err(|_| "capture-unavailable")?
        .check(&expected_scope)?
        != epoch
    {
        return Err("stale-collection-scope".into());
    }
    Ok(payload)
}
#[tauri::command]
pub fn collection_capture_take(
    window: tauri::WebviewWindow,
    state: State<'_, Capture>,
    collection: State<'_, Collection>,
    expected_scope: String,
    id: String,
) -> Result<CapturePayload> {
    crate::main_window(&window)?;
    let epoch = collection
        .0
        .lock()
        .map_err(|_| "capture-unavailable")?
        .check(&expected_scope)?;
    let mut inner = state.inner.lock().map_err(|_| "capture-unavailable")?;
    if inner.pending.as_ref().is_some_and(|p| {
        p.created.elapsed().as_secs() > 60 || p.epoch != epoch || p.scope != expected_scope
    }) {
        inner.pending = None;
    }
    let pending = inner.pending.as_ref().ok_or("capture-expired")?;
    if pending.id != id
        || pending.scope != expected_scope
        || pending.epoch != epoch
        || pending.created.elapsed().as_secs() > 60
    {
        return Err("capture-expired".into());
    }
    Ok(inner.pending.take().ok_or("capture-expired")?.payload)
}
