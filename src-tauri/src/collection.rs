//! Device-owned, read-only directory capabilities for collection and source connectors.
mod capture;
pub use capture::*;
mod index;
pub use index::*;
mod download;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use cap_std::fs::{Dir, OpenOptions};
pub use download::*;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs::File,
    io::{Read, Seek, Write},
    path::{Component, Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::UNIX_EPOCH,
};
use tauri::State;
use tauri_plugin_dialog::DialogExt;

type Result<T> = std::result::Result<T, String>;
const FILE_LIMIT: u64 = 64 * 1024 * 1024;
const FILE_COUNT: usize = 10_000;
const ENTRY_COUNT: usize = 50_000;
const DEPTH_LIMIT: usize = 32;
const CONNECTION_LIMIT: usize = 128;
const CONFIG_LIMIT: u64 = 128 * 1024;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Grant {
    id: String,
    path: PathBuf,
    scope: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub id: String,
    pub name: String,
    pub path: String,
    pub available: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub path: String,
    pub size: u64,
    /// Decimal nanoseconds since the epoch. A string avoids JS integer truncation.
    pub modified: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Skipped {
    path: String,
    reason: &'static str,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    pub files: Vec<Entry>,
    skipped: Vec<Skipped>,
    /// An over-limit/failed traversal is an error, never a partial snapshot.
    complete: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Content {
    bytes: String,
    size: u64,
    modified: String,
}
struct Inner {
    config: Dir,
    index_path: PathBuf,
    grants: Vec<Grant>,
    scope: String,
    epoch: u64,
    identity: Option<crate::workspaces::ActiveIdentity>,
    session_token: String,
    operations: HashMap<String, Arc<AtomicU64>>,
}
pub struct Collection(Arc<Mutex<Inner>>, Arc<Mutex<()>>);
struct OperationLease {
    counter: Arc<AtomicU64>,
    generation: u64,
    identity: Option<crate::workspaces::ActiveIdentity>,
    scope: String,
    token: String,
}
impl OperationLease {
    fn check(&self) -> Result<()> {
        if self.counter.load(Ordering::Acquire) != self.generation {
            return Err("source-operation-cancelled".into());
        }
        if let Some(identity) = &self.identity {
            let active = identity.lock().map_err(|_| "stale-collection-scope")?;
            if active.0 != self.scope || active.1 != self.token {
                return Err("stale-collection-scope".into());
            }
        }
        Ok(())
    }
}

fn disk(error: std::io::Error) -> String {
    match error.kind() {
        std::io::ErrorKind::NotFound => "source-unavailable",
        std::io::ErrorKind::PermissionDenied => "permission-denied",
        _ => "source-read-failed",
    }
    .into()
}
fn linked(metadata: &std::fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    false
}
fn regular(file: &File) -> Result<()> {
    let metadata = file.metadata().map_err(disk)?;
    if !metadata.is_file() || linked(&metadata) {
        return Err("unsafe-source-path".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 {
            return Err("unsafe-source-path".into());
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            BY_HANDLE_FILE_INFORMATION, GetFileInformationByHandle,
        };
        // SAFETY: file owns a live handle and info is a valid output structure.
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 {
            return Err(disk(std::io::Error::last_os_error()));
        }
        if info.nNumberOfLinks != 1 {
            return Err("unsafe-source-path".into());
        }
    }
    Ok(())
}
fn directory(parent: &Dir, name: &Path) -> Result<Dir> {
    let held = parent.try_clone().map_err(disk)?.into_std_file();
    let file = cap_primitives::fs::open_dir_nofollow(&held, name).map_err(disk)?;
    if linked(&file.metadata().map_err(disk)?) {
        return Err("unsafe-source-path".into());
    }
    Ok(Dir::from_std_file(file))
}
fn open_root(path: &Path) -> Result<Dir> {
    let parent = path.parent().ok_or("unsafe-source-path")?;
    let name = path.file_name().ok_or("unsafe-source-path")?;
    let parent = Dir::open_ambient_dir(parent, cap_std::ambient_authority()).map_err(disk)?;
    directory(&parent, Path::new(name))
}
fn open_regular(dir: &Dir, name: &str) -> Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use cap_std::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    #[cfg(windows)]
    {
        use cap_std::fs::OpenOptionsExt;
        options.custom_flags(0x00200000);
    }
    let file = dir.open_with(name, &options).map_err(disk)?.into_std();
    regular(&file)?;
    Ok(file)
}
fn excluded(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    name.starts_with('.')
        || name.starts_with('~')
        || name.ends_with('~')
        || lower.ends_with(".tmp")
        || lower.ends_with(".swp")
        || lower.ends_with(".bak")
        || matches!(
            lower.as_str(),
            "node_modules"
                | "target"
                | "$recycle.bin"
                | "system volume information"
                | "thumbs.db"
                | "desktop.ini"
        )
}
fn segments(path: &str) -> Result<Vec<&str>> {
    if path.is_empty() || path.len() > 4096 || path.contains(['\\', ':', '\0']) {
        return Err("unsafe-source-path".into());
    }
    let parts: Vec<_> = path.split('/').collect();
    if parts.len() > DEPTH_LIMIT + 1
        || parts
            .iter()
            .any(|s| s.is_empty() || excluded(s) || s.ends_with(['.', ' ']))
        || Path::new(path)
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err("unsafe-source-path".into());
    }
    Ok(parts)
}
fn modified(metadata: &std::fs::Metadata) -> Result<String> {
    Ok(metadata
        .modified()
        .map_err(disk)?
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "source-timestamp-invalid")?
        .as_nanos()
        .to_string())
}
fn read_file(
    root: &Dir,
    path: &str,
    expected_size: Option<u64>,
    expected_modified: Option<&str>,
) -> Result<Content> {
    read_file_checked(root, path, expected_size, expected_modified, &|| Ok(()))
}
fn read_bytes(file: &mut File, limit: u64, check: &dyn Fn() -> Result<()>) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    let mut chunk = [0u8; 65536];
    loop {
        check()?;
        let count = file.read(&mut chunk).map_err(disk)?;
        if count == 0 {
            return Ok(bytes);
        }
        if bytes.len() as u64 + count as u64 > limit {
            return Err("source-file-too-large".into());
        }
        bytes.extend_from_slice(&chunk[..count]);
    }
}
fn read_file_checked(
    root: &Dir,
    path: &str,
    expected_size: Option<u64>,
    expected_modified: Option<&str>,
    check: &dyn Fn() -> Result<()>,
) -> Result<Content> {
    check()?;
    let parts = segments(path)?;
    let mut parent = root.try_clone().map_err(disk)?;
    for part in &parts[..parts.len() - 1] {
        parent = directory(&parent, Path::new(part))?;
    }
    let mut file = open_regular(&parent, parts[parts.len() - 1])?;
    let before = file.metadata().map_err(disk)?;
    let stamp = modified(&before)?;
    if before.len() > FILE_LIMIT {
        return Err("source-file-too-large".into());
    }
    if expected_size.is_some_and(|s| s != before.len())
        || expected_modified.is_some_and(|m| m != stamp)
    {
        return Err("source-file-changed".into());
    }
    let first = read_bytes(&mut file, FILE_LIMIT, check)?;
    file.rewind().map_err(disk)?;
    let second = read_bytes(&mut file, FILE_LIMIT, check)?;
    let after = file.metadata().map_err(disk)?;
    if first != second
        || first.len() as u64 != before.len()
        || before.len() != after.len()
        || stamp != modified(&after)?
    {
        return Err("source-file-changed".into());
    }
    Ok(Content {
        bytes: STANDARD.encode(first),
        size: before.len(),
        modified: stamp,
    })
}
fn walk(
    root: &Dir,
    prefix: &str,
    depth: usize,
    count: &mut usize,
    listing: &mut Listing,
) -> Result<()> {
    walk_checked(root, prefix, depth, count, listing, &|| Ok(()))
}
fn walk_checked(
    root: &Dir,
    prefix: &str,
    depth: usize,
    count: &mut usize,
    listing: &mut Listing,
    check: &dyn Fn() -> Result<()>,
) -> Result<()> {
    check()?;
    for item in root.entries().map_err(disk)? {
        check()?;
        let item = item.map_err(disk)?;
        *count += 1;
        if *count > ENTRY_COUNT {
            return Err("source-directory-too-large".into());
        }
        let Some(name) = item.file_name().to_str().map(str::to_owned) else {
            return Err("source-filename-invalid".into());
        };
        let path = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}/{name}")
        };
        if excluded(&name) {
            listing.skipped.push(Skipped {
                path,
                reason: "private-or-temporary",
            });
            continue;
        }
        segments(&path)?;
        let kind = item.file_type().map_err(disk)?;
        if kind.is_symlink() {
            listing.skipped.push(Skipped {
                path,
                reason: "link",
            });
            continue;
        }
        if kind.is_dir() {
            if depth >= DEPTH_LIMIT {
                return Err("source-directory-too-deep".into());
            }
            let child = match directory(root, Path::new(&name)) {
                Ok(child) => child,
                Err(error) if error == "unsafe-source-path" => {
                    listing.skipped.push(Skipped {
                        path,
                        reason: "link",
                    });
                    continue;
                }
                Err(error) => return Err(error),
            };
            walk_checked(&child, &path, depth + 1, count, listing, check)?;
        } else if kind.is_file() {
            let file = match open_regular(root, &name) {
                Ok(file) => file,
                Err(error) if error == "unsafe-source-path" => {
                    listing.skipped.push(Skipped {
                        path,
                        reason: "link",
                    });
                    continue;
                }
                Err(error) => return Err(error),
            };
            let metadata = file.metadata().map_err(disk)?;
            if metadata.len() > FILE_LIMIT {
                listing.skipped.push(Skipped {
                    path,
                    reason: "file-too-large",
                });
                continue;
            }
            if listing.files.len() >= FILE_COUNT {
                return Err("source-directory-too-large".into());
            }
            listing.files.push(Entry {
                path,
                size: metadata.len(),
                modified: modified(&metadata)?,
            });
        } else {
            listing.skipped.push(Skipped {
                path,
                reason: "not-a-file",
            });
        }
    }
    Ok(())
}
impl Inner {
    fn begin(&mut self, scope: &str, id: &str) -> Result<OperationLease> {
        self.check(scope)?;
        if !self
            .grants
            .iter()
            .any(|grant| grant.id == id && grant.scope == scope)
        {
            return Err("source-grant-missing".into());
        }
        let counter = self
            .operations
            .entry(id.into())
            .or_insert_with(|| Arc::new(AtomicU64::new(0)))
            .clone();
        Ok(OperationLease {
            generation: counter.load(Ordering::Acquire),
            counter,
            identity: self.identity.clone(),
            scope: scope.into(),
            token: self.session_token.clone(),
        })
    }
    fn cancel_all(&self) {
        for counter in self.operations.values() {
            counter.fetch_add(1, Ordering::AcqRel);
        }
    }
    fn check(&self, scope: &str) -> Result<u64> {
        if scope.is_empty() || self.scope != scope {
            return Err("stale-collection-scope".into());
        }
        if let Some(identity) = &self.identity {
            let active = identity.lock().map_err(|_| "stale-collection-scope")?;
            if active.0 != scope || active.1 != self.session_token {
                return Err("stale-collection-scope".into());
            }
        }
        Ok(self.epoch)
    }
    fn save(&self, grants: &[Grant]) -> Result<()> {
        let bytes = serde_json::to_vec(grants).map_err(|_| "source-config-invalid")?;
        if bytes.len() as u64 > CONFIG_LIMIT {
            return Err("source-connection-limit".into());
        }
        let name = format!("collection-{}.tmp", uuid::Uuid::new_v4());
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        let result = (|| {
            let mut file = self.config.open_with(&name, &options).map_err(disk)?;
            file.write_all(&bytes).map_err(disk)?;
            file.sync_all().map_err(disk)?;
            self.config
                .rename(&name, &self.config, "collection-directories.json")
                .map_err(disk)
        })();
        if result.is_err() {
            let _ = self.config.remove_file(&name);
        }
        result
    }
    fn grant(
        &mut self,
        id: Option<String>,
        path: PathBuf,
        scope: &str,
        epoch: u64,
    ) -> Result<Connection> {
        if self.check(scope)? != epoch {
            return Err("stale-collection-scope".into());
        }
        if linked(&std::fs::symlink_metadata(&path).map_err(disk)?) {
            return Err("unsafe-source-path".into());
        }
        let path = path.canonicalize().map_err(disk)?;
        open_root(&path)?;
        let mut id = id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        uuid::Uuid::parse_str(&id).map_err(|_| "invalid-source-grant")?;
        if self.grants.iter().any(|g| g.id == id && g.scope != scope) {
            id = uuid::Uuid::new_v4().to_string();
        }
        let mut next = self.grants.clone();
        if let Some(grant) = next.iter_mut().find(|g| g.id == id) {
            grant.path = path.clone();
        } else {
            if next.len() >= CONNECTION_LIMIT {
                return Err("source-connection-limit".into());
            }
            next.push(Grant {
                id: id.clone(),
                path: path.clone(),
                scope: scope.into(),
            });
        }
        index::clear(&self.index_path, &id)?;
        self.save(&next)?;
        self.grants = next;
        self.cancel_all();
        self.operations.clear();
        self.epoch += 1;
        Ok(connection(&Grant {
            id,
            path,
            scope: scope.into(),
        }))
    }
    fn root(&self, scope: &str, id: &str) -> Result<Dir> {
        self.check(scope)?;
        let grant = self
            .grants
            .iter()
            .find(|g| g.id == id && g.scope == scope)
            .ok_or("source-grant-missing")?;
        open_root(&grant.path)
    }
}
fn connection(grant: &Grant) -> Connection {
    Connection {
        id: grant.id.clone(),
        name: grant
            .path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        path: grant.path.to_string_lossy().into_owned(),
        available: open_root(&grant.path).is_ok(),
    }
}
impl Collection {
    pub fn new(config: &Path) -> Result<Self> {
        let index_path = config.join("collection-index.sqlite3");
        let config = Dir::open_ambient_dir(config, cap_std::ambient_authority()).map_err(disk)?;
        let grants: Vec<Grant> = match open_regular(&config, "collection-directories.json") {
            Ok(file) => {
                let mut bytes = Vec::new();
                file.take(CONFIG_LIMIT + 1)
                    .read_to_end(&mut bytes)
                    .map_err(disk)?;
                if bytes.len() as u64 > CONFIG_LIMIT {
                    return Err("source-config-invalid".into());
                }
                serde_json::from_slice(&bytes).map_err(|_| "source-config-invalid")?
            }
            Err(error) if error == "source-unavailable" => vec![],
            Err(error) => return Err(error),
        };
        let mut ids = HashSet::new();
        if grants.len() > CONNECTION_LIMIT
            || grants.iter().any(|g| {
                uuid::Uuid::parse_str(&g.id).is_err()
                    || !g.path.is_absolute()
                    || g.scope.is_empty()
                    || g.scope.len() > 256
                    || !ids.insert(&g.id)
            })
        {
            return Err("source-config-invalid".into());
        }
        Ok(Self(
            Arc::new(Mutex::new(Inner {
                config,
                index_path,
                grants,
                scope: String::new(),
                epoch: 0,
                identity: None,
                session_token: String::new(),
                operations: HashMap::new(),
            })),
            Arc::new(Mutex::new(())),
        ))
    }
    pub fn invalidate(&self) {
        if let Ok(mut inner) = self.0.lock() {
            inner.scope.clear();
            inner.cancel_all();
            inner.operations.clear();
            inner.epoch += 1;
        }
    }
    pub fn attach_workspace(&self, identity: crate::workspaces::ActiveIdentity) {
        if let Ok(mut inner) = self.0.lock() {
            inner.identity = Some(identity);
        }
    }
}
#[tauri::command]
pub fn collection_bind_scope(
    window: tauri::WebviewWindow,
    state: State<'_, Collection>,
    scope: String,
) -> Result<()> {
    crate::main_window(&window)?;
    if scope.len() > 256 {
        return Err("invalid-collection-scope".into());
    }
    let mut inner = state.0.lock().map_err(|_| "source-read-failed")?;
    let token = if let Some(identity) = &inner.identity {
        let active = identity.lock().map_err(|_| "stale-collection-scope")?;
        if !scope.is_empty() && active.0 != scope {
            return Err("stale-collection-scope".into());
        }
        if scope.is_empty() {
            String::new()
        } else {
            active.1.clone()
        }
    } else {
        String::new()
    };
    if inner.scope != scope || inner.session_token != token {
        inner.scope = scope;
        inner.session_token = token;
        inner.cancel_all();
        inner.operations.clear();
        inner.epoch += 1;
    }
    Ok(())
}
#[tauri::command]
pub fn collection_directories(
    window: tauri::WebviewWindow,
    state: State<'_, Collection>,
    expected_scope: String,
) -> Result<Vec<Connection>> {
    crate::main_window(&window)?;
    let inner = state.0.lock().map_err(|_| "source-read-failed")?;
    inner.check(&expected_scope)?;
    Ok(inner
        .grants
        .iter()
        .filter(|grant| grant.scope == expected_scope)
        .map(connection)
        .collect())
}
#[tauri::command]
pub async fn collection_directory_choose(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: State<'_, Collection>,
    expected_scope: String,
    id: Option<String>,
) -> Result<Option<Connection>> {
    crate::main_window(&window)?;
    let epoch = state
        .0
        .lock()
        .map_err(|_| "source-read-failed")?
        .check(&expected_scope)?;
    let path =
        tauri::async_runtime::spawn_blocking(move || app.dialog().file().blocking_pick_folder())
            .await
            .map_err(|_| "source-read-failed")?;
    let Some(path) = path else {
        return Ok(None);
    };
    let manager = state.0.clone();
    let serial = state.1.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _serial = serial.lock().map_err(|_| "source-read-failed")?;
        let mut inner = manager.lock().map_err(|_| "source-read-failed")?;
        inner
            .grant(
                id,
                path.into_path().map_err(|_| "unsafe-source-path")?,
                &expected_scope,
                epoch,
            )
            .map(Some)
    })
    .await
    .map_err(|_| "source-read-failed")?
}
#[tauri::command]
pub async fn collection_directory_list(
    window: tauri::WebviewWindow,
    state: State<'_, Collection>,
    expected_scope: String,
    id: String,
) -> Result<Listing> {
    crate::main_window(&window)?;
    let manager = state.0.clone();
    let lease = manager
        .lock()
        .map_err(|_| "source-read-failed")?
        .begin(&expected_scope, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let (root, epoch) = {
            let inner = manager.lock().map_err(|_| "source-read-failed")?;
            (inner.root(&expected_scope, &id)?, inner.epoch)
        };
        let mut listing = Listing {
            files: vec![],
            skipped: vec![],
            complete: true,
        };
        walk_checked(&root, "", 0, &mut 0, &mut listing, &|| lease.check())?;
        listing.files.sort_by(|a, b| a.path.cmp(&b.path));
        listing.skipped.sort_by(|a, b| a.path.cmp(&b.path));
        if manager
            .lock()
            .map_err(|_| "source-read-failed")?
            .check(&expected_scope)?
            != epoch
        {
            return Err("stale-collection-scope".into());
        }
        Ok(listing)
    })
    .await
    .map_err(|_| "source-read-failed")?
}
#[tauri::command]
pub async fn collection_directory_read(
    window: tauri::WebviewWindow,
    state: State<'_, Collection>,
    expected_scope: String,
    id: String,
    path: String,
    expected_size: u64,
    expected_modified: String,
) -> Result<Content> {
    crate::main_window(&window)?;
    let manager = state.0.clone();
    let lease = manager
        .lock()
        .map_err(|_| "source-read-failed")?
        .begin(&expected_scope, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let (root, epoch) = {
            let inner = manager.lock().map_err(|_| "source-read-failed")?;
            (inner.root(&expected_scope, &id)?, inner.epoch)
        };
        let content = read_file_checked(
            &root,
            &path,
            Some(expected_size),
            Some(&expected_modified),
            &|| lease.check(),
        )?;
        if manager
            .lock()
            .map_err(|_| "source-read-failed")?
            .check(&expected_scope)?
            != epoch
        {
            return Err("stale-collection-scope".into());
        }
        Ok(content)
    })
    .await
    .map_err(|_| "source-read-failed")?
}
#[tauri::command]
pub async fn collection_directory_disconnect(
    window: tauri::WebviewWindow,
    state: State<'_, Collection>,
    expected_scope: String,
    id: String,
) -> Result<()> {
    crate::main_window(&window)?;
    let manager = state.0.clone();
    let serial = state.1.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _serial = serial.lock().map_err(|_| "source-read-failed")?;
        let mut inner = manager.lock().map_err(|_| "source-read-failed")?;
        inner.check(&expected_scope)?;
        if !inner
            .grants
            .iter()
            .any(|grant| grant.id == id && grant.scope == expected_scope)
        {
            return Ok(());
        }
        index::clear(&inner.index_path, &id)?;
        let next: Vec<_> = inner
            .grants
            .iter()
            .filter(|g| g.id != id || g.scope != expected_scope)
            .cloned()
            .collect();
        inner.save(&next)?;
        inner.grants = next;
        inner.cancel_all();
        inner.operations.clear();
        inner.epoch += 1;
        Ok(())
    })
    .await
    .map_err(|_| "source-read-failed")?
}

#[tauri::command]
pub fn collection_directory_cancel(
    window: tauri::WebviewWindow,
    state: State<'_, Collection>,
    expected_scope: String,
    id: String,
) -> Result<()> {
    crate::main_window(&window)?;
    let mut inner = state.0.lock().map_err(|_| "source-read-failed")?;
    let lease = inner.begin(&expected_scope, &id)?;
    lease.counter.fetch_add(1, Ordering::AcqRel);
    Ok(())
}

#[cfg(test)]
mod tests;
