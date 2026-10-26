//! Desktop directory sessions for inspecting explicit M0 roots. No learning-library switch.
//! The device index stores only selected paths and identities; it is not portable workspace state.
use crate::{
    files,
    prototype::{CardMapping, Prototype, Result},
};
use rusqlite::{Connection, OpenFlags, OptionalExtension, params};
use serde::Serialize;
use std::{
    fs::{self, File},
    path::{Path, PathBuf},
};

pub const MAX_FILES: usize = 4096;
const MAX_SCAN_BYTES: usize = 32 * 1024 * 1024;
const INDEX_APP_ID: i32 = 0x52505030; // RPP0: device-local preview preferences.
const INDEX_VERSION: i32 = 1001;

#[derive(Clone, Debug, Serialize)]
pub struct Recent {
    pub path: String,
    pub id: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct Active {
    pub path: String,
    pub id: String,
    pub token: String,
}
#[derive(Debug, Serialize)]
pub struct Status {
    pub epoch: String,
    pub active: Option<Active>,
    pub recent: Vec<Recent>,
    pub restore_error: Option<String>,
}
#[derive(Debug, Serialize)]
pub struct Accepted {
    pub id: String,
    pub path: String,
    pub raw: String,
    pub cards: Vec<CardMapping>,
}
#[derive(Debug, Serialize)]
pub struct Observation {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}
#[derive(Debug, Serialize)]
pub struct Scan {
    pub token: String,
    pub complete: bool,
    pub accepted: Vec<Accepted>,
    pub observations: Vec<Observation>,
    pub issues: Vec<String>,
    #[serde(skip)]
    examined: usize,
}
struct IdentityLock(File);
impl Drop for IdentityLock {
    fn drop(&mut self) {
        let _ = self.0.unlock();
    }
}
struct Session {
    prototype: Prototype,
    _identity_lock: IdentityLock,
    anchor: cap_std::fs::Dir,
    root_identity: same_file::Handle,
    descriptor: Active,
}
pub struct Sessions {
    index: Connection,
    directory: PathBuf,
    current: Option<Session>,
    epoch: String,
    restore_error: Option<String>,
}
fn nonce() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn text_path(path: &Path) -> Result<String> {
    path.to_str()
        .filter(|value| value.len() <= 32_768)
        .map(str::to_owned)
        .ok_or_else(|| "invalid-path".into())
}
fn directory(path: &Path) -> Result<()> {
    let meta = fs::symlink_metadata(path)?;
    if !meta.is_dir() || meta.is_symlink() {
        return Err("unsafe-directory".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return Err("unsafe-directory".into());
        }
    }
    Ok(())
}
impl Sessions {
    pub fn open(device_directory: &Path) -> Result<Self> {
        directory(device_directory)?;
        let directory = device_directory.canonicalize()?;
        let path = directory.join("workspace-preview.sqlite3");
        let exists = path.try_exists()?;
        if exists {
            files::regular_file(&path)?;
        }
        let flags = OpenFlags::SQLITE_OPEN_READ_WRITE
            | if exists {
                OpenFlags::empty()
            } else {
                OpenFlags::SQLITE_OPEN_CREATE
            };
        let index = Connection::open_with_flags(&path, flags)?;
        if exists {
            if index.pragma_query_value(None, "application_id", |r| r.get::<_, i32>(0))?
                != INDEX_APP_ID
                || index.pragma_query_value(None, "user_version", |r| r.get::<_, i32>(0))?
                    != INDEX_VERSION
            {
                return Err("incompatible-preview-index".into());
            }
        } else {
            index.execute_batch(&format!("PRAGMA application_id={INDEX_APP_ID}; PRAGMA user_version={INDEX_VERSION};
                CREATE TABLE recent(path TEXT PRIMARY KEY,id TEXT NOT NULL,opened INTEGER NOT NULL);
                CREATE TABLE selected(singleton INTEGER PRIMARY KEY CHECK(singleton=1),path TEXT NOT NULL,id TEXT NOT NULL);"))?;
            files::sync_directory(&directory)?;
        }
        index.execute_batch("PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000;")?;
        let selected: Option<Recent> = index
            .query_row("SELECT path,id FROM selected WHERE singleton=1", [], |r| {
                Ok(Recent {
                    path: r.get(0)?,
                    id: r.get(1)?,
                })
            })
            .optional()?;
        let mut result = Self {
            index,
            directory,
            current: None,
            epoch: nonce(),
            restore_error: None,
        };
        if let Some(selected) = selected {
            match result.open_session(Path::new(&selected.path), Some(&selected.id)) {
                Ok(session) => result.current = Some(session),
                Err(error) => result.restore_error = Some(error_code(error.as_ref())),
            }
        }
        Ok(result)
    }
    pub fn status(&self) -> Result<Status> {
        let recent = self
            .index
            .prepare("SELECT path,id FROM recent ORDER BY opened DESC,path LIMIT 8")?
            .query_map([], |r| {
                Ok(Recent {
                    path: r.get(0)?,
                    id: r.get(1)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(Status {
            epoch: self.epoch.clone(),
            active: self.current.as_ref().map(|s| s.descriptor.clone()),
            recent,
            restore_error: self.restore_error.clone(),
        })
    }
    fn check_epoch(&self, expected: &str) -> Result<()> {
        if expected != self.epoch {
            return Err("stale-workspace-session".into());
        }
        Ok(())
    }
    fn open_session(&self, path: &Path, expected_id: Option<&str>) -> Result<Session> {
        directory(path)?;
        let anchor = cap_std::fs::Dir::open_ambient_dir(path, cap_std::ambient_authority())?;
        let root_identity = same_file::Handle::from_file(anchor.try_clone()?.into_std_file())?;
        let prototype = Prototype::open(path)?;
        let id = prototype.workspace_id()?;
        let uuid = uuid::Uuid::parse_str(&id).map_err(|_| "invalid-workspace-id")?;
        if uuid.to_string() != id || expected_id.is_some_and(|expected| expected != id) {
            return Err("workspace-identity-changed".into());
        }
        let lock_directory = self.directory.join("workspace-preview-locks");
        if !lock_directory.try_exists()? {
            files::create_private_dir(&lock_directory)?;
        }
        directory(&lock_directory)?;
        let lock_path = lock_directory.join(format!("{id}.lock"));
        if !lock_path.try_exists()? {
            match files::write_new(&lock_path, b"") {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(error) => return Err(error.into()),
            }
        }
        let lock = files::regular_file(&lock_path)?;
        // Windows LockFileEx requires a writable handle; reopen only the already validated file.
        let lock = writable_lock(lock, &lock_path)?;
        lock.try_lock().map_err(|error| match error {
            std::fs::TryLockError::WouldBlock => "workspace-already-open".into(),
            std::fs::TryLockError::Error(error) => {
                Box::new(error) as Box<dyn std::error::Error + Send + Sync>
            }
        })?;
        if root_identity != same_file::Handle::from_path(path)? {
            return Err("workspace-identity-changed".into());
        }
        Ok(Session {
            prototype,
            _identity_lock: IdentityLock(lock),
            anchor,
            root_identity,
            descriptor: Active {
                path: text_path(&path.canonicalize()?)?,
                id,
                token: nonce(),
            },
        })
    }
    /// `path` must come from the native picker, never an untrusted renderer path parameter.
    pub fn choose(&mut self, expected: &str, path: &Path, create: bool) -> Result<Status> {
        self.check_epoch(expected)?;
        directory(path)?;
        let canonical = path.canonicalize()?;
        if self
            .current
            .as_ref()
            .is_some_and(|s| Path::new(&s.descriptor.path) == canonical)
        {
            if create {
                return Err("prototype-root-must-be-empty".into());
            }
            return self.status();
        }
        if create {
            drop(Prototype::create_in_empty(&canonical)?);
        }
        let session = self.open_session(&canonical, None)?;
        self.select(session)
    }
    pub fn recent(&mut self, expected: &str, path: &str, id: &str) -> Result<Status> {
        self.check_epoch(expected)?;
        let known: bool = self.index.query_row(
            "SELECT EXISTS(SELECT 1 FROM recent WHERE path=?1 AND id=?2)",
            params![path, id],
            |r| r.get(0),
        )?;
        if !known {
            return Err("unknown-recent-workspace".into());
        }
        if self
            .current
            .as_ref()
            .is_some_and(|s| s.descriptor.path == path && s.descriptor.id == id)
        {
            return self.status();
        }
        let session = self.open_session(Path::new(path), Some(id))?;
        self.select(session)
    }
    fn select(&mut self, session: Session) -> Result<Status> {
        let tx = self.index.transaction()?;
        let opened: i64 =
            tx.query_row("SELECT coalesce(max(opened),0)+1 FROM recent", [], |r| {
                r.get(0)
            })?;
        tx.execute("INSERT INTO recent VALUES(?1,?2,?3) ON CONFLICT(path) DO UPDATE SET id=excluded.id,opened=excluded.opened", params![session.descriptor.path,session.descriptor.id,opened])?;
        tx.execute("DELETE FROM recent WHERE path NOT IN (SELECT path FROM recent ORDER BY opened DESC,path LIMIT 8)", [])?;
        tx.execute("INSERT INTO selected VALUES(1,?1,?2) ON CONFLICT(singleton) DO UPDATE SET path=excluded.path,id=excluded.id", params![session.descriptor.path,session.descriptor.id])?;
        tx.commit()?;
        self.current = Some(session);
        self.restore_error = None;
        self.epoch = nonce();
        self.status()
    }
    pub fn close(&mut self, expected: &str) -> Result<Status> {
        self.check_epoch(expected)?;
        self.index.execute("DELETE FROM selected", [])?;
        self.current = None;
        self.restore_error = None;
        self.epoch = nonce();
        self.status()
    }
    pub fn scan(&self, token: &str) -> Result<Scan> {
        let session = self
            .current
            .as_ref()
            .filter(|s| s.descriptor.token == token)
            .ok_or("stale-workspace-session")?;
        // A moved/replaced root must be reopened explicitly. Do not discover a replacement silently.
        directory(Path::new(&session.descriptor.path))?;
        if session.root_identity != same_file::Handle::from_path(&session.descriptor.path)? {
            return Err("workspace-identity-changed".into());
        }
        let mut budget = MAX_SCAN_BYTES;
        let accepted = session
            .prototype
            .preview_files(&mut budget, |hash, remaining| {
                read_cap(
                    &session.anchor,
                    Path::new(&format!(".repeaty/objects/sha256/{}/{hash}", &hash[..2])),
                    remaining,
                )
            })?;
        let mut scan = Scan {
            token: token.to_owned(),
            complete: true,
            accepted,
            observations: vec![],
            issues: vec![],
            examined: 0,
        };
        for name in ["notes", "sources", "drafts"] {
            match session.anchor.symlink_metadata(name) {
                Ok(metadata) if metadata.is_dir() && !metadata.is_symlink() => {
                    match session.anchor.open_dir(name) {
                        Ok(dir) => scan_directory(&dir, Path::new(name), 0, &mut budget, &mut scan),
                        Err(_) => {
                            scan.complete = false;
                            scan.issues.push("unreadable-directory".into());
                        }
                    }
                }
                Ok(_) => {
                    scan.complete = false;
                    scan.issues.push("unsafe-directory".into());
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    if name == "notes" {
                        scan.complete = false;
                        scan.issues.push("unreadable-directory".into());
                    }
                }
                Err(_) => {
                    scan.complete = false;
                    scan.issues.push("unreadable-directory".into());
                }
            }
        }
        scan.observations.sort_by(|a, b| a.path.cmp(&b.path));
        scan.issues.sort();
        scan.issues.dedup();
        Ok(scan)
    }
}
#[cfg(unix)]
fn writable_lock(file: File, _path: &Path) -> Result<File> {
    Ok(file)
}
#[cfg(windows)]
fn writable_lock(_file: File, path: &Path) -> Result<File> {
    use std::os::windows::fs::OpenOptionsExt;
    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .custom_flags(0x00200000)
        .open(path)?;
    if !file.metadata()?.is_file() {
        return Err("unsafe-lock".into());
    }
    Ok(file)
}
fn read_options() -> cap_std::fs::OpenOptions {
    use cap_std::fs::OpenOptionsExt;
    let mut options = cap_std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    options.custom_flags(libc::O_NONBLOCK | libc::O_NOFOLLOW);
    #[cfg(windows)]
    options.custom_flags(0x00200000);
    options
}
fn read_cap(dir: &cap_std::fs::Dir, path: &Path, budget: usize) -> Result<Vec<u8>> {
    let file = dir.open_with(path, &read_options())?.into_std();
    if file.metadata()?.len() > budget as u64 {
        return Err("preview-limit".into());
    }
    Ok(files::read_stable_file(
        file,
        files::MAX_TEXT_BYTES.min(budget as u64),
    )?)
}
fn scan_directory(
    dir: &cap_std::fs::Dir,
    relative: &Path,
    depth: usize,
    budget: &mut usize,
    scan: &mut Scan,
) {
    if depth > 12 || scan.observations.len() >= MAX_FILES || scan.examined >= 20_000 || *budget == 0
    {
        scan.complete = false;
        scan.issues.push("preview-limit".into());
        return;
    }
    let entries = match dir.entries() {
        Ok(entries) => entries,
        Err(_) => {
            scan.complete = false;
            scan.issues.push("unreadable-directory".into());
            return;
        }
    };
    for entry in entries {
        if scan.observations.len() >= MAX_FILES || scan.examined >= 20_000 {
            scan.complete = false;
            scan.issues.push("preview-limit".into());
            break;
        }
        scan.examined += 1;
        let Ok(entry) = entry else {
            scan.complete = false;
            scan.issues.push("unreadable-directory".into());
            continue;
        };
        let relative_path = relative.join(entry.file_name());
        let Ok(relative_name) = text_path(&relative_path) else {
            scan.complete = false;
            scan.issues.push("invalid-path".into());
            continue;
        };
        #[cfg(windows)]
        let relative_name = relative_name.replace('\\', "/");
        let Ok(kind) = entry.file_type() else {
            scan.complete = false;
            scan.issues.push("unreadable-file".into());
            continue;
        };
        if kind.is_dir() {
            match entry.open_dir() {
                Ok(child) => scan_directory(&child, &relative_path, depth + 1, budget, scan),
                Err(_) => {
                    scan.complete = false;
                    scan.issues.push("unsafe-directory".into());
                }
            }
            continue;
        }
        if kind.is_symlink() {
            scan.complete = false;
            scan.issues.push("unsafe-file".into());
        }
        if !relative_name.to_ascii_lowercase().ends_with(".md") {
            continue;
        }
        let read = (|| -> Result<String> {
            if kind.is_symlink() {
                return Err("unsafe-file".into());
            }
            let file = entry.open_with(&read_options())?.into_std();
            let size = file.metadata()?.len();
            if size > *budget as u64 {
                return Err("preview-limit".into());
            }
            let bytes = files::read_stable_file(file, files::MAX_TEXT_BYTES)?;
            if bytes.len() > *budget {
                return Err("preview-limit".into());
            }
            *budget -= bytes.len();
            Ok(String::from_utf8(bytes).map_err(|_| "invalid-utf8")?)
        })();
        let (raw, error) = match read {
            Ok(raw) => (Some(raw), None),
            Err(error) => (None, Some(error_code(error.as_ref()))),
        };
        if error.as_deref() == Some("preview-limit") {
            scan.complete = false;
            scan.issues.push("preview-limit".into());
        }
        scan.observations.push(Observation {
            path: relative_name,
            raw,
            error,
        });
    }
}
/// Public diagnostics are stable codes; absolute OS error strings never become product copy.
pub fn error_code(error: &(dyn std::error::Error + Send + Sync + 'static)) -> String {
    if let Some(error) = error.downcast_ref::<std::io::Error>() {
        return match error.kind() {
            std::io::ErrorKind::NotFound => "workspace-missing",
            std::io::ErrorKind::PermissionDenied => "permission-denied",
            std::io::ErrorKind::FileTooLarge => "file-too-large",
            std::io::ErrorKind::WouldBlock => "file-changing",
            _ => "workspace-unavailable",
        }
        .into();
    }
    let message = error.to_string();
    match message.as_str() {
        "prototype-root-must-be-empty"
        | "not-an-m0-prototype"
        | "incompatible-prototype-database"
        | "prototype-already-open"
        | "workspace-already-open"
        | "workspace-identity-changed"
        | "stale-workspace-session"
        | "unknown-recent-workspace"
        | "preview-limit"
        | "invalid-utf8"
        | "unsafe-directory"
        | "unsafe-file"
        | "incompatible-preview-index" => message,
        _ => "workspace-unavailable".into(),
    }
}
