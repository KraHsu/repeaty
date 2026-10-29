//! Explicit attachment maintenance. Ordinary commits never run this full scan.
//! Trash is a transactional tombstone: immutable shared bytes stay in place until
//! an explicit purge, so a crash cannot strand another id sharing the same object.
use crate::{
    error::{Error, Result},
    files,
    records::MAX_MEDIA,
};
use cap_std::fs::{Dir, OpenOptions};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    io,
    path::Path,
};

const MAX_FILES: usize = 50_000;
const MAX_SCAN: u64 = 512 * 1024 * 1024;

pub fn schema(db: &Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS attachment_trash(id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,trashed_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS attachment_purge(path TEXT PRIMARY KEY,hash TEXT NOT NULL,ids TEXT NOT NULL);")?;
    Ok(())
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Mutation {
    pub expected_revision: i64,
    pub inventory_token: String,
    pub action: Action,
    pub ids: Vec<String>,
}
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Trash,
    Restore,
    Purge,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    id: String,
    name: String,
    path: String,
    mime: String,
    size: u64,
    hash: String,
    state: String,
    source: String,
    refs: BTreeMap<String, u64>,
    trashed_at: Option<String>,
    available: bool,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Inventory {
    revision: i64,
    inventory_token: String,
    entries: Vec<Entry>,
    totals: Value,
    plugin_protection: bool,
}
#[derive(Clone)]
struct DiskFile {
    path: String,
    hash: String,
    size: u64,
    text: Option<String>,
}

fn open_dir(parent: &Dir, name: &str) -> Result<Dir> {
    let handle = parent.try_clone()?.into_std_file();
    cap_primitives::fs::open_dir_nofollow(&handle, Path::new(name))
        .map(Dir::from_std_file)
        .map_err(|_| Error("unsafe-file"))
}
fn read(dir: &Dir, path: &str) -> Result<Vec<u8>> {
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
    files::read_stable_file(dir.open_with(path, &options)?.into_std(), MAX_MEDIA as u64)
        .map_err(|_| Error("unsafe-file"))
}
fn walk(
    dir: &Dir,
    prefix: &str,
    result: &mut Vec<DiskFile>,
    bytes: &mut u64,
    text: bool,
) -> Result<()> {
    for item in dir.entries()? {
        let item = item?;
        let name = item
            .file_name()
            .into_string()
            .map_err(|_| Error("unsafe-file"))?;
        let path = format!("{prefix}/{name}");
        let kind = item.file_type()?;
        if kind.is_symlink() {
            return Err(Error("unsafe-file"));
        }
        if kind.is_dir() {
            if path.len() > 1024 {
                return Err(Error("workspace-limit"));
            }
            walk(&open_dir(dir, &name)?, &path, result, bytes, text)?;
        } else if kind.is_file() {
            if result.len() >= MAX_FILES {
                return Err(Error("workspace-limit"));
            }
            let content = read(dir, &name)?;
            *bytes += content.len() as u64;
            if *bytes > MAX_SCAN {
                return Err(Error("workspace-limit"));
            }
            result.push(DiskFile {
                path,
                hash: files::digest(&content),
                size: content.len() as u64,
                text: if text {
                    String::from_utf8(content).ok()
                } else {
                    None
                },
            });
        } else {
            return Err(Error("unsafe-file"));
        }
    }
    Ok(())
}
fn scan(root: &Dir, path: &str, text: bool, bytes: &mut u64) -> Result<Vec<DiskFile>> {
    let mut dir = root.try_clone()?;
    for name in path.split('/') {
        match dir.symlink_metadata(name) {
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(e.into()),
            Ok(_) => dir = open_dir(&dir, name)?,
        }
    }
    let mut files = Vec::new();
    walk(&dir, path, &mut files, bytes, text)?;
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

fn table_exists(db: &Connection, name: &str) -> Result<bool> {
    Ok(db.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
        [name],
        |r| r.get(0),
    )?)
}
fn strings(value: &Value, set: &mut BTreeSet<String>) {
    match value {
        Value::String(s) => {
            set.insert(s.clone());
            for token in s.split(|c: char| !c.is_alphanumeric() && !"-_./%".contains(c)) {
                if !token.is_empty() {
                    set.insert(token.trim_start_matches("../").to_owned());
                }
            }
            // Settings often store a JSON document inside a JSON string.
            if (s.starts_with('{') || s.starts_with('['))
                && let Ok(nested) = serde_json::from_str::<Value>(s)
            {
                strings(&nested, set);
            }
        }
        Value::Array(items) => {
            for v in items {
                strings(v, set);
            }
        }
        Value::Object(items) => {
            for (k, v) in items {
                set.insert(k.clone());
                strings(v, set);
            }
        }
        _ => {}
    }
}
fn media_names(value: &Value, names: &mut BTreeMap<String, String>) {
    if let (Some(id), Some(name), Some(mime)) = (
        value["id"].as_str(),
        value["name"].as_str(),
        value["type"].as_str(),
    ) && mime.contains('/')
    {
        names.entry(id.into()).or_insert_with(|| name.into());
    }
    match value {
        Value::Array(items) => {
            for item in items {
                media_names(item, names);
            }
        }
        Value::Object(items) => {
            for item in items.values() {
                media_names(item, names);
            }
        }
        _ => {}
    }
}
fn collect_refs(
    db: &Connection,
    names: &mut BTreeMap<String, String>,
) -> Result<BTreeMap<String, Vec<BTreeSet<String>>>> {
    let mut result: BTreeMap<String, Vec<BTreeSet<String>>> = BTreeMap::new();
    for (category, table) in [
        ("active", "notes"),
        ("active", "sources"),
        ("active", "media"),
        ("history", "history"),
        ("retired", "retired_notes"),
        ("retired", "retired_records"),
        ("retired", "retired_media"),
        ("drafts", "card_drafts"),
        ("drafts", "source_drafts"),
        ("undo", "operation_history"),
        ("plugins", "values_store"),
    ] {
        if !table_exists(db, table)? {
            continue;
        }
        let mut stmt = db.prepare(&format!("SELECT data FROM {table} WHERE data IS NOT NULL"))?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        for row in rows {
            let mut refs = BTreeSet::new();
            let value: Value = serde_json::from_str(&row?)?;
            strings(&value, &mut refs);
            media_names(&value, names);
            result.entry(category.into()).or_default().push(refs);
        }
    }
    Ok(result)
}
fn opaque_plugin_values(db: &Connection) -> Result<bool> {
    if !table_exists(db, "values_store")? {
        return Ok(false);
    }
    let mut values = db.prepare("SELECT data FROM values_store WHERE namespace LIKE 'plugin:%'")?;
    for row in values.query_map([], |r| r.get::<_, String>(0))? {
        let value: Value = serde_json::from_str(&row?)?;
        if let Value::String(text) = value
            && serde_json::from_str::<Value>(&text).is_err()
        {
            return Ok(true);
        }
    }
    Ok(false)
}
fn snapshot(db: &Connection, root: &Dir) -> Result<Inventory> {
    let revision: i64 = db.query_row("SELECT revision FROM workspace WHERE id=1", [], |r| {
        r.get(0)
    })?;
    let mut names = BTreeMap::new();
    let mut refs = collect_refs(db, &mut names)?;
    let mut bytes = 0;
    let objects = scan(root, ".repeaty/media", false, &mut bytes)?;
    let working = scan(root, "assets", false, &mut bytes)?;
    let mut fingerprint = Vec::new();
    let mut plugin_protection = opaque_plugin_values(db)?;
    for location in ["notes", "sources", ".repeaty/plugin-data"] {
        for file in scan(root, location, true, &mut bytes)? {
            let mut found = BTreeSet::new();
            if let Some(text) = &file.text {
                strings(&Value::String(text.clone()), &mut found);
            }
            if location == ".repeaty/plugin-data"
                && file
                    .text
                    .as_ref()
                    .is_none_or(|s| serde_json::from_str::<Value>(s).is_err())
            {
                plugin_protection = true;
            }
            refs.entry(
                if location == ".repeaty/plugin-data" {
                    "plugins"
                } else {
                    "working"
                }
                .into(),
            )
            .or_default()
            .push(found);
            fingerprint.push((file.path.clone(), file.hash.clone()));
        }
    }
    // Arbitrary plugin files have no reference declaration. Keep every asset while
    // opaque private data exists rather than assuming its encoding is understood.
    let trash: BTreeMap<String, String> = {
        let mut stmt = db.prepare("SELECT id,trashed_at FROM attachment_trash ORDER BY id")?;
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<std::result::Result<_, _>>()?
    };
    let mut entries = Vec::new();
    let mut managed_paths = BTreeSet::new();
    let mut stmt = db.prepare("SELECT id,mime,path,size FROM assets ORDER BY id")?;
    let assets = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, i64>(3)? as u64,
        ))
    })?;
    for row in assets {
        let (id, mime, path, size) = row?;
        let hash = path.split('.').next().unwrap_or("").to_owned();
        let object_path = format!(".repeaty/media/{path}");
        let working_path = format!("assets/{path}");
        managed_paths.insert(object_path.clone());
        let mut counts = BTreeMap::new();
        for (category, documents) in &refs {
            let count = documents
                .iter()
                .filter(|r| r.contains(&id) || r.contains(&working_path) || r.contains(&path))
                .count() as u64;
            if count > 0 {
                counts.insert(category.clone(), count);
            }
        }
        if plugin_protection {
            counts.insert("unknownPlugin".into(), 1);
        }
        let available = objects
            .iter()
            .any(|f| f.path == object_path && f.hash == hash && f.size == size);
        let state = if trash.contains_key(&id) {
            "trash"
        } else if counts.is_empty() {
            "unused"
        } else {
            "referenced"
        };
        entries.push(Entry {
            id: id.clone(),
            name: names.remove(&id).unwrap_or_else(|| path.clone()),
            path: object_path,
            mime,
            size,
            hash,
            state: state.into(),
            source: "managed".into(),
            refs: counts,
            trashed_at: trash.get(&id).cloned(),
            available,
        });
    }
    for file in working
        .iter()
        .chain(objects.iter().filter(|f| !managed_paths.contains(&f.path)))
    {
        let managed_copy = working.iter().any(|f| f.path == file.path)
            && entries.iter().any(|e| {
                e.path.replacen(".repeaty/media/", "assets/", 1) == file.path && e.hash == file.hash
            });
        if managed_copy {
            continue;
        }
        entries.push(Entry {
            id: format!("external:{}", file.path),
            name: file.path.rsplit('/').next().unwrap_or("").into(),
            path: file.path.clone(),
            mime: "application/octet-stream".into(),
            size: file.size,
            hash: file.hash.clone(),
            state: "external".into(),
            source: "external".into(),
            refs: BTreeMap::new(),
            trashed_at: None,
            available: true,
        });
    }
    let mut unique = BTreeMap::new();
    let mut physical = 0;
    for file in objects.iter().chain(&working) {
        physical += file.size;
        unique.insert(file.hash.clone(), file.size);
        fingerprint.push((file.path.clone(), file.hash.clone()));
    }
    let unique_bytes: u64 = unique.values().sum();
    let totals = json!({"physicalBytes":physical,"uniqueBytes":unique_bytes,"duplicateBytes":physical-unique_bytes,
        "objects":objects.len(),"workingFiles":working.len(),"unused":entries.iter().filter(|e| e.state=="unused" && e.available).count(),
        "trash":trash.len(),"external":entries.iter().filter(|e| e.state=="external").count()});
    let inventory_token = files::digest(&serde_json::to_vec(&(
        revision,
        &entries,
        &fingerprint,
        plugin_protection,
    ))?);
    Ok(Inventory {
        revision,
        inventory_token,
        entries,
        totals,
        plugin_protection,
    })
}
pub fn inventory(db: &Connection, root: &Dir) -> Result<Value> {
    Ok(serde_json::to_value(snapshot(db, root)?)?)
}

