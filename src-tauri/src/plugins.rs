//! Runtime packages and generic native capabilities; no plugin business code is linked here.
mod http;
mod models;
mod network;
mod secrets;
#[cfg(test)]
mod tests;
#[cfg(windows)]
mod windows_permissions;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use cap_std::fs::{Dir, OpenOptions};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::HashSet,
    fs::File,
    io::{self, Read, Seek, Write},
    path::{Component, Path},
    sync::{Arc, Mutex},
};
pub type Result<T> = std::result::Result<T, String>;
const CODE_LIMIT: usize = 4 * 1024 * 1024;
const STYLE_LIMIT: usize = 1024 * 1024;
const README_LIMIT: usize = 256 * 1024;
const ASSETS_LIMIT: usize = 34 * 1024 * 1024;
const FILE_LIMIT: usize = 2 * 1024 * 1024;
fn invalid() -> String {
    "invalid-plugin".into()
}
// Explicit sorting also works when another dependency enables serde_json/preserve_order.
fn canonical(value: &Value) -> String {
    match value {
        Value::Object(object) => {
            let mut keys: Vec<_> = object.keys().collect();
            keys.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
            format!(
                "{{{}}}",
                keys.into_iter()
                    .map(|key| format!(
                        "{}:{}",
                        serde_json::to_string(key).expect("string"),
                        canonical(&object[key])
                    ))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
        Value::Array(values) => format!(
            "[{}]",
            values.iter().map(canonical).collect::<Vec<_>>().join(",")
        ),
        _ => value.to_string(),
    }
}
fn disk(error: io::Error) -> String {
    match error.kind() {
        io::ErrorKind::NotFound => "plugin-unavailable",
        io::ErrorKind::PermissionDenied => "permission-denied",
        _ => "plugin-storage-error",
    }
    .into()
}
fn id_valid(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.as_bytes()[0].is_ascii_lowercase()
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}
fn link(metadata: &std::fs::Metadata) -> bool {
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
fn directory(parent: &Dir, name: &str, create: bool) -> Result<Option<Dir>> {
    if create {
        match parent.create_dir(name) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(disk(e)),
        }
    }
    let held = parent.try_clone().map_err(disk)?.into_std_file();
    let file = match cap_primitives::fs::open_dir_nofollow(&held, Path::new(name)) {
        Ok(file) => file,
        Err(e) if !create && e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(disk(e)),
    };
    if link(&file.metadata().map_err(disk)?) {
        return Err("unsafe-plugin-file".into());
    }
    Ok(Some(Dir::from_std_file(file)))
}
fn private(root: &Dir, name: &str, create: bool) -> Result<Option<Dir>> {
    let state = directory(root, ".repeaty", false)?.ok_or_else(invalid)?;
    directory(&state, name, create)
}
fn regular(file: &File) -> Result<()> {
    let metadata = file.metadata().map_err(disk)?;
    if !metadata.is_file() || link(&metadata) {
        return Err("unsafe-plugin-file".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 {
            return Err("unsafe-plugin-file".into());
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            BY_HANDLE_FILE_INFORMATION, GetFileInformationByHandle,
        };
        // SAFETY: this plain output structure is initialized before the live file handle is queried.
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        // SAFETY: file owns the handle and info is a valid writable output pointer.
        if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 {
            return Err(disk(io::Error::last_os_error()));
        }
        if info.nNumberOfLinks != 1 {
            return Err("unsafe-plugin-file".into());
        }
    }
    Ok(())
}
fn open_regular(dir: &Dir, name: &str) -> Result<Option<File>> {
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
    let file = match dir.open_with(name, &options) {
        Ok(file) => file.into_std(),
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(disk(e)),
    };
    regular(&file)?;
    Ok(Some(file))
}
fn read_text(dir: &Dir, name: &str, limit: usize) -> Result<Option<String>> {
    let Some(mut file) = open_regular(dir, name)? else {
        return Ok(None);
    };
    let before = file.metadata().map_err(disk)?;
    if before.len() > limit as u64 {
        return Err("plugin-limit".into());
    }
    let mut first = Vec::new();
    (&mut file)
        .take(limit as u64 + 1)
        .read_to_end(&mut first)
        .map_err(disk)?;
    file.rewind().map_err(disk)?;
    let mut second = Vec::new();
    (&mut file)
        .take(limit as u64 + 1)
        .read_to_end(&mut second)
        .map_err(disk)?;
    let after = file.metadata().map_err(disk)?;
    if first != second
        || first.len() > limit
        || before.len() != after.len()
        || before.modified().map_err(disk)? != after.modified().map_err(disk)?
    {
        return Err("plugin-file-changed".into());
    }
    String::from_utf8(first).map(Some).map_err(|_| invalid())
}
fn write_new(dir: &Dir, name: &str, text: &str) -> Result<()> {
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    let mut file = dir.open_with(name, &options).map_err(disk)?;
    file.write_all(text.as_bytes()).map_err(disk)?;
    file.sync_all().map_err(disk)
}
#[derive(Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Permissions {
    #[serde(default)]
    origins: Vec<String>,
    #[serde(default)]
    secrets: bool,
    #[serde(default)]
    files: bool,
    #[serde(default)]
    models: bool,
    #[serde(default)]
    network: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    id: String,
    name: String,
    version: String,
    api_version: u32,
    data_version: Option<u32>,
    kind: String,
    #[serde(default)]
    permissions: Permissions,
}
struct Package {
    raw: Value,
    manifest: Manifest,
}
fn validate_assets(value: &Value) -> Result<()> {
    let entries = value.as_object().ok_or_else(invalid)?;
    if entries.len() > 2000 {
        return Err(invalid());
    }
    let mut total = 0;
    for (path, value) in entries {
        if path.len() > 240
            || path.split('/').any(|part| {
                let base = part.split('.').next().unwrap_or("").to_ascii_lowercase();
                part.is_empty()
                    || !part.as_bytes()[0].is_ascii_alphanumeric() && part.as_bytes()[0] != b'_'
                    || !part
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
                    || part.ends_with('.')
                    || ["con", "prn", "aux", "nul"].contains(&base.as_str())
                    || base.len() == 4
                        && (base.starts_with("com") || base.starts_with("lpt"))
                        && matches!(base.as_bytes()[3], b'1'..=b'9')
            })
        {
            return Err(invalid());
        }
        let asset = value.as_object().ok_or_else(invalid)?;
        let mime = value["type"].as_str().ok_or_else(invalid)?;
        if asset.len() != 2
            || mime.len() > 100
            || mime.split('/').count() != 2
            || mime.split('/').any(|part| {
                part.is_empty()
                    || !part
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b".+-".contains(&b))
            })
        {
            return Err(invalid());
        }
        let encoded = value["base64"].as_str().ok_or_else(invalid)?;
        if encoded.len() > (8 * 1024 * 1024_usize).div_ceil(3) * 4 {
            return Err(invalid());
        }
        let bytes = STANDARD.decode(encoded).map_err(|_| invalid())?;
        if bytes.len() > 8 * 1024 * 1024 {
            return Err(invalid());
        }
        total += bytes.len();
        if total > 24 * 1024 * 1024 {
            return Err(invalid());
        }
    }
    Ok(())
}
impl Package {
    fn parse(raw: Value, id: &str) -> Result<Self> {
        let manifest: Manifest =
            serde_json::from_value(raw["manifest"].clone()).map_err(|_| invalid())?;
        let main = raw["main"].as_str().ok_or_else(invalid)?;
        if !id_valid(id)
            || manifest.id != id
            || manifest.name.trim().is_empty()
            || manifest.name.len() > 300
            || manifest.version.is_empty()
            || manifest.version.len() > 64
            || !manifest
                .version
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b".+-".contains(&b))
            || manifest.api_version != 1
            || manifest.data_version == Some(0)
            || !["frontend", "local"].contains(&manifest.kind.as_str())
            || main.is_empty()
            || main.len() > CODE_LIMIT
            || raw["manifest"].to_string().len() > 64 * 1024
            || raw
                .get("styles")
                .is_some_and(|v| !v.is_string() || v.as_str().unwrap_or("").len() > STYLE_LIMIT)
            || raw
                .get("readme")
                .is_some_and(|v| !v.is_string() || v.as_str().unwrap_or("").len() > README_LIMIT)
            || manifest.permissions.origins.len() > 32
        {
            return Err(invalid());
        }
        if let Some(assets) = raw.get("assets") {
            validate_assets(assets)?;
        }
        let mut origins = HashSet::new();
        for value in &manifest.permissions.origins {
            if http::origin(value)? != *value || !origins.insert(value) {
                return Err(invalid());
            }
        }
        Ok(Self { raw, manifest })
    }
    fn hash(&self) -> String {
        let mut content = json!({"manifest":self.raw["manifest"],"main":self.raw["main"],"styles":self.raw.get("styles").and_then(Value::as_str).unwrap_or("")});
        // Preserve existing trust for packages without documentation; presence and bytes are trusted.
        if let Some(readme) = self.raw.get("readme") {
            content["readme"] = readme.clone();
        }
        if let Some(assets) = self.raw.get("assets") {
            content["assets"] = assets.clone();
        }
        repeaty_workspace::files::digest(canonical(&content).as_bytes())
    }
}
fn package(root: &Dir, id: &str) -> Result<Package> {
    let packages = private(root, "plugins", false)?.ok_or("plugin-unavailable")?;
    let dir = directory(&packages, id, false)?.ok_or("plugin-unavailable")?;
    let manifest = read_text(&dir, "manifest.json", 64 * 1024)?.ok_or_else(invalid)?;
    let main = read_text(&dir, "main.js", CODE_LIMIT)?.ok_or_else(invalid)?;
    let styles = read_text(&dir, "styles.css", STYLE_LIMIT)?;
    let readme = read_text(&dir, "README.md", README_LIMIT)?;
    let assets = read_text(&dir, "assets.json", ASSETS_LIMIT)?;
    let mut raw = json!({"manifest":serde_json::from_str::<Value>(&manifest).map_err(|_|invalid())?,"main":main});
    if let Some(styles) = styles {
        raw["styles"] = Value::String(styles);
    }
    if let Some(readme) = readme {
        raw["readme"] = Value::String(readme);
    }
    if let Some(assets) = assets {
        raw["assets"] = serde_json::from_str(&assets).map_err(|_| invalid())?;
    }
    Package::parse(raw, id)
}
fn tree_plain(dir: &Dir, depth: usize, count: &mut usize) -> Result<()> {
    if depth > 8 {
        return Err("plugin-limit".into());
    }
    for entry in dir.entries().map_err(disk)? {
        *count += 1;
        if *count > 256 {
            return Err("plugin-limit".into());
        }
        let entry = entry.map_err(disk)?;
        let name = entry.file_name().into_string().map_err(|_| invalid())?;
        if entry.file_type().map_err(disk)?.is_dir() {
            let child = directory(dir, &name, false)?.ok_or_else(invalid)?;
            tree_plain(&child, depth + 1, count)?;
        } else {
            // Cleanup checks file identity and links without interpreting damaged package bytes.
            drop(open_regular(dir, &name)?.ok_or_else(invalid)?);
        }
    }
    Ok(())
}
fn install(root: &Dir, id: &str, payload: Value) -> Result<Value> {
    let value = Package::parse(payload, id)?;
    let packages = private(root, "plugins", true)?.ok_or_else(invalid)?;
    let stage = format!(".staging-{}", uuid::Uuid::new_v4());
    let retained = format!(".retained-{}", uuid::Uuid::new_v4());
    let staging = directory(&packages, &stage, true)?.ok_or_else(invalid)?;
    let result = (|| {
        write_new(
            &staging,
            "manifest.json",
            &value.raw["manifest"].to_string(),
        )?;
        write_new(
            &staging,
            "main.js",
            value.raw["main"].as_str().ok_or_else(invalid)?,
        )?;
        if let Some(styles) = value.raw.get("styles").and_then(Value::as_str) {
            write_new(&staging, "styles.css", styles)?;
        }
        if let Some(readme) = value.raw.get("readme").and_then(Value::as_str) {
            write_new(&staging, "README.md", readme)?;
        }
        if let Some(assets) = value.raw.get("assets") {
            write_new(&staging, "assets.json", &assets.to_string())?;
        }
        drop(staging);
        let existing = directory(&packages, id, false)?;
        if let Some(existing) = &existing {
            tree_plain(existing, 0, &mut 0)?;
        }
        let existed = existing.is_some();
        drop(existing);
        if existed {
            packages.rename(id, &packages, &retained).map_err(disk)?;
        }
        if let Err(error) = packages.rename(&stage, &packages, id) {
            if existed {
                let _ = packages.rename(&retained, &packages, id);
            }
            return Err(disk(error));
        }
        if let Some(old) = directory(&packages, &retained, false)? {
            tree_plain(&old, 0, &mut 0)?;
            drop(old);
            packages.remove_dir_all(&retained).map_err(disk)?;
        }
        Ok(value.raw)
    })();
    if result.is_err()
        && let Ok(Some(stage_dir)) = directory(&packages, &stage, false)
        && tree_plain(&stage_dir, 0, &mut 0).is_ok()
    {
        drop(stage_dir);
        let _ = packages.remove_dir_all(&stage);
    }
    result
}
fn remove(root: &Dir, id: &str) -> Result<Value> {
    let Some(packages) = private(root, "plugins", false)? else {
        return Ok(Value::Null);
    };
    let Some(dir) = directory(&packages, id, false)? else {
        return Ok(Value::Null);
    };
    tree_plain(&dir, 0, &mut 0)?;
    drop(dir);
    let retained = format!(".retained-{}", uuid::Uuid::new_v4());
    packages.rename(id, &packages, &retained).map_err(disk)?;
    packages.remove_dir_all(retained).map_err(disk)?;
    Ok(Value::Null)
}
fn plugin_file(root: &Dir, id: &str, payload: Value) -> Result<Value> {
    let path = payload["path"].as_str().ok_or_else(invalid)?;
    if path.is_empty()
        || path.len() > 512
        || path.contains(['\\', ':', '\0'])
        || Path::new(path)
            .components()
            .any(|p| !matches!(p, Component::Normal(_)))
    {
        return Err("unsafe-plugin-file".into());
    }
    let write = payload["action"] == "write";
    if !write && payload["action"] != "read" {
        return Err(invalid());
    }
    let Some(data) = private(root, "plugin-data", write)? else {
        return Ok(Value::Null);
    };
    let Some(mut dir) = directory(&data, id, write)? else {
        return Ok(Value::Null);
    };
    let parts: Vec<_> = path.split('/').collect();
    for part in &parts[..parts.len() - 1] {
        let Some(next) = directory(&dir, part, write)? else {
            return Ok(Value::Null);
        };
        dir = next;
    }
    let name = parts[parts.len() - 1];
    if !write {
        return read_text(&dir, name, FILE_LIMIT)
            .map(|text| text.map(Value::String).unwrap_or(Value::Null));
    }
    let text = payload["body"]
        .as_str()
        .filter(|text| text.len() <= FILE_LIMIT)
        .ok_or_else(invalid)?;
    read_text(&dir, name, FILE_LIMIT)?;
    let candidate = format!(".write-{}", uuid::Uuid::new_v4());
    write_new(&dir, &candidate, text)?;
    if let Err(error) = dir.rename(&candidate, &dir, name) {
        let _ = dir.remove_file(candidate);
        return Err(disk(error));
    }
    Ok(Value::Null)
}
#[derive(Clone)]
pub struct Plugins {
    secrets: Arc<Mutex<secrets::Secrets>>,
    client: reqwest::Client,
    models: Arc<models::Models>,
    network: Arc<network::Network>,
}
impl Plugins {
    pub fn new(directory: &Path) -> Result<Self> {
        let secrets = Arc::new(Mutex::new(secrets::Secrets::open(
            &directory.join("plugin-secrets.sqlite3"),
        )?));
        Ok(Self {
            models: Arc::new(models::Models::new(directory, secrets.clone())?),
            network: Arc::new(network::Network::default()),
            secrets,
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(20))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .map_err(|_| "plugin-network-error")?,
        })
    }
    fn trusted(&self, package: &Package) -> Result<()> {
        if self
            .secrets
            .lock()
            .map_err(|_| "plugin-storage-error")?
            .trusted(&package.hash())?
        {
            Ok(())
        } else {
            Err("plugin-not-trusted".into())
        }
    }
    fn models_authorized(&self, root: &Dir, id: &str) -> Result<()> {
        if !id_valid(id) {
            return Err(invalid());
        }
        let package = package(root, id)?;
        self.trusted(&package)?;
        if !package.manifest.permissions.models {
            return Err("permission-denied".into());
        }
        Ok(())
    }
    fn operation(
        &self,
        root: Dir,
        id: &str,
        operation: &str,
        payload: Value,
        binding: Option<&network::Binding>,
    ) -> Result<Value> {
        match operation {
            "list" => {
                let Some(packages) = private(&root, "plugins", false)? else {
                    return Ok(json!([]));
                };
                let mut ids = Vec::new();
                for (index, entry) in packages.entries().map_err(disk)?.enumerate() {
                    if index >= 512 {
                        return Err("plugin-limit".into());
                    }
                    let entry = entry.map_err(disk)?;
                    let id = entry.file_name().into_string().map_err(|_| invalid())?;
                    if id.starts_with('.') {
                        continue;
                    }
                    ids.push(id);
                    if ids.len() > 128 {
                        return Err("plugin-limit".into());
                    }
                }
                if ids.len() > 128 {
                    return Err("plugin-limit".into());
                }
                ids.sort();
                Ok(Value::Array(
                    ids.into_iter()
                        .map(|id| {
                            if !id_valid(&id) {
                                return json!({"id":id,"error":"invalid-plugin"});
                            }
                            match package(&root, &id) {
                                Ok(package) => package.raw,
                                Err(error) => json!({"id":id,"error":error}),
                            }
                        })
                        .collect(),
                ))
            }
            "trust-state" => self
                .secrets
                .lock()
                .map_err(|_| "plugin-storage-error")?
                .trust_state(),
            _ => {
                if !id_valid(id) {
                    return Err(invalid());
                }
                match operation {
                    "read" => Ok(package(&root, id)?.raw),
                    "install" => install(&root, id, payload),
                    "remove" => remove(&root, id),
                    "trust" => {
                        let hash = package(&root, id)?.hash();
                        if payload["hash"].as_str() != Some(&hash) {
                            return Err("plugin-file-changed".into());
                        }
                        self.secrets
                            .lock()
                            .map_err(|_| "plugin-storage-error")?
                            .trust(&hash)?;
                        Ok(Value::Null)
                    }
                    "files" | "secrets" => {
                        let package = package(&root, id)?;
                        self.trusted(&package)?;
                        if operation == "files" && package.manifest.permissions.files {
                            plugin_file(&root, id, payload)
                        } else if operation == "secrets" && package.manifest.permissions.secrets {
                            let permissions = match binding {
                                Some(binding) => self
                                    .network
                                    .permissions(binding, &package.manifest.permissions)?,
                                None => package.manifest.permissions.clone(),
                            };
                            let slot = payload["slot"].as_str().map(str::to_owned);
                            let changed =
                                matches!(payload["action"].as_str(), Some("set" | "clear"));
                            let result = self
                                .secrets
                                .lock()
                                .map_err(|_| "plugin-storage-error")?
                                .operation(id, &permissions, payload)?;
                            if changed && let Some(slot) = slot {
                                self.network.cancel_slot(id, &slot);
                            }
                            Ok(result)
                        } else {
                            Err("permission-denied".into())
                        }
                    }
                    _ => Err("unknown-operation".into()),
                }
            }
        }
    }
    pub async fn call(
        &self,
        workspaces: &crate::workspaces::Workspaces,
        token: String,
        id: String,
        operation: String,
        payload: Value,
    ) -> Result<Value> {
        let host = self.clone();
        // Advance from the actual identity, never from an untrusted delayed call token.
        {
            let identity = workspaces.active_identity();
            let current = identity.lock().map_err(|_| "workspace-changed")?;
            if current.1 != token {
                return Err("workspace-changed".into());
            }
            self.network.scope(&current.1)?;
        }
        if matches!(
            operation.as_str(),
            "network.authorize" | "http.cancel" | "http.dispose"
        ) {
            let binding = network::Binding::from_payload(&token, &id, &payload)?;
            crate::workspaces::with_plugin_workspace(workspaces, token, move |root| {
                if !id_valid(&id) {
                    return Err(invalid());
                }
                // Cleanup must remain possible after the package is removed or replaced.
                match operation.as_str() {
                    "http.dispose" => {
                        host.network.dispose(&binding);
                        Ok(Value::Null)
                    }
                    "http.cancel" => {
                        host.network.cancel(
                            &binding,
                            payload["requestId"].as_str().ok_or("invalid-data")?,
                        )?;
                        Ok(Value::Null)
                    }
                    _ => {
                        let package = package(&root, &id)?;
                        host.trusted(&package)?;
                        if !package.manifest.permissions.network {
                            return Err("permission-denied".into());
                        }
                        host.network.authorize(
                            &binding,
                            payload["origin"].as_str().ok_or("invalid-data")?,
                        )?;
                        Ok(Value::Null)
                    }
                }
            })
            .await
        } else if operation.starts_with("model.") {
            let plugin_id = id.clone();
            let disposing = operation == "model.dispose";
            crate::workspaces::with_plugin_workspace(workspaces, token.clone(), move |root| {
                if !id_valid(&plugin_id) {
                    return Err(invalid());
                }
                // Cleanup only touches this activation's existing resources. The package
                // may already be removed or replaced with one without model permission.
                if disposing {
                    Ok(())
                } else {
                    host.models_authorized(&root, &plugin_id)
                }
            })
            .await?;
            let response = self
                .models
                .call(
                    &token,
                    &id,
                    &operation,
                    payload,
                    workspaces.active_identity(),
                )
                .await;
            crate::workspaces::with_plugin_workspace(workspaces, token, |_| Ok(())).await?;
            response
        } else if operation == "http" {
            let binding = network::Binding::from_payload(&token, &id, &payload)?;
            let request = self.network.register(&binding, &payload)?;
            let prepared =
                crate::workspaces::with_plugin_workspace(workspaces, token.clone(), move |root| {
                    if !id_valid(&id) {
                        return Err(invalid());
                    }
                    let package = package(&root, &id)?;
                    host.trusted(&package)?;
                    let permissions = host
                        .network
                        .permissions(&binding, &package.manifest.permissions)?;
                    http::prepare(&host, &id, &permissions, payload)
                })
                .await?;
            let response = self
                .network
                .run(
                    &request,
                    workspaces.active_identity(),
                    http::send(self, prepared),
                )
                .await;
            crate::workspaces::with_plugin_workspace(workspaces, token, |_| Ok(())).await?;
            response
        } else {
            let binding = if payload.get("activationId").is_some() {
                Some(network::Binding::from_payload(&token, &id, &payload)?)
            } else {
                None
            };
            crate::workspaces::with_plugin_workspace(workspaces, token, move |root| {
                host.operation(root, &id, &operation, payload, binding.as_ref())
            })
            .await
        }
    }
}
