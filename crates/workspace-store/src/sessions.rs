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
    sync_device: Option<String>,
}
impl Sessions {
    pub fn sync_bind_device(&mut self, device: &str) -> Result<()> {
        self.sync_bind_for_group(device, None)
    }
    fn sync_bind_for_group(&mut self, device: &str, joining: Option<&str>) -> Result<()> {
        self.sync_device = Some(device.to_owned());
        if let Some(active) = self.active.as_mut() {
            active.library.sync_bind_device(device)?;
            let base = active
                .library
                .db
                .sync_device
                .clone()
                .ok_or(Error("sync-device-required"))?;
            let state: Option<(String, String)> = active
                .library
                .db
                .connection
                .query_row(
                    "SELECT group_id,clock FROM sync_state WHERE id=1",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;
            let state = state.or_else(|| joining.map(|group| (group.to_owned(), "{}".into())));
            let Some((group, raw_clock)) = state else {
                return Ok(());
            };
            let clock: crate::sync::Clock = serde_json::from_str(&raw_clock)?;
            let tx = self.index.transaction()?;
            let previous:Option<(String,i64)>=tx.query_row("SELECT writer,highwater FROM sync_writer_frontiers WHERE base=?1 AND group_id=?2",params![base,group],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
            let mut writer = previous
                .as_ref()
                .map(|(writer, _)| writer.clone())
                .unwrap_or_else(|| base.clone());
            let applied = clock.get(&writer).copied().unwrap_or(0);
            if previous
                .as_ref()
                .is_some_and(|(_, water)| applied < *water as u64)
            {
                // An older library was copied over this path. Retain that branch, but
                // never reuse a transaction identity already exposed by this device.
                writer = crate::files::digest(format!("{base}\n{}", Uuid::new_v4()).as_bytes());
            }
            let stored: i64 = active.library.db.connection.query_row(
                "SELECT COALESCE(MAX(sequence),0) FROM sync_events WHERE device=?1",
                [&writer],
                |r| r.get(0),
            )?;
            let highwater = stored.max(
                i64::try_from(clock.get(&writer).copied().unwrap_or(0))
                    .map_err(|_| Error::invalid())?,
            );
            if previous.as_ref() != Some(&(writer.clone(), highwater)) {
                tx.execute("INSERT INTO sync_writer_frontiers(base,group_id,writer,highwater) VALUES(?1,?2,?3,?4) ON CONFLICT(base,group_id) DO UPDATE SET writer=excluded.writer,highwater=excluded.highwater",params![base,group,writer,highwater])?;
            }
            tx.commit()?;
            active.library.db.sync_device = Some(writer);
        }
        Ok(())
    }
    pub fn sync_request(&mut self, token: &str, method: &str, payload: Value) -> Result<Value> {
        self.active
            .as_ref()
            .ok_or(Error("workspace-not-open"))?
            .library
            .guard(token)?;
        // Persist the high-water mark before a journal batch can leave the device.
        // This closes the crash window between a library commit and index bookkeeping.
        if let Some(device) = self.sync_device.clone() {
            if method == "start" {
                let group = payload["groupId"]
                    .as_str()
                    .filter(|group| Uuid::parse_str(group).is_ok())
                    .ok_or_else(Error::invalid)?;
                self.sync_bind_for_group(&device, Some(group))?;
            } else {
                self.sync_bind_device(&device)?;
            }
        }
        let active = self.active.as_mut().ok_or(Error("workspace-not-open"))?;
        active.library.guard(token)?;
        let result = active.library.sync_request(method, payload);
        if let Some(device) = self.sync_device.clone() {
            self.sync_bind_device(&device)?;
        }
        result
    }
    /// Identity only: native peripheral services must not scan library content to bind a session.
    pub fn active_identity(&self) -> Option<(&str, &str)> {
        self.active
            .as_ref()
            .map(|active| (active.library.id.as_str(), active.library.token.as_str()))
    }
    pub fn open(directory: &Path) -> Result<Self> {
        fs::create_dir_all(directory)?;
        let index = Connection::open(directory.join("workspaces.sqlite3"))?;
        index.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS recent(path TEXT PRIMARY KEY,id TEXT NOT NULL,used INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS selected(slot INTEGER PRIMARY KEY CHECK(slot=1),path TEXT NOT NULL,id TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS sync_writer_frontiers(base TEXT NOT NULL,group_id TEXT NOT NULL,writer TEXT NOT NULL,highwater INTEGER NOT NULL CHECK(highwater>=0),PRIMARY KEY(base,group_id));")?;
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
            sync_device: None,
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
    pub fn backup(&self, token: &str, target: &Path) -> Result<crate::backup::Summary> {
        self.backup_with_cancel(token, target, &std::sync::atomic::AtomicBool::new(false))
    }
    pub fn backup_with_cancel(
        &self,
        token: &str,
        target: &Path,
        cancel: &std::sync::atomic::AtomicBool,
    ) -> Result<crate::backup::Summary> {
        let active = self.active.as_ref().ok_or(Error("workspace-not-open"))?;
        active.library.guard(token)?;
        crate::backup::create(&active.library, target, cancel)
    }
    pub fn inspect_backup(path: &Path) -> Result<crate::backup::Summary> {
        crate::backup::inspect(path)
    }
    pub fn list_backup_summary(path: &Path) -> Result<crate::backup::Summary> {
        crate::backup::list_summary(path)
    }
    pub fn inspect_backup_with_cancel(
        path: &Path,
        cancel: &std::sync::atomic::AtomicBool,
    ) -> Result<crate::backup::Summary> {
        crate::backup::inspect_with_cancel(path, cancel)
    }
    pub fn search_backup_checked_with_cancel(
        path: &Path,
        query: &str,
        limit: usize,
        expected_digest: &str,
        cancel: &std::sync::atomic::AtomicBool,
    ) -> Result<Vec<crate::backup::SearchHit>> {
        crate::backup::search_checked_with_cancel(path, query, limit, Some(expected_digest), cancel)
    }
    pub fn search_backup(
        path: &Path,
        query: &str,
        limit: usize,
    ) -> Result<Vec<crate::backup::SearchHit>> {
        crate::backup::search(path, query, limit)
    }
    pub fn restore_backup(
        &mut self,
        epoch: &str,
        archive: &Path,
        target: &Path,
        expected_digest: &str,
    ) -> Result<Value> {
        self.restore_backup_with_cancel(
            epoch,
            archive,
            target,
            expected_digest,
            &std::sync::atomic::AtomicBool::new(false),
        )
    }
    pub fn search_backup_checked(
        path: &Path,
        query: &str,
        limit: usize,
        expected_digest: &str,
    ) -> Result<Vec<crate::backup::SearchHit>> {
        crate::backup::search_checked(path, query, limit, Some(expected_digest))
    }
    pub fn restore_backup_items_with_cancel(
        archive: &Path,
        target: &Path,
        expected_digest: &str,
        paths: &[String],
        cancel: &std::sync::atomic::AtomicBool,
    ) -> Result<Value> {
        crate::backup::restore_items_with_cancel(archive, target, expected_digest, paths, cancel)
    }
    pub fn restore_backup_with_cancel(
        &mut self,
        epoch: &str,
        archive: &Path,
        target: &Path,
        expected_digest: &str,
        cancel: &std::sync::atomic::AtomicBool,
    ) -> Result<Value> {
        self.check_epoch(epoch)?;
        if let Some(active) = &self.active
            && fs::canonicalize(target.parent().ok_or(Error("invalid-path"))?)?
                .starts_with(active.library.path())
        {
            return Err(Error("backup-target-in-workspace"));
        }
        let restored = crate::backup::restore(archive, target, expected_digest, cancel)?;
        let active = self.open_library(&restored, None, false)?;
        self.index.execute("INSERT INTO recent VALUES(?1,?2,?3) ON CONFLICT(path) DO UPDATE SET id=excluded.id,used=excluded.used",params![restored.to_str().ok_or(Error("invalid-path"))?,active.library.id,chrono::Utc::now().timestamp_millis()])?;
        self.index.execute("DELETE FROM recent WHERE path NOT IN (SELECT path FROM recent ORDER BY used DESC,path LIMIT 8)",[])?;
        let result = json!({"restoredPath":restored.to_str().ok_or(Error("invalid-path"))?,"newWorkspaceId":active.library.id,"status":self.status()?});
        drop(active);
        Ok(result)
    }
    pub fn restore_backup_items(
        archive: &Path,
        target: &Path,
        expected_digest: &str,
        paths: &[String],
    ) -> Result<Value> {
        crate::backup::restore_items(archive, target, expected_digest, paths)
    }
    pub fn maintenance(&mut self, token: &str, vacuum: bool) -> Result<Value> {
        let active = self.active.as_mut().ok_or(Error("workspace-not-open"))?;
        active.library.guard(token)?;
        let db = &active.library.db.connection;
        let integrity: String = db.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
        if integrity != "ok" {
            return Err(Error("workspace-corrupt"));
        }
        if vacuum {
            let busy: i64 = db.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |r| r.get(0))?;
            if busy != 0 {
                return Err(Error("workspace-busy"));
            }
            db.execute_batch("VACUUM; PRAGMA optimize;")?;
            db.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()))?;
        }
        let pages: i64 = db.pragma_query_value(None, "page_count", |r| r.get(0))?;
        let free: i64 = db.pragma_query_value(None, "freelist_count", |r| r.get(0))?;
        let size: i64 = db.pragma_query_value(None, "page_size", |r| r.get(0))?;
        Ok(
            json!({"integrity":integrity,"pages":pages,"freePages":free,"pageSize":size,"databaseBytes":pages*size,"reclaimableBytes":free*size,"compacted":vacuum}),
        )
    }
}

#[cfg(test)]
mod sync_writer_tests {
    use super::*;
    fn sessions() -> (
        tempfile::TempDir,
        tempfile::TempDir,
        Sessions,
        String,
        String,
    ) {
        let device = tempfile::tempdir().unwrap();
        let workspace = tempfile::tempdir().unwrap();
        let mut sessions = Sessions::open(device.path()).unwrap();
        let epoch = sessions.status().unwrap()["epoch"]
            .as_str()
            .unwrap()
            .to_owned();
        sessions.choose(&epoch, workspace.path(), true).unwrap();
        sessions.sync_bind_device("test-device").unwrap();
        let token = sessions.active_identity().unwrap().1.to_owned();
        let group = Uuid::new_v4().to_string();
        sessions
            .sync_request(&token, "start", json!({"groupId":group}))
            .unwrap();
        (device, workspace, sessions, token, group)
    }
    fn write(sessions: &mut Sessions, token: &str, value: &str) {
        sessions
            .write(
                token,
                json!({"type":"value","namespace":"plugin:sample","id":"data","value":value}),
            )
            .unwrap();
    }
    fn list(sessions: &mut Sessions, token: &str) -> Value {
        sessions
            .sync_request(token, "journal/list", json!({"clock":{},"limit":128}))
            .unwrap()
    }
    #[test]
    fn old_database_replaced_at_same_path_rotates_writer_before_next_local_event() {
        let (device, workspace, mut sessions, token, group) = sessions();
        write(&mut sessions, &token, "first");
        let first = list(&mut sessions, &token);
        let old_writer = first[0]["deviceId"].as_str().unwrap().to_owned();
        let snapshot = device.path().join("older.sqlite3");
        sessions
            .active
            .as_ref()
            .unwrap()
            .library
            .db
            .connection
            .execute("VACUUM INTO ?1", [snapshot.to_str().unwrap()])
            .unwrap();
        write(&mut sessions, &token, "second");
        // No explicit bind after the write: journal/list itself must persist exposure.
        let exposed = list(&mut sessions, &token);
        assert_eq!(exposed[1]["sequence"], 2);
        drop(sessions);
        let database = workspace.path().join(".repeaty/state.sqlite3");
        assert!(!workspace.path().join(".repeaty/state.sqlite3-wal").exists());
        // Only fixture-owned files are replaced, with no live SQLite connection.
        fs::copy(&snapshot, &database).unwrap();
        let mut reopened = Sessions::open(device.path()).unwrap();
        reopened.sync_bind_device("test-device").unwrap();
        let token = reopened.active_identity().unwrap().1.to_owned();
        write(&mut reopened, &token, "restored branch");
        let branch = list(&mut reopened, &token);
        let event = branch
            .as_array()
            .unwrap()
            .iter()
            .find(|event| event["deviceId"] != old_writer)
            .unwrap();
        assert_eq!(event["sequence"], 1);
        assert_eq!(event["clock"][&old_writer], 1);
        let writer = event["deviceId"].as_str().unwrap().to_owned();
        drop(reopened);
        let mut reopened = Sessions::open(device.path()).unwrap();
        reopened.sync_bind_device("test-device").unwrap();
        assert_eq!(
            reopened
                .active
                .as_ref()
                .unwrap()
                .library
                .db
                .sync_device
                .as_ref(),
            Some(&writer)
        );
        let remote_dir = tempfile::tempdir().unwrap();
        let mut remote = Library::create(remote_dir.path()).unwrap();
        remote.sync_bind_device("other-device").unwrap();
        remote
            .sync_request("start", json!({"groupId":group}))
            .unwrap();
        remote
            .sync_request("journal/receive", json!({"events":exposed}))
            .unwrap();
        remote
            .sync_request("journal/receive", json!({"events":branch}))
            .unwrap();
        assert_eq!(
            remote
                .sync_request("journal/list", json!({"clock":{},"limit":128}))
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            3
        );
    }
    #[test]
    fn highwater_persistence_failure_blocks_journal_exposure() {
        let (_device, _workspace, mut sessions, token, _group) = sessions();
        write(&mut sessions, &token, "first");
        list(&mut sessions, &token);
        sessions.index.execute_batch("CREATE TRIGGER fail_frontier BEFORE UPDATE ON sync_writer_frontiers BEGIN SELECT RAISE(ABORT,'injected failure'); END;").unwrap();
        write(&mut sessions, &token, "second");
        assert!(
            sessions
                .sync_request(&token, "journal/list", json!({"clock":{},"limit":128}))
                .is_err()
        );
        sessions
            .index
            .execute_batch("DROP TRIGGER fail_frontier")
            .unwrap();
        assert_eq!(list(&mut sessions, &token).as_array().unwrap().len(), 2);
    }
    #[test]
    fn restoring_a_pre_group_library_chooses_a_fresh_writer_before_new_baseline() {
        let device = tempfile::tempdir().unwrap();
        let workspace = tempfile::tempdir().unwrap();
        let mut sessions = Sessions::open(device.path()).unwrap();
        let epoch = sessions.status().unwrap()["epoch"]
            .as_str()
            .unwrap()
            .to_owned();
        sessions.choose(&epoch, workspace.path(), true).unwrap();
        sessions.sync_bind_device("device").unwrap();
        let token = sessions.active_identity().unwrap().1.to_owned();
        write(&mut sessions, &token, "before group");
        let snapshot = device.path().join("pre-group.sqlite3");
        sessions
            .active
            .as_ref()
            .unwrap()
            .library
            .db
            .connection
            .execute("VACUUM INTO ?1", [snapshot.to_str().unwrap()])
            .unwrap();
        let group = Uuid::new_v4().to_string();
        sessions
            .sync_request(&token, "start", json!({"groupId":group}))
            .unwrap();
        let first = list(&mut sessions, &token);
        drop(sessions);
        fs::copy(snapshot, workspace.path().join(".repeaty/state.sqlite3")).unwrap();
        let mut sessions = Sessions::open(device.path()).unwrap();
        sessions.sync_bind_device("device").unwrap();
        let token = sessions.active_identity().unwrap().1.to_owned();
        sessions
            .sync_request(&token, "start", json!({"groupId":group}))
            .unwrap();
        let fresh = list(&mut sessions, &token);
        assert_ne!(first[0]["deviceId"], fresh[0]["deviceId"]);
        assert_eq!(fresh[0]["sequence"], 1);
    }
}
