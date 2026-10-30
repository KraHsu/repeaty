use super::error::{Error, Result};
use crate::files;
use cap_std::fs::{Dir, OpenOptions};
use chrono::{SecondsFormat, Utc};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    path::Path,
    time::Duration,
};
use std::{io::Write, sync::Arc};

#[cfg(test)]
#[path = "records_snapshot_tests.rs"]
mod snapshot_tests;

pub const STORES: [&str; 11] = [
    "decks",
    "notes",
    "cards",
    "reviews",
    "media",
    "savedSearches",
    "practices",
    "attempts",
    "sources",
    "materialReceipts",
    "materialFolders",
];
pub const MAX_MEDIA: usize = 10 * 1024 * 1024;
pub const MAX_DOCUMENT: usize = 64 * 1024 * 1024;
pub fn media_limit(mime: &str) -> usize {
    if matches!(
        mime,
        "application/pdf" | "application/epub+zip" | "text/html" | "application/octet-stream"
    ) {
        MAX_DOCUMENT
    } else {
        MAX_MEDIA
    }
}

#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Commit {
    pub expected_revision: i64,
    pub patches: Vec<Patch>,
    pub reason: Option<String>,
    #[serde(default)]
    pub operation_history: Option<Value>,
    #[serde(default)]
    pub retired: Option<Vec<Value>>,
}
#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct Patch {
    pub store: String,
    pub id: String,
    pub position: Option<i64>,
    pub value: Option<Value>,
    #[serde(default, rename = "positionOnly")]
    pub position_only: bool,
}
#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(tag = "mode", rename_all = "camelCase", deny_unknown_fields)]
pub enum ReadAttempts {
    One { id: String, revision: i64 },
    Batch { offset: i64, revision: i64 },
}
pub struct Database {
    pub(crate) connection: Connection,
    assets: Arc<Dir>,
    validators: HashMap<String, jsonschema::Validator>,
}
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.encode_utf16().count() <= 150
}
fn revision(db: &Connection) -> Result<i64> {
    Ok(
        db.query_row("SELECT revision FROM workspace WHERE id=1", [], |row| {
            row.get(0)
        })?,
    )
}
fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