/// Finish only previously authorized object deletions. A shared path or changed
/// file is retained. A failed unlink remains recorded and can be retried safely.
pub fn recover(db: &Connection, root: &Dir) -> Result<()> {
    let mut stmt = db.prepare("SELECT path,hash,ids FROM attachment_purge ORDER BY path")?;
    let pending = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    drop(stmt);
    if pending.is_empty() {
        return Ok(());
    }
    let mut references = collect_refs(db, &mut BTreeMap::new())?;
    let mut plugin_protection = opaque_plugin_values(db)?;
    let mut scanned_bytes = 0;
    for location in ["notes", "sources", ".repeaty/plugin-data"] {
        for file in scan(root, location, true, &mut scanned_bytes)? {
            let mut found = BTreeSet::new();
            if let Some(text) = &file.text {
                strings(&Value::String(text.clone()), &mut found);
            }
            if location == ".repeaty/plugin-data"
                && file
                    .text
                    .as_ref()
                    .is_none_or(|s| serde_json::from_str::<Value>(s).is_err())
            {
                plugin_protection = true;
            }
            references.entry("working".into()).or_default().push(found);
        }
    }
    for (path, hash, ids) in pending {
        if path.contains('/')
            || path.contains('\\')
            || path.split('.').next() != Some(&hash)
            || hash.len() != 64
            || !hash.bytes().all(|c| c.is_ascii_hexdigit())
        {
            return Err(Error::invalid());
        }
        let used: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM assets WHERE path=?1)",
            [&path],
            |r| r.get(0),
        )?;
        let removed_ids: Vec<String> = serde_json::from_str(&ids)?;
        let referenced = plugin_protection
            || references.values().flatten().any(|r| {
                r.contains(&format!("assets/{path}"))
                    || r.contains(&path)
                    || removed_ids.iter().any(|id| r.contains(id))
            });
        if !used && !referenced {
            for location in [".repeaty/media", "assets"] {
                let dir = if location == "assets" {
                    open_dir(root, "assets")?
                } else {
                    open_dir(&open_dir(root, ".repeaty")?, "media")?
                };
                match dir.symlink_metadata(&path) {
                    Err(e) if e.kind() == io::ErrorKind::NotFound => {}
                    Err(e) => return Err(e.into()),
                    Ok(_) => {
                        // Never remove a working copy edited outside Repeaty.
                        if files::digest(&read(&dir, &path)?) == hash {
                            dir.remove_file(&path)?;
                        }
                    }
                }
            }
        }
        db.execute("DELETE FROM attachment_purge WHERE path=?1", [path])?;
    }
    Ok(())
}
pub fn mutate(db: &mut Connection, root: &Dir, input: Mutation) -> Result<Value> {
    if input.ids.is_empty()
        || input.ids.len() > 500
        || input.ids.iter().collect::<BTreeSet<_>>().len() != input.ids.len()
    {
        return Err(Error::invalid());
    }
    let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let current = snapshot(&tx, root)?;
    if current.revision != input.expected_revision
        || current.inventory_token != input.inventory_token
    {
        return Err(Error::conflict());
    }
    for id in &input.ids {
        let entry = current
            .entries
            .iter()
            .find(|e| &e.id == id && e.source == "managed")
            .ok_or_else(Error::invalid)?;
        if !entry.available || (input.action != Action::Restore && !entry.refs.is_empty()) {
            return Err(Error::conflict());
        }
        if (input.action == Action::Trash && entry.state != "unused")
            || (input.action != Action::Trash && entry.state != "trash")
        {
            return Err(Error::conflict());
        }
    }
    for id in &input.ids {
        match input.action {
            Action::Trash => {
                tx.execute(
                    "INSERT INTO attachment_trash VALUES(?1,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                    [id],
                )?;
            }
            Action::Restore => {
                tx.execute("DELETE FROM attachment_trash WHERE id=?1", [id])?;
            }
            Action::Purge => {
                let path: String =
                    tx.query_row("SELECT path FROM assets WHERE id=?1", [id], |r| r.get(0))?;
                let hash = path.split('.').next().ok_or_else(Error::invalid)?;
                tx.execute("INSERT INTO attachment_purge VALUES(?1,?2,json_array(?3)) ON CONFLICT(path) DO UPDATE SET ids=json_insert(ids,'$[#]',?3)",params![path,hash,id])?;
                tx.execute("DELETE FROM attachment_trash WHERE id=?1", [id])?;
                tx.execute("DELETE FROM assets WHERE id=?1", [id])?;
            }
        }
    }
    // Older clients automatically garbage-collect assets without understanding
    // trash or durable undo protection. Gate them only after a successful write.
    let version: i64 = tx.pragma_query_value(None, "user_version", |r| r.get(0))?;
    tx.pragma_update(None, "user_version", version.max(12))?;
    tx.commit()?;
    recover(db, root)?;
    inventory(db, root)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    struct Fixture {
        _temp: tempfile::TempDir,
        root: Dir,
        db: Connection,
    }
    impl Fixture {
        fn new() -> Self {
            let temp = tempfile::tempdir().unwrap();
            for path in [
                ".repeaty/media",
                ".repeaty/plugin-data",
                "assets",
                "notes",
                "sources",
            ] {
                fs::create_dir_all(temp.path().join(path)).unwrap();
            }
            let root = Dir::open_ambient_dir(temp.path(), cap_std::ambient_authority()).unwrap();
            let db = Connection::open_in_memory().unwrap();
            db.execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE workspace(id INTEGER PRIMARY KEY,revision INTEGER); INSERT INTO workspace VALUES(1,7); CREATE TABLE assets(id TEXT PRIMARY KEY,mime TEXT,path TEXT,size INTEGER,created INTEGER); CREATE TABLE values_store(namespace TEXT,id TEXT,data TEXT);").unwrap();
            for table in [
                "notes",
                "sources",
                "media",
                "history",
                "retired_notes",
                "retired_records",
                "retired_media",
                "card_drafts",
                "operation_history",
            ] {
                db.execute_batch(&format!("CREATE TABLE {table}(data TEXT)"))
                    .unwrap();
            }
            schema(&db).unwrap();
            Self {
                _temp: temp,
                root,
                db,
            }
        }
        fn asset(&self, id: &str, bytes: &[u8]) -> String {
            let path = format!("{}.png", files::digest(bytes));
            self.root
                .write(format!(".repeaty/media/{path}"), bytes)
                .unwrap();
            self.db
                .execute(
                    "INSERT INTO assets VALUES(?1,'image/png',?2,?3,0)",
                    params![id, path, bytes.len() as i64],
                )
                .unwrap();
            path
        }
        fn perform(&mut self, action: Action, ids: &[&str]) -> Result<Value> {
            let view = snapshot(&self.db, &self.root)?;
            mutate(
                &mut self.db,
                &self.root,
                Mutation {
                    expected_revision: view.revision,
                    inventory_token: view.inventory_token,
                    action,
                    ids: ids.iter().map(|s| s.to_string()).collect(),
                },
            )
        }
    }
    #[test]
    fn protects_current_versions_history_retired_drafts_undo_plugins_and_working_documents() {
        let mut f = Fixture::new();
        for (table, id, data) in [
            ("notes", "active", json!({"frontMedia":["active"]})),
            (
                "sources",
                "version",
                json!({"versions":[{"document":{"originalMediaId":"version"}}]}),
            ),
            ("history", "historic", json!({"frontMedia":["historic"]})),
            ("retired_media", "retired", json!({"id":"retired"})),
            (
                "card_drafts",
                "draft",
                json!({"uploads":[{"meta":{"id":"draft"}}]}),
            ),
            ("operation_history", "undo", json!({"mediaIds":["undo"]})),
        ] {
            f.asset(id, id.as_bytes());
            f.db.execute(
                &format!("INSERT INTO {table} VALUES(?1)"),
                [data.to_string()],
            )
            .unwrap();
        }
        let working = f.asset("working", b"working");
        f.root
            .write(
                "notes/external.md",
                format!("![image](../assets/{working})"),
            )
            .unwrap();
        f.asset("plugin", b"plugin");
        f.db.execute(
            "INSERT INTO values_store VALUES('plugin:demo','state',?1)",
            [json!({"image":"plugin"}).to_string()],
        )
        .unwrap();
        for id in [
            "active", "version", "historic", "retired", "draft", "undo", "plugin", "working",
        ] {
            assert_eq!(
                f.perform(Action::Trash, &[id]).unwrap_err().0,
                "revision-conflict"
            );
        }
        f.asset("unused", b"unused");
        assert!(f.perform(Action::Trash, &["unused"]).is_ok());
    }
    #[test]
    fn shares_physical_objects_and_roundtrips_trash_without_changing_revision_or_identity() {
        let mut f = Fixture::new();
        let path = f.asset("first", b"shared");
        f.asset("second", b"shared");
        f.root.write(format!("assets/{path}"), b"shared").unwrap();
        let view = inventory(&f.db, &f.root).unwrap();
        assert_eq!(view["totals"]["physicalBytes"], 12);
        assert_eq!(view["totals"]["uniqueBytes"], 6);
        assert_eq!(view["totals"]["duplicateBytes"], 6);
        f.perform(Action::Trash, &["first", "second"]).unwrap();
        f.perform(Action::Restore, &["first"]).unwrap();
        assert_eq!(snapshot(&f.db, &f.root).unwrap().revision, 7);
        assert_eq!(
            f.db.query_row("SELECT path FROM assets WHERE id='first'", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            path
        );
        f.perform(Action::Trash, &["first"]).unwrap();
        f.perform(Action::Purge, &["first"]).unwrap();
        assert!(f.root.exists(format!(".repeaty/media/{path}")));
        f.perform(Action::Purge, &["second"]).unwrap();
        assert!(!f.root.exists(format!(".repeaty/media/{path}")));
        assert!(!f.root.exists(format!("assets/{path}")));
    }
    #[test]
    fn preview_detects_new_refs_and_external_writes_even_without_revision_change() {
        let mut f = Fixture::new();
        f.asset("unclaimed", b"original");
        let view = snapshot(&f.db, &f.root).unwrap();
        assert_eq!(
            f.db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
        f.db.execute(
            "INSERT INTO card_drafts VALUES(?1)",
            [json!({"mediaId":"unclaimed"}).to_string()],
        )
        .unwrap();
        let request = Mutation {
            expected_revision: 7,
            inventory_token: view.inventory_token,
            action: Action::Trash,
            ids: vec!["unclaimed".into()],
        };
        assert_eq!(
            mutate(&mut f.db, &f.root, request).unwrap_err().0,
            "revision-conflict"
        );
        assert_eq!(
            f.db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            f.db.query_row("SELECT count(*) FROM attachment_trash", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        f.db.execute("DELETE FROM card_drafts", []).unwrap();
        f.perform(Action::Trash, &["unclaimed"]).unwrap();
        assert_eq!(
            f.db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
                .unwrap(),
            12
        );
        f.db.execute(
            "INSERT INTO operation_history VALUES(?1)",
            [json!({"mediaIds":["unclaimed"]}).to_string()],
        )
        .unwrap();
        assert!(f.perform(Action::Purge, &["unclaimed"]).is_err());
        assert!(f.perform(Action::Restore, &["unclaimed"]).is_ok());
    }
    #[test]
    fn keeps_external_and_modified_working_files_and_unknown_plugin_data() {
        let mut f = Fixture::new();
        let path = f.asset("orphan", b"accepted");
        f.root
            .write(format!("assets/{path}"), b"external edit")
            .unwrap();
        f.root.write("assets/user.png", b"user original").unwrap();
        let view = inventory(&f.db, &f.root).unwrap();
        assert_eq!(view["totals"]["external"], 2);
        assert!(
            f.perform(Action::Trash, &["external:assets/user.png"])
                .is_err()
        );
        f.root
            .write(".repeaty/plugin-data/custom.dat", b"opaque encoded refs")
            .unwrap();
        assert!(snapshot(&f.db, &f.root).unwrap().plugin_protection);
        assert!(f.perform(Action::Trash, &["orphan"]).is_err());
        f.root
            .remove_file(".repeaty/plugin-data/custom.dat")
            .unwrap();
        f.perform(Action::Trash, &["orphan"]).unwrap();
        f.perform(Action::Purge, &["orphan"]).unwrap();
        assert_eq!(
            f.root.read(format!("assets/{path}")).unwrap(),
            b"external edit"
        );
        assert_eq!(f.root.read("assets/user.png").unwrap(), b"user original");
    }
    #[test]
    fn interrupted_purge_retries_only_unchanged_unshared_objects() {
        let f = Fixture::new();
        let path = f.asset("orphan", b"old");
        f.db.execute(
            "INSERT INTO attachment_purge VALUES(?1,?2,'[\"orphan\"]')",
            params![path, files::digest(b"old")],
        )
        .unwrap();
        f.db.execute("DELETE FROM assets WHERE id='orphan'", [])
            .unwrap();
        f.root.write(format!("assets/{path}"), b"edited").unwrap();
        recover(&f.db, &f.root).unwrap();
        recover(&f.db, &f.root).unwrap();
        assert!(!f.root.exists(format!(".repeaty/media/{path}")));
        assert_eq!(f.root.read(format!("assets/{path}")).unwrap(), b"edited");
    }
    #[cfg(unix)]
    #[test]
    fn rejects_linked_directories_and_files_instead_of_traversing_outside() {
        let f = Fixture::new();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), f._temp.path().join("assets/linked")).unwrap();
        assert_eq!(inventory(&f.db, &f.root).unwrap_err().0, "unsafe-file");
    }
}
