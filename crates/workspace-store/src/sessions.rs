use crate::{
    error::{Error, Result},
    library::Library,
};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};
use std::{
    fs::{self, File, OpenOptions},
    path::{Path, PathBuf},
};
use uuid::Uuid;
struct IdentityLock(File);
impl Drop for IdentityLock {
    fn drop(&mut self) {
        let _ = self.0.unlock();
    }
}
struct Active {
    library: Library,
    watch: crate::watch::DirectoryWatch,
    _identity_lock: IdentityLock,
}
pub struct Sessions {
    directory: PathBuf,
    index: Connection,
    active: Option<Active>,
    epoch: String,
    selected: Option<(String, String)>,
    restore_error: Option<String>,
}
impl Sessions {
    pub fn open(directory: &Path) -> Result<Self> {
        fs::create_dir_all(directory)?;
        let index = Connection::open(directory.join("workspaces.sqlite3"))?;
        index.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS recent(path TEXT PRIMARY KEY,id TEXT NOT NULL,used INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS selected(slot INTEGER PRIMARY KEY CHECK(slot=1),path TEXT NOT NULL,id TEXT NOT NULL);")?;
        let selected = index
            .query_row("SELECT path,id FROM selected WHERE slot=1", [], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .optional()?;
        let mut sessions = Self {
            directory: directory.into(),
            index,
            active: None,
            epoch: Uuid::new_v4().to_string(),
            selected,
            restore_error: None,
        };
        if let Some((path, id)) = sessions.selected.clone() {
            match sessions.open_library(Path::new(&path), Some(&id), false) {
                Ok(active) => sessions.active = Some(active),
                Err(error) => sessions.restore_error = Some(error.0.into()),
            }
        }
        Ok(sessions)
    }
    pub fn status(&self) -> Result<Value> {
        let mut stmt = self
            .index
            .prepare("SELECT path,id FROM recent ORDER BY used DESC,path LIMIT 8")?;
        let recent = stmt
            .query_map([], |r| {
                Ok(json!({"path":r.get::<_,String>(0)?,"id":r.get::<_,String>(1)?}))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(
            json!({"epoch":self.epoch,"active":self.active.as_ref().map(|active|json!({"id":active.library.id,"token":active.library.token,"path":active.library.path()})),"recent":recent,"error":self.restore_error}),
        )
    }
    fn open_library(&self, path: &Path, id: Option<&str>, create: bool) -> Result<Active> {
        let library = if create {
            Library::create(path)?
        } else {
            Library::open(path)?
        };
        if id.is_some_and(|id| id != library.id) {
            return Err(Error("workspace-identity-changed"));
        }
        let locks = self.directory.join("workspace-locks");
        fs::create_dir_all(&locks)?;
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
        }
        let lock = options.open(locks.join(format!("{}.lock", library.id)))?;
        lock.try_lock()
            .map_err(|_| Error("workspace-already-open"))?;
        Ok(Active {
            watch: crate::watch::DirectoryWatch::new(library.path()),
            library,
            _identity_lock: IdentityLock(lock),
        })
    }
    pub fn check_epoch(&self, epoch: &str) -> Result<()> {
        if epoch != self.epoch {
            Err(Error("stale-workspace-session"))
        } else {
            Ok(())
        }
    }
    pub fn choose(&mut self, epoch: &str, path: &Path, create: bool) -> Result<Value> {
        self.check_epoch(epoch)?;
        if !create
            && let Some(active) = &self.active
            && fs::canonicalize(path).ok().as_deref() == Some(active.library.path())
        {
            active.library.guard(&active.library.token)?;
            return self.status();
        }
        let active = self.open_library(path, None, create)?;
        self.select(active)
    }
    fn select(&mut self, active: Active) -> Result<Value> {
        let path = active
            .library
            .path()
            .to_str()
            .ok_or(Error("invalid-path"))?
            .to_owned();
        let id = active.library.id.clone();
        let tx = self.index.transaction()?;
        tx.execute("INSERT INTO recent VALUES(?1,?2,?3) ON CONFLICT(path) DO UPDATE SET id=excluded.id,used=excluded.used",params![path,id,chrono::Utc::now().timestamp_millis()])?;
        tx.execute("INSERT INTO selected VALUES(1,?1,?2) ON CONFLICT(slot) DO UPDATE SET path=excluded.path,id=excluded.id",params![path,id])?;
        tx.execute("DELETE FROM recent WHERE path NOT IN (SELECT path FROM recent ORDER BY used DESC,path LIMIT 8)",[])?;
        tx.commit()?;
        self.active = Some(active);
        self.selected = Some((path, id));
        self.restore_error = None;
        self.epoch = Uuid::new_v4().to_string();
        self.status()
    }
    pub fn recent(&mut self, epoch: &str, path: &str, id: &str) -> Result<Value> {
        self.check_epoch(epoch)?;
        let registered: bool = self.index.query_row(
            "SELECT EXISTS(SELECT 1 FROM recent WHERE path=?1 AND id=?2)",
            params![path, id],
            |r| r.get(0),
        )?;
        if !registered {
            return Err(Error("unknown-recent-workspace"));
        }
        if let Some(active) = &self.active
            && active.library.path() == Path::new(path)
            && active.library.id == id
        {
            active.library.guard(&active.library.token)?;
            return self.status();
        }
        let active = self.open_library(Path::new(path), Some(id), false)?;
        self.select(active)
    }
    pub fn restore(&mut self, epoch: &str) -> Result<Value> {
        self.check_epoch(epoch)?;
        if self.active.is_some() {
            return self.status();
        }
        let (path, id) = self.selected.clone().ok_or(Error("workspace-not-open"))?;
        let active = self.open_library(Path::new(&path), Some(&id), false)?;
        self.select(active)
    }
    pub fn close(&mut self, epoch: &str) -> Result<Value> {
        self.check_epoch(epoch)?;
        if let Some((path, id)) = &self.selected {
            self.index.execute(
                "DELETE FROM selected WHERE slot=1 AND path=?1 AND id=?2",
                params![path, id],
            )?;
        }
        self.active = None;
        self.selected = None;
        self.restore_error = None;
        self.epoch = Uuid::new_v4().to_string();
        self.status()
    }
    pub fn read(&mut self, token: &str, request: Value) -> Result<Value> {
        let active = self.active.as_mut().ok_or(Error("workspace-not-open"))?;
        active.library.guard(token)?;
        active.library.read(request)
    }
    pub fn changes(&self, token: &str) -> Result<Option<crate::watch::Changes>> {
        self.watch_session(token)?;
        let active = self.active.as_ref().ok_or(Error("workspace-not-open"))?;
        // Idle notification drains perform no SQLite queries or filesystem reads.
        Ok(active.watch.take())
    }
    pub fn watch_session(&self, token: &str) -> Result<()> {
        match &self.active {
            Some(active) if active.library.token == token => Ok(()),
            Some(_) => Err(Error("stale-workspace-session")),
            None => Err(Error("workspace-not-open")),
        }
    }
    /// Return a held directory capability only after validating the active session and identity.
    pub fn plugin_root(&self, token: &str) -> Result<cap_std::fs::Dir> {
        let active = self.active.as_ref().ok_or(Error("workspace-not-open"))?;
        active.library.guard(token)?;
        Ok(active.library.anchor.try_clone()?)
    }
    pub fn write(&mut self, token: &str, request: Value) -> Result<Value> {
        let active = self.active.as_mut().ok_or(Error("workspace-not-open"))?;
        active.library.guard(token)?;
        active.library.write(request)
    }
}
