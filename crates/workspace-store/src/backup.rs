//! Complete, portable workspace snapshots. SQLite is copied by VACUUM INTO while
//! the caller holds the session mutex; working files are checked before and after
//! streaming. No live WAL file, device secret, lock or staging file is archived.
use crate::{
    atomic,
    error::{Error, Result},
    files,
    library::{Library, Marker},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use cap_std::fs::{Dir, OpenOptions};
use rusqlite::{Connection, OpenFlags, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File},
    io::{Read, Seek, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};
use uuid::Uuid;

const MAGIC: &[u8; 16] = b"REPEATY-SNAPSHOT";
const MAX_MANIFEST: u64 = 32 * 1024 * 1024;
const MAX_TOTAL: u64 = 1024 * 1024 * 1024 * 1024;
const MAX_FILES: usize = 200_000;
const ROOTS: &[&str] = &[
    "notes",
    "sources",
    "assets",
    ".repeaty/objects",
    ".repeaty/media",
    ".repeaty/retained",
    ".repeaty/plugins",
    ".repeaty/plugin-data",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Entry {
    path: String,
    size: u64,
    sha256: String,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    format: String,
    version: u32,
    id: String,
    source_workspace_id: String,
    created_at: String,
    revision: i64,
    total_bytes: u64,
    counts: BTreeMap<String, u64>,
    directories: Vec<String>,
    files: Vec<Entry>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub id: String,
    pub archive_path: String,
    pub source_workspace_id: String,
    pub created_at: String,
    pub revision: i64,
    pub file_count: usize,
    pub total_bytes: u64,
    pub sha256: String,
    /// Header-only listings must never imply that payload checksums were verified.
    pub verified: bool,
    pub manifest_sha256: String,
    pub counts: BTreeMap<String, u64>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub store: String,
    pub id: String,
    pub title: String,
    pub excerpt: String,
    pub retired: bool,
    pub path: Option<String>,
    pub restore_key: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Resource {
    kind: String,
    id: String,
    path: String,
    hash: String,
    retired: bool,
}
impl Resource {
    fn key(&self) -> Result<String> {
        Ok(format!(
            "resource:{}",
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(self)?)
        ))
    }
    fn validate(&self) -> Result<()> {
        if !["note", "source"].contains(&self.kind.as_str())
            || (self.retired && self.kind != "note")
            || !hash_valid(&self.hash)
            || !allowed(&self.path, false)
            || !self.path.starts_with(if self.kind == "note" {
                "notes/"
            } else {
                "sources/"
            })
        {
            return Err(Error::invalid());
        }
        Ok(())
    }
}
fn resource(db: &Connection, kind: &str, id: &str, retired: bool) -> Result<Option<Resource>> {
    let pair = if retired {
        db.query_row(
            "SELECT path,hash FROM retired_documents WHERE id=?1",
            [id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .optional()?
    } else {
        db.query_row(
            "SELECT path,hash FROM documents WHERE kind=?1 AND id=?2",
            params![kind, id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .optional()?
    };
    Ok(pair.map(|(path, hash)| Resource {
        kind: kind.into(),
        id: id.into(),
        path,
        hash,
        retired,
    }))
}

fn cancelled(cancel: &AtomicBool) -> Result<()> {
    if cancel.load(Ordering::Relaxed) {
        Err(Error("backup-cancelled"))
    } else {
        Ok(())
    }
}
fn corrupt() -> Error {
    Error("backup-corrupt")
}
fn path_text(path: &Path) -> Result<String> {
    Ok(path.to_str().ok_or(Error("invalid-path"))?.to_owned())
}
fn hash_valid(hash: &str) -> bool {
    hash.len() == 64
        && hash
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn allowed(path: &str, directory: bool) -> bool {
    if path.len() > 4096
        || path.contains(['\\', ':', '\0', '<', '>', '"', '|', '?', '*'])
        || path.split('/').count() > 64
        || path.split('/').any(|p| {
            p.is_empty()
                || p == "."
                || p == ".."
                || p.ends_with(['.', ' '])
                || p.chars().any(char::is_control)
                || {
                    let p = p.split('.').next().unwrap_or("").to_ascii_uppercase();
                    [
                        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6",
                        "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6",
                        "LPT7", "LPT8", "LPT9",
                    ]
                    .contains(&p.as_str())
                }
        })
    {
        return false;
    }
    (!directory && ["workspace.json", ".repeaty/state.sqlite3"].contains(&path))
        || (directory && path == ".repeaty")
        || ROOTS.iter().any(|root| {
            (directory && path == *root)
                || path
                    .strip_prefix(root)
                    .is_some_and(|rest| rest.starts_with('/'))
        })
}
fn link(metadata: &fs::Metadata) -> bool {
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
    let metadata = file.metadata()?;
    if !metadata.is_file() || link(&metadata) {
        return Err(Error("unsafe-backup-file"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 {
            return Err(Error("unsafe-backup-file"));
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            BY_HANDLE_FILE_INFORMATION, GetFileInformationByHandle,
        };
        // SAFETY: a live file handle and initialized output structure are supplied.
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 {
            return Err(Error::internal());
        }
        if info.nNumberOfLinks != 1 {
            return Err(Error("unsafe-backup-file"));
        }
    }
    Ok(())
}
fn directory(parent: &Dir, name: &str) -> Result<Dir> {
    let held = parent.try_clone()?.into_std_file();
    let file = cap_primitives::fs::open_dir_nofollow(&held, Path::new(name))?;
    if link(&file.metadata()?) {
        return Err(Error("unsafe-backup-file"));
    }
    Ok(Dir::from_std_file(file))
}
fn open_file(root: &Dir, path: &str) -> Result<File> {
    let mut parts = path.split('/').collect::<Vec<_>>();
    let name = parts.pop().ok_or_else(corrupt)?;
    let mut parent = root.try_clone()?;
    for part in parts {
        parent = directory(&parent, part)?;
    }
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
    let file = parent.open_with(name, &options)?.into_std();
    regular(&file)?;
    Ok(file)
}
fn transfer(
    input: &mut impl Read,
    output: &mut impl Write,
    size: u64,
    cancel: &AtomicBool,
) -> Result<String> {
    let mut remaining = size;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    while remaining > 0 {
        cancelled(cancel)?;
        let take = remaining.min(buffer.len() as u64) as usize;
        let read = input.read(&mut buffer[..take])?;
        if read == 0 {
            return Err(corrupt());
        }
        output.write_all(&buffer[..read])?;
        hash.update(&buffer[..read]);
        remaining -= read as u64;
    }
    Ok(format!("{:x}", hash.finalize()))
}
fn file_entry(root: &Dir, path: &str, cancel: &AtomicBool) -> Result<Entry> {
    let mut file = open_file(root, path)?;
    let before = file.metadata()?;
    if before.len() > MAX_TOTAL {
        return Err(Error("backup-limit"));
    }
    let hash = transfer(&mut file, &mut std::io::sink(), before.len(), cancel)?;
    file.rewind()?;
    let second = transfer(&mut file, &mut std::io::sink(), before.len(), cancel)?;
    if second != hash
        || file.metadata()?.len() != before.len()
        || file.metadata()?.modified().ok() != before.modified().ok()
    {
        return Err(Error("backup-files-changed"));
    }
    Ok(Entry {
        path: path.into(),
        size: before.len(),
        sha256: hash,
    })
}
fn walk(
    root: &Dir,
    dir: &Dir,
    prefix: &str,
    entries: &mut Vec<Entry>,
    dirs: &mut Vec<String>,
    cancel: &AtomicBool,
) -> Result<()> {
    cancelled(cancel)?;
    if !allowed(prefix, true) {
        return Err(Error("unsafe-backup-file"));
    }
    dirs.push(prefix.into());
    for entry in dir.entries()? {
        let entry = entry?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| Error("invalid-path"))?;
        let path = format!("{prefix}/{name}");
        if entry.file_type()?.is_dir() {
            let child = directory(dir, &name)?;
            walk(root, &child, &path, entries, dirs, cancel)?;
        } else {
            if !allowed(&path, false) {
                return Err(Error("unsafe-backup-file"));
            }
            entries.push(file_entry(root, &path, cancel)?);
        }
        if entries.len() + dirs.len() > MAX_FILES {
            return Err(Error("backup-limit"));
        }
    }
    Ok(())
}
fn inventory(root: &Dir, cancel: &AtomicBool) -> Result<(Vec<Entry>, Vec<String>)> {
    let mut entries = vec![file_entry(root, "workspace.json", cancel)?];
    let mut dirs = vec![".repeaty".into()];
    for prefix in ROOTS {
        let (parent, name) = prefix.rsplit_once('/').unwrap_or(("", prefix));
        let base = if parent.is_empty() {
            root.try_clone()?
        } else {
            directory(root, parent)?
        };
        match base.symlink_metadata(name) {
            Ok(_) => {
                let child = directory(&base, name)?;
                walk(root, &child, prefix, &mut entries, &mut dirs, cancel)?;
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
    }
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    dirs.sort();
    Ok((entries, dirs))
}
struct Scratch(PathBuf);
impl Scratch {
    fn new(parent: &Path) -> Result<Self> {
        let path = parent.join(format!(".repeaty-backup-{}", Uuid::new_v4()));
        files::create_private_dir(&path)?;
        Ok(Self(path))
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn target_path(target: &Path) -> Result<PathBuf> {
    let parent = fs::canonicalize(target.parent().ok_or(Error("invalid-path"))?)?;
    let name = target.file_name().ok_or(Error("invalid-path"))?;
    let path = parent.join(name);
    if path.symlink_metadata().is_ok() {
        return Err(Error("backup-target-exists"));
    }
    Ok(path)
}
fn summary(path: &Path, manifest: &Manifest, digest: String) -> Result<Summary> {
    Ok(Summary {
        id: manifest.id.clone(),
        archive_path: path_text(path)?,
        source_workspace_id: manifest.source_workspace_id.clone(),
        created_at: manifest.created_at.clone(),
        revision: manifest.revision,
        file_count: manifest.files.len(),
        total_bytes: manifest.total_bytes,
        verified: !digest.is_empty(),
        sha256: digest,
        manifest_sha256: files::digest(&serde_json::to_vec(manifest)?),
        counts: manifest.counts.clone(),
    })
}
fn counts(db: &Connection) -> Result<BTreeMap<String, u64>> {
    let mut result = BTreeMap::new();
    for table in crate::records::STORES.into_iter().chain([
        "retired_notes",
        "retired_cards",
        "retired_records",
        "card_drafts",
        "source_drafts",
        "values_store",
        "assets",
    ]) {
        if ["source_drafts", "materialFolders"].contains(&table)
            && !db.query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
                [table],
                |r| r.get::<_, bool>(0),
            )?
        {
            continue;
        }
        result.insert(
            table.into(),
            db.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| {
                r.get::<_, i64>(0)
            })? as u64,
        );
    }
    Ok(result)
}
pub fn create(library: &Library, target: &Path, cancel: &AtomicBool) -> Result<Summary> {
    create_with_hook(library, target, cancel, |_| Ok(()))
}
fn create_with_hook(
    library: &Library,
    target: &Path,
    cancel: &AtomicBool,
    mut checkpoint: impl FnMut(&str) -> Result<()>,
) -> Result<Summary> {
    library.guard(&library.token)?;
    cancelled(cancel)?;
    let pending: bool = library.db.connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM publications WHERE status='pending')",
        [],
        |r| r.get(0),
    )?;
    if pending {
        return Err(Error("workspace-publication-pending"));
    }
    let target = target_path(target)?;
    if target.starts_with(library.path()) {
        return Err(Error("backup-target-in-workspace"));
    }
    let scratch = Scratch::new(target.parent().ok_or(Error("invalid-path"))?)?;
    let snapshot = scratch.0.join("state.sqlite3");
    let (original, dirs) = inventory(&library.anchor, cancel)?;
    library
        .db
        .connection
        .execute("VACUUM INTO ?1", [path_text(&snapshot)?])?;
    checkpoint("snapshot")?;
    files::sync_regular_file(&snapshot)?;
    let db = Connection::open_with_flags(&snapshot, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let revision = db.query_row("SELECT revision FROM workspace WHERE id=1", [], |r| {
        r.get(0)
    })?;
    let records = counts(&db)?;
    drop(db);
    let scratch_dir = Dir::open_ambient_dir(&scratch.0, cap_std::ambient_authority())?;
    let mut database = file_entry(&scratch_dir, "state.sqlite3", cancel)?;
    database.path = ".repeaty/state.sqlite3".into();
    let mut entries = original.clone();
    entries.push(database);
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    let total_bytes = entries
        .iter()
        .try_fold(0u64, |sum, e| sum.checked_add(e.size))
        .ok_or(Error("backup-limit"))?;
    if total_bytes > MAX_TOTAL {
        return Err(Error("backup-limit"));
    }
    let manifest = Manifest {
        format: "repeaty-workspace-backup".into(),
        version: 1,
        id: Uuid::new_v4().to_string(),
        source_workspace_id: library.id.clone(),
        created_at: chrono::Utc::now().to_rfc3339(),
        revision,
        total_bytes,
        counts: records,
        directories: dirs.clone(),
        files: entries,
    };
    validate_manifest(&manifest)?;
    validate_database_at(library.path(), &snapshot, &manifest)?;
    let raw = serde_json::to_vec(&manifest)?;
    if raw.len() as u64 > MAX_MANIFEST {
        return Err(Error("backup-limit"));
    }
    let archive = scratch.0.join("archive");
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&archive)?;
    output.write_all(MAGIC)?;
    output.write_all(&(raw.len() as u64).to_le_bytes())?;
    output.write_all(&raw)?;
    for entry in &manifest.files {
        let mut input = if entry.path == ".repeaty/state.sqlite3" {
            open_file(&scratch_dir, "state.sqlite3")?
        } else {
            open_file(&library.anchor, &entry.path)?
        };
        if transfer(&mut input, &mut output, entry.size, cancel)? != entry.sha256
            || input.metadata()?.len() != entry.size
        {
            return Err(Error("backup-files-changed"));
        }
    }
    output.sync_all()?;
    drop(output);
    checkpoint("streamed")?;
    if inventory(&library.anchor, cancel)? != (original, dirs) {
        return Err(Error("backup-files-changed"));
    }
    library.guard(&library.token)?;
    let digest = file_entry(&scratch_dir, "archive", cancel)?.sha256;
    checkpoint("verified")?;
    cancelled(cancel)?;
    atomic::publish_new(&archive, &target)?;
    files::sync_directory(target.parent().unwrap())?;
    summary(&target, &manifest, digest)
}
fn validate_manifest(manifest: &Manifest) -> Result<()> {
    if manifest.format != "repeaty-workspace-backup" || manifest.version != 1 {
        return Err(Error("backup-incompatible"));
    }
    if Uuid::parse_str(&manifest.id).is_err()
        || Uuid::parse_str(&manifest.source_workspace_id).is_err()
        || chrono::DateTime::parse_from_rfc3339(&manifest.created_at).is_err()
        || manifest.revision < 0
        || manifest.files.len() + manifest.directories.len() > MAX_FILES
    {
        return Err(corrupt());
    }
    let mut paths = BTreeSet::new();
    let mut directories = BTreeSet::new();
    let mut total = 0u64;
    for path in &manifest.directories {
        if !allowed(path, true) || !paths.insert(path.to_lowercase()) {
            return Err(corrupt());
        }
        directories.insert(path.as_str());
    }
    for entry in &manifest.files {
        if !allowed(&entry.path, false)
            || !hash_valid(&entry.sha256)
            || !paths.insert(entry.path.to_lowercase())
        {
            return Err(corrupt());
        }
        if let Some((parent, _)) = entry.path.rsplit_once('/')
            && !directories.contains(parent)
        {
            return Err(corrupt());
        }
        total = total.checked_add(entry.size).ok_or_else(corrupt)?;
    }
    for dir in &manifest.directories {
        if let Some((parent, _)) = dir.rsplit_once('/')
            && !directories.contains(parent)
        {
            return Err(corrupt());
        }
    }
    if total != manifest.total_bytes
        || total > MAX_TOTAL
        || !["workspace.json", ".repeaty/state.sqlite3"]
            .iter()
            .all(|p| manifest.files.iter().any(|e| e.path == *p))
    {
        return Err(corrupt());
    }
    Ok(())
}
struct HashReader<R> {
    inner: R,
    hash: Sha256,
}
impl<R: Read> Read for HashReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let size = self.inner.read(buf)?;
        self.hash.update(&buf[..size]);
        Ok(size)
    }
}
fn unpack(path: &Path, destination: &Path, cancel: &AtomicBool) -> Result<(Manifest, String)> {
    cancelled(cancel)?;
    let file = files::regular_file(path)?;
    regular(&file)?;
    let before = file.metadata()?;
    let mut input = HashReader {
        inner: file,
        hash: Sha256::new(),
    };
    let manifest = read_manifest(&mut input, before.len())?;
    let mut dirs = manifest.directories.clone();
    dirs.sort_by_key(|dir| dir.split('/').count());
    for dir in dirs {
        files::create_private_dir(&destination.join(dir))?;
    }
    for entry in &manifest.files {
        cancelled(cancel)?;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(destination.join(&entry.path))?;
        if transfer(&mut input, &mut file, entry.size, cancel)? != entry.sha256 {
            return Err(corrupt());
        }
        file.sync_all()?;
    }
    let mut extra = [0u8; 1];
    if input.read(&mut extra)? != 0
        || input.inner.metadata()?.len() != before.len()
        || input.inner.metadata()?.modified().ok() != before.modified().ok()
    {
        return Err(Error("backup-files-changed"));
    }
    validate_database(destination, &manifest)?;
    Ok((manifest, format!("{:x}", input.hash.finalize())))
}
fn validate_database(root: &Path, manifest: &Manifest) -> Result<()> {
    validate_database_at(root, &root.join(".repeaty/state.sqlite3"), manifest)
}
fn validate_database_at(root: &Path, database_path: &Path, manifest: &Manifest) -> Result<()> {
    let marker: Marker = serde_json::from_slice(&files::read_stable(&root.join("workspace.json"))?)
        .map_err(|_| corrupt())?;
    if marker.format != "repeaty-workspace"
        || marker.version != 3
        || marker.id != manifest.source_workspace_id
    {
        return Err(corrupt());
    }
    let db = Connection::open_with_flags(database_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    db.pragma_update(None, "trusted_schema", "OFF")?;
    let app: i64 = db.pragma_query_value(None, "application_id", |r| r.get(0))?;
    let version: u32 = db.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if app != 0x52505459 || ![10, 11, 12, 13, 14].contains(&version) {
        return Err(Error("backup-incompatible"));
    }
    let identity: String = db.query_row("SELECT id FROM workspace_identity", [], |r| r.get(0))?;
    let revision: i64 = db.query_row("SELECT revision FROM workspace WHERE id=1", [], |r| {
        r.get(0)
    })?;
    let integrity: String = db.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    if identity != marker.id
        || revision != manifest.revision
        || integrity != "ok"
        || db.prepare("PRAGMA foreign_key_check")?.exists([])?
        || counts(&db)? != manifest.counts
    {
        return Err(corrupt());
    }
    let entries = manifest
        .files
        .iter()
        .map(|e| (e.path.as_str(), e))
        .collect::<BTreeMap<_, _>>();
    let mut statement=db.prepare("SELECT hash FROM documents UNION SELECT hash FROM retired_documents UNION SELECT hash FROM publications WHERE hash IS NOT NULL")?;
    for hash in statement.query_map([], |r| r.get::<_, String>(0))? {
        let hash = hash?;
        if !hash_valid(&hash)
            || entries
                .get(format!(".repeaty/objects/{hash}").as_str())
                .is_none_or(|e| e.sha256 != hash)
        {
            return Err(corrupt());
        }
    }
    let mut statement = db.prepare("SELECT path,size FROM assets")?;
    for row in statement.query_map([], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? as u64))
    })? {
        let (path, size) = row?;
        if path.contains(['/', '\\'])
            || path.len() < 65
            || entries
                .get(format!(".repeaty/media/{path}").as_str())
                .is_none_or(|e| e.size != size || Some(e.sha256.as_str()) != path.get(..64))
        {
            return Err(corrupt());
        }
    }
    Ok(())
}
pub fn inspect(path: &Path) -> Result<Summary> {
    inspect_with_cancel(path, &AtomicBool::new(false))
}
pub fn inspect_with_cancel(path: &Path, cancel: &AtomicBool) -> Result<Summary> {
    let scratch = Scratch::new(&std::env::temp_dir())?;
    let (manifest, digest) = unpack(path, &scratch.0, cancel)?;
    summary(path, &manifest, digest)
}
fn read_manifest(input: &mut impl Read, total_length: u64) -> Result<Manifest> {
    let mut header = [0u8; 24];
    input.read_exact(&mut header).map_err(|_| corrupt())?;
    if &header[..16] != MAGIC {
        return Err(Error("backup-incompatible"));
    }
    let length = u64::from_le_bytes(header[16..].try_into().unwrap());
    if length > MAX_MANIFEST {
        return Err(Error("backup-limit"));
    }
    let mut raw = vec![0u8; length as usize];
    input.read_exact(&mut raw).map_err(|_| corrupt())?;
    let manifest: Manifest = serde_json::from_slice(&raw).map_err(|_| corrupt())?;
    validate_manifest(&manifest)?;
    if 24 + length + manifest.total_bytes != total_length {
        return Err(corrupt());
    }
    Ok(manifest)
}
/// Catalogue metadata only: does not read, hash, unpack or validate payload bytes.
pub fn list_summary(path: &Path) -> Result<Summary> {
    let mut file = files::regular_file(path)?;
    regular(&file)?;
    let before = file.metadata()?;
    let manifest = read_manifest(&mut file, before.len())?;
    let after = file.metadata()?;
    if before.len() != after.len() || before.modified().ok() != after.modified().ok() {
        return Err(Error("backup-files-changed"));
    }
    summary(path, &manifest, String::new())
}
pub fn restore(
    archive: &Path,
    target: &Path,
    expected: &str,
    cancel: &AtomicBool,
) -> Result<PathBuf> {
    if !hash_valid(expected) {
        return Err(Error("backup-confirmation-required"));
    }
    let target = target_path(target)?;
    let scratch = Scratch::new(target.parent().unwrap())?;
    let (_, digest) = unpack(archive, &scratch.0, cancel)?;
    if digest != expected {
        return Err(Error("backup-files-changed"));
    }
    for path in [
        ".repeaty/staging",
        "notes",
        "sources",
        "assets",
        ".repeaty/objects",
        ".repeaty/media",
        ".repeaty/retained",
    ] {
        if !scratch.0.join(path).exists() {
            files::create_private_dir(&scratch.0.join(path))?;
        }
    }
    let id = Uuid::new_v4().to_string();
    let db = Connection::open(scratch.0.join(".repeaty/state.sqlite3"))?;
    db.execute("UPDATE workspace_identity SET id=?1", [&id])?;
    drop(db);
    let marker = Marker {
        format: "repeaty-workspace".into(),
        version: 3,
        id,
    };
    let mut marker_file = fs::OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(scratch.0.join("workspace.json"))?;
    marker_file.write_all(&serde_json::to_vec(&marker)?)?;
    marker_file.sync_all()?;
    drop(marker_file);
    // Open/recovery validation is performed before publication, without touching the active library.
    let checked = Library::open(&scratch.0)?;
    drop(checked);
    files::sync_regular_file(&scratch.0.join(".repeaty/state.sqlite3"))?;
    cancelled(cancel)?;
    atomic::publish_new(&scratch.0, &target)?;
    files::sync_directory(target.parent().unwrap())?;
    Ok(target)
}
fn strings(value: &Value, output: &mut String) {
    match value {
        Value::String(text) => {
            output.push_str(text);
            output.push(' ');
        }
        Value::Array(values) => {
            for v in values {
                strings(v, output)
            }
        }
        Value::Object(values) => {
            for (k, v) in values {
                if ![
                    "id",
                    "mediaId",
                    "noteId",
                    "cardId",
                    "deckId",
                    "createdAt",
                    "updatedAt",
                ]
                .contains(&k.as_str())
                {
                    strings(v, output)
                }
            }
        }
        _ => {}
    }
}
pub fn search(path: &Path, query: &str, limit: usize) -> Result<Vec<SearchHit>> {
    search_checked(path, query, limit, None)
}
pub fn search_checked(
    path: &Path,
    query: &str,
    limit: usize,
    expected: Option<&str>,
) -> Result<Vec<SearchHit>> {
    search_checked_with_cancel(path, query, limit, expected, &AtomicBool::new(false))
}
pub fn search_checked_with_cancel(
    path: &Path,
    query: &str,
    limit: usize,
    expected: Option<&str>,
    cancel: &AtomicBool,
) -> Result<Vec<SearchHit>> {
    cancelled(cancel)?;
    if query.trim().is_empty() {
        return Ok(vec![]);
    }
    if query.len() > 1000 || !(1..=100).contains(&limit) {
        return Err(Error::invalid());
    }
    let scratch = Scratch::new(&std::env::temp_dir())?;
    let (_, digest) = unpack(path, &scratch.0, cancel)?;
    if expected.is_some_and(|expected| expected != digest) {
        return Err(Error("backup-files-changed"));
    }
    let db = Connection::open_with_flags(
        scratch.0.join(".repeaty/state.sqlite3"),
        OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?;
    let mut hits = Vec::new();
    let query = query.trim().to_lowercase();
    for (store, sql, retired) in [
        ("notes", "SELECT id,data FROM notes", false),
        ("sources", "SELECT id,data FROM sources", false),
        ("retired_notes", "SELECT id,data FROM retired_notes", true),
        (
            "history.notes",
            "SELECT id,data FROM history WHERE store='notes' AND data IS NOT NULL",
            false,
        ),
        (
            "history.sources",
            "SELECT id,data FROM history WHERE store='sources' AND data IS NOT NULL",
            false,
        ),
    ] {
        let mut stmt = db.prepare(sql)?;
        for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
            cancelled(cancel)?;
            let (id, raw) = row?;
            let data: Value = serde_json::from_str(&raw)?;
            let mut text = String::new();
            strings(&data, &mut text);
            if store.ends_with("sources")
                && let Some(media) = data["mediaId"].as_str()
            {
                let mut media_query =
                    db.prepare("SELECT path FROM assets WHERE id=?1 AND mime LIKE 'text/%'")?;
                let mut rows = media_query.query([media])?;
                if let Some(row) = rows.next()? {
                    let asset: String = row.get(0)?;
                    let body = files::read_stable_with_limit(
                        &scratch.0.join(".repeaty/media").join(asset),
                        crate::records::MAX_MEDIA as u64,
                    )?;
                    text.push_str(&String::from_utf8(body).map_err(|_| corrupt())?);
                }
            }
            if !text.to_lowercase().contains(&query) {
                continue;
            }
            let title = data["title"]
                .as_str()
                .or_else(|| data["front"].as_str())
                .unwrap_or(&id)
                .chars()
                .take(160)
                .collect();
            let lowered = text.to_lowercase();
            let at = lowered.find(&query).unwrap_or(0);
            let char_at = lowered[..at].chars().count();
            let excerpt = text
                .chars()
                .skip(char_at.saturating_sub(60))
                .take(300)
                .collect();
            // A historical row has different bytes from the accepted document at this
            // snapshot. Do not offer a path that would silently restore the newer row.
            let document = if store.starts_with("history.") {
                None
            } else {
                resource(
                    &db,
                    if store == "sources" { "source" } else { "note" },
                    &id,
                    retired,
                )?
            };
            let restore_key = document.as_ref().map(Resource::key).transpose()?;
            hits.push(SearchHit {
                store: store.into(),
                id,
                title,
                excerpt,
                retired,
                path: document.map(|doc| doc.path),
                restore_key,
            });
            if hits.len() >= limit {
                return Ok(hits);
            }
        }
    }
    Ok(hits)
}
pub fn restore_items(
    archive: &Path,
    target: &Path,
    expected: &str,
    paths: &[String],
) -> Result<Value> {
    restore_items_with_cancel(archive, target, expected, paths, &AtomicBool::new(false))
}
pub fn restore_items_with_cancel(
    archive: &Path,
    target: &Path,
    expected: &str,
    paths: &[String],
    cancel: &AtomicBool,
) -> Result<Value> {
    if paths.is_empty()
        || paths.len() > 1000
        || !hash_valid(expected)
        || paths.iter().any(|p| p.len() > 16 * 1024)
    {
        return Err(Error::invalid());
    }
    let target = target_path(target)?;
    let source = Scratch::new(target.parent().unwrap())?;
    let output = Scratch::new(target.parent().unwrap())?;
    let (manifest, digest) = unpack(archive, &source.0, cancel)?;
    if digest != expected {
        return Err(Error("backup-files-changed"));
    }
    let database = Connection::open_with_flags(
        source.0.join(".repeaty/state.sqlite3"),
        OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?;
    let mut selected = BTreeMap::new();
    let mut accepted_assets = BTreeMap::<String, (String, String)>::new();
    for key in paths {
        let document = if let Some(encoded) = key.strip_prefix("resource:") {
            let requested: Resource = serde_json::from_slice(
                &URL_SAFE_NO_PAD
                    .decode(encoded)
                    .map_err(|_| Error::invalid())?,
            )?;
            requested.validate()?;
            if resource(&database, &requested.kind, &requested.id, requested.retired)?.as_ref()
                != Some(&requested)
            {
                return Err(Error("backup-resource-changed"));
            }
            Some(requested)
        } else {
            if !allowed(key, false) || !(key.starts_with("notes/") || key.starts_with("sources/")) {
                return Err(Error::invalid());
            }
            let mut stmt=database.prepare("SELECT kind,id,path,hash,0 FROM documents WHERE path=?1 UNION ALL SELECT 'note',id,path,hash,1 FROM retired_documents WHERE path=?1")?;
            let matches = stmt
                .query_map([key], |r| {
                    Ok(Resource {
                        kind: r.get(0)?,
                        id: r.get(1)?,
                        path: r.get(2)?,
                        hash: r.get(3)?,
                        retired: r.get(4)?,
                    })
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            if matches.len() > 1 {
                return Err(Error("backup-ambiguous-resource"));
            }
            matches.into_iter().next()
        };
        let (path, origin) = if let Some(document) = document {
            document.validate()?;
            let table = if document.retired {
                "retired_notes"
            } else if document.kind == "note" {
                "notes"
            } else {
                "sources"
            };
            let raw: String = database.query_row(
                &format!("SELECT data FROM {table} WHERE id=?1"),
                [&document.id],
                |r| r.get(0),
            )?;
            let data: Value = serde_json::from_str(&raw)?;
            for binding in data["inlineMedia"].as_array().into_iter().flatten() {
                let path = binding["path"].as_str().ok_or_else(corrupt)?;
                let hash = binding["hash"].as_str().ok_or_else(corrupt)?;
                let media = binding["mediaId"].as_str().ok_or_else(corrupt)?;
                if !allowed(path, false) || !path.starts_with("assets/") || !hash_valid(hash) {
                    return Err(corrupt());
                }
                let asset: String =
                    database
                        .query_row("SELECT path FROM assets WHERE id=?1", [media], |r| r.get(0))?;
                let origin = format!(".repeaty/media/{asset}");
                if !manifest
                    .files
                    .iter()
                    .any(|entry| entry.path == origin && entry.sha256 == hash)
                {
                    return Err(corrupt());
                }
                if let Some((_, existing)) = accepted_assets.get(path)
                    && existing != hash
                {
                    return Err(Error("backup-resource-asset-conflict"));
                }
                // Also reject cross-platform casing collisions in accepted bindings.
                if accepted_assets.iter().any(|(prior, (_, existing))| {
                    prior.to_lowercase() == path.to_lowercase()
                        && (prior != path || existing != hash)
                }) {
                    return Err(Error("backup-resource-asset-conflict"));
                }
                accepted_assets.insert(path.into(), (origin, hash.into()));
            }
            (document.path, format!(".repeaty/objects/{}", document.hash))
        } else if manifest.files.iter().any(|entry| entry.path == *key) {
            (key.clone(), key.clone())
        } else {
            return Err(Error::missing());
        };
        if selected.contains_key(&path) {
            return Err(Error("backup-resource-path-conflict"));
        }
        selected.insert(path, origin);
    }
    drop(database);
    let mut copied = 0;
    for entry in manifest
        .files
        .iter()
        .filter(|e| e.path.starts_with("assets/") || e.path.starts_with(".repeaty/media/"))
    {
        cancelled(cancel)?;
        let destination = output.0.join(&entry.path);
        fs::create_dir_all(destination.parent().unwrap())?;
        fs::copy(source.0.join(&entry.path), &destination)?;
        files::sync_regular_file(&destination)?;
        copied += 1;
    }
    for (path, origin) in selected {
        cancelled(cancel)?;
        let destination = output.0.join(path);
        fs::create_dir_all(destination.parent().unwrap())?;
        fs::copy(source.0.join(origin), &destination)?;
        files::sync_regular_file(&destination)?;
        copied += 1;
    }
    // The working assets may contain unaccepted external edits. Bind exported
    // accepted markdown to its immutable accepted bytes inside the new copy.
    for (path, (origin, _)) in accepted_assets {
        cancelled(cancel)?;
        let destination = output.0.join(path);
        fs::create_dir_all(destination.parent().unwrap())?;
        fs::copy(source.0.join(origin), &destination)?;
        files::sync_regular_file(&destination)?;
    }
    cancelled(cancel)?;
    atomic::publish_new(&output.0, &target)?;
    Ok(json!({"path":path_text(&target)?,"files":copied}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{records::Commit, sessions::Sessions};
    use rusqlite::params;

    fn fixture() -> (tempfile::TempDir, Library) {
        let parent = tempfile::tempdir().unwrap();
        let root = parent.path().join("library");
        fs::create_dir(&root).unwrap();
        let mut library = Library::create(&root).unwrap();
        library
            .db
            .put_media("image", "image/png", b"immutable media")
            .unwrap();
        library
            .db
            .put_media(
                "old-original",
                "application/pdf",
                b"%PDF old complete original",
            )
            .unwrap();
        library
            .db
            .put_media(
                "new-original",
                "application/pdf",
                b"%PDF current complete original",
            )
            .unwrap();
        let db = &library.db.connection;
        for (table, id, data) in [
            ("decks", "deck", json!({"id":"deck","name":"Recovery test"})),
            (
                "notes",
                "note",
                json!({"id":"note","deckId":"deck","front":"Searchable question","back":"Answer retained intact"}),
            ),
            (
                "cards",
                "card",
                json!({"id":"card","noteId":"note","due":"2026-11-01T00:00:00Z","stability":9.5}),
            ),
            (
                "reviews",
                "review",
                json!({"id":"review","cardId":"card","rating":3}),
            ),
            (
                "practices",
                "practice",
                json!({"id":"practice","cardId":"card"}),
            ),
            (
                "attempts",
                "attempt",
                json!({"id":"attempt","cardId":"card","practiceId":"practice","code":"fn main() { println!(\"full code\"); }","result":{"detail":"all diagnostics"}}),
            ),
            (
                "sources",
                "source",
                json!({"id":"source","title":"Versioned original","document":{"originalMediaId":"new-original"},"versions":[{"document":{"originalMediaId":"old-original"}}],"reading":{"fraction":0.7}}),
            ),
        ] {
            db.execute(
                &format!("INSERT INTO {table}(id,position,data) VALUES(?1,0,?2)"),
                params![id, data.to_string()],
            )
            .unwrap();
        }
        let raw = b"# Accepted content\nSearchable question\n";
        let hash = files::digest(raw);
        files::write_new(&root.join(format!(".repeaty/objects/{hash}")), raw).unwrap();
        files::write_new(&root.join("notes/note.md"), b"external, not yet accepted").unwrap();
        db.execute(
            "INSERT INTO documents VALUES('note','note','notes/note.md',?1)",
            [&hash],
        )
        .unwrap();
        db.execute(
            "INSERT INTO retired_documents VALUES('retired','notes/retired.md',?1)",
            [&hash],
        )
        .unwrap();
        db.execute(
            "INSERT INTO retired_notes VALUES('retired',?1,'2026-10-29')",
            [json!({"id":"retired","front":"Retired searchable card"}).to_string()],
        )
        .unwrap();
        db.execute(
            "INSERT INTO retired_cards VALUES('retired-card','retired','forward',?1,'2026-10-29')",
            [json!({"id":"retired-card","stability":23.0}).to_string()],
        )
        .unwrap();
        db.execute(
            "INSERT INTO retired_records VALUES('attempts','retired-attempt','retired-card',0,?1)",
            [json!({"code":"complete retired code"}).to_string()],
        )
        .unwrap();
        db.execute(
            "INSERT INTO card_drafts VALUES('draft',?1)",
            [json!({"text":"unfinished draft","uploads":[{"meta":{"id":"image"}}]}).to_string()],
        )
        .unwrap();
        db.execute(
            "INSERT INTO values_store VALUES('settings','theme','\"dark\"')",
            [],
        )
        .unwrap();
        db.execute(
            "INSERT INTO values_store VALUES('plugin:heatmap','private',?1)",
            [json!({"retained":true}).to_string()],
        )
        .unwrap();
        db.execute(
            "INSERT INTO history VALUES(1,'notes','note',0,?1)",
            [json!({"id":"note","front":"Searchable old question"}).to_string()],
        )
        .unwrap();
        db.execute(
            "INSERT INTO operation_history VALUES(1,?1)",
            [json!({"schemaVersion":1,"undo":[],"redo":[],"mediaIds":["image"]}).to_string()],
        )
        .unwrap();
        db.execute("UPDATE workspace SET revision=2", []).unwrap();
        db.pragma_update(None, "user_version", 12).unwrap();
        for path in [
            ".repeaty/plugins/heatmap",
            ".repeaty/plugin-data/heatmap",
            "assets/pictures",
        ] {
            fs::create_dir_all(root.join(path)).unwrap();
        }
        files::write_new(
            &root.join(".repeaty/plugins/heatmap/main.js"),
            b"export default {};",
        )
        .unwrap();
        files::write_new(
            &root.join(".repeaty/plugin-data/heatmap/cache.bin"),
            b"plugin portable data",
        )
        .unwrap();
        files::write_new(
            &root.join("assets/pictures/cover.png"),
            b"external attachment",
        )
        .unwrap();
        files::write_new(&root.join(".repeaty/staging/excluded.tmp"), b"incomplete").unwrap();
        files::write_new(
            &root.join(".repeaty/plugin-secrets.sqlite3"),
            b"must never leak",
        )
        .unwrap();
        (parent, library)
    }
    fn saved(library: &Library, parent: &Path) -> (PathBuf, Summary) {
        let archive = parent.join("complete.repeaty-workspace");
        let info = create(library, &archive, &AtomicBool::new(false)).unwrap();
        (archive, info)
    }

    #[test]
    fn complete_snapshot_preserves_sqlite_rows_files_versions_drafts_plugins_and_retirement() {
        let (parent, library) = fixture();
        let draft = json!({"id":Uuid::new_v4().to_string(),"sourceId":"source","mediaId":"old-original","scope":format!("local:workspace:{}",library.id),"content":"unfinished source draft","properties":"unknown: retained","title":"Draft","url":"","updatedAt":"2026-10-30T00:00:00Z"});
        library
            .db
            .connection
            .execute(
                "INSERT INTO source_drafts VALUES('source',?1)",
                [draft.to_string()],
            )
            .unwrap();
        library
            .db
            .connection
            .pragma_update(None, "user_version", 13)
            .unwrap();
        let (archive, info) = saved(&library, parent.path());
        assert_eq!(inspect(&archive).unwrap().sha256, info.sha256);
        let target = parent.path().join("restored");
        restore(&archive, &target, &info.sha256, &AtomicBool::new(false)).unwrap();
        let restored = Library::open(&target).unwrap();
        assert_ne!(restored.id, library.id);
        for table in crate::records::STORES.into_iter().chain([
            "documents",
            "retired_notes",
            "retired_cards",
            "retired_records",
            "retired_documents",
            "history",
            "card_drafts",
            "source_drafts",
            "values_store",
            "operation_history",
        ]) {
            let read = |db: &Connection| {
                let mut stmt = db
                    .prepare(&format!("SELECT * FROM {table} ORDER BY rowid"))
                    .unwrap();
                let count = stmt.column_count();
                stmt.query_map([], |row| {
                    Ok((0..count)
                        .map(|i| format!("{:?}", row.get_ref(i).unwrap()))
                        .collect::<Vec<_>>())
                })
                .unwrap()
                .collect::<std::result::Result<Vec<_>, _>>()
                .unwrap()
            };
            assert_eq!(
                read(&library.db.connection),
                read(&restored.db.connection),
                "{table}"
            );
        }
        for path in [
            "notes/note.md",
            ".repeaty/plugins/heatmap/main.js",
            ".repeaty/plugin-data/heatmap/cache.bin",
            "assets/pictures/cover.png",
        ] {
            assert_eq!(
                fs::read(library.path().join(path)).unwrap(),
                fs::read(target.join(path)).unwrap()
            );
        }
        assert!(!target.join(".repeaty/plugin-secrets.sqlite3").exists());
        assert!(!target.join(".repeaty/staging/excluded.tmp").exists());
        assert!(target.join(".repeaty/staging").is_dir());
        assert_eq!(info.counts["retired_records"], 1);
        assert_eq!(info.counts["card_drafts"], 1);
        assert_eq!(info.counts["source_drafts"], 1);
        assert_eq!(
            restored
                .db
                .connection
                .pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))
                .unwrap(),
            13
        );
    }
    #[test]
    fn corrupted_payload_changed_confirmation_cancel_and_existing_destination_never_publish() {
        let (parent, library) = fixture();
        let (archive, info) = saved(&library, parent.path());
        let target = parent.path().join("restored");
        assert!(restore(&archive, &target, &"a".repeat(64), &AtomicBool::new(false)).is_err());
        assert!(!target.exists());
        assert_eq!(
            restore(&archive, &target, &info.sha256, &AtomicBool::new(true))
                .unwrap_err()
                .0,
            "backup-cancelled"
        );
        assert!(!target.exists());
        fs::create_dir(&target).unwrap();
        files::write_new(&target.join("precious"), b"keep").unwrap();
        assert_eq!(
            restore(&archive, &target, &info.sha256, &AtomicBool::new(false))
                .unwrap_err()
                .0,
            "backup-target-exists"
        );
        assert_eq!(fs::read(target.join("precious")).unwrap(), b"keep");
        let bad = parent.path().join("bad.repeaty-workspace");
        let mut bytes = fs::read(&archive).unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 1;
        fs::write(&bad, bytes).unwrap();
        assert_eq!(inspect(&bad).unwrap_err().0, "backup-corrupt");
        assert_eq!(
            create(&library, &archive, &AtomicBool::new(false))
                .unwrap_err()
                .0,
            "backup-target-exists"
        );
        library.guard(&library.token).unwrap();
    }
    #[test]
    fn refuses_nested_target_hardlinks_and_unsettled_publication_without_losing_source() {
        let (parent, library) = fixture();
        assert_eq!(
            create(
                &library,
                &library.path().join("backup.repeaty-workspace"),
                &AtomicBool::new(false)
            )
            .unwrap_err()
            .0,
            "backup-target-in-workspace"
        );
        fs::hard_link(
            library.path().join("notes/note.md"),
            library.path().join("notes/linked.md"),
        )
        .unwrap();
        assert_eq!(
            create(
                &library,
                &parent.path().join("links.repeaty-workspace"),
                &AtomicBool::new(false)
            )
            .unwrap_err()
            .0,
            "unsafe-backup-file"
        );
        fs::remove_file(library.path().join("notes/linked.md")).unwrap();
        library
            .db
            .connection
            .execute(
                "INSERT INTO publications VALUES('pending','notes/note.md',NULL,NULL,'pending')",
                [],
            )
            .unwrap();
        assert_eq!(
            create(
                &library,
                &parent.path().join("pending.repeaty-workspace"),
                &AtomicBool::new(false)
            )
            .unwrap_err()
            .0,
            "workspace-publication-pending"
        );
    }
    #[test]
    fn malicious_manifest_traversal_duplicate_case_and_incompatible_version_are_rejected() {
        let (parent, library) = fixture();
        let (archive, _) = saved(&library, parent.path());
        let original = fs::read(&archive).unwrap();
        let length = u64::from_le_bytes(original[16..24].try_into().unwrap()) as usize;
        for (name, path, version) in [
            ("traversal", "notes/../../outside", 1),
            ("absolute", "C:/outside", 1),
            ("private", ".repeaty/plugin-secrets.sqlite3", 1),
            ("version", "notes/note.md", 99),
        ] {
            let mut manifest: Manifest =
                serde_json::from_slice(&original[24..24 + length]).unwrap();
            manifest.files[0].path = path.into();
            manifest.version = version;
            let raw = serde_json::to_vec(&manifest).unwrap();
            let mut bytes = MAGIC.to_vec();
            bytes.extend((raw.len() as u64).to_le_bytes());
            bytes.extend(raw);
            bytes.extend(&original[24 + length..]);
            let bad = parent.path().join(name);
            fs::write(&bad, bytes).unwrap();
            assert!(inspect(&bad).is_err(), "{name}");
        }
        let mut manifest: Manifest = serde_json::from_slice(&original[24..24 + length]).unwrap();
        let mut duplicate = manifest.files.last().unwrap().clone();
        duplicate.path = duplicate.path.to_uppercase();
        manifest.files.push(duplicate);
        assert!(validate_manifest(&manifest).is_err());
    }
    #[test]
    fn search_and_single_resource_restore_use_readonly_backup_and_accepted_retired_content() {
        let (parent, library) = fixture();
        let (archive, info) = saved(&library, parent.path());
        let before = fs::read(&archive).unwrap();
        let hits = search(&archive, "searchable", 30).unwrap();
        assert!(hits.iter().any(|hit| hit.retired));
        assert!(hits.iter().any(|hit| hit.store == "history.notes"));
        assert!(
            hits.iter()
                .filter(|hit| hit.store.starts_with("history."))
                .all(|hit| hit.path.is_none())
        );
        assert_eq!(
            search_checked(&archive, "searchable", 30, Some(&"a".repeat(64)))
                .unwrap_err()
                .0,
            "backup-files-changed"
        );
        let target = parent.path().join("selected");
        assert_eq!(
            restore_items_with_cancel(
                &archive,
                &target,
                &info.sha256,
                &["notes/note.md".into()],
                &AtomicBool::new(true)
            )
            .unwrap_err()
            .0,
            "backup-cancelled"
        );
        assert!(!target.exists());
        restore_items(
            &archive,
            &target,
            &info.sha256,
            &["notes/note.md".into(), "notes/retired.md".into()],
        )
        .unwrap();
        assert_eq!(
            fs::read(target.join("notes/note.md")).unwrap(),
            b"# Accepted content\nSearchable question\n"
        );
        assert_eq!(
            fs::read(target.join("notes/retired.md")).unwrap(),
            b"# Accepted content\nSearchable question\n"
        );
        assert!(target.join("assets/pictures/cover.png").exists());
        assert!(!target.join("workspace.json").exists());
        assert_eq!(fs::read(&archive).unwrap(), before);
    }
    #[test]
    fn lightweight_listing_reads_only_the_manifest_and_never_claims_payload_validation() {
        let (parent, library) = fixture();
        let (archive, full) = saved(&library, parent.path());
        let light = list_summary(&archive).unwrap();
        assert!(!light.verified);
        assert!(light.sha256.is_empty());
        assert_eq!(light.manifest_sha256, full.manifest_sha256);
        assert!(full.verified);
        let mut bytes = fs::read(&archive).unwrap();
        let header_end = 24 + u64::from_le_bytes(bytes[16..24].try_into().unwrap()) as usize;
        let mut header_only = std::io::Cursor::new(&bytes[..header_end]);
        read_manifest(&mut header_only, bytes.len() as u64).unwrap();
        assert_eq!(header_only.position(), header_end as u64);
        let last = bytes.len() - 1;
        bytes[last] ^= 1;
        fs::write(&archive, bytes).unwrap();
        assert!(!list_summary(&archive).unwrap().verified);
        assert!(inspect(&archive).is_err());
        assert_eq!(
            inspect_with_cancel(&archive, &AtomicBool::new(true))
                .unwrap_err()
                .0,
            "backup-cancelled"
        );
    }
    #[test]
    fn resource_keys_disambiguate_active_retired_paths_and_note_source_ids() {
        let (parent, library) = fixture();
        let retired_body = b"retired accepted exact body";
        let retired_hash = files::digest(retired_body);
        files::write_new(
            &library.path().join(".repeaty/objects").join(&retired_hash),
            retired_body,
        )
        .unwrap();
        library
            .db
            .connection
            .execute(
                "UPDATE retired_documents SET path='notes/note.md',hash=?1 WHERE id='retired'",
                [retired_hash],
            )
            .unwrap();
        let source_body = b"source accepted exact body";
        let source_hash = files::digest(source_body);
        files::write_new(
            &library.path().join(".repeaty/objects").join(&source_hash),
            source_body,
        )
        .unwrap();
        library
            .db
            .connection
            .execute(
                "INSERT INTO sources(id,position,data) VALUES('note',1,?1)",
                [json!({"id":"note","title":"Searchable separate source"}).to_string()],
            )
            .unwrap();
        library
            .db
            .connection
            .execute(
                "INSERT INTO documents VALUES('source','note','sources/same-id.md',?1)",
                [source_hash],
            )
            .unwrap();
        let (archive, info) = saved(&library, parent.path());
        let hits = search(&archive, "searchable", 30).unwrap();
        for (store, expected, path) in [
            (
                "notes",
                b"# Accepted content\nSearchable question\n".as_slice(),
                "notes/note.md",
            ),
            ("retired_notes", retired_body.as_slice(), "notes/note.md"),
            ("sources", source_body.as_slice(), "sources/same-id.md"),
        ] {
            let hit = hits
                .iter()
                .find(|hit| hit.store == store && hit.restore_key.is_some())
                .unwrap();
            let target = parent.path().join(format!("item-{store}"));
            restore_items(
                &archive,
                &target,
                &info.sha256,
                &[hit.restore_key.clone().unwrap()],
            )
            .unwrap();
            assert_eq!(fs::read(target.join(path)).unwrap(), expected);
        }
        assert_eq!(
            restore_items(
                &archive,
                &parent.path().join("ambiguous"),
                &info.sha256,
                &["notes/note.md".into()]
            )
            .unwrap_err()
            .0,
            "backup-ambiguous-resource"
        );
        let keys = hits
            .iter()
            .filter(|hit| matches!(hit.store.as_str(), "notes" | "retired_notes"))
            .filter_map(|hit| hit.restore_key.clone())
            .collect::<Vec<_>>();
        assert_eq!(
            restore_items(
                &archive,
                &parent.path().join("collision"),
                &info.sha256,
                &keys
            )
            .unwrap_err()
            .0,
            "backup-resource-path-conflict"
        );
    }
    #[test]
    fn single_item_uses_accepted_attachment_bytes_and_rejects_conflicting_bindings() {
        let (parent, mut library) = fixture();
        let binding = json!([{ "path":"assets/pictures/cover.png","mediaId":"image","hash":files::digest(b"immutable media"),"url":"../assets/pictures/cover.png"}]);
        library
            .db
            .connection
            .execute(
                "UPDATE notes SET data=json_set(data,'$.inlineMedia',json(?1)) WHERE id='note'",
                [binding.to_string()],
            )
            .unwrap();
        let (archive, info) = saved(&library, parent.path());
        let key = search(&archive, "Searchable question", 30)
            .unwrap()
            .into_iter()
            .find(|hit| hit.store == "notes")
            .unwrap()
            .restore_key
            .unwrap();
        let target = parent.path().join("accepted-assets");
        restore_items(&archive, &target, &info.sha256, &[key]).unwrap();
        assert_eq!(
            fs::read(target.join("assets/pictures/cover.png")).unwrap(),
            b"immutable media"
        );
        assert_eq!(
            fs::read(library.path().join("assets/pictures/cover.png")).unwrap(),
            b"external attachment"
        );
        library
            .db
            .put_media("other-image", "image/png", b"different immutable image")
            .unwrap();
        let other = json!([{ "path":"assets/pictures/cover.png","mediaId":"other-image","hash":files::digest(b"different immutable image"),"url":"../assets/pictures/cover.png"}]);
        library.db.connection.execute("UPDATE retired_notes SET data=json_set(data,'$.inlineMedia',json(?1)) WHERE id='retired'",[other.to_string()]).unwrap();
        let archive = parent.path().join("conflicting.repeaty-workspace");
        let info = create(&library, &archive, &AtomicBool::new(false)).unwrap();
        let keys = search(&archive, "searchable", 30)
            .unwrap()
            .into_iter()
            .filter_map(|hit| hit.restore_key)
            .collect::<Vec<_>>();
        assert_eq!(
            restore_items(
                &archive,
                &parent.path().join("conflicting-copy"),
                &info.sha256,
                &keys
            )
            .unwrap_err()
            .0,
            "backup-resource-asset-conflict"
        );
        assert!(!parent.path().join("conflicting-copy").exists());
    }
    #[test]
    fn search_matches_material_text_beyond_one_mebibyte() {
        let (parent, library) = fixture();
        let mut body = "材料正文。".repeat(100_000).into_bytes();
        assert!(body.len() > 1024 * 1024);
        body.extend_from_slice("末尾独有搜索词".as_bytes());
        let path = format!("{}.txt", files::digest(&body));
        files::write_new(&library.path().join(".repeaty/media").join(&path), &body).unwrap();
        library
            .db
            .connection
            .execute(
                "INSERT INTO assets VALUES('large-material','text/plain',?1,?2,0)",
                params![path, body.len() as i64],
            )
            .unwrap();
        library.db.connection.execute("INSERT INTO media(id,position,data) VALUES('large-material',0,?1)",[json!({"id":"large-material","name":"large text","type":"text/plain","size":body.len()}).to_string()]).unwrap();
        library.db.connection.execute("UPDATE sources SET data=json_set(data,'$.mediaId','large-material') WHERE id='source'", []).unwrap();
        let (archive, info) = saved(&library, parent.path());
        let hits = search_checked(&archive, "末尾独有搜索词", 30, Some(&info.sha256)).unwrap();
        let hit = hits
            .iter()
            .find(|hit| hit.store == "sources" && hit.id == "source")
            .unwrap();
        assert!(hit.excerpt.contains("末尾独有搜索词"));
    }
    #[test]
    fn session_restore_is_independent_new_identity_and_leaves_active_scope_unchanged() {
        let (parent, library) = fixture();
        let root = library.path().to_path_buf();
        drop(library);
        let mut sessions = Sessions::open(&parent.path().join("device")).unwrap();
        let status = sessions.status().unwrap();
        let status = sessions
            .choose(status["epoch"].as_str().unwrap(), &root, false)
            .unwrap();
        let token = status["active"]["token"].as_str().unwrap();
        let epoch = status["epoch"].as_str().unwrap();
        let archive = parent.path().join("complete.repeaty-workspace");
        let info = sessions.backup(token, &archive).unwrap();
        let target = parent.path().join("restored");
        let result = sessions
            .restore_backup(epoch, &archive, &target, &info.sha256)
            .unwrap();
        assert_eq!(sessions.status().unwrap()["active"], status["active"]);
        assert_eq!(sessions.status().unwrap()["epoch"], status["epoch"]);
        assert!(
            sessions.status().unwrap()["recent"]
                .as_array()
                .unwrap()
                .iter()
                .any(|item| item["id"] == result["newWorkspaceId"])
        );
        assert_ne!(result["newWorkspaceId"], status["active"]["id"]);
        sessions.read(token, json!({"type":"load"})).unwrap();
        let stats = sessions.maintenance(token, false).unwrap();
        assert_eq!(stats["integrity"], "ok");
        sessions.maintenance(token, true).unwrap();
        sessions.read(token, json!({"type":"load"})).unwrap();
    }
    #[test]
    fn operation_history_is_transactional_persists_and_only_success_gates_old_readers() {
        let parent = tempfile::tempdir().unwrap();
        let mut library = Library::create(parent.path()).unwrap();
        let history = json!({"schemaVersion":1,"undo":[{"id":"undo","label":"edit","changes":[]}],"redo":[],"mediaIds":[]});
        assert!(library.db.load().unwrap().get("operationHistory").is_none());
        let bad = Commit {
            expected_revision: 1,
            patches: vec![],
            reason: None,
            operation_history: Some(history.clone()),
            retired: None,
        };
        assert!(library.db.commit(bad).is_err());
        let version: u32 = library
            .db
            .connection
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(version, 10);
        library
            .db
            .commit(Commit {
                expected_revision: 0,
                patches: vec![],
                reason: None,
                operation_history: Some(history.clone()),
                retired: None,
            })
            .unwrap();
        let version: u32 = library
            .db
            .connection
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(version, 12);
        drop(library);
        let mut library = Library::open(parent.path()).unwrap();
        assert_eq!(library.db.load().unwrap()["operationHistory"], history);
        library
            .db
            .commit(Commit {
                expected_revision: 1,
                patches: vec![],
                reason: None,
                operation_history: None,
                retired: None,
            })
            .unwrap();
        assert_eq!(library.db.load().unwrap()["operationHistory"], history);
    }
    #[test]
    fn interrupted_writes_and_external_saves_leave_no_completed_archive_and_preserve_library() {
        let (parent, library) = fixture();
        for phase in ["snapshot", "streamed", "verified"] {
            let target = parent
                .path()
                .join(format!("fail-{phase}.repeaty-workspace"));
            assert!(
                create_with_hook(&library, &target, &AtomicBool::new(false), |at| {
                    if at == phase {
                        Err(Error("injected-storage-failure"))
                    } else {
                        Ok(())
                    }
                })
                .is_err()
            );
            assert!(!target.exists());
            library.guard(&library.token).unwrap();
        }
        let target = parent.path().join("raced.repeaty-workspace");
        let failure = create_with_hook(&library, &target, &AtomicBool::new(false), |phase| {
            if phase == "streamed" {
                fs::write(library.path().join("notes/note.md"), b"later editor save")?;
            }
            Ok(())
        })
        .unwrap_err();
        assert_eq!(failure.0, "backup-files-changed");
        assert!(!target.exists());
        assert_eq!(
            fs::read(library.path().join("notes/note.md")).unwrap(),
            b"later editor save"
        );
        assert!(!fs::read_dir(parent.path()).unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".repeaty-backup-")
        }));
    }
    #[test]
    fn missing_immutable_original_cannot_replace_a_valid_complete_backup() {
        let (parent, library) = fixture();
        let (archive, info) = saved(&library, parent.path());
        let asset: String = library
            .db
            .connection
            .query_row("SELECT path FROM assets WHERE id='old-original'", [], |r| {
                r.get(0)
            })
            .unwrap();
        fs::remove_file(library.path().join(".repeaty/media").join(asset)).unwrap();
        let target = parent.path().join("incomplete.repeaty-workspace");
        assert_eq!(
            create(&library, &target, &AtomicBool::new(false))
                .unwrap_err()
                .0,
            "backup-corrupt"
        );
        assert!(!target.exists());
        assert_eq!(inspect(&archive).unwrap().sha256, info.sha256);
    }
}