impl Database {
    pub fn open(path: &Path, assets: Arc<Dir>) -> Result<Self> {
        let mut connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        let version: u32 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version > 14 {
            return Err(Error::invalid());
        }
        let tx = connection.transaction()?;
        tx.execute_batch("CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL); INSERT OR IGNORE INTO workspace VALUES(1,0);
            CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, mime TEXT NOT NULL, path TEXT NOT NULL, size INTEGER NOT NULL, created INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS checkpoints (id TEXT PRIMARY KEY, revision INTEGER NOT NULL UNIQUE, created_at TEXT NOT NULL, reason TEXT NOT NULL, cards INTEGER NOT NULL, notes INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS history (revision INTEGER NOT NULL, store TEXT NOT NULL, id TEXT NOT NULL, position INTEGER, data TEXT, PRIMARY KEY(revision,store,id));
            CREATE INDEX IF NOT EXISTS history_store ON history(store,id);
            CREATE TABLE IF NOT EXISTS operation_history (id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL);")?;
        for store in STORES {
            let relation = match store {
                "notes" => {
                    ", deck_id TEXT GENERATED ALWAYS AS (json_extract(data,'$.deckId')) STORED REFERENCES decks(id) DEFERRABLE INITIALLY DEFERRED"
                }
                "cards" => {
                    ", note_id TEXT GENERATED ALWAYS AS (json_extract(data,'$.noteId')) STORED REFERENCES notes(id) DEFERRABLE INITIALLY DEFERRED"
                }
                "reviews" => {
                    ", card_id TEXT GENERATED ALWAYS AS (json_extract(data,'$.cardId')) STORED REFERENCES cards(id) DEFERRABLE INITIALLY DEFERRED"
                }
                "practices" => {
                    ", card_id TEXT GENERATED ALWAYS AS (json_extract(data,'$.cardId')) STORED REFERENCES cards(id) DEFERRABLE INITIALLY DEFERRED"
                }
                "attempts" => {
                    ", practice_id TEXT GENERATED ALWAYS AS (json_extract(data,'$.practiceId')) STORED REFERENCES practices(id) DEFERRABLE INITIALLY DEFERRED"
                }
                "sources" => {
                    ", media_id TEXT GENERATED ALWAYS AS (json_extract(data,'$.mediaId')) STORED REFERENCES media(id) DEFERRABLE INITIALLY DEFERRED"
                }
                "media" => ", FOREIGN KEY(id) REFERENCES assets(id) DEFERRABLE INITIALLY DEFERRED",
                _ => "",
            };
            tx.execute_batch(&format!("CREATE TABLE IF NOT EXISTS {store} (id TEXT PRIMARY KEY, position INTEGER NOT NULL CHECK(position>=0), data TEXT NOT NULL CHECK(json_valid(data)){relation}); CREATE INDEX IF NOT EXISTS {store}_position ON {store}(position);"))?;
        }
        tx.execute_batch(
            "CREATE TABLE IF NOT EXISTS source_drafts(id TEXT PRIMARY KEY,data TEXT NOT NULL);",
        )?;
        tx.execute_batch("CREATE INDEX IF NOT EXISTS notes_deck ON notes(deck_id); CREATE INDEX IF NOT EXISTS cards_note ON cards(note_id); CREATE INDEX IF NOT EXISTS reviews_card ON reviews(card_id); CREATE INDEX IF NOT EXISTS practices_card ON practices(card_id); CREATE INDEX IF NOT EXISTS attempts_practice ON attempts(practice_id);")?;
        tx.pragma_update(None, "user_version", version.max(10))?;
        tx.commit()?;
        let asset_reader = assets.clone();
        connection.create_scalar_function(
            "asset_bytes",
            1,
            rusqlite::functions::FunctionFlags::SQLITE_UTF8
                | rusqlite::functions::FunctionFlags::SQLITE_DIRECTONLY,
            move |ctx| {
                let path: String = ctx.get(0)?;
                read_asset(&asset_reader, &path)
                    .map_err(|error| rusqlite::Error::UserFunctionError(Box::new(error)))
            },
        )?;
        let schemas: HashMap<String, Value> =
            serde_json::from_str(include_str!("../schema/entities.json"))?;
        let validators = schemas
            .into_iter()
            .map(|(name, schema)| {
                Ok((
                    name,
                    jsonschema::validator_for(&schema).map_err(|_| Error::internal())?,
                ))
            })
            .collect::<Result<_>>()?;
        crate::attachments::schema(&connection)?;
        crate::retirement::history_schema(&connection)?;
        Ok(Self {
            connection,
            validators,
            assets,
        })
    }
    pub fn load(&mut self) -> Result<Value> {
        self.load_history(false)
    }
    pub fn load_summary(&mut self) -> Result<Value> {
        self.load_history(true)
    }
    fn load_history(&mut self, summary: bool) -> Result<Value> {
        let tx = self.connection.transaction()?;
        let current = revision(&tx)?;
        Self::checkpoint(&tx, "自动备份", false)?;
        let library = Self::library_history(&tx, summary)?;
        let history = tx
            .query_row("SELECT data FROM operation_history WHERE id=1", [], |r| {
                r.get::<_, String>(0)
            })
            .optional()?;
        let operation_history: Option<Value> =
            history.map(|raw| serde_json::from_str(&raw)).transpose()?;
        tx.commit()?;
        let mut snapshot = json!({"revision":current,"library":library});
        if let Some(history) = operation_history {
            snapshot["operationHistory"] = history;
        }
        Ok(snapshot)
    }
    fn library_history(db: &Connection, summary: bool) -> Result<Value> {
        let mut library = json!({"version":16});
        for store in STORES {
            let data = if store == "attempts" && summary {
                "json_remove(data,'$.code','$.result.detail')"
            } else {
                "data"
            };
            let mut stmt = db.prepare(&format!("SELECT {data} FROM {store} ORDER BY position"))?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            library[store] = Value::Array(
                rows.iter()
                    .map(|s| serde_json::from_str(s))
                    .collect::<std::result::Result<_, _>>()?,
            );
        }
        Ok(library)
    }
    pub fn read_attempts(&mut self, input: ReadAttempts) -> Result<Value> {
        let tx = self.connection.transaction()?;
        let current = revision(&tx)?;
        let mut values = Vec::new();
        match input {
            ReadAttempts::One { id, revision } => {
                if !valid_id(&id) || revision < 0 {
                    return Err(Error::invalid());
                }
                if current != revision {
                    return Err(Error::conflict());
                }
                let data: String = tx
                    .query_row("SELECT data FROM attempts WHERE id=?1", [&id], |row| {
                        row.get(0)
                    })
                    .optional()?
                    .ok_or_else(Error::missing)?;
                values.push(serde_json::from_str::<Value>(&data)?);
            }
            ReadAttempts::Batch { offset, revision } => {
                if !(0..=500_000).contains(&offset) || revision < 0 {
                    return Err(Error::invalid());
                }
                if current != revision {
                    return Err(Error::conflict());
                }
                let mut stmt = tx.prepare("SELECT position,data FROM attempts WHERE position>=?1 ORDER BY position LIMIT 128")?;
                let mut rows = stmt.query([offset])?;
                let mut bytes = 0;
                while let Some(row) = rows.next()? {
                    let position: i64 = row.get(0)?;
                    if position != offset + values.len() as i64 {
                        return Err(Error::invalid());
                    }
                    let data: String = row.get(1)?;
                    if !values.is_empty() && bytes + data.len() > 4 * 1024 * 1024 {
                        break;
                    }
                    bytes += data.len();
                    values.push(serde_json::from_str::<Value>(&data)?);
                }
            }
        }
        tx.commit()?;
        Ok(json!({"revision":current,"attempts":values}))
    }
    pub fn commit(&mut self, commit: Commit) -> Result<i64> {
        self.commit_with(commit, |_| Ok(()))
    }
    pub(crate) fn commit_with(
        &mut self,
        commit: Commit,
        finish: impl FnOnce(&Transaction<'_>) -> Result<()>,
    ) -> Result<i64> {
        self.commit_callbacks(commit, |_| Ok(()), finish)
    }
    pub(crate) fn commit_callbacks(
        &mut self,
        commit: Commit,
        begin: impl FnOnce(&Transaction<'_>) -> Result<()>,
        finish: impl FnOnce(&Transaction<'_>) -> Result<()>,
    ) -> Result<i64> {
        if commit.expected_revision < 0
            || commit.patches.len() > 1_000_000
            || commit.reason.as_ref().is_some_and(|s| s.len() > 160)
        {
            return Err(Error::invalid());
        }
        let mut seen = HashSet::new();
        for patch in &commit.patches {
            if !valid_id(&patch.id)
                || !STORES.contains(&patch.store.as_str())
                || !seen.insert((&patch.store, &patch.id))
            {
                return Err(Error::invalid());
            }
            if patch.position_only {
                if patch.value.is_some()
                    || patch
                        .position
                        .is_none_or(|position| !(0..=500000).contains(&position))
                {
                    return Err(Error::invalid());
                }
                continue;
            }
            if let Some(value) = &patch.value {
                if value["id"] != patch.id
                    || patch.position.is_none()
                    || patch.position.unwrap() > 500_000
                    || !self.validators[&patch.store].is_valid(value)
                {
                    return Err(Error::invalid());
                }
                if patch.store == "notes" {
                    crate::materials::plugin(&value["plugin"])?;
                    if value["type"] == "plugin" {
                        if !value["plugin"].is_object()
                            || value["plugin"]["data"].to_string().len() > 800_000
                        {
                            return Err(Error::invalid());
                        }
                    } else if !value["plugin"].is_null() {
                        return Err(Error::invalid());
                    }
                }
                if patch.store == "practices"
                    && value["question"]["plugin"]["data"].to_string().len() > 800_000
                {
                    return Err(Error::invalid());
                }
                if patch.store == "practices" {
                    crate::materials::plugin(&value["question"]["plugin"])?;
                }
                if patch.store == "attempts" {
                    let status = value["status"].as_str().unwrap_or("");
                    let numbered = value["submissionId"].is_string();
                    let evaluated = value["result"].is_object();
                    if ((status == "pending" || status == "completed") && !numbered)
                        || ((status == "completed") != evaluated)
                    {
                        return Err(Error::invalid());
                    }
                }
            } else if patch.position.is_some() {
                return Err(Error::invalid());
            }
        }
        let tx = self.connection.transaction()?;
        let current = revision(&tx)?;
        if current != commit.expected_revision {
            return Err(Error::conflict());
        }
        if current > 0 {
            Self::checkpoint(
                &tx,
                commit.reason.as_deref().unwrap_or("自动备份"),
                commit.reason.is_some(),
            )?;
        }
        let retain: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM checkpoints)", [], |row| {
            row.get(0)
        })?;
        // Remember what each patched row looked like before, so validation can skip records
        // whose content did not change (reading-position saves are the common case).
        let mut changed: Vec<(&Patch, Option<Value>)> = Vec::new();
        begin(&tx)?;
        for patch in &commit.patches {
            let store = &patch.store;
            if patch.position_only {
                if retain {
                    tx.execute(&format!("INSERT INTO history SELECT ?1,'{store}',id,position,data FROM {store} WHERE id=?2"),params![current+1,patch.id])?;
                }
                if tx.execute(
                    &format!("UPDATE {store} SET position=?1 WHERE id=?2"),
                    params![patch.position, patch.id],
                )? != 1
                {
                    return Err(Error::conflict());
                }
                changed.push((patch, None));
                continue;
            }
            let previous: Option<(i64, String)> = tx
                .query_row(
                    &format!("SELECT position,data FROM {store} WHERE id=?1"),
                    [&patch.id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;
            let previous_value = previous
                .as_ref()
                .map(|(_, data)| serde_json::from_str::<Value>(data))
                .transpose()?;
            if retain {
                tx.execute(
                    "INSERT INTO history VALUES(?1,?2,?3,?4,?5)",
                    params![
                        current + 1,
                        store,
                        patch.id,
                        previous.as_ref().map(|p| p.0),
                        previous.as_ref().map(|p| &p.1)
                    ],
                )?;
            }
            let touched = match (&patch.value, &previous_value) {
                (Some(value), Some(before)) => {
                    before != value || previous.as_ref().map(|p| p.0) != patch.position
                }
                _ => true,
            };
            if let Some(value) = &patch.value {
                tx.execute(&format!("INSERT INTO {store}(id,position,data) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET position=excluded.position,data=excluded.data"), params![patch.id, patch.position, value.to_string()])?;
            } else {
                tx.execute(&format!("DELETE FROM {store} WHERE id=?1"), [&patch.id])?;
            }
            if touched {
                changed.push((patch, previous_value));
            }
        }
        // Unchanged stores were validated when they were last written; re-checking all of
        // them on every commit made position saves scale with the whole library.
        let touched_stores: HashSet<&str> = changed
            .iter()
            .map(|(patch, _)| patch.store.as_str())
            .collect();
        for store in STORES {
            if !touched_stores.contains(store) {
                continue;
            }
            let (count, distinct, max): (i64, i64, Option<i64>) = tx.query_row(
                &format!("SELECT COUNT(*),COUNT(DISTINCT position),MAX(position) FROM {store}"),
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )?;
            let limit = match store {
                "decks" => 1000,
                "notes" => 100000,
                "cards" => 200000,
                "reviews" => 500000,
                "practices" => 100000,
                "attempts" => 500000,
                "savedSearches" => 100,
                "sources" => 10000,
                "materialReceipts" => 100000,
                "materialFolders" => 10000,
                _ => 1600000,
            };
            if count > limit || distinct != count || (count > 0 && max != Some(count - 1)) {
                return Err(Error::invalid());
            }
        }
        if touched_stores.contains("materialFolders") {
            Self::validate_folder_graph(&tx)?;
        }
        if changed.iter().any(|(patch, previous)| {
            patch.store == "sources"
                && patch.value.as_ref().is_none_or(|value| {
                    previous.as_ref().is_none_or(|old| {
                        ["studySequence", "parentSourceId"]
                            .iter()
                            .any(|key| old[*key] != value[*key])
                            || old["document"]["container"] != value["document"]["container"]
                    })
                })
        }) {
            crate::materials::sequences(&tx)?;
        }
        if let Some(retired) = &commit.retired {
            crate::retirement::portable_validate(&tx, retired, &self.validators)?;
            crate::retirement::replace(&tx, retired)?;
        }
        for (patch, previous) in &changed {
            if !patch.position_only {
                Self::validate_patch(&tx, patch, previous.as_ref(), commit.retired.is_some())?;
            }
        }
        finish(&tx)?;
        if let Some(history) = &commit.operation_history {
            if history["schemaVersion"] != 1
                || ["undo", "redo"].iter().any(|key| {
                    history[*key]
                        .as_array()
                        .is_none_or(|stack| stack.len() > 20)
                })
                || history["mediaIds"].as_array().is_none_or(|ids| {
                    ids.len() > 100_000
                        || ids
                            .iter()
                            .any(|id| id.as_str().is_none_or(|id| !valid_id(id)))
                })
                || serde_json::to_vec(history)?.len() > 64 * 1024 * 1024
            {
                return Err(Error::invalid());
            }
            tx.execute("INSERT INTO operation_history VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET data=excluded.data",[history.to_string()])?;
            let version: u32 = tx.pragma_query_value(None, "user_version", |r| r.get(0))?;
            tx.pragma_update(None, "user_version", version.max(12))?;
        }
        // This reader gate commits with the new records: a failed import cannot upgrade
        // the library, and an old application cannot strip unknown material metadata.
        if commit.patches.iter().any(|patch| {
            patch.value.as_ref().is_some_and(|value| {
                patch.store == "materialReceipts"
                    || !value["document"].is_null()
                    || !value["parentSourceId"].is_null()
                    || !value["excerpt"]["locator"].is_null()
                    || !value["origin"]["locator"].is_null()
                    || !value["reading"]["locator"].is_null()
                    || value["versions"].as_array().is_some_and(|versions| {
                        versions.iter().any(|version| {
                            !version["document"].is_null()
                                || !version["reading"]["locator"].is_null()
                        })
                    })
            })
        }) {
            let version: u32 = tx.pragma_query_value(None, "user_version", |r| r.get(0))?;
            tx.pragma_update(None, "user_version", version.max(11))?;
        }
        if commit.patches.iter().any(|patch| {
            patch.store == "materialFolders"
                || (patch.store == "materialReceipts"
                    && patch
                        .value
                        .as_ref()
                        .is_some_and(|value| value["kind"] == "edit-content"))
                || (patch.store == "sources"
                    && patch.value.as_ref().is_some_and(|value| {
                        ["folderId", "order", "properties", "annotations"]
                            .iter()
                            .any(|key| !value[*key].is_null())
                    }))
        }) {
            let version: u32 = tx.pragma_query_value(None, "user_version", |r| r.get(0))?;
            tx.pragma_update(None, "user_version", version.max(13))?;
        }
        if commit.retired.is_some()
            || tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM retired_history WHERE revision=?1)",
                [current + 1],
                |row| row.get::<_, bool>(0),
            )?
            || commit.patches.iter().any(|patch| {
                patch.value.as_ref().is_some_and(|value| {
                    crate::materials::needs_p4(value)
                        || patch.store == "media"
                            && value["size"].as_u64().unwrap_or(0) > MAX_MEDIA as u64
                })
            })
        {
            tx.pragma_update(None, "user_version", 14)?;
        }
        tx.execute("UPDATE workspace SET revision=?1 WHERE id=1", [current + 1])?;
        Self::collect_assets(&tx)?;
        tx.commit()?;
        Ok(current + 1)
    }
    /// Validate only what this patch changed: the row itself plus the JSON references that
    /// foreign keys cannot express. Unchanged rows were already validated when they were
    /// written; rescanning all of them made every save scale with the whole library, and a
    /// reading-position save happens every few hundred milliseconds while scrolling.
    fn validate_patch(
        tx: &Transaction<'_>,
        patch: &Patch,
        previous: Option<&Value>,
        portable_replacement: bool,
    ) -> Result<()> {
        match patch.store.as_str() {
            "sources" => {
                Self::validate_source(tx, patch, previous, portable_replacement)?;
                if let Some(value) = &patch.value {
                    if previous.is_none_or(|old| {
                        old["folderId"] != value["folderId"]
                            || old["parentSourceId"] != value["parentSourceId"]
                    }) && let Some(id) = value["folderId"].as_str()
                        && (!value["parentSourceId"].is_null()
                            || !Self::exists(
                                tx,
                                "SELECT EXISTS(SELECT 1 FROM materialFolders WHERE id=?1)",
                                id,
                            )?)
                    {
                        return Err(Error::invalid());
                    }
                    if previous.is_none_or(|old| {
                        old["annotations"] != value["annotations"]
                            || old["versions"] != value["versions"]
                            || old["mediaId"] != value["mediaId"]
                    }) {
                        let mut ids = HashSet::new();
                        for annotation in value["annotations"].as_array().into_iter().flatten() {
                            if !ids.insert(annotation["id"].as_str().unwrap_or("")) {
                                return Err(Error::invalid());
                            }
                            let snapshot = Self::source_snapshot(value, annotation)?;
                            let text = Self::source_body(tx, &snapshot)?;
                            let start = annotation["start"].as_u64().unwrap_or(u64::MAX) as usize;
                            let end = annotation["end"].as_u64().unwrap_or(0) as usize;
                            let quote: Vec<u16> = annotation["quote"]
                                .as_str()
                                .unwrap_or("")
                                .encode_utf16()
                                .collect();
                            if end <= start || text.get(start..end) != Some(quote.as_slice()) {
                                return Err(Error::invalid());
                            }
                            let mut reference = annotation.clone();
                            reference["sourceId"] = json!(patch.id);
                            crate::materials::reference(&snapshot, &reference, &text)?;
                        }
                    }
                }
                Self::validate_inline_media(tx, patch, previous)
            }
            "materialFolders" => Self::validate_folder(tx, patch),
            "notes" => {
                Self::validate_note(tx, patch, previous)?;
                Self::validate_inline_media(tx, patch, previous)
            }
            "media" => Self::validate_media(tx, patch),
            "reviews" | "practices" | "attempts" => Self::validate_history(tx, patch),
            "materialReceipts" => {
                if let Some(value) = &patch.value {
                    let duplicate: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM materialReceipts WHERE id<>?1 AND json_extract(data,'$.pluginId')=?2 AND json_extract(data,'$.kind')=?3 AND json_extract(data,'$.operationId')=?4)", params![patch.id, value["pluginId"].as_str().unwrap_or(""), value["kind"].as_str().unwrap_or(""), value["operationId"].as_str().unwrap_or("")], |row| row.get(0))?;
                    if duplicate {
                        return Err(Error::invalid());
                    }
                }
                if previous
                    .zip(patch.value.as_ref())
                    .is_some_and(|(before, next)| before != next)
                {
                    return Err(Error::invalid());
                }
                Ok(())
            }
            _ => Ok(()),
        }
    }
    fn exists(tx: &Transaction<'_>, sql: &str, id: &str) -> Result<bool> {
        Ok(tx.query_row(sql, [id], |row| row.get(0))?)
    }
    fn validate_folder_graph(tx: &Transaction<'_>) -> Result<()> {
        let mut query =
            tx.prepare("SELECT id,json_extract(data,'$.parentId') FROM materialFolders")?;
        let folders = query
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
            })?
            .collect::<std::result::Result<HashMap<_, _>, _>>()?;
        for id in folders.keys() {
            let mut seen = HashSet::new();
            let mut current = Some(id);
            while let Some(id) = current {
                if seen.len() >= 32 || !seen.insert(id) {
                    return Err(Error::invalid());
                }
                current = folders.get(id).ok_or_else(Error::invalid)?.as_ref();
            }
        }
        Ok(())
    }
    fn validate_folder(tx: &Transaction<'_>, patch: &Patch) -> Result<()> {
        let Some(value) = &patch.value else {
            if Self::exists(
                tx,
                "SELECT EXISTS(SELECT 1 FROM materialFolders WHERE json_extract(data,'$.parentId')=?1) OR EXISTS(SELECT 1 FROM sources WHERE json_extract(data,'$.folderId')=?1)",
                &patch.id,
            )? {
                return Err(Error::invalid());
            }
            return Ok(());
        };
        let mut seen = HashSet::from([patch.id.clone()]);
        let mut parent = value["parentId"].as_str().map(str::to_owned);
        while let Some(id) = parent {
            if seen.len() >= 32 || !seen.insert(id.clone()) {
                return Err(Error::invalid());
            }
            let data: String = tx
                .query_row(
                    "SELECT data FROM materialFolders WHERE id=?1",
                    [&id],
                    |row| row.get(0),
                )
                .map_err(|_| Error::invalid())?;
            parent = serde_json::from_str::<Value>(&data)?["parentId"]
                .as_str()
                .map(str::to_owned);
        }
        Ok(())
    }
    fn validate_inline_media(
        tx: &Transaction<'_>,
        patch: &Patch,
        previous: Option<&Value>,
    ) -> Result<()> {
        let Some(value) = &patch.value else {
            return Ok(());
        };
        if previous.is_some_and(|before| {
            before["inlineMedia"] == value["inlineMedia"] && before["versions"] == value["versions"]
        }) {
            return Ok(());
        }
        for snapshot in
            std::iter::once(value).chain(value["versions"].as_array().into_iter().flatten())
        {
            for reference in snapshot["inlineMedia"].as_array().into_iter().flatten() {
                let valid: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM assets a JOIN media m ON m.id=a.id WHERE a.id=?1 AND substr(a.path,1,64)=?2 AND (a.mime LIKE 'image/%' OR a.mime LIKE 'audio/%'))", params![reference["mediaId"].as_str().unwrap_or(""), reference["hash"].as_str().unwrap_or("")], |row| row.get(0))?;
                if !valid {
                    return Err(Error::invalid());
                }
            }
        }
        Ok(())
    }
    fn validate_media(tx: &Transaction<'_>, patch: &Patch) -> Result<()> {
        let Some(value) = patch.value.as_ref() else {
            // Deleting an asset that a note still attaches would leave a dangling reference.
            let referenced: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM notes n, json_each(json_extract(n.data,'$.frontMedia')) m WHERE m.value=?1) OR EXISTS(SELECT 1 FROM notes n, json_each(json_extract(n.data,'$.backMedia')) m WHERE m.value=?1) OR EXISTS(SELECT 1 FROM sources s, json_each(json_extract(s.data,'$.versions')) v WHERE json_extract(v.value,'$.mediaId')=?1) OR EXISTS(SELECT 1 FROM (SELECT data FROM notes UNION ALL SELECT data FROM sources) r,json_each(json_extract(r.data,'$.inlineMedia')) m WHERE json_extract(m.value,'$.mediaId')=?1) OR EXISTS(SELECT 1 FROM sources s,json_each(json_extract(s.data,'$.versions')) v,json_each(json_extract(v.value,'$.inlineMedia')) m WHERE json_extract(m.value,'$.mediaId')=?1) OR EXISTS(SELECT 1 FROM sources WHERE json_extract(data,'$.document.originalMediaId')=?1) OR EXISTS(SELECT 1 FROM sources s,json_each(json_extract(s.data,'$.versions')) v WHERE json_extract(v.value,'$.document.originalMediaId')=?1)",
                [&patch.id],
                |row| row.get(0),
            )?;
            let resources: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM sources s,json_each(json_extract(s.data,'$.document.resources')) r WHERE json_extract(r.value,'$.mediaId')=?1) OR EXISTS(SELECT 1 FROM sources s,json_each(json_extract(s.data,'$.versions')) v,json_each(json_extract(v.value,'$.document.resources')) r WHERE json_extract(r.value,'$.mediaId')=?1)", [&patch.id], |row| row.get(0))?;
            return if referenced || resources {
                Err(Error::invalid())
            } else {
                Ok(())
            };
        };
        let stored: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM assets a WHERE a.id=?1 AND a.mime=json_extract(?2,'$.type') AND a.size=json_extract(?2,'$.size'))",
            params![patch.id, value.to_string()],
            |row| row.get(0),
        )?;
        if stored
            && value["size"].as_u64().unwrap_or(u64::MAX)
                <= media_limit(value["type"].as_str().unwrap_or("")) as u64
        {
            Ok(())
        } else {
            Err(Error::invalid())
        }
    }
    fn validate_history(tx: &Transaction<'_>, patch: &Patch) -> Result<()> {
        let invalid = Error::invalid();
        match patch.store.as_str() {
            "reviews" => {
                let Some(value) = patch.value.as_ref() else {
                    return if Self::exists(
                        tx,
                        "SELECT EXISTS(SELECT 1 FROM practices WHERE json_extract(data,'$.reviewId')=?1)",
                        &patch.id,
                    )? {
                        Err(invalid)
                    } else {
                        Ok(())
                    };
                };
                if let Some(practice) = value["practiceId"].as_str() {
                    let card: Option<String> = tx
                        .query_row(
                            "SELECT card_id FROM practices WHERE id=?1",
                            [practice],
                            |row| row.get(0),
                        )
                        .optional()?;
                    if card.as_deref() != value["cardId"].as_str() {
                        return Err(invalid);
                    }
                }
                Ok(())
            }
            "practices" => {
                let Some(value) = patch.value.as_ref() else {
                    return if Self::exists(
                        tx,
                        "SELECT EXISTS(SELECT 1 FROM reviews WHERE json_extract(data,'$.practiceId')=?1)",
                        &patch.id,
                    )? {
                        Err(invalid)
                    } else {
                        Ok(())
                    };
                };
                let Some(review_id) = value["reviewId"].as_str() else {
                    return Ok(());
                };
                let row: Option<String> = tx
                    .query_row("SELECT data FROM reviews WHERE id=?1", [review_id], |row| {
                        row.get(0)
                    })
                    .optional()?;
                let Some(row) = row else { return Err(invalid) };
                let review: Value = serde_json::from_str(&row)?;
                if review["cardId"] != value["cardId"]
                    || review["practiceId"] != value["id"]
                    || review["rating"] != value["rating"]
                {
                    return Err(invalid);
                }
                Ok(())
            }
            _ => {
                let Some(value) = patch.value.as_ref() else {
                    return Ok(());
                };
                if let Some(practice) = value["practiceId"].as_str()
                    && !Self::exists(
                        tx,
                        "SELECT EXISTS(SELECT 1 FROM practices WHERE id=?1)",
                        practice,
                    )?
                {
                    return Err(invalid);
                }
                Ok(())
            }
        }
    }
    fn source_snapshot(source: &Value, reference: &Value) -> Result<Value> {
        let versions = source["versions"].as_array();
        let id = reference["mediaId"]
            .as_str()
            .or_else(|| {
                versions
                    .and_then(|v| v.first())
                    .and_then(|v| v["mediaId"].as_str())
            })
            .or_else(|| source["mediaId"].as_str());
        if id == source["mediaId"].as_str() {
            return Ok(source.clone());
        }
        versions
            .and_then(|v| v.iter().find(|v| v["mediaId"].as_str() == id))
            .cloned()
            .ok_or_else(Error::invalid)
    }
    fn source_body(tx: &Transaction<'_>, source: &Value) -> Result<Vec<u16>> {
        let body: Vec<u8> = tx
            .query_row(
                "SELECT asset_bytes(path) FROM assets WHERE id=?1",
                [source["mediaId"].as_str().unwrap_or("")],
                |row| row.get(0),
            )
            .map_err(|_| Error::invalid())?;
        let text = std::str::from_utf8(&body).map_err(|_| Error::invalid())?;
        if text.trim().is_empty()
            || text.contains('\r')
            || text.encode_utf16().count() as u64 != source["characters"].as_u64().unwrap_or(0)
        {
            return Err(Error::invalid());
        }
        Ok(text.encode_utf16().collect())
    }
    fn validate_source(
        tx: &Transaction<'_>,
        patch: &Patch,
        previous: Option<&Value>,
        portable_replacement: bool,
    ) -> Result<()> {
        let Some(value) = patch.value.as_ref() else {
            let referenced: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM sources WHERE json_extract(data,'$.origin.sourceId')=?1 OR json_extract(data,'$.parentSourceId')=?1) OR EXISTS(SELECT 1 FROM notes WHERE json_extract(data,'$.excerpt.sourceId')=?1)",
                [&patch.id], |row| row.get(0),
            )?;
            let retired = Self::retired_source_refs(tx, &patch.id)?;
            return if referenced || !retired.is_empty() {
                Err(Error::invalid())
            } else {
                Ok(())
            };
        };
        let versions = value["versions"].as_array().cloned().unwrap_or_default();
        if previous.is_none_or(|before| {
            before["parentSourceId"] != value["parentSourceId"]
                || before["origin"] != value["origin"]
        }) {
            crate::materials::hierarchy(tx, value)?;
        }
        let mut seen = HashSet::new();
        for snapshot in std::iter::once(value).chain(versions.iter()) {
            crate::materials::reading(snapshot, &patch.id)?;
            if !seen.insert(snapshot["mediaId"].as_str().unwrap_or("")) {
                return Err(Error::invalid());
            }
            if let Some(reading) = snapshot.get("reading").filter(|v| !v.is_null()) {
                let preview = reading["view"].as_str() == Some("preview");
                if reading["offset"].as_u64().unwrap_or(0)
                    > snapshot["characters"].as_u64().unwrap_or(0)
                    || (preview && snapshot["format"].as_str() != Some("markdown"))
                    || (!preview && reading["fraction"].as_f64().unwrap_or(0.0) != 0.0)
                {
                    return Err(Error::invalid());
                }
            }
        }
        // Queue/position-only saves never read source bodies or scan the workspace.
        let content_changed = previous.is_none_or(|before| {
            [
                "mediaId",
                "characters",
                "format",
                "kind",
                "origin",
                "versions",
                "derived",
                "inlineMedia",
                "document",
            ]
            .iter()
            .any(|key| before[key] != value[key])
        });
        if !content_changed {
            return Ok(());
        }
        if let Some(before) = previous {
            // A snapshot identity includes its attachment bindings. Reusing the text
            // media ID with different attachments would silently alter old quotations.
            for snapshot in std::iter::once(value).chain(versions.iter()) {
                if let Ok(old) =
                    Self::source_snapshot(before, &json!({"mediaId":snapshot["mediaId"]}))
                {
                    for key in ["format", "characters", "inlineMedia", "derived", "document"] {
                        let same = if key == "inlineMedia" {
                            old[key].as_array().cloned().unwrap_or_default()
                                == snapshot[key].as_array().cloned().unwrap_or_default()
                        } else {
                            old[key] == snapshot[key]
                        };
                        if !same {
                            return Err(Error::invalid());
                        }
                    }
                }
            }
        }
        let parent = if let Some(origin) = value.get("origin").filter(|v| !v.is_null()) {
            if origin["sourceId"].as_str() == Some(patch.id.as_str())
                || value["kind"].as_str() != Some("excerpt")
            {
                return Err(Error::invalid());
            }
            let mut seen = HashSet::from([patch.id.clone()]);
            let mut current = origin["sourceId"].as_str().unwrap_or("").to_owned();
            let mut depth = 0;
            loop {
                depth += 1;
                if depth > 32 || !seen.insert(current.clone()) {
                    return Err(Error::invalid());
                }
                let row: String = tx
                    .query_row("SELECT data FROM sources WHERE id=?1", [&current], |row| {
                        row.get(0)
                    })
                    .map_err(|_| Error::invalid())?;
                let next: Value = serde_json::from_str(&row)?;
                match next["origin"]["sourceId"].as_str() {
                    Some(parent) => current = parent.to_owned(),
                    None => break,
                }
            }
            let row: String = tx
                .query_row(
                    "SELECT data FROM sources WHERE id=?1",
                    [origin["sourceId"].as_str().unwrap_or("")],
                    |row| row.get(0),
                )
                .map_err(|_| Error::invalid())?;
            Some(Self::source_snapshot(&serde_json::from_str(&row)?, origin)?)
        } else {
            None
        };
        for snapshot in std::iter::once(value).chain(versions.iter()) {
            crate::materials::document(tx, snapshot)?;
            let mime = if snapshot["format"].as_str() == Some("markdown") {
                "text/markdown"
            } else {
                "text/plain"
            };
            let media_ok: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM media WHERE id=?1 AND json_extract(data,'$.type')=?2 AND json_extract(data,'$.size')<=1048576)", params![snapshot["mediaId"].as_str().unwrap_or(""), mime], |row| row.get(0))?;
            if !media_ok {
                return Err(Error::invalid());
            }
            let body = Self::source_body(tx, snapshot)?;
            if let Some(parent) = &parent {
                let origin = &value["origin"];
                let start = origin["start"].as_u64().unwrap_or(0) as usize;
                let end = origin["end"].as_u64().unwrap_or(0) as usize;
                let derived = snapshot["derived"].as_bool() == Some(true);
                let original = Self::source_body(tx, parent)?;
                crate::materials::reference(parent, origin, &original)?;
                if end <= start
                    || end - start > 10_000
                    || end > original.len()
                    || (!derived
                        && (snapshot["format"] != parent["format"]
                            || original.get(start..end) != Some(body.as_slice())))
                {
                    return Err(Error::invalid());
                }
            }
        }
        // Every existing quote must still resolve, including a reference without an explicit version.
        let mut statement = tx.prepare("SELECT data, 'source' FROM sources WHERE json_extract(data,'$.origin.sourceId')=?1 UNION ALL SELECT data, 'note' FROM notes WHERE json_extract(data,'$.excerpt.sourceId')=?1")?;
        let mut references = statement
            .query_map([&patch.id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        references.extend(
            Self::retired_source_refs(tx, &patch.id)?
                .into_iter()
                .map(|data| (data, "note".into())),
        );
        for (data, kind) in references {
            let child: Value = serde_json::from_str(&data)?;
            let reference = &child[if kind == "source" {
                "origin"
            } else {
                "excerpt"
            }];
            let parent = Self::source_snapshot(value, reference)?;
            // Legacy references without mediaId mean the original first snapshot.
            // Keeping the quote text is not enough: deleting/reordering versions
            // must not silently bind active or retired records to a different one.
            // Explicit portable replacement validates the supplied whole collection
            // and may legitimately rekey every media identity during restoration.
            if !portable_replacement
                && reference["mediaId"].as_str().is_none()
                && let Some(before) = previous
                && Self::source_snapshot(before, reference)?["mediaId"] != parent["mediaId"]
            {
                return Err(Error::invalid());
            }
            let text = Self::source_body(tx, &parent)?;
            crate::materials::reference(&parent, reference, &text)?;
            let start = reference["start"].as_u64().unwrap_or(0) as usize;
            let end = reference["end"].as_u64().unwrap_or(0) as usize;
            if kind == "note" {
                let quote: Vec<u16> = reference["quote"]
                    .as_str()
                    .unwrap_or("")
                    .encode_utf16()
                    .collect();
                if text.get(start..end) != Some(quote.as_slice()) {
                    return Err(Error::invalid());
                }
                for locator in child["plugin"]["variantLocators"]
                    .as_object()
                    .into_iter()
                    .flat_map(|map| map.values())
                {
                    let mut variant_reference = reference.clone();
                    variant_reference["locator"] = locator.clone();
                    crate::materials::reference(&parent, &variant_reference, &text)?;
                }
            } else {
                for snapshot in std::iter::once(&child)
                    .chain(child["versions"].as_array().into_iter().flatten())
                {
                    if snapshot["derived"].as_bool() != Some(true)
                        && text.get(start..end) != Some(Self::source_body(tx, snapshot)?.as_slice())
                    {
                        return Err(Error::invalid());
                    }
                }
            }
        }
        Ok(())
    }
    fn retired_source_refs(tx: &Transaction<'_>, id: &str) -> Result<Vec<String>> {
        let present: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='retired_notes' AND type='table')", [], |row| row.get(0))?;
        if !present {
            return Ok(vec![]);
        }
        let mut statement = tx.prepare(
            "SELECT data FROM retired_notes WHERE json_extract(data,'$.excerpt.sourceId')=?1",
        )?;
        Ok(statement
            .query_map([id], |row| row.get(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?)
    }
    fn validate_note(tx: &Transaction<'_>, patch: &Patch, previous: Option<&Value>) -> Result<()> {
        let Some(value) = patch.value.as_ref() else {
            return Ok(());
        };
        if previous.is_none_or(|before| {
            before["plugin"]["variantLocators"] != value["plugin"]["variantLocators"]
                || before["excerpt"] != value["excerpt"]
        }) && let Some(locators) = value["plugin"]["variantLocators"].as_object()
        {
            let excerpt = &value["excerpt"];
            let raw: String = tx
                .query_row(
                    "SELECT data FROM sources WHERE id=?1",
                    [excerpt["sourceId"].as_str().unwrap_or("")],
                    |row| row.get(0),
                )
                .map_err(|_| Error::invalid())?;
            let snapshot = Self::source_snapshot(&serde_json::from_str(&raw)?, excerpt)?;
            let text = Self::source_body(tx, &snapshot)?;
            for locator in locators.values() {
                let mut reference = excerpt.clone();
                reference["locator"] = locator.clone();
                crate::materials::reference(&snapshot, &reference, &text)?;
            }
        }
        if previous.is_none_or(|before| {
            before["frontMedia"] != value["frontMedia"] || before["backMedia"] != value["backMedia"]
        }) {
            let mut stmt =
                tx.prepare("SELECT json_extract(data,'$.type') FROM media WHERE id=?1")?;
            for key in ["frontMedia", "backMedia"] {
                for id in value[key].as_array().cloned().unwrap_or_default() {
                    let kind: Option<String> = stmt
                        .query_row([id.as_str().unwrap_or("")], |row| row.get(0))
                        .optional()?;
                    match kind {
                        None => return Err(Error::invalid()),
                        Some(kind)
                            if !kind.starts_with("image/") && !kind.starts_with("audio/") =>
                        {
                            return Err(Error::invalid());
                        }
                        _ => {}
                    }
                }
            }
        }
        if let Some(excerpt) = value.get("excerpt").filter(|excerpt| !excerpt.is_null())
            && previous.is_none_or(|before| before["excerpt"] != *excerpt)
        {
            let source_id = excerpt["sourceId"].as_str().unwrap_or("");
            let row: Option<String> = tx
                .query_row("SELECT data FROM sources WHERE id=?1", [source_id], |row| {
                    row.get(0)
                })
                .optional()?;
            let Some(row) = row else {
                return Err(Error::invalid());
            };
            let source = Self::source_snapshot(&serde_json::from_str(&row)?, excerpt)?;
            let start = excerpt["start"].as_u64().unwrap_or(0) as usize;
            let end = excerpt["end"].as_u64().unwrap_or(0) as usize;
            let quote = excerpt["quote"].as_str().ok_or_else(Error::invalid)?;
            let utf16: Vec<u16> = quote.encode_utf16().collect();
            if end > source["characters"].as_u64().unwrap_or(0) as usize
                || quote.trim().is_empty()
                || utf16.len() > 10_000
            {
                return Err(Error::invalid());
            }
            let text = Self::source_body(tx, &source)?;
            crate::materials::reference(&source, excerpt, &text)?;
            if text.get(start..end) != Some(utf16.as_slice()) {
                return Err(Error::invalid());
            }
        }
        Ok(())
    }
    fn checkpoint(tx: &Transaction<'_>, reason: &str, force: bool) -> Result<()> {
        let rev = revision(tx)?;
        let notes: i64 = tx.query_row("SELECT COUNT(*) FROM notes", [], |r| r.get(0))?;
        let sources: i64 = tx.query_row("SELECT COUNT(*) FROM sources", [], |r| r.get(0))?;
        if notes == 0 && sources == 0 && !force {
            return Ok(());
        }
        let latest: Option<String> = tx
            .query_row(
                "SELECT created_at FROM checkpoints ORDER BY revision DESC LIMIT 1",
                [],
                |r| r.get(0),
            )
            .optional()?;
        if !force
            && latest
                .and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok())
                .is_some_and(|time| (Utc::now() - time.with_timezone(&Utc)).num_minutes() < 30)
        {
            return Ok(());
        }
        tx.execute(
            "INSERT OR IGNORE INTO checkpoints SELECT ?1,?2,?3,?4,(SELECT COUNT(*) FROM cards),?5",
            params![uuid::Uuid::new_v4().to_string(), rev, now(), reason, notes],
        )?;
        tx.execute("DELETE FROM checkpoints WHERE id IN (SELECT id FROM checkpoints ORDER BY revision DESC LIMIT -1 OFFSET 10)", [])?;
        tx.execute(
            "DELETE FROM history WHERE revision <= (SELECT MIN(revision) FROM checkpoints)",
            [],
        )?;
        tx.execute(
            "DELETE FROM retired_history WHERE revision <= (SELECT MIN(revision) FROM checkpoints)",
            [],
        )?;
        Ok(())
    }
    fn collect_assets(_tx: &Transaction<'_>) -> Result<()> {
        // Deletion is an explicit attachment-management operation. Ordinary grading
        // must neither load plugin/private JSON nor discard media kept by durable undo.
        Ok(())
    }
    pub fn backup_now(&mut self, force: bool) -> Result<()> {
        let tx = self.connection.transaction()?;
        Self::checkpoint(
            &tx,
            if force {
                "手动快照"
            } else {
                "自动备份"
            },
            force,
        )?;
        Self::collect_assets(&tx)?;
        tx.commit()?;
        Ok(())
    }
    pub fn backups(&self) -> Result<Value> {
        let mut stmt = self.connection.prepare("SELECT id,revision,created_at,reason,cards,notes FROM checkpoints ORDER BY revision DESC")?;
        let rows = stmt.query_map([], |r| Ok(json!({"id":r.get::<_,String>(0)?,"revision":r.get::<_,i64>(1)?,"createdAt":r.get::<_,String>(2)?,"reason":r.get::<_,String>(3)?,"cards":r.get::<_,i64>(4)?,"notes":r.get::<_,i64>(5)?})))?.collect::<std::result::Result<Vec<_>,_>>()?;
        Ok(Value::Array(rows))
    }
    pub fn backup(&self, id: &str) -> Result<Value> {
        let target: i64 = self
            .connection
            .query_row("SELECT revision FROM checkpoints WHERE id=?1", [id], |r| {
                r.get(0)
            })
            .optional()?
            .ok_or_else(Error::missing)?;
        let mut library = json!({"version":16});
        for store in STORES {
            let mut rows = BTreeMap::<String, (i64, Value)>::new();
            let mut stmt = self
                .connection
                .prepare(&format!("SELECT id,position,data FROM {store}"))?;
            for row in stmt.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })? {
                let (id, pos, data) = row?;
                rows.insert(id, (pos, serde_json::from_str(&data)?));
            }
            let mut history = self.connection.prepare("SELECT id,position,data FROM history WHERE store=?1 AND revision>?2 ORDER BY revision DESC")?;
            for row in history.query_map(params![store, target], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<i64>>(1)?,
                    r.get::<_, Option<String>>(2)?,
                ))
            })? {
                let (id, pos, data) = row?;
                if let (Some(pos), Some(data)) = (pos, data) {
                    rows.insert(id, (pos, serde_json::from_str(&data)?));
                } else {
                    rows.remove(&id);
                }
            }
            let mut values: Vec<_> = rows.into_values().collect();
            values.sort_by_key(|(position, _)| *position);
            library[store] = Value::Array(values.into_iter().map(|(_, data)| data).collect());
        }
        Ok(library)
    }
    pub fn put_media(&mut self, id: &str, mime: &str, bytes: &[u8]) -> Result<()> {
        let allowed = [
            "image/png",
            "image/jpeg",
            "image/webp",
            "image/gif",
            "audio/mpeg",
            "audio/wav",
            "audio/x-wav",
            "audio/ogg",
            "audio/mp4",
            "audio/webm",
            "audio/flac",
            "audio/aac",
            "text/plain",
            "text/markdown",
            "text/html",
            "application/pdf",
            "application/epub+zip",
            "application/json",
            "application/octet-stream",
        ];
        if !valid_id(id)
            || bytes.is_empty()
            || bytes.len() > media_limit(mime)
            || !allowed.contains(&mime)
        {
            return Err(Error::invalid());
        }
        if mime.starts_with("text/")
            && ((mime != "text/html" && bytes.len() > 1024 * 1024)
                || std::str::from_utf8(bytes).is_err())
        {
            return Err(Error::invalid());
        }
        let existing: Option<(String, Vec<u8>)> = self
            .connection
            .query_row(
                "SELECT mime,asset_bytes(path) FROM assets WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((prior_mime, prior_bytes)) = existing {
            return if prior_mime == mime && prior_bytes == bytes {
                Ok(())
            } else {
                Err(Error::conflict())
            };
        }
        let hash = files::digest(bytes);
        let extension = match mime {
            "image/png" => "png",
            "image/jpeg" => "jpg",
            "image/webp" => "webp",
            "image/gif" => "gif",
            "text/markdown" => "md",
            "text/plain" => "txt",
            "text/html" => "html",
            "application/pdf" => "pdf",
            "application/epub+zip" => "epub",
            "application/json" => "json",
            "application/octet-stream" => "bin",
            "audio/mpeg" => "mp3",
            "audio/ogg" => "ogg",
            "audio/mp4" => "m4a",
            "audio/webm" => "webm",
            "audio/flac" => "flac",
            "audio/aac" => "aac",
            _ => "wav",
        };
        let path = format!("{hash}.{extension}");
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use cap_std::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match self.assets.open_with(&path, &options) {
            Ok(mut file) => {
                file.write_all(bytes)?;
                file.sync_all()?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                if read_asset(&self.assets, &path)? != bytes {
                    return Err(Error::invalid());
                }
            }
            Err(error) => return Err(error.into()),
        }
        #[cfg(unix)]
        self.assets.open(".")?.sync_all()?;
        self.connection.execute(
            "INSERT INTO assets VALUES(?1,?2,?3,?4,unixepoch())",
            params![id, mime, path, bytes.len() as i64],
        )?;
        Ok(())
    }
    pub fn media(&self, id: &str) -> Result<(String, Vec<u8>)> {
        self.connection
            .query_row(
                "SELECT mime,asset_bytes(path) FROM assets WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?
            .ok_or_else(Error::missing)
    }
}

fn read_asset(dir: &Dir, path: &str) -> std::io::Result<Vec<u8>> {
    let (hash, extension) = path
        .split_once('.')
        .ok_or(std::io::ErrorKind::InvalidInput)?;
    if hash.len() != 64
        || !hash
            .bytes()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
        || extension.is_empty()
        || !extension.bytes().all(|c| c.is_ascii_alphanumeric())
    {
        return Err(std::io::ErrorKind::InvalidInput.into());
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
    let bytes = files::read_stable_file(
        dir.open_with(path, &options)?.into_std(),
        if matches!(extension, "pdf" | "epub" | "html" | "bin") {
            MAX_DOCUMENT
        } else {
            MAX_MEDIA
        } as u64,
    )?;
    if files::digest(&bytes) != hash {
        return Err(std::io::ErrorKind::InvalidData.into());
    }
    Ok(bytes)
}
