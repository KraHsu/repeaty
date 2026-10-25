//! Opaque-content transaction experiment on explicitly created M0 roots, not a library schema.
//! Working Markdown may differ from the immutable accepted version. Recovery never overwrites it.

use crate::{
    atomic::{self, ReplaceMethod},
    files,
};
use rusqlite::{Connection, OpenFlags, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions as FileOptions},
    io,
    path::{Path, PathBuf},
    time::Duration,
};

pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
const MARKER: &[u8] = b"{\"format\":\"repeaty-workspace-m0-experiment\",\"version\":1}\n";
const APP_ID: i32 = 0x52504d30; // RPM0, deliberately not the final RPTY workspace format.
const DB_VERSION: i32 = 1001;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NewCard {
    pub id: String,
    pub variant: String,
    /// Already computed by the domain layer; the coordinator never replays ratings or runs FSRS.
    pub state_json: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SaveRequest {
    pub operation_id: String,
    pub note_id: String,
    pub path: String,
    pub expected_hash: Option<String>,
    pub draft_id: Option<String>,
    pub new_cards: Vec<NewCard>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Intent {
    version: u32,
    request: SaveRequest,
    next_hash: String,
    method: ReplaceMethod,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SaveOutcome {
    Committed {
        operation_id: String,
        note_id: String,
        hash: String,
    },
    Attention {
        operation_id: String,
        committed: Option<bool>,
        reason: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Checkpoint {
    ObjectDurable,
    JournalDurable,
    ReservationCommitted,
    PublishStarted,
    FilePublished,
    PublicationRecorded,
    BeforeDatabaseCommit,
    DatabaseCommitted,
    CompletionRecorded,
}
impl Checkpoint {
    pub const ALL: [Self; 9] = [
        Self::ObjectDurable,
        Self::JournalDurable,
        Self::ReservationCommitted,
        Self::PublishStarted,
        Self::FilePublished,
        Self::PublicationRecorded,
        Self::BeforeDatabaseCommit,
        Self::DatabaseCommitted,
        Self::CompletionRecorded,
    ];
}

pub struct Prototype {
    root: PathBuf,
    conn: Connection,
    _lock: File,
}

impl Prototype {
    /// Refuses nonempty roots. This marker/database cannot be opened as an existing user library.
    pub fn create_in_empty(root: &Path) -> Result<Self> {
        require_directory(root)?;
        if fs::read_dir(root)?.next().is_some() {
            return Err("prototype-root-must-be-empty".into());
        }
        let root = root.canonicalize()?;
        for path in [
            "notes",
            ".repeaty",
            ".repeaty/objects",
            ".repeaty/objects/sha256",
            ".repeaty/transactions",
        ] {
            files::create_private_dir(&root.join(path))?;
        }
        let conn = Connection::open(root.join("state.prototype.sqlite3"))?;
        conn.execute_batch(&format!(
            "PRAGMA application_id={APP_ID}; PRAGMA user_version={DB_VERSION};
             PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;
             CREATE TABLE notes(id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL,
               path_key TEXT UNIQUE NOT NULL, accepted_hash TEXT NOT NULL, last_operation TEXT);
             CREATE TABLE cards(id TEXT PRIMARY KEY, note_id TEXT NOT NULL REFERENCES notes(id),
               variant TEXT NOT NULL, state_json TEXT NOT NULL, UNIQUE(note_id, variant));
             CREATE TABLE drafts(id TEXT PRIMARY KEY, payload TEXT NOT NULL,
               reserved_by TEXT, reserved_note_id TEXT, consumed_by TEXT);
             CREATE TABLE operations(id TEXT PRIMARY KEY, intent TEXT NOT NULL, note_id TEXT NOT NULL,
               path_key TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','attention','committed')));
             CREATE UNIQUE INDEX pending_note ON operations(note_id) WHERE status != 'committed';
             CREATE UNIQUE INDEX pending_path ON operations(path_key) WHERE status != 'committed';
             CREATE TABLE changes(operation_id TEXT PRIMARY KEY REFERENCES operations(id),
               note_id TEXT NOT NULL REFERENCES notes(id), accepted_hash TEXT NOT NULL);"
        ))?;
        drop(conn);
        files::sync_directory(&root)?;
        files::write_new(&root.join("prototype.json"), MARKER)?;
        Self::open(&root)
    }

    pub fn open(root: &Path) -> Result<Self> {
        require_directory(root)?;
        let root = root.canonicalize()?;
        if files::read_stable(&root.join("prototype.json"))? != MARKER {
            return Err("not-an-m0-prototype".into());
        }
        for path in [
            "notes",
            ".repeaty",
            ".repeaty/objects",
            ".repeaty/objects/sha256",
            ".repeaty/transactions",
        ] {
            require_directory(&root.join(path))?;
        }
        let database_path = root.join("state.prototype.sqlite3");
        files::regular_file(&database_path)?;
        let lock = lock_root(&root)?;
        let conn = Connection::open_with_flags(database_path, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
        if conn.pragma_query_value(None, "application_id", |row| row.get::<_, i32>(0))? != APP_ID
            || conn.pragma_query_value(None, "user_version", |row| row.get::<_, i32>(0))?
                != DB_VERSION
        {
            return Err("incompatible-prototype-database".into());
        }
        conn.busy_timeout(Duration::from_secs(1))?;
        conn.execute_batch(
            "PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA journal_mode=WAL;",
        )?;
        Ok(Self {
            root,
            conn,
            _lock: lock,
        })
    }

    /// Fixture setup only, not an import API. Future M1 must validate identity, syntax and references.
    pub fn seed_note_for_fixture(
        &mut self,
        note_id: &str,
        path: &str,
        bytes: &[u8],
        cards: &[NewCard],
    ) -> Result<()> {
        let target = self.target(path)?;
        let hash = self.store_object(bytes)?;
        files::write_new(&target, bytes)?;
        let tx = self.conn.transaction()?;
        tx.execute(
            "INSERT INTO notes VALUES(?1,?2,?3,?4,NULL)",
            params![note_id, path, path.to_lowercase(), hash],
        )?;
        for card in cards {
            insert_card(&tx, note_id, card)?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn seed_draft_for_fixture(&self, id: &str, payload: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO drafts(id,payload) VALUES(?1,?2)",
            params![id, payload],
        )?;
        Ok(())
    }

    pub fn save(&mut self, request: SaveRequest, bytes: &[u8]) -> Result<SaveOutcome> {
        self.save_with_checkpoint(request, bytes, |_| Ok(()))
    }

    /// M0 fault-injection hook; tests also exit a child process here, without running destructors.
    pub fn save_with_checkpoint(
        &mut self,
        request: SaveRequest,
        bytes: &[u8],
        mut checkpoint: impl FnMut(Checkpoint) -> Result<()>,
    ) -> Result<SaveOutcome> {
        validate_request(&request)?;
        if bytes.len() as u64 > files::MAX_TEXT_BYTES || std::str::from_utf8(bytes).is_err() {
            return Err("invalid-proposed-text".into());
        }
        let intent = Intent {
            version: 1,
            request,
            next_hash: files::digest(bytes),
            method: atomic::replace_method(),
        };
        let serialized = serde_json::to_vec(&intent)?;
        if serialized.len() as u64 > files::MAX_TEXT_BYTES {
            return Err("transaction-intent-too-large".into());
        }
        let dir = self.operation_dir(&intent.request.operation_id)?;
        if dir.exists() {
            require_directory(&dir)?;
            if dir.join("intent.json").exists() {
                if self.read_intent(&dir)? != intent {
                    return Err("operation-id-reused".into());
                }
                if dir.join("publish-started").exists()
                    || matches!(
                        self.operation_status(&intent)?.as_deref(),
                        Some("committed" | "attention")
                    )
                    || has_attention_record(&dir)?
                {
                    return self.recover_intent(&intent);
                }
            } else if dir.join("publish-started").exists()
                || self.raw_operation(&intent.request.operation_id)?.is_some()
            {
                return Err("incomplete-journal-needs-attention".into());
            }
        } else {
            files::create_private_dir(&dir)?;
        }
        self.store_object(bytes)?;
        checkpoint(Checkpoint::ObjectDurable)?;
        write_same_or_new(&dir.join("slot"), bytes)?;
        write_same_or_new(&dir.join("intent.json"), &serialized)?;
        checkpoint(Checkpoint::JournalDurable)?;
        self.reserve(&intent)?;
        checkpoint(Checkpoint::ReservationCommitted)?;
        if let Some(reason) = self.baseline_issue(&intent)? {
            return self.attention(&intent, reason, false);
        }
        write_same_or_new(&dir.join("publish-started"), b"started\n")?;
        checkpoint(Checkpoint::PublishStarted)?;
        require_directory(&dir)?;
        let target = self.target(&intent.request.path)?;
        let result = if intent.request.expected_hash.as_ref() == Some(&intent.next_hash) {
            Ok(())
        } else if intent.request.expected_hash.is_some() {
            atomic::replace_preserving(&target, &dir.join("slot"), &dir.join("displaced"))
        } else {
            atomic::publish_new(&dir.join("slot"), &target)
        };
        if result.is_err() {
            return self.attention(&intent, "native-publication-failed", false);
        }
        checkpoint(Checkpoint::FilePublished)?;
        files::sync_regular_file(&target)?;
        if let Some(displaced) = self.displaced(&intent) {
            files::sync_regular_file(&displaced)?;
        }
        files::sync_directory(target.parent().ok_or("missing-target-parent")?)?;
        files::sync_directory(&dir)?;
        write_same_or_new(&dir.join("published"), b"published\n")?;
        checkpoint(Checkpoint::PublicationRecorded)?;
        self.finish(&intent, &mut checkpoint)
    }

    /// Never republishes, restores or deletes a working file. Ambiguous topology needs a decision.
    pub fn recover(&mut self) -> Result<Vec<SaveOutcome>> {
        checked_directory(&self.root, ".repeaty/transactions")?;
        let mut paths: Vec<_> =
            fs::read_dir(self.root.join(".repeaty/transactions"))?.collect::<io::Result<_>>()?;
        paths.sort_by_key(|entry| entry.file_name());
        let mut outcomes = Vec::new();
        for entry in paths {
            let id = entry.file_name().to_string_lossy().into_owned();
            let outcome = (|| {
                require_directory(&entry.path())?;
                let intent = self.read_intent(&entry.path())?;
                if id != intent.request.operation_id {
                    return Err("journal-directory-mismatch".into());
                }
                self.recover_intent(&intent)
            })();
            let committed = match self.raw_operation(&id) {
                Ok(Some((_, status))) => Some(status == "committed"),
                Ok(None) => Some(false),
                Err(_) => None,
            };
            outcomes.push(outcome.unwrap_or(SaveOutcome::Attention {
                operation_id: id,
                committed,
                reason: "invalid-or-incomplete-journal".into(),
            }));
        }
        Ok(outcomes)
    }

    fn reserve(&mut self, intent: &Intent) -> Result<()> {
        let serialized = serde_json::to_string(intent)?;
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let previous: Option<String> = tx
            .query_row(
                "SELECT intent FROM operations WHERE id=?1",
                [&intent.request.operation_id],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(previous) = previous {
            if previous != serialized {
                return Err("operation-id-reused".into());
            }
            tx.commit()?;
            return Ok(());
        }
        if let Some(draft_id) = &intent.request.draft_id {
            let updated = tx.execute("UPDATE drafts SET reserved_by=?1,reserved_note_id=?2 WHERE id=?3 AND consumed_by IS NULL AND reserved_by IS NULL",
                params![intent.request.operation_id, intent.request.note_id, draft_id])?;
            if updated != 1 {
                return Err("draft-missing-consumed-or-already-reserved".into());
            }
        }
        tx.execute(
            "INSERT INTO operations VALUES(?1,?2,?3,?4,'pending')",
            params![
                intent.request.operation_id,
                serialized,
                intent.request.note_id,
                intent.request.path.to_lowercase()
            ],
        )?;
        tx.commit()?;
        Ok(())
    }

    fn baseline_issue(&self, intent: &Intent) -> Result<Option<&'static str>> {
        let r = &intent.request;
        let note: Option<(String, String)> = self
            .conn
            .query_row(
                "SELECT accepted_hash,path FROM notes WHERE id=?1",
                [&r.note_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let db_matches = match (&r.expected_hash, note) {
            (None, None) => true,
            (Some(expected), Some((accepted, path))) => *expected == accepted && path == r.path,
            _ => false,
        };
        if !db_matches {
            return Ok(Some("accepted-baseline-changed"));
        }
        let other: bool = self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM notes WHERE path_key=?1 AND id!=?2)",
            params![r.path.to_lowercase(), r.note_id],
            |row| row.get(0),
        )?;
        if other {
            return Ok(Some("path-belongs-to-another-note"));
        }
        let target = self.target(&r.path)?;
        match (r.expected_hash.as_ref(), read_optional(&target)?) {
            (None, None) => Ok(None),
            (Some(hash), Some(bytes)) if files::digest(&bytes) == *hash => Ok(None),
            _ => Ok(Some("working-baseline-changed")),
        }
    }

    fn recover_intent(&mut self, intent: &Intent) -> Result<SaveOutcome> {
        self.verify_object(&intent.next_hash)?;
        let Some(status) = self.operation_status(intent)? else {
            return Ok(need_attention(intent, false, "unregistered-intent"));
        };
        if status == "committed" {
            return self.finish(intent, &mut |_| Ok(()));
        }
        let dir = self.operation_dir(&intent.request.operation_id)?;
        if status == "attention" || has_attention_record(&dir)? {
            return Ok(need_attention(intent, false, "unresolved-conflict"));
        }
        if !dir.join("publish-started").exists() {
            return Ok(need_attention(intent, false, "prepared-not-published"));
        }
        let target = read_optional(&self.target(&intent.request.path)?)?;
        let target_is_new = target
            .as_ref()
            .is_some_and(|bytes| files::digest(bytes) == intent.next_hash);
        let proof = if intent.request.expected_hash.is_none() {
            !dir.join("slot").exists()
        } else if intent.request.expected_hash.as_ref() == Some(&intent.next_hash) {
            dir.join("published").is_file()
        } else {
            self.displaced(intent)
                .map(|path| read_optional(&path))
                .transpose()?
                .flatten()
                .is_some_and(|bytes| files::digest(&bytes) != intent.next_hash)
        };
        if !target_is_new || !proof {
            return Ok(need_attention(
                intent,
                false,
                "publication-ambiguous-or-working-file-changed",
            ));
        }
        self.finish(intent, &mut |_| Ok(()))
    }

    fn finish(
        &mut self,
        intent: &Intent,
        checkpoint: &mut impl FnMut(Checkpoint) -> Result<()>,
    ) -> Result<SaveOutcome> {
        self.verify_object(&intent.next_hash)?;
        let committed = self.operation_status(intent)?.as_deref() == Some("committed");
        if let Some(path) = self.displaced(intent) {
            let Some(bytes) = read_optional(&path)? else {
                return self.attention(intent, "displaced-file-missing", committed);
            };
            let hash = self.store_object(&bytes)?;
            if Some(&hash) != intent.request.expected_hash.as_ref() {
                return self.attention(intent, "displaced-file-changed", committed);
            }
        }
        let target = read_optional(&self.target(&intent.request.path)?)?;
        let target_matches = target
            .as_ref()
            .is_some_and(|bytes| files::digest(bytes) == intent.next_hash);
        if let Some(bytes) = &target {
            self.store_object(bytes)?;
        }
        if !target_matches {
            let is_head: bool = self.conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM notes WHERE id=?1 AND last_operation=?2)",
                params![intent.request.note_id, intent.request.operation_id],
                |row| row.get(0),
            )?;
            if !committed || is_head {
                return self.attention(intent, "working-file-changed-or-missing", committed);
            }
        }
        if !committed {
            self.commit_acceptance(intent, checkpoint)?;
        }
        checkpoint(Checkpoint::DatabaseCommitted)?;
        write_same_or_new(
            &self
                .operation_dir(&intent.request.operation_id)?
                .join("complete"),
            b"complete\n",
        )?;
        checkpoint(Checkpoint::CompletionRecorded)?;
        Ok(SaveOutcome::Committed {
            operation_id: intent.request.operation_id.clone(),
            note_id: intent.request.note_id.clone(),
            hash: intent.next_hash.clone(),
        })
    }

    fn commit_acceptance(
        &mut self,
        intent: &Intent,
        checkpoint: &mut impl FnMut(Checkpoint) -> Result<()>,
    ) -> Result<()> {
        let r = &intent.request;
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(expected) = &r.expected_hash {
            if tx.execute("UPDATE notes SET accepted_hash=?1,last_operation=?2 WHERE id=?3 AND path=?4 AND accepted_hash=?5",
                params![intent.next_hash, r.operation_id, r.note_id, r.path, expected])? != 1 { return Err("accepted-baseline-changed".into()); }
        } else {
            tx.execute(
                "INSERT INTO notes VALUES(?1,?2,?3,?4,?5)",
                params![
                    r.note_id,
                    r.path,
                    r.path.to_lowercase(),
                    intent.next_hash,
                    r.operation_id
                ],
            )?;
        }
        for card in &r.new_cards {
            insert_card(&tx, &r.note_id, card)?;
        }
        if let Some(draft_id) = &r.draft_id
            && tx.execute("UPDATE drafts SET consumed_by=?1 WHERE id=?2 AND reserved_by=?1 AND reserved_note_id=?3 AND consumed_by IS NULL",
                params![r.operation_id, draft_id, r.note_id])? != 1 { return Err("draft-reservation-changed".into()); }
        tx.execute(
            "INSERT INTO changes VALUES(?1,?2,?3)",
            params![r.operation_id, r.note_id, intent.next_hash],
        )?;
        tx.execute(
            "UPDATE operations SET status='committed' WHERE id=?1",
            [&r.operation_id],
        )?;
        checkpoint(Checkpoint::BeforeDatabaseCommit)?;
        tx.commit()?;
        Ok(())
    }

    fn attention(&mut self, intent: &Intent, reason: &str, committed: bool) -> Result<SaveOutcome> {
        let dir = self.operation_dir(&intent.request.operation_id)?;
        // A content-addressed observation is append-only; no older conflict evidence is replaced.
        let bytes = serde_json::to_vec(&(reason, committed))?;
        write_same_or_new(
            &dir.join(format!("attention-{}.json", files::digest(&bytes))),
            &bytes,
        )?;
        if !committed {
            self.conn.execute(
                "UPDATE operations SET status='attention' WHERE id=?1 AND status!='committed'",
                [&intent.request.operation_id],
            )?;
        }
        Ok(need_attention(intent, committed, reason))
    }

    fn target(&self, path: &str) -> Result<PathBuf> {
        validate_path(path)?;
        checked_directory(&self.root, "notes")?;
        Ok(self.root.join(path))
    }

    fn operation_dir(&self, id: &str) -> Result<PathBuf> {
        if !safe_component(id) {
            return Err("invalid-operation-id".into());
        }
        checked_directory(&self.root, ".repeaty/transactions")?;
        Ok(self.root.join(".repeaty/transactions").join(id))
    }

    fn read_intent(&self, dir: &Path) -> Result<Intent> {
        let intent: Intent =
            serde_json::from_slice(&files::read_stable(&dir.join("intent.json"))?)?;
        if intent.version != 1 || !valid_hash(&intent.next_hash) {
            return Err("unsupported-journal".into());
        }
        validate_request(&intent.request)?;
        Ok(intent)
    }

    fn raw_operation(&self, id: &str) -> Result<Option<(String, String)>> {
        Ok(self
            .conn
            .query_row(
                "SELECT intent,status FROM operations WHERE id=?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?)
    }

    fn operation_status(&self, intent: &Intent) -> Result<Option<String>> {
        let Some((serialized, status)) = self.raw_operation(&intent.request.operation_id)? else {
            return Ok(None);
        };
        if serialized != serde_json::to_string(intent)? {
            return Err("journal-database-mismatch".into());
        }
        Ok(Some(status))
    }

    fn displaced(&self, intent: &Intent) -> Option<PathBuf> {
        if intent.request.expected_hash.is_none()
            || intent.request.expected_hash.as_ref() == Some(&intent.next_hash)
        {
            return None;
        }
        let name = if intent.method == ReplaceMethod::Exchange {
            "slot"
        } else {
            "displaced"
        };
        Some(
            self.root
                .join(".repeaty/transactions")
                .join(&intent.request.operation_id)
                .join(name),
        )
    }

    fn object_path(&self, hash: &str) -> Result<PathBuf> {
        if !valid_hash(hash) {
            return Err("invalid-object-hash".into());
        }
        checked_directory(&self.root, ".repeaty/objects/sha256")?;
        let dir = self.root.join(".repeaty/objects/sha256").join(&hash[..2]);
        if dir.exists() {
            require_directory(&dir)?;
        } else {
            files::create_private_dir(&dir)?;
        }
        Ok(dir.join(hash))
    }

    fn store_object(&self, bytes: &[u8]) -> Result<String> {
        if bytes.len() as u64 > files::MAX_TEXT_BYTES {
            return Err("object-too-large".into());
        }
        let hash = files::digest(bytes);
        write_same_or_new(&self.object_path(&hash)?, bytes)?;
        Ok(hash)
    }

    fn verify_object(&self, hash: &str) -> Result<()> {
        if files::digest(&files::read_stable(&self.object_path(hash)?)?) != hash {
            return Err("corrupt-content-object".into());
        }
        Ok(())
    }
}

fn insert_card(conn: &Connection, note_id: &str, card: &NewCard) -> Result<()> {
    conn.execute(
        "INSERT INTO cards VALUES(?1,?2,?3,?4)",
        params![card.id, note_id, card.variant, card.state_json],
    )?;
    Ok(())
}
fn require_directory(path: &Path) -> Result<()> {
    if !fs::symlink_metadata(path)?.file_type().is_dir() {
        return Err("not-a-plain-directory".into());
    }
    Ok(())
}
fn checked_directory(root: &Path, relative: &str) -> Result<()> {
    require_directory(root)?;
    let mut path = root.to_path_buf();
    for component in relative.split('/') {
        path.push(component);
        require_directory(&path)?;
    }
    Ok(())
}
fn has_attention_record(dir: &Path) -> Result<bool> {
    Ok(fs::read_dir(dir)?
        .collect::<io::Result<Vec<_>>>()?
        .iter()
        .any(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("attention-")
        }))
}
fn safe_component(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}
fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}
fn validate_path(path: &str) -> Result<()> {
    // Flat, portable names for M0. Arbitrary Unicode/nested paths and capability traversal are M1.
    let name = path.strip_prefix("notes/").ok_or("invalid-note-path")?;
    let stem = name.strip_suffix(".md").ok_or("invalid-note-path")?;
    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if !safe_component(stem) || reserved.contains(&stem.to_ascii_uppercase().as_str()) {
        return Err("invalid-note-path".into());
    }
    Ok(())
}
fn validate_request(request: &SaveRequest) -> Result<()> {
    if !safe_component(&request.operation_id)
        || request.note_id.is_empty()
        || request.note_id.len() > 600
        || request.new_cards.len() > 99
    {
        return Err("invalid-save-request".into());
    }
    validate_path(&request.path)?;
    if request
        .expected_hash
        .as_ref()
        .is_some_and(|hash| !valid_hash(hash))
        || request
            .draft_id
            .as_ref()
            .is_some_and(|id| id.is_empty() || id.len() > 400)
    {
        return Err("invalid-save-request".into());
    }
    if request.draft_id.is_some() && request.expected_hash.is_some() {
        return Err("draft-confirmation-must-create-a-note".into());
    }
    let mut ids = std::collections::HashSet::new();
    let mut variants = std::collections::HashSet::new();
    for card in &request.new_cards {
        let cloze = card
            .variant
            .strip_prefix("cloze:")
            .and_then(|value| value.parse::<u8>().ok())
            .is_some_and(|number| {
                (1..=99).contains(&number) && card.variant == format!("cloze:{number}")
            });
        if card.id.is_empty()
            || card.id.len() > 600
            || !ids.insert(&card.id)
            || !variants.insert(&card.variant)
            || (!matches!(card.variant.as_str(), "forward" | "reverse") && !cloze)
            || card.state_json.len() > 64 * 1024
        {
            return Err("invalid-card-plan".into());
        }
        let _: serde_json::Value = serde_json::from_str(&card.state_json)?;
    }
    Ok(())
}
fn write_same_or_new(path: &Path, bytes: &[u8]) -> Result<()> {
    match files::write_new(path, bytes) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            if files::read_stable(path)? == bytes {
                Ok(())
            } else {
                Err("persistent-file-mismatch".into())
            }
        }
        Err(error) => Err(error.into()),
    }
}
fn read_optional(path: &Path) -> Result<Option<Vec<u8>>> {
    match files::read_stable(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}
fn need_attention(intent: &Intent, committed: bool, reason: &str) -> SaveOutcome {
    SaveOutcome::Attention {
        operation_id: intent.request.operation_id.clone(),
        committed: Some(committed),
        reason: reason.into(),
    }
}
fn lock_root(root: &Path) -> Result<File> {
    let mut options = FileOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    let file = options.open(root.join("prototype.lock"))?;
    if !file.metadata()?.is_file() {
        return Err("invalid-lock-file".into());
    }
    file.try_lock().map_err(|_| "prototype-already-open")?;
    Ok(file)
}
