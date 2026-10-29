//! The desktop's active learning store. SQLite commits accepted records and durable
//! publication intents together; working Markdown is never overwritten after an external edit.
use crate::{
    atomic,
    error::{Error, Result},
    files,
    records::{Commit, Database},
    retirement, working_media,
};
use cap_std::fs::Dir;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    fs::{self, File, OpenOptions},
    io,
    path::{Component, Path, PathBuf},
    sync::Arc,
};
use uuid::Uuid;
const FORMAT: &str = "repeaty-workspace";
const APP_ID: i32 = 0x52505459;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Marker {
    pub format: String,
    pub version: u32,
    pub id: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Document {
    pub kind: String,
    pub id: String,
    pub path: String,
    pub raw: Option<String>,
    pub expected_hash: Option<String>,
    /// An explicit external acceptance checks the observed disk bytes independently.
    #[serde(default)]
    pub working_hash: Option<String>,
    #[serde(default)]
    pub missing: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Save {
    pub operation_id: String,
    pub expected_revision: i64,
    pub patches: Vec<crate::records::Patch>,
    pub documents: Vec<Document>,
    pub reason: Option<String>,
    #[serde(default)]
    pub operation_history: Option<Value>,
    pub consume_card_draft: Option<String>,
    #[serde(default)]
    pub consume_source_draft: Option<String>,
    #[serde(default)]
    pub scan_hash: Option<String>,
    #[serde(default)]
    pub asset_observations: Vec<working_media::Observation>,
}
struct Lock(File);
impl Drop for Lock {
    fn drop(&mut self) {
        let _ = self.0.unlock();
    }
}
pub struct Library {
    pub(crate) root: PathBuf,
    pub(crate) anchor: Arc<Dir>,
    identity: same_file::Handle,
    members: Vec<(String, same_file::Handle)>,
    pub id: String,
    pub token: String,
    pub(crate) db: Database,
    _lock: Lock,
}
fn fail(code: &'static str) -> Error {
    Error(code)
}
fn io_error(error: io::Error) -> Error {
    match error.kind() {
        io::ErrorKind::NotFound => fail("workspace-missing"),
        io::ErrorKind::PermissionDenied => fail("permission-denied"),
        _ => fail("storage-error"),
    }
}
fn plain(path: &Path, directory: bool) -> Result<()> {
    let meta = fs::symlink_metadata(path).map_err(io_error)?;
    if meta.file_type().is_symlink()
        || (directory && !meta.is_dir())
        || (!directory && !meta.is_file())
    {
        return Err(fail("unsafe-file"));
    }
    Ok(())
}
impl Library {
    pub fn create(root: &Path) -> Result<Self> {
        plain(root, true)?;
        if fs::read_dir(root)?.next().is_some() {
            return Err(fail("workspace-not-empty"));
        }
        for name in [".repeaty", "notes", "sources", "assets"] {
            files::create_private_dir(&root.join(name))?;
        }
        for name in ["objects", "staging", "retained", "media"] {
            files::create_private_dir(&root.join(".repeaty").join(name))?;
        }
        let marker = Marker {
            format: FORMAT.into(),
            version: 3,
            id: Uuid::new_v4().to_string(),
        };
        // Publish the marker only after the database has been initialized.
        let root = fs::canonicalize(root)?;
        let anchor = Arc::new(Dir::open_ambient_dir(&root, cap_std::ambient_authority())?);
        let db = Database::open(
            &root.join(".repeaty/state.sqlite3"),
            Arc::new(anchor.open_dir(".repeaty/media")?),
        )?;
        Self::schema(&db, &marker.id)?;
        drop(db);
        let staged = root.join(".repeaty/staging/marker");
        files::write_new(&staged, &serde_json::to_vec_pretty(&marker)?)?;
        atomic::publish_new(&staged, &root.join("workspace.json"))?;
        files::sync_directory(&root)?;
        Self::open(&root)
    }
    fn schema(db: &Database, id: &str) -> Result<()> {
        db.connection.execute_batch("PRAGMA synchronous=FULL;
          CREATE TABLE workspace_identity(id TEXT NOT NULL);
          CREATE TABLE documents(kind TEXT NOT NULL,id TEXT NOT NULL,path TEXT NOT NULL UNIQUE,hash TEXT NOT NULL,PRIMARY KEY(kind,id));
          CREATE TABLE publications(operation TEXT NOT NULL,path TEXT NOT NULL,hash TEXT,expected TEXT,status TEXT NOT NULL DEFAULT 'pending',PRIMARY KEY(operation,path));
          CREATE INDEX publications_status ON publications(status);
          CREATE TABLE receipts(id TEXT PRIMARY KEY,digest TEXT NOT NULL,revision INTEGER NOT NULL);
          CREATE TABLE card_drafts(id TEXT PRIMARY KEY,data TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS source_drafts(id TEXT PRIMARY KEY,data TEXT NOT NULL);
          CREATE TABLE values_store(namespace TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(namespace,id));")?;
        retirement::schema(&db.connection)?;
        db.connection
            .execute("INSERT INTO workspace_identity VALUES(?1)", [id])?;
        db.connection
            .pragma_update(None, "application_id", APP_ID)?;
        Ok(())
    }
    pub fn open(root: &Path) -> Result<Self> {
        let root = fs::canonicalize(root).map_err(io_error)?;
        plain(&root, true)?;
        let marker: Marker =
            serde_json::from_slice(&files::read_stable(&root.join("workspace.json"))?)?;
        if marker.format != FORMAT || marker.version != 3 || Uuid::parse_str(&marker.id).is_err() {
            return Err(fail("workspace-incompatible"));
        }
        for path in [
            ".repeaty",
            ".repeaty/objects",
            ".repeaty/staging",
            ".repeaty/retained",
            ".repeaty/media",
            "notes",
            "sources",
            "assets",
        ] {
            plain(&root.join(path), true)?;
        }
        let lock_path = root.join(".repeaty/workspace.lock");
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
        }
        if lock_path.exists() {
            let _ = files::regular_file(&lock_path)?;
        }
        let lock = options.open(&lock_path)?;
        lock.try_lock()
            .map_err(|_| fail("workspace-already-open"))?;
        let lock = Lock(lock);
        let db_path = root.join(".repeaty/state.sqlite3");
        let _ = files::regular_file(&db_path)?;
        // Reject unknown databases before Database::open can create any tables.
        let check = rusqlite::Connection::open_with_flags(
            &db_path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )?;
        let app: i32 = check.pragma_query_value(None, "application_id", |r| r.get(0))?;
        let version: i32 = check.pragma_query_value(None, "user_version", |r| r.get(0))?;
        let identity: String = check
            .query_row("SELECT id FROM workspace_identity", [], |r| r.get(0))
            .map_err(|_| fail("workspace-incompatible"))?;
        if app != APP_ID || ![10, 11, 12, 13].contains(&version) || identity != marker.id {
            return Err(fail("workspace-incompatible"));
        }
        drop(check);
        let anchor = Arc::new(Dir::open_ambient_dir(&root, cap_std::ambient_authority())?);
        let identity = same_file::Handle::from_file(anchor.try_clone()?.into_std_file())?;
        let db = Database::open(&db_path, Arc::new(anchor.open_dir(".repeaty/media")?))?;
        let members = [
            ".repeaty",
            ".repeaty/state.sqlite3",
            "workspace.json",
            ".repeaty/objects",
            ".repeaty/staging",
            ".repeaty/retained",
            ".repeaty/media",
            "notes",
            "sources",
            "assets",
        ]
        .into_iter()
        .map(|name| {
            Ok((
                name.to_owned(),
                same_file::Handle::from_path(root.join(name))?,
            ))
        })
        .collect::<Result<Vec<_>>>()?;
        let mut library = Self {
            root,
            anchor,
            identity,
            members,
            id: marker.id,
            token: Uuid::new_v4().to_string(),
            db,
            _lock: lock,
        };
        library.recover()?;
        crate::attachments::recover(&library.db.connection, &library.anchor)?;
        Ok(library)
    }
    pub fn path(&self) -> &Path {
        &self.root
    }
    pub fn guard(&self, token: &str) -> Result<()> {
        if token != self.token {
            return Err(fail("stale-workspace-session"));
        }
        if self.identity != same_file::Handle::from_path(&self.root).map_err(io_error)? {
            return Err(fail("workspace-identity-changed"));
        }
        for (name, identity) in &self.members {
            if identity != &same_file::Handle::from_path(self.root.join(name)).map_err(io_error)? {
                return Err(fail("workspace-identity-changed"));
            }
        }
        for part in [
            ".repeaty",
            ".repeaty/objects",
            ".repeaty/staging",
            ".repeaty/retained",
            ".repeaty/media",
            "notes",
            "sources",
            "assets",
        ] {
            plain(&self.root.join(part), true)?;
        }
        Ok(())
    }
    fn target(&self, path: &str) -> Result<PathBuf> {
        if path.len() > 1024
            || path.contains('\\')
            || !path.ends_with(".md")
            || !(path.starts_with("notes/") || path.starts_with("sources/"))
        {
            return Err(Error::invalid());
        }
        if Path::new(path)
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
        {
            return Err(Error::invalid());
        }
        let target = self.root.join(path);
        let mut parent = target.parent();
        while let Some(path) = parent {
            if path == self.root {
                break;
            }
            plain(path, true)?;
            parent = path.parent();
        }
        Ok(target)
    }
    pub(crate) fn read_working(&self, path: &str) -> Result<Option<Vec<u8>>> {
        self.target(path)?;
        let mut options = cap_std::fs::OpenOptions::new();
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
        match self.anchor.open_with(path, &options) {
            Ok(file) => Ok(Some(files::read_stable_file(
                file.into_std(),
                files::MAX_TEXT_BYTES,
            )?)),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(io_error(error)),
        }
    }
    fn object(&self, hash: &str) -> Result<PathBuf> {
        if hash.len() != 64
            || !hash
                .bytes()
                .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
        {
            return Err(Error::invalid());
        }
        Ok(self.root.join(".repeaty/objects").join(hash))
    }
    fn store_object(&self, raw: &str) -> Result<String> {
        if raw.len() as u64 > files::MAX_TEXT_BYTES {
            return Err(fail("file-too-large"));
        }
        let hash = files::digest(raw.as_bytes());
        let path = self.object(&hash)?;
        if path.exists() {
            if files::read_stable(&path)? != raw.as_bytes() {
                return Err(fail("corrupt-content-object"));
            }
        } else {
            files::write_new(&path, raw.as_bytes())?;
        }
        Ok(hash)
    }
    pub fn documents(&self, ids: Option<&[String]>) -> Result<Value> {
        self.document_rows(ids, false)
    }
    fn document_rows(&self, ids: Option<&[String]>, retired: bool) -> Result<Value> {
        let table = if retired {
            "(SELECT 'note' AS kind,id,path,hash FROM retired_documents)"
        } else {
            "documents"
        };
        let mut stmt=self.db.connection.prepare(&format!("SELECT kind,id,path,hash FROM {table} WHERE ?1 IS NULL OR id IN (SELECT value FROM json_each(?1)) ORDER BY path"))?;
        let rows = stmt
            .query_map([ids.map(serde_json::to_string).transpose()?], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let mut result = Vec::new();
        let mut bytes = 0;
        for (kind, id, path, hash) in rows {
            let raw = String::from_utf8(files::read_stable(&self.object(&hash)?)?)
                .map_err(|_| Error::invalid())?;
            if files::digest(raw.as_bytes()) != hash {
                return Err(fail("corrupt-content-object"));
            }
            bytes += raw.len();
            if bytes > 32 * 1024 * 1024 {
                return Err(fail("workspace-limit"));
            }
            result.push(json!({"kind":kind,"id":id,"path":path,"hash":hash,"raw":raw}));
        }
        Ok(Value::Array(result))
    }
    pub fn scan(&self) -> Result<Value> {
        let accepted = self.documents(None)?;
        let mut working = Vec::new();
        let mut bytes = 0usize;
        for folder in ["notes", "sources"] {
            self.walk(folder, 0, &mut working, &mut bytes)?;
        }
        working.sort_by(|a, b| a["path"].as_str().cmp(&b["path"].as_str()));
        let hashes = working
            .iter()
            .map(|file| json!([file["path"], file["hash"]]))
            .collect::<Vec<_>>();
        let scan_hash = files::digest(&serde_json::to_vec(&hashes)?);
        let retired = retirement::listing(&self.db.connection, "", 0)?;
        Ok(
            json!({"accepted":accepted,"working":working,"scanHash":scan_hash,"retired":retired["notes"],"retiredCount":retired["total"],"attention":self.attention()?}),
        )
    }
    pub(crate) fn walk(
        &self,
        path: &str,
        depth: usize,
        out: &mut Vec<Value>,
        bytes: &mut usize,
    ) -> Result<()> {
        if depth > 12 || out.len() > 4096 {
            return Err(fail("workspace-limit"));
        }
        for entry in self.anchor.read_dir(path)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            let path = format!("{path}/{name}");
            let kind = entry.file_type()?;
            if kind.is_dir() {
                plain(&self.root.join(&path), true)?;
                self.walk(&path, depth + 1, out, bytes)?;
            } else if kind.is_file() && path.ends_with(".md") {
                let raw = self.read_working(&path)?.ok_or_else(Error::missing)?;
                *bytes += raw.len();
                if *bytes > 32 * 1024 * 1024 {
                    return Err(fail("workspace-limit"));
                }
                let raw = String::from_utf8(raw).map_err(|_| fail("invalid-utf8"))?;
                out.push(json!({"path":path,"raw":raw,"hash":files::digest(raw.as_bytes())}));
            } else if kind.is_symlink() {
                return Err(fail("unsafe-file"));
            }
        }
        Ok(())
    }
    pub fn save(&mut self, request: Save) -> Result<Value> {
        self.guard(&self.token.clone())?;
        if Uuid::parse_str(&request.operation_id).is_err() || request.documents.len() > 100_000 {
            return Err(Error::invalid());
        }
        let fingerprint = files::digest(&serde_json::to_vec(&request)?);
        let prior: Option<(String, i64)> = self
            .db
            .connection
            .query_row(
                "SELECT digest,revision FROM receipts WHERE id=?1",
                [&request.operation_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((hash, revision)) = prior {
            if hash != fingerprint {
                return Err(fail("operation-conflict"));
            }
            self.recover()?;
            return Ok(json!({"revision":revision,"attention":self.attention()?}));
        }
        if let Some(expected) = &request.scan_hash
            && self.scan()?["scanHash"].as_str() != Some(expected)
        {
            return Err(fail("working-file-changed"));
        }
        working_media::verify(&self.anchor, &request.asset_observations)?;
        let mut documents = Vec::new();
        for doc in &request.documents {
            if !["note", "source"].contains(&doc.kind.as_str())
                || doc.id.is_empty()
                || doc.id.encode_utf16().count() > 150
                || (doc.missing && doc.working_hash.is_some())
                || (doc.kind == "note"
                    && doc.raw.is_none()
                    && doc.missing
                    && request.scan_hash.is_none())
            {
                return Err(Error::invalid());
            }
            self.target(&doc.path)?;
            let store = if doc.kind == "note" {
                "notes"
            } else {
                "sources"
            };
            if !doc.path.starts_with(&format!("{store}/"))
                || !request.patches.iter().any(|patch| {
                    patch.store == store
                        && !patch.position_only
                        && patch.id == doc.id
                        && patch.value.is_some() == doc.raw.is_some()
                })
            {
                return Err(Error::invalid());
            }
            let prior: Option<String> = self
                .db
                .connection
                .query_row(
                    "SELECT hash FROM documents WHERE kind=?1 AND id=?2",
                    params![doc.kind, doc.id],
                    |r| r.get(0),
                )
                .optional()?;
            if prior != doc.expected_hash {
                return Err(Error::conflict());
            }
            let disk = self
                .read_working(&doc.path)?
                .map(|data| files::digest(&data));
            let expected_disk = if doc.missing {
                None
            } else {
                doc.working_hash
                    .clone()
                    .or_else(|| doc.expected_hash.clone())
            };
            if disk != expected_disk {
                return Err(fail("working-file-changed"));
            }
            let next = doc
                .raw
                .as_ref()
                .map(|raw| self.store_object(raw))
                .transpose()?;
            documents.push((doc, next));
        }
        // Every changed note must have its editable Markdown accepted in the same transaction.
        for patch in &request.patches {
            let source_content = if patch.store == "sources" && !patch.position_only {
                let previous: Option<String> = self
                    .db
                    .connection
                    .query_row("SELECT data FROM sources WHERE id=?1", [&patch.id], |row| {
                        row.get(0)
                    })
                    .optional()?;
                match (previous, &patch.value) {
                    (Some(raw), Some(value)) => {
                        let before: Value = serde_json::from_str(&raw)?;
                        [
                            "title",
                            "url",
                            "mediaId",
                            "format",
                            "characters",
                            "origin",
                            "kind",
                            "derived",
                            "versions",
                            "inlineMedia",
                            "document",
                        ]
                        .iter()
                        .any(|key| before[key] != value[key])
                    }
                    _ => true,
                }
            } else {
                false
            };
            if (patch.store == "notes" || source_content)
                && !patch.position_only
                && !request.documents.iter().any(|doc| {
                    doc.kind
                        == if patch.store == "notes" {
                            "note"
                        } else {
                            "source"
                        }
                        && doc.id == patch.id
                })
            {
                return Err(Error::invalid());
            }
        }
        let consume = request.consume_card_draft;
        let consume_source = request.consume_source_draft;
        let operation = request.operation_id;
        let patches = request.patches;
        let metadata = patches
            .iter()
            .map(|patch| crate::records::Patch {
                store: patch.store.clone(),
                id: patch.id.clone(),
                position: None,
                value: patch.value.as_ref().map(|_| Value::Null),
                position_only: patch.position_only,
            })
            .collect::<Vec<_>>();
        let capture = &metadata;
        let anchor = &self.anchor;
        let observations = &request.asset_observations;
        let reactivate = &metadata;
        let revision=self.db.commit_callbacks(Commit {expected_revision:request.expected_revision,patches,reason:request.reason,operation_history:request.operation_history},|tx| { working_media::verify(anchor, observations)?; retirement::capture(tx,capture) },|tx| {
            working_media::verify(anchor, observations)?;
            retirement::reactivate(tx,reactivate)?;
            if let Some(id)=consume && tx.execute("DELETE FROM card_drafts WHERE id=?1",[id])?!=1 { return Err(Error::conflict()); }
            if let Some(id)=consume_source && tx.execute("DELETE FROM source_drafts WHERE json_extract(data,'$.id')=?1",[id])?!=1 { return Err(Error::conflict()); }
            for (doc,hash) in &documents {
                // A newly accepted observation supersedes older incomplete publication
                // attempts for this document, including its previous working path.
                tx.execute("UPDATE publications SET status='superseded' WHERE status IN ('pending','conflict') AND (path=?1 OR path IN (SELECT path FROM documents WHERE kind=?2 AND id=?3))",params![doc.path,doc.kind,doc.id])?;
                if let Some(hash)=hash {
                    tx.execute("INSERT INTO documents VALUES(?1,?2,?3,?4) ON CONFLICT(kind,id) DO UPDATE SET path=excluded.path,hash=excluded.hash",params![doc.kind,doc.id,doc.path,hash])?;
                } else { tx.execute("DELETE FROM documents WHERE kind=?1 AND id=?2",params![doc.kind,doc.id])?; }
                tx.execute("INSERT INTO publications(operation,path,hash,expected) VALUES(?1,?2,?3,?4)",params![operation,doc.path,hash,if doc.missing {None}else{doc.working_hash.clone().or_else(||doc.expected_hash.clone())}])?;
            }
            tx.execute("INSERT INTO receipts VALUES(?1,?2,?3)",params![operation,fingerprint,request.expected_revision+1])?;
            Ok(())
        })?;
        // The accepted transaction is committed. A publication failure is diagnostic,
        // not a failed grade that could be retried as another learning operation.
        if self.recover().is_err() { /* Pending intents remain durable and retry on open. */ }
        Ok(json!({"revision":revision,"attention":self.attention()?}))
    }
    pub fn recover(&mut self) -> Result<()> {
        let rows = {
            let mut stmt = self.db.connection.prepare(
                "SELECT operation,path,hash,expected FROM publications WHERE status='pending'",
            )?;
            stmt.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?
        };
        for (operation, path, hash, expected) in rows {
            if Uuid::parse_str(&operation).is_err() {
                return Err(Error::invalid());
            }
            let target = self.target(&path)?;
            // Stable intent-derived slots let recovery distinguish an unused candidate
            // from the actual displaced inode, even after a crash inside exchange.
            let slot = format!("{operation}-{}", files::digest(path.as_bytes()));
            let retained = self
                .root
                .join(".repeaty/retained")
                .join(format!("{slot}.md"));
            let candidate = self.root.join(".repeaty/staging").join(&slot);
            let disk = self.read_working(&path)?.map(|data| files::digest(&data));
            let retained_hash = if retained.exists() {
                Some(files::digest(&files::read_stable(&retained)?))
            } else {
                None
            };
            let candidate_hash = if candidate.exists() {
                Some(files::digest(&files::read_stable(&candidate)?))
            } else {
                None
            };
            let status = if retained_hash.is_some() {
                if disk == hash && retained_hash == expected {
                    "done"
                } else {
                    "conflict"
                }
            } else if candidate_hash.is_some() && candidate_hash != hash {
                atomic::publish_new(&candidate, &retained)?;
                if disk == hash && candidate_hash == expected {
                    "done"
                } else {
                    "conflict"
                }
            } else if disk == hash {
                // Publication completed before its SQL acknowledgement.
                if candidate.exists() {
                    atomic::publish_new(&candidate, &retained)?;
                }
                "done"
            } else if disk != expected {
                "conflict"
            } else {
                if let Some(hash) = &hash {
                    if !candidate.exists() {
                        let raw = files::read_stable(&self.object(hash)?)?;
                        if files::digest(&raw) != *hash {
                            return Err(fail("corrupt-content-object"));
                        }
                        files::write_new(&candidate, &raw)?;
                    }
                    if disk.is_some() {
                        atomic::replace_preserving(&target, &candidate, &retained)?;
                        if candidate.exists() {
                            atomic::publish_new(&candidate, &retained)?;
                        }
                    } else {
                        atomic::publish_new(&candidate, &target)?;
                    }
                } else if disk.is_some() {
                    atomic::publish_new(&target, &retained)?;
                }
                // A writer racing the last hash check is retained in full. Never
                // exchange back: another edit may already exist at the target.
                let displaced = if retained.exists() {
                    Some(files::digest(&files::read_stable(&retained)?))
                } else {
                    None
                };
                if displaced != expected {
                    "conflict"
                } else {
                    "done"
                }
            };
            files::sync_directory(target.parent().ok_or_else(Error::invalid)?)?;
            files::sync_directory(&self.root.join(".repeaty/staging"))?;
            files::sync_directory(&self.root.join(".repeaty/retained"))?;
            self.db.connection.execute(
                "UPDATE publications SET status=?1 WHERE operation=?2 AND path=?3",
                params![status, operation, path],
            )?;
        }
        Ok(())
    }
    pub fn attention(&self) -> Result<Value> {
        let mut stmt=self.db.connection.prepare("SELECT path,status FROM publications WHERE status IN ('pending','conflict') ORDER BY rowid DESC LIMIT 100")?;
        Ok(Value::Array(
            stmt.query_map([], |r| {
                Ok(json!({"path":r.get::<_,String>(0)?,"status":r.get::<_,String>(1)?}))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?,
        ))
    }
    pub fn read(&mut self, request: Value) -> Result<Value> {
        match request["type"].as_str().unwrap_or("") {
            "attachment-inventory" => {
                crate::attachments::inventory(&self.db.connection, &self.anchor)
            }
            "load" => self.db.load_summary(),
            "documents" => self.documents(
                request
                    .get("ids")
                    .and_then(Value::as_array)
                    .map(|ids| {
                        ids.iter()
                            .filter_map(Value::as_str)
                            .map(str::to_owned)
                            .collect::<Vec<_>>()
                    })
                    .as_deref(),
            ),
            "retired-documents" => {
                let ids = request["ids"]
                    .as_array()
                    .ok_or_else(Error::invalid)?
                    .iter()
                    .map(|id| id.as_str().map(str::to_owned).ok_or_else(Error::invalid))
                    .collect::<Result<Vec<_>>>()?;
                if ids.len() > 100000 {
                    return Err(Error::invalid());
                }
                self.document_rows(Some(&ids), true)
            }
            "scan" => self.scan(),
            "observe" => self.observe(&request),
            "inspect-assets" => self.inspect_assets(&request),
            "retired-list" => retirement::listing(
                &self.db.connection,
                request["query"].as_str().ok_or_else(Error::invalid)?,
                request["offset"].as_i64().ok_or_else(Error::invalid)?,
            ),
            "retired-note" => {
                let mut value = retirement::note(
                    &self.db.connection,
                    request["id"].as_str().ok_or_else(Error::invalid)?,
                )?;
                if let Some(doc) = value["document"].as_object_mut() {
                    let hash = doc["hash"].as_str().ok_or_else(Error::invalid)?;
                    let bytes = files::read_stable(&self.object(hash)?)?;
                    if files::digest(&bytes) != hash {
                        return Err(fail("corrupt-content-object"));
                    }
                    doc.insert(
                        "raw".into(),
                        Value::String(String::from_utf8(bytes).map_err(|_| Error::invalid())?),
                    );
                }
                Ok(value)
            }
            "retired-attempt" => retirement::attempt(
                &self.db.connection,
                request["id"].as_str().ok_or_else(Error::invalid)?,
                request["revision"].as_i64().ok_or_else(Error::invalid)?,
            ),
            "settings" => {
                let mut stmt = self
                    .db
                    .connection
                    .prepare("SELECT id,data FROM values_store WHERE namespace='settings'")?;
                let mut values = serde_json::Map::new();
                for row in
                    stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
                {
                    let (key, raw) = row?;
                    values.insert(key, serde_json::from_str(&raw)?);
                }
                Ok(Value::Object(values))
            }
            "check-media" => {
                let table = match request["kind"].as_str() {
                    Some("note") => "notes",
                    Some("source") => "sources",
                    _ => return Err(Error::invalid()),
                };
                let raw: Option<String> = self
                    .db
                    .connection
                    .query_row(
                        &format!("SELECT data FROM {table} WHERE id=?1"),
                        [request["id"].as_str().ok_or_else(Error::invalid)?],
                        |row| row.get(0),
                    )
                    .optional()?;
                let mut changed = Vec::new();
                let mut total = 0;
                if let Some(raw) = raw {
                    let value: Value = serde_json::from_str(&raw)?;
                    let mut seen = std::collections::HashSet::new();
                    for reference in value["inlineMedia"].as_array().into_iter().flatten() {
                        let path = reference["path"].as_str().ok_or_else(Error::invalid)?;
                        if !seen.insert(path.to_owned()) {
                            continue;
                        }
                        let hash = match working_media::read(&self.anchor, path) {
                            Ok(Some(bytes)) => {
                                total += bytes.len();
                                if total > 50 * 1024 * 1024 {
                                    return Err(Error("workspace-limit"));
                                }
                                Some(files::digest(&bytes))
                            }
                            _ => None,
                        };
                        if hash.as_deref() != reference["hash"].as_str() {
                            changed.push(path.to_owned());
                        }
                    }
                }
                Ok(json!({"changed":changed}))
            }
            "asset-files" => {
                use base64::Engine;
                let paths = request["paths"].as_array().ok_or_else(Error::invalid)?;
                if paths.len() > 64 {
                    return Err(Error::invalid());
                }
                let mut result = Vec::new();
                let mut total = 0;
                for path in paths {
                    let path = path.as_str().ok_or_else(Error::invalid)?;
                    let mime = working_media::mime(path)?;
                    let bytes =
                        working_media::read(&self.anchor, path)?.ok_or_else(Error::missing)?;
                    total += bytes.len();
                    if bytes.is_empty() || total > 50 * 1024 * 1024 {
                        return Err(Error("workspace-limit"));
                    }
                    result.push(json!({"path":path,"type":mime,"hash":files::digest(&bytes),"body":base64::engine::general_purpose::STANDARD.encode(bytes)}));
                }
                Ok(json!(result))
            }
            "asset-paths" => {
                let ids = request["ids"].as_array().ok_or_else(Error::invalid)?;
                if ids.len() > 20000 || ids.iter().any(|id| !id.is_string()) {
                    return Err(Error::invalid());
                }
                let mut stmt = self.db.connection.prepare(
                    "SELECT id,path FROM assets WHERE id IN (SELECT value FROM json_each(?1))",
                )?;
                let mut values = serde_json::Map::new();
                for row in stmt.query_map([serde_json::to_string(ids)?], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                })? {
                    let (id, path) = row?;
                    values.insert(id, Value::String(format!("assets/{path}")));
                }
                Ok(Value::Object(values))
            }
            "attempts" => self
                .db
                .read_attempts(serde_json::from_value(request["input"].clone())?),
            "media" => {
                match self
                    .db
                    .media(request["id"].as_str().ok_or_else(Error::invalid)?)
                {
                    Ok((mime, bytes)) => {
                        use base64::Engine;
                        Ok(
                            json!({"type":mime,"body":base64::engine::general_purpose::STANDARD.encode(bytes)}),
                        )
                    }
                    Err(error) if error.0 == "not-found" => Ok(Value::Null),
                    Err(error) => Err(error),
                }
            }
            "backups" => self.db.backups(),
            "backup" => self
                .db
                .backup(request["id"].as_str().ok_or_else(Error::invalid)?),
            "source-draft" => {
                let id = request["sourceId"].as_str().ok_or_else(Error::invalid)?;
                let raw: Option<String> = self
                    .db
                    .connection
                    .query_row("SELECT data FROM source_drafts WHERE id=?1", [id], |r| {
                        r.get(0)
                    })
                    .optional()?;
                Ok(raw
                    .map(|value| serde_json::from_str(&value))
                    .transpose()?
                    .unwrap_or(Value::Null))
            }
            "drafts" => {
                let mut stmt = self.db.connection.prepare(
                    "SELECT data FROM card_drafts ORDER BY json_extract(data,'$.position'),id",
                )?;
                let raw = stmt
                    .query_map([], |r| r.get::<_, String>(0))?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                Ok(Value::Array(
                    raw.iter()
                        .map(|raw| serde_json::from_str(raw))
                        .collect::<std::result::Result<_, _>>()?,
                ))
            }
            "value" => {
                let raw: Option<String> = self
                    .db
                    .connection
                    .query_row(
                        "SELECT data FROM values_store WHERE namespace=?1 AND id=?2",
                        params![
                            request["namespace"].as_str().ok_or_else(Error::invalid)?,
                            request["id"].as_str().ok_or_else(Error::invalid)?
                        ],
                        |r| r.get(0),
                    )
                    .optional()?;
                Ok(raw
                    .map(|s| serde_json::from_str(&s))
                    .transpose()?
                    .unwrap_or(Value::Null))
            }
            _ => Err(Error::invalid()),
        }
    }
    pub fn write(&mut self, request: Value) -> Result<Value> {
        match request["type"].as_str().unwrap_or("") {
            "attachment-mutate" => {
                let mut input = request.clone();
                input
                    .as_object_mut()
                    .ok_or_else(Error::invalid)?
                    .remove("type");
                crate::attachments::mutate(
                    &mut self.db.connection,
                    &self.anchor,
                    serde_json::from_value(input)?,
                )
            }
            "commit" => self.save(serde_json::from_value(request["input"].clone())?),
            "media" => {
                use base64::Engine;
                let encoded = request["body"].as_str().ok_or_else(Error::invalid)?;
                if encoded.len() > 15 * 1024 * 1024 {
                    return Err(Error::invalid());
                }
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(encoded)
                    .map_err(|_| Error::invalid())?;
                self.db.put_media(
                    request["id"].as_str().ok_or_else(Error::invalid)?,
                    request["mime"].as_str().ok_or_else(Error::invalid)?,
                    &bytes,
                )?;
                if !request["mime"].as_str().unwrap_or("").starts_with("text/") {
                    let path: String = self.db.connection.query_row(
                        "SELECT path FROM assets WHERE id=?1",
                        [request["id"].as_str().unwrap_or("")],
                        |row| row.get(0),
                    )?;
                    let path = format!("assets/{path}");
                    if let Some(existing) = working_media::read(&self.anchor, &path)? {
                        if existing != bytes {
                            return Err(Error("working-file-changed"));
                        }
                    } else {
                        let mut options = cap_std::fs::OpenOptions::new();
                        options.write(true).create_new(true);
                        let mut file = self.anchor.open_with(&path, &options)?;
                        use std::io::Write;
                        file.write_all(&bytes)?;
                        file.sync_all()?;
                    }
                }
                Ok(Value::Null)
            }
            "backup" => {
                self.db
                    .backup_now(request["force"].as_bool().unwrap_or(false))?;
                Ok(Value::Null)
            }
            "source-draft" => {
                let draft = &request["draft"];
                let source_id = draft["sourceId"].as_str().ok_or_else(Error::invalid)?;
                let id = draft["id"].as_str().ok_or_else(Error::invalid)?;
                let media_id = draft["mediaId"].as_str().ok_or_else(Error::invalid)?;
                if source_id.len() > 100
                    || source_id.is_empty()
                    || Uuid::parse_str(id).is_err()
                    || media_id.is_empty()
                    || media_id.len() > 100
                    || draft["scope"].as_str() != Some(&format!("local:workspace:{}", self.id))
                    || draft["content"]
                        .as_str()
                        .is_none_or(|v| v.encode_utf16().count() > 250_000)
                    || draft["properties"]
                        .as_str()
                        .is_none_or(|v| v.encode_utf16().count() > 65_536)
                    || draft["title"]
                        .as_str()
                        .is_none_or(|v| v.encode_utf16().count() > 160)
                    || draft["url"]
                        .as_str()
                        .is_none_or(|v| v.encode_utf16().count() > 2048)
                    || draft["updatedAt"]
                        .as_str()
                        .is_none_or(|v| chrono::DateTime::parse_from_rfc3339(v).is_err())
                    || draft.to_string().len() > 2 * 1024 * 1024
                {
                    return Err(Error::invalid());
                }
                let tx = self.db.connection.transaction()?;
                let source: Option<String> = tx
                    .query_row("SELECT data FROM sources WHERE id=?1", [source_id], |r| {
                        r.get(0)
                    })
                    .optional()?;
                let source: Value = serde_json::from_str(&source.ok_or_else(Error::conflict)?)?;
                if source["mediaId"] != media_id
                    && !source["versions"].as_array().is_some_and(|versions| {
                        versions
                            .iter()
                            .any(|version| version["mediaId"] == media_id)
                    })
                {
                    return Err(Error::conflict());
                }
                tx.execute("INSERT INTO source_drafts VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data", params![source_id,draft.to_string()])?;
                let count: i64 =
                    tx.query_row("SELECT COUNT(*) FROM source_drafts", [], |r| r.get(0))?;
                if count > 50 {
                    return Err(fail("draft-limit"));
                }
                tx.pragma_update(None, "user_version", 13)?;
                tx.commit()?;
                Ok(Value::Null)
            }
            "source-draft-remove" => {
                self.db.connection.execute(
                    "DELETE FROM source_drafts WHERE id=?1 AND json_extract(data,'$.id')=?2",
                    params![
                        request["sourceId"].as_str().ok_or_else(Error::invalid)?,
                        request["id"].as_str().ok_or_else(Error::invalid)?
                    ],
                )?;
                Ok(Value::Null)
            }
            "draft-add" | "draft-update" => {
                let entries = request["entries"].as_array().ok_or_else(Error::invalid)?;
                let tx = self.db.connection.transaction()?;
                for entry in entries {
                    let id = entry["id"].as_str().ok_or_else(Error::invalid)?;
                    if Uuid::parse_str(id).is_err()
                        || entry["scope"].as_str() != Some(&format!("local:workspace:{}", self.id))
                        || entry.to_string().len() > 20 * 1024 * 1024
                    {
                        return Err(Error::invalid());
                    }
                    if request["type"] == "draft-add" {
                        tx.execute(
                            "INSERT OR IGNORE INTO card_drafts VALUES(?1,?2)",
                            params![id, entry.to_string()],
                        )?;
                    } else if tx.execute(
                        "UPDATE card_drafts SET data=?1 WHERE id=?2",
                        params![entry.to_string(), id],
                    )? != 1
                    {
                        return Err(Error::conflict());
                    }
                }
                let count: i64 =
                    tx.query_row("SELECT COUNT(*) FROM card_drafts", [], |r| r.get(0))?;
                if count > 50 {
                    return Err(fail("draft-limit"));
                }
                tx.commit()?;
                Ok(Value::Null)
            }
            "draft-remove" => {
                self.db.connection.execute(
                    "DELETE FROM card_drafts WHERE id=?1",
                    [request["id"].as_str().ok_or_else(Error::invalid)?],
                )?;
                Ok(Value::Null)
            }
            "value" => {
                let ns = request["namespace"].as_str().ok_or_else(Error::invalid)?;
                let id = request["id"].as_str().ok_or_else(Error::invalid)?;
                let plugin_namespace = ns.strip_prefix("plugin:").is_some_and(|id| {
                    !id.is_empty()
                        && id.len() <= 64
                        && id.as_bytes()[0].is_ascii_lowercase()
                        && id
                            .bytes()
                            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
                });
                if !(["leetcode", "settings"].contains(&ns) || plugin_namespace)
                    || id.len() > 512
                    || request["value"].to_string().len() > 2 * 1024 * 1024
                {
                    return Err(Error::invalid());
                }
                if request["value"].is_null() {
                    self.db.connection.execute(
                        "DELETE FROM values_store WHERE namespace=?1 AND id=?2",
                        params![ns, id],
                    )?;
                } else {
                    self.db.connection.execute("INSERT INTO values_store VALUES(?1,?2,?3) ON CONFLICT(namespace,id) DO UPDATE SET data=excluded.data",params![ns,id,request["value"].to_string()])?;
                }
                Ok(Value::Null)
            }
            _ => Err(Error::invalid()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn plugin_values_are_namespaced_and_survive_reopen_without_changing_legacy_values() {
        let root = tempfile::tempdir().unwrap();
        let mut library = Library::create(root.path()).unwrap();
        for ns in [
            "leetcode",
            "settings",
            "plugin:sample-plugin",
            "plugin:other",
        ] {
            library
                .write(json!({"type":"value","namespace":ns,"id":"draft","value":{"owner":ns}}))
                .unwrap();
        }
        for ns in [
            "plugin:",
            "plugin:../escape",
            "plugin:Upper",
            "plugin:1bad",
            "foreign",
        ] {
            assert!(
                library
                    .write(json!({"type":"value","namespace":ns,"id":"draft","value":1}))
                    .is_err()
            );
        }
        drop(library);
        let mut library = Library::open(root.path()).unwrap();
        for ns in [
            "leetcode",
            "settings",
            "plugin:sample-plugin",
            "plugin:other",
        ] {
            assert_eq!(
                library
                    .read(json!({"type":"value","namespace":ns,"id":"draft"}))
                    .unwrap(),
                json!({"owner":ns})
            );
        }
        library.write(json!({"type":"value","namespace":"plugin:sample-plugin","id":"draft","value":null})).unwrap();
        assert_eq!(
            library
                .read(json!({"type":"value","namespace":"plugin:other","id":"draft"}))
                .unwrap(),
            json!({"owner":"plugin:other"})
        );
    }
    fn fixture(
        old: &str,
        next: Option<&str>,
    ) -> (tempfile::TempDir, Library, PathBuf, PathBuf, PathBuf) {
        let root = tempfile::tempdir().unwrap();
        let library = Library::create(root.path()).unwrap();
        let path = "notes/test.md";
        let target = root.path().join(path);
        files::write_new(&target, old.as_bytes()).unwrap();
        let operation = Uuid::new_v4().to_string();
        let hash = next.map(|raw| library.store_object(raw).unwrap());
        library
            .db
            .connection
            .execute(
                "INSERT INTO publications(operation,path,hash,expected) VALUES(?1,?2,?3,?4)",
                params![operation, path, hash, files::digest(old.as_bytes())],
            )
            .unwrap();
        let slot = format!("{operation}-{}", files::digest(path.as_bytes()));
        let candidate = root.path().join(".repeaty/staging").join(&slot);
        let retained = root
            .path()
            .join(".repeaty/retained")
            .join(format!("{slot}.md"));
        (root, library, target, candidate, retained)
    }
    #[test]
    fn restart_after_exchange_retains_the_displaced_inode() {
        let (root, library, target, candidate, retained) =
            fixture("editor original", Some("accepted next"));
        files::write_new(&candidate, b"accepted next").unwrap();
        atomic::replace_preserving(&target, &candidate, &retained).unwrap();
        drop(library);
        let mut reopened = Library::open(root.path()).unwrap();
        reopened.recover().unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"accepted next");
        assert_eq!(fs::read(&retained).unwrap(), b"editor original");
        assert_eq!(reopened.attention().unwrap(), json!([]));
    }
    #[test]
    fn recovery_does_not_replace_a_later_external_edit() {
        let (root, library, target, candidate, retained) = fixture("original", Some("accepted"));
        files::write_new(&candidate, b"accepted").unwrap();
        atomic::replace_preserving(&target, &candidate, &retained).unwrap();
        fs::write(&target, b"edited after publication").unwrap();
        drop(library);
        let reopened = Library::open(root.path()).unwrap();
        assert_eq!(fs::read(target).unwrap(), b"edited after publication");
        assert_eq!(fs::read(retained).unwrap(), b"original");
        assert_eq!(reopened.attention().unwrap()[0]["status"], "conflict");
    }
    #[test]
    fn interrupted_candidate_and_deletion_resume_once() {
        let (root, library, target, candidate, retained) = fixture("original", Some("next"));
        files::write_new(&candidate, b"next").unwrap();
        drop(library);
        let mut reopened = Library::open(root.path()).unwrap();
        reopened.recover().unwrap();
        assert_eq!(fs::read(target).unwrap(), b"next");
        assert_eq!(fs::read(retained).unwrap(), b"original");
        let (root, library, target, _, retained) = fixture("delete original", None);
        atomic::publish_new(&target, &retained).unwrap();
        drop(library);
        let reopened = Library::open(root.path()).unwrap();
        assert!(!target.exists());
        assert_eq!(fs::read(retained).unwrap(), b"delete original");
        assert_eq!(reopened.attention().unwrap(), json!([]));
    }
    #[test]
    fn guard_rejects_replaced_managed_members() {
        for name in ["workspace.json", ".repeaty/state.sqlite3", "assets"] {
            let root = tempfile::tempdir().unwrap();
            let library = Library::create(root.path()).unwrap();
            let member = root.path().join(name);
            let moved = fs::rename(&member, root.path().join("old"));
            if cfg!(windows)
                && name == ".repeaty/state.sqlite3"
                && moved.as_ref().is_err_and(|error| {
                    error.kind() == io::ErrorKind::PermissionDenied
                        || matches!(error.raw_os_error(), Some(32 | 33))
                })
            {
                // Open SQLite files can also report ERROR_SHARING_VIOLATION (32)
                // or ERROR_LOCK_VIOLATION (33), classified as Uncategorized by Rust.
                library.guard(&library.token).unwrap();
                continue;
            }
            moved.unwrap();
            if name == "assets" {
                fs::create_dir(&member).unwrap();
            } else {
                fs::write(&member, b"replacement").unwrap();
            }
            assert_eq!(
                library.guard(&library.token).unwrap_err().0,
                "workspace-identity-changed"
            );
        }
    }
}
