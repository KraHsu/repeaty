use crate::error::{Error, Result};
use chrono::{SecondsFormat, Utc};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    path::Path,
    time::Duration,
};

pub const STORES: [&str; 9] = [
    "decks",
    "notes",
    "cards",
    "reviews",
    "media",
    "savedSearches",
    "practices",
    "attempts",
    "sources",
];
pub const MAX_MEDIA: usize = 10 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Commit {
    pub expected_revision: i64,
    pub patches: Vec<Patch>,
    pub reason: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Patch {
    pub store: String,
    pub id: String,
    pub position: Option<i64>,
    pub value: Option<Value>,
}
#[derive(Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase", deny_unknown_fields)]
pub enum ReadAttempts {
    One { id: String, revision: i64 },
    Batch { offset: i64, revision: i64 },
}
pub struct Database {
    connection: Connection,
    validators: HashMap<String, jsonschema::Validator>,
}
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.chars().count() <= 100
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
    pub fn open(path: &Path) -> Result<Self> {
        let mut connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        let version: u32 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version > 10 {
            return Err(Error::invalid());
        }
        let tx = connection.transaction()?;
        tx.execute_batch("CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL); INSERT OR IGNORE INTO workspace VALUES(1,0);
            CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, mime TEXT NOT NULL, body BLOB NOT NULL, created INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS checkpoints (id TEXT PRIMARY KEY, revision INTEGER NOT NULL UNIQUE, created_at TEXT NOT NULL, reason TEXT NOT NULL, cards INTEGER NOT NULL, notes INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS history (revision INTEGER NOT NULL, store TEXT NOT NULL, id TEXT NOT NULL, position INTEGER, data TEXT, PRIMARY KEY(revision,store,id));
            CREATE INDEX IF NOT EXISTS history_store ON history(store,id);")?;
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
        tx.execute_batch("CREATE INDEX IF NOT EXISTS notes_deck ON notes(deck_id); CREATE INDEX IF NOT EXISTS cards_note ON cards(note_id); CREATE INDEX IF NOT EXISTS reviews_card ON reviews(card_id); CREATE INDEX IF NOT EXISTS practices_card ON practices(card_id); CREATE INDEX IF NOT EXISTS attempts_practice ON attempts(practice_id); PRAGMA user_version=10;")?;
        tx.commit()?;
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
        Ok(Self {
            connection,
            validators,
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
        tx.commit()?;
        Ok(json!({"revision":current,"library":library}))
    }
    fn library_history(db: &Connection, summary: bool) -> Result<Value> {
        let mut library = json!({"version":13});
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
            if let Some(value) = &patch.value {
                if value["id"] != patch.id
                    || patch.position.is_none()
                    || patch.position.unwrap() > 500_000
                    || !self.validators[&patch.store].is_valid(value)
                {
                    return Err(Error::invalid());
                }
                if patch.store == "notes" {
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
        for patch in &commit.patches {
            let store = &patch.store;
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
                _ => 1600000,
            };
            if count > limit || distinct != count || (count > 0 && max != Some(count - 1)) {
                return Err(Error::invalid());
            }
        }
        for (patch, previous) in &changed {
            Self::validate_patch(&tx, patch, previous.as_ref())?;
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
    fn validate_patch(tx: &Transaction<'_>, patch: &Patch, previous: Option<&Value>) -> Result<()> {
        match patch.store.as_str() {
            "sources" => Self::validate_source(tx, patch, previous),
            "notes" => Self::validate_note(tx, patch, previous),
            "media" => Self::validate_media(tx, patch),
            "reviews" | "practices" | "attempts" => Self::validate_history(tx, patch),
            _ => Ok(()),
        }
    }
    fn exists(tx: &Transaction<'_>, sql: &str, id: &str) -> Result<bool> {
        Ok(tx.query_row(sql, [id], |row| row.get(0))?)
    }
    fn validate_media(tx: &Transaction<'_>, patch: &Patch) -> Result<()> {
        let Some(value) = patch.value.as_ref() else {
            // Deleting an asset that a note still attaches would leave a dangling reference.
            let referenced: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM notes n, json_each(json_extract(n.data,'$.frontMedia')) m WHERE m.value=?1) OR EXISTS(SELECT 1 FROM notes n, json_each(json_extract(n.data,'$.backMedia')) m WHERE m.value=?1)",
                [&patch.id],
                |row| row.get(0),
            )?;
            return if referenced {
                Err(Error::invalid())
            } else {
                Ok(())
            };
        };
        let stored: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM assets a WHERE a.id=?1 AND a.mime=json_extract(?2,'$.type') AND length(a.body)=json_extract(?2,'$.size'))",
            params![patch.id, value.to_string()],
            |row| row.get(0),
        )?;
        if stored {
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
    fn source_body(tx: &Transaction<'_>, id: &str) -> Result<Vec<u16>> {
        let body: Vec<u8> = tx
            .query_row(
                "SELECT a.body FROM sources s JOIN assets a ON a.id=s.media_id WHERE s.id=?1",
                [id],
                |row| row.get(0),
            )
            .map_err(|_| Error::invalid())?;
        Ok(std::str::from_utf8(&body)
            .map_err(|_| Error::invalid())?
            .encode_utf16()
            .collect())
    }
    fn validate_source(
        tx: &Transaction<'_>,
        patch: &Patch,
        previous: Option<&Value>,
    ) -> Result<()> {
        let Some(value) = patch.value.as_ref() else {
            // A deleted snapshot must not leave excerpts or notes pointing at it.
            let referenced: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM sources WHERE json_extract(data,'$.origin.sourceId')=?1) OR EXISTS(SELECT 1 FROM notes WHERE json_extract(data,'$.excerpt.sourceId')=?1)",
                [&patch.id],
                |row| row.get(0),
            )?;
            return if referenced {
                Err(Error::invalid())
            } else {
                Ok(())
            };
        };
        if let Some(reading) = value.get("reading").filter(|reading| !reading.is_null()) {
            let preview = reading["view"].as_str() == Some("preview");
            if reading["offset"].as_u64().unwrap_or(0) > value["characters"].as_u64().unwrap_or(0)
                || (preview && value["format"].as_str() != Some("markdown"))
                || (!preview && reading["fraction"].as_f64().unwrap_or(0.0) != 0.0)
            {
                return Err(Error::invalid());
            }
        }
        let mime = if value["format"].as_str() == Some("markdown") {
            "text/markdown"
        } else {
            "text/plain"
        };
        let media_ok: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM media m WHERE m.id=?1 AND json_extract(m.data,'$.type')=?2 AND json_extract(m.data,'$.size')<=1048576)",
            params![value["mediaId"].as_str().unwrap_or(""), mime],
            |row| row.get(0),
        )?;
        if !media_ok {
            return Err(Error::invalid());
        }
        // A position save only moves offsets. The snapshot body cannot have changed unless one
        // of these fields did, so the body read (and excerpt re-validation) is skipped.
        let content_changed = previous.is_none_or(|before| {
            before["mediaId"] != value["mediaId"]
                || before["characters"] != value["characters"]
                || before["format"] != value["format"]
                || before["kind"] != value["kind"]
                || before["origin"] != value["origin"]
        });
        if !content_changed {
            return Ok(());
        }
        let body: Vec<u8> = tx
            .query_row(
                "SELECT body FROM assets WHERE id=?1",
                [value["mediaId"].as_str().unwrap_or("")],
                |row| row.get(0),
            )
            .map_err(|_| Error::invalid())?;
        let text = std::str::from_utf8(&body).map_err(|_| Error::invalid())?;
        if text.trim().is_empty()
            || text.contains('\r')
            || text.encode_utf16().count() as u64 != value["characters"].as_u64().unwrap_or(0)
        {
            return Err(Error::invalid());
        }
        if let Some(origin) = value.get("origin").filter(|origin| !origin.is_null()) {
            let parent_id = origin["sourceId"].as_str().unwrap_or("");
            let start = origin["start"].as_u64().unwrap_or(0) as usize;
            let end = origin["end"].as_u64().unwrap_or(0) as usize;
            let row: Option<String> = tx
                .query_row("SELECT data FROM sources WHERE id=?1", [parent_id], |row| {
                    row.get(0)
                })
                .optional()?;
            let Some(row) = row else {
                return Err(Error::invalid());
            };
            let parent: Value = serde_json::from_str(&row)?;
            if parent_id == patch.id
                || value["kind"].as_str() != Some("excerpt")
                || end <= start
                || end - start != value["characters"].as_u64().unwrap_or(0) as usize
                || end - start > 10_000
                || end > parent["characters"].as_u64().unwrap_or(0) as usize
                || parent["format"] != value["format"]
            {
                return Err(Error::invalid());
            }
            let mut seen = HashSet::from([patch.id.clone()]);
            let mut current = parent_id.to_owned();
            let mut depth = 0;
            loop {
                depth += 1;
                if depth > 32 || !seen.insert(current.clone()) {
                    return Err(Error::invalid());
                }
                let next: Option<String> = tx
                    .query_row("SELECT data FROM sources WHERE id=?1", [&current], |row| {
                        row.get(0)
                    })
                    .optional()?;
                let Some(next) = next else { break };
                let next: Value = serde_json::from_str(&next)?;
                match next["origin"]["sourceId"].as_str() {
                    Some(parent) => current = parent.to_owned(),
                    None => break,
                }
            }
            let original = Self::source_body(tx, parent_id)?;
            let quote: Vec<u16> = text.encode_utf16().collect();
            if original.get(start..end) != Some(quote.as_slice()) {
                return Err(Error::invalid());
            }
        }
        // Replacing a snapshot body can break excerpts recorded against the old text.
        if previous.is_some_and(|before| before["mediaId"] != value["mediaId"]) {
            let original: Vec<u16> = text.encode_utf16().collect();
            let mut stmt = tx.prepare(
                "SELECT data FROM sources WHERE json_extract(data,'$.origin.sourceId')=?1",
            )?;
            let children: Vec<String> = stmt
                .query_map([&patch.id], |row| row.get(0))?
                .collect::<rusqlite::Result<_>>()?;
            drop(stmt);
            for child in children {
                let child: Value = serde_json::from_str(&child)?;
                let start = child["origin"]["start"].as_u64().unwrap_or(0) as usize;
                let end = child["origin"]["end"].as_u64().unwrap_or(0) as usize;
                let child_body: Vec<u8> = tx
                    .query_row(
                        "SELECT body FROM assets WHERE id=?1",
                        [child["mediaId"].as_str().unwrap_or("")],
                        |row| row.get(0),
                    )
                    .map_err(|_| Error::invalid())?;
                let child_text: Vec<u16> = std::str::from_utf8(&child_body)
                    .map_err(|_| Error::invalid())?
                    .encode_utf16()
                    .collect();
                if original.get(start..end) != Some(child_text.as_slice()) {
                    return Err(Error::invalid());
                }
            }
        }
        Ok(())
    }
    fn validate_note(tx: &Transaction<'_>, patch: &Patch, previous: Option<&Value>) -> Result<()> {
        let Some(value) = patch.value.as_ref() else {
            return Ok(());
        };
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
                        Some(kind) if kind.starts_with("text/") => return Err(Error::invalid()),
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
            let source: Value = serde_json::from_str(&row)?;
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
            let text = Self::source_body(tx, source_id)?;
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
        Ok(())
    }
    fn collect_assets(tx: &Transaction<'_>) -> Result<()> {
        // Unreferenced uploads are staged for a day, so an interrupted import can retry.
        tx.execute("DELETE FROM assets WHERE created < unixepoch()-86400 AND id NOT IN (SELECT id FROM media) AND id NOT IN (SELECT id FROM history WHERE store='media' AND data IS NOT NULL)", [])?;
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
        let mut library = json!({"version":13});
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
        ];
        if !valid_id(id) || bytes.is_empty() || bytes.len() > MAX_MEDIA || !allowed.contains(&mime)
        {
            return Err(Error::invalid());
        }
        if mime.starts_with("text/")
            && (bytes.len() > 1024 * 1024 || std::str::from_utf8(bytes).is_err())
        {
            return Err(Error::invalid());
        }
        let existing: Option<(String, Vec<u8>)> = self
            .connection
            .query_row("SELECT mime,body FROM assets WHERE id=?1", [id], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .optional()?;
        if let Some((prior_mime, prior_bytes)) = existing {
            return if prior_mime == mime && prior_bytes == bytes {
                Ok(())
            } else {
                Err(Error::conflict())
            };
        }
        self.connection.execute(
            "INSERT INTO assets VALUES(?1,?2,?3,unixepoch())",
            params![id, mime, bytes],
        )?;
        Ok(())
    }
    pub fn media(&self, id: &str) -> Result<(String, Vec<u8>)> {
        self.connection
            .query_row("SELECT mime,body FROM assets WHERE id=?1", [id], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .optional()?
            .ok_or_else(Error::missing)
    }
}
