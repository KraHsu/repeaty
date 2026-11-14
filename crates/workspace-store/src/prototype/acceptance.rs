//! Versioned DTO from the shared TypeScript Markdown validator. No second Markdown interpreter.
use super::*;
use std::collections::HashSet;

const MAX_ASSET: u64 = 10 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CardMapping {
    pub id: String,
    pub variant: String,
    pub lifecycle: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AssetSnapshot {
    pub id: String,
    pub path: String,
    pub hash: String,
    pub media_type: String,
    pub size: u64,
    pub name: String,
    pub created_at: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceSnapshot {
    pub source_id: String,
    pub revision_id: String,
    pub format: String,
    pub body_hash: String,
    pub size: u64,
    pub start: usize,
    pub end: usize,
    pub quote: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NoteAcceptance {
    pub version: u32,
    pub workspace_id: String,
    pub deck_id: String,
    pub note_type: String,
    pub raw_hash: String,
    pub revision: String,
    pub expected_revision: Option<String>,
    pub variants: Vec<String>,
    pub expected_cards: Vec<CardMapping>,
    pub assets: Vec<AssetSnapshot>,
    pub publish_assets: Vec<String>,
    pub source: Option<SourceSnapshot>,
    pub draft_hash: Option<String>,
}

pub(super) fn create_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE identity(singleton INTEGER PRIMARY KEY CHECK(singleton=1),workspace_id TEXT UNIQUE NOT NULL);
         CREATE TABLE decks(id TEXT PRIMARY KEY);
         CREATE TABLE note_versions(revision TEXT PRIMARY KEY, note_id TEXT NOT NULL REFERENCES notes(id), raw_hash TEXT NOT NULL, manifest TEXT NOT NULL);
         CREATE INDEX versions_by_note ON note_versions(note_id);
         CREATE TABLE asset_versions(id TEXT NOT NULL,hash TEXT NOT NULL,path TEXT NOT NULL,metadata TEXT NOT NULL,PRIMARY KEY(id,hash,path));
         CREATE INDEX assets_by_path ON asset_versions(lower(path),id);
         CREATE TABLE note_assets(revision TEXT NOT NULL REFERENCES note_versions(revision),id TEXT NOT NULL,hash TEXT NOT NULL,path TEXT NOT NULL,
           PRIMARY KEY(revision,id), FOREIGN KEY(id,hash,path) REFERENCES asset_versions(id,hash,path));
         CREATE TABLE source_revisions(revision TEXT PRIMARY KEY,source_id TEXT NOT NULL,body_hash TEXT NOT NULL,format TEXT NOT NULL);
         CREATE TABLE note_origins(revision TEXT PRIMARY KEY REFERENCES note_versions(revision),source_revision TEXT NOT NULL REFERENCES source_revisions(revision),start INTEGER NOT NULL,end INTEGER NOT NULL,quote TEXT NOT NULL,CHECK(start>=0 AND end>start));"
    )?;
    Ok(())
}

impl Prototype {
    pub fn workspace_id(&self) -> Result<String> {
        Ok(self
            .conn
            .query_row("SELECT workspace_id FROM identity", [], |row| row.get(0))?)
    }
    pub fn seed_deck_for_fixture(&self, id: &str) -> Result<()> {
        self.conn.execute("INSERT INTO decks VALUES(?1)", [id])?;
        Ok(())
    }
    pub fn domain_snapshot(&self, note_id: &str) -> Result<serde_json::Value> {
        let note: Option<(String, Option<String>)> = self
            .conn
            .query_row(
                "SELECT accepted_hash,accepted_revision FROM notes WHERE id=?1",
                [note_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let cards: Vec<serde_json::Value> = self.conn.prepare("SELECT id,variant,lifecycle,state_json,last_revision FROM cards WHERE note_id=?1 ORDER BY variant")?
            .query_map([note_id], |row| Ok(serde_json::json!({"id":row.get::<_,String>(0)?,"variant":row.get::<_,String>(1)?,"lifecycle":row.get::<_,String>(2)?,"state_json":row.get::<_,String>(3)?,"last_revision":row.get::<_,Option<String>>(4)?})))?
            .collect::<rusqlite::Result<_>>()?;
        let changes: i64 = self
            .conn
            .query_row("SELECT count(*) FROM changes", [], |row| row.get(0))?;
        let drafts: Vec<serde_json::Value> = self.conn.prepare("SELECT id,payload,consumed_by FROM drafts ORDER BY id")?
            .query_map([], |row| Ok(serde_json::json!({"id":row.get::<_,String>(0)?,"payload":row.get::<_,String>(1)?,"consumed_by":row.get::<_,Option<String>>(2)?})))?.collect::<rusqlite::Result<_>>()?;
        let versions: i64 = self.conn.query_row(
            "SELECT count(*) FROM note_versions WHERE note_id=?1",
            [note_id],
            |row| row.get(0),
        )?;
        Ok(
            serde_json::json!({"workspace_id":self.workspace_id()? ,"raw_hash":note.as_ref().map(|item| &item.0),"revision":note.as_ref().and_then(|item| item.1.as_ref()),"cards":cards,"changes":changes,"drafts":drafts,"versions":versions}),
        )
    }
}

pub(super) fn validate_plan(proto: &Prototype, request: &SaveRequest, bytes: &[u8]) -> Result<()> {
    let Some(a) = &request.acceptance else {
        return Ok(());
    };
    if a.version != 1
        || a.workspace_id != proto.workspace_id()?
        || a.raw_hash != files::digest(bytes)
        || !valid_hash(&a.revision)
        || a.variants.is_empty()
        || a.variants.len() > 99
    {
        return Err("invalid-acceptance-manifest".into());
    }
    if a.expected_revision
        .as_ref()
        .is_some_and(|hash| !valid_hash(hash))
        || a.expected_revision.is_some() != request.expected_hash.is_some()
    {
        return Err("invalid-accepted-version-baseline".into());
    }
    if a.draft_hash.is_some() != request.draft_id.is_some()
        || a.draft_hash.as_ref().is_some_and(|hash| !valid_hash(hash))
    {
        return Err("invalid-draft-baseline".into());
    }
    let expected_shape = match a.note_type.as_str() {
        "basic" | "plugin" => a.variants == ["forward"],
        "reversed" => a.variants == ["forward", "reverse"],
        "cloze" => a.variants.iter().all(|variant| {
            variant
                .strip_prefix("cloze:")
                .and_then(|v| v.parse::<u8>().ok())
                .is_some_and(|number| {
                    (1..=99).contains(&number) && *variant == format!("cloze:{number}")
                })
        }),
        _ => false,
    };
    let desired: HashSet<_> = a.variants.iter().collect();
    let known: HashSet<_> = a.expected_cards.iter().map(|card| &card.variant).collect();
    if !expected_shape
        || desired.len() != a.variants.len()
        || known.len() != a.expected_cards.len()
        || a.expected_cards
            .iter()
            .any(|card| !matches!(card.lifecycle.as_str(), "active" | "retired"))
        || a.expected_cards
            .iter()
            .map(|card| &card.id)
            .collect::<HashSet<_>>()
            .len()
            != a.expected_cards.len()
    {
        return Err("invalid-lifecycle-plan".into());
    }
    let new: HashSet<_> = request.new_cards.iter().map(|card| &card.variant).collect();
    if new != desired.difference(&known).copied().collect() {
        return Err("new-card-plan-mismatch".into());
    }
    for card in &request.new_cards {
        let state: serde_json::Value = serde_json::from_str(&card.state_json)?;
        if state["id"] != card.id
            || state["noteId"] != request.note_id
            || state["variant"] != card.variant
            || !state["schedule"].is_object()
        {
            return Err("new-card-state-identity-mismatch".into());
        }
    }
    if a.assets.len() > 64
        || a.assets
            .iter()
            .fold(0_u64, |sum, asset| sum.saturating_add(asset.size))
            > 128 * 1024 * 1024
    {
        return Err("media-bundle-too-large".into());
    }
    let mut ids = HashSet::new();
    let mut paths = HashSet::new();
    for asset in &a.assets {
        validate_asset_path(&asset.path)?;
        if asset.id.is_empty()
            || asset.id.len() > 600
            || !ids.insert(&asset.id)
            || !paths.insert(asset.path.to_lowercase())
            || !valid_hash(&asset.hash)
            || asset.size == 0
            || asset.size > MAX_ASSET
            || !matches!(
                asset.media_type.as_str(),
                "image/png"
                    | "image/jpeg"
                    | "image/webp"
                    | "image/gif"
                    | "audio/mpeg"
                    | "audio/wav"
                    | "audio/x-wav"
                    | "audio/ogg"
                    | "audio/mp4"
                    | "audio/webm"
                    | "audio/flac"
                    | "audio/aac"
            )
            || asset.name.len() > 2000
            || asset.created_at.len() > 100
        {
            return Err("invalid-asset-manifest".into());
        }
    }
    if a.assets.windows(2).any(|pair| {
        pair[0].id.encode_utf16().cmp(pair[1].id.encode_utf16()) != std::cmp::Ordering::Less
    }) || a.publish_assets.iter().any(|id| !ids.contains(id))
        || a.publish_assets.iter().collect::<HashSet<_>>().len() != a.publish_assets.len()
    {
        return Err("invalid-media-publication-plan".into());
    }
    let assets: Vec<_> = a
        .assets
        .iter()
        .map(|asset| {
            (
                &asset.id,
                &asset.path,
                &asset.hash,
                &asset.media_type,
                asset.size,
            )
        })
        .collect();
    let revision = files::digest(&serde_json::to_vec(&(
        1,
        &request.note_id,
        &a.raw_hash,
        assets,
    ))?);
    if a.revision != revision {
        return Err("accepted-revision-mismatch".into());
    }
    if let Some(source) = &a.source
        && (source.source_id.is_empty()
            || source.source_id.len() > 400
            || !valid_hash(&source.body_hash)
            || source.size > 1024 * 1024
            || source.start >= source.end
            || source.end > 250_000
            || source.end - source.start > 10_000
            || !matches!(source.format.as_str(), "plain" | "markdown"))
    {
        return Err("invalid-source-proof".into());
    }
    Ok(())
}

pub(super) fn validate_baseline(conn: &Connection, request: &SaveRequest) -> Result<()> {
    let revision: Option<Option<String>> = conn
        .query_row(
            "SELECT accepted_revision FROM notes WHERE id=?1",
            [&request.note_id],
            |row| row.get(0),
        )
        .optional()?;
    let Some(a) = &request.acceptance else {
        if revision.flatten().is_some() {
            return Err("validated-note-requires-manifest".into());
        }
        return Ok(());
    };
    if revision.flatten() != a.expected_revision {
        return Err("accepted-revision-changed".into());
    }
    if !conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM decks WHERE id=?1)",
        [&a.deck_id],
        |row| row.get::<_, bool>(0),
    )? {
        return Err("unknown-deck".into());
    }
    for asset in &a.assets {
        if conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM asset_versions WHERE lower(path)=lower(?1) AND id!=?2)",
            params![asset.path, asset.id],
            |row| row.get::<_, bool>(0),
        )? {
            return Err("asset-path-identity-conflict".into());
        }
    }
    let actual: Vec<CardMapping> = conn
        .prepare("SELECT id,variant,lifecycle FROM cards WHERE note_id=?1")?
        .query_map([&request.note_id], |row| {
            Ok(CardMapping {
                id: row.get(0)?,
                variant: row.get(1)?,
                lifecycle: row.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    if actual.len() != a.expected_cards.len()
        || actual.iter().any(|card| !a.expected_cards.contains(card))
    {
        return Err("card-mapping-baseline-changed".into());
    }
    if let Some(id) = &request.draft_id {
        let payload: String =
            conn.query_row("SELECT payload FROM drafts WHERE id=?1", [id], |row| {
                row.get(0)
            })?;
        if a.draft_hash.as_deref() != Some(files::digest(payload.as_bytes()).as_str()) {
            return Err("draft-content-changed".into());
        }
        let draft: serde_json::Value = serde_json::from_str(&payload)?;
        if draft["workspace_id"] != a.workspace_id || draft["id"] != *id {
            return Err("draft-workspace-mismatch".into());
        }
        let note_id = format!(
            "note-{}",
            files::digest(&serde_json::to_vec(&(&a.workspace_id, "draft", id))?)
        );
        if request.note_id != note_id {
            return Err("draft-confirmation-identity-mismatch".into());
        }
    }
    Ok(())
}

fn object_bytes(proto: &Prototype, hash: &str, size: u64) -> Result<Vec<u8>> {
    let bytes = files::read_stable_with_limit(&proto.object_path(hash)?, MAX_ASSET)?;
    if bytes.len() as u64 != size || files::digest(&bytes) != hash {
        return Err("dependency-object-mismatch".into());
    }
    Ok(bytes)
}
fn store_blob(proto: &Prototype, hash: &str, size: u64, bytes: &[u8]) -> Result<()> {
    if bytes.len() as u64 != size || size > MAX_ASSET || files::digest(bytes) != hash {
        return Err("dependency-object-mismatch".into());
    }
    let path = proto.object_path(hash)?;
    match files::write_new(&path, bytes) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            object_bytes(proto, hash, size)?;
            Ok(())
        }
        Err(error) => Err(error.into()),
    }
}
fn check_source(source: &SourceSnapshot, bytes: &[u8]) -> Result<()> {
    let body = std::str::from_utf8(bytes)?;
    let revision = format!(
        "sha256:{}",
        files::digest(&serde_json::to_vec(&(
            1,
            &source.source_id,
            &source.format,
            body
        ))?)
    );
    let utf16: Vec<_> = body.encode_utf16().collect();
    if source.revision_id != revision
        || source.end > utf16.len()
        || String::from_utf16(&utf16[source.start..source.end])? != source.quote
    {
        return Err("source-quote-mismatch".into());
    }
    Ok(())
}
pub(super) fn prepare_objects(
    proto: &Prototype,
    request: &SaveRequest,
    reader: &mut impl FnMut(&str) -> Result<Vec<u8>>,
) -> Result<()> {
    let Some(a) = &request.acceptance else {
        return Ok(());
    };
    for asset in &a.assets {
        let bytes = if a.publish_assets.contains(&asset.id) {
            if proto.object_path(&asset.hash)?.exists() {
                object_bytes(proto, &asset.hash, asset.size)?
            } else {
                reader(&asset.hash)?
            }
        } else {
            files::read_stable_with_limit(&asset_path(proto, &asset.path)?, MAX_ASSET)?
        };
        store_blob(proto, &asset.hash, asset.size, &bytes)?;
    }
    if let Some(source) = &a.source {
        let bytes = if proto.object_path(&source.body_hash)?.exists() {
            object_bytes(proto, &source.body_hash, source.size)?
        } else {
            reader(&source.body_hash)?
        };
        store_blob(proto, &source.body_hash, source.size, &bytes)?;
        check_source(source, &bytes)?;
    }
    Ok(())
}

pub(super) fn publish_assets(
    proto: &Prototype,
    request: &SaveRequest,
    checkpoint: &mut impl FnMut(Checkpoint) -> Result<()>,
) -> Result<Option<&'static str>> {
    let Some(a) = &request.acceptance else {
        return Ok(None);
    };
    for (index, asset) in a.assets.iter().enumerate() {
        let target = asset_path(proto, &asset.path)?;
        match files::read_stable_with_limit(&target, MAX_ASSET) {
            Ok(bytes) => {
                if files::digest(&bytes) != asset.hash {
                    return Ok(Some("working-media-changed"));
                }
            }
            Err(error)
                if error.kind() == io::ErrorKind::NotFound
                    && a.publish_assets.contains(&asset.id) =>
            {
                let bytes = object_bytes(proto, &asset.hash, asset.size)?;
                let slot = proto
                    .operation_dir(&request.operation_id)?
                    .join(format!("asset-{index}.slot"));
                match files::write_new(&slot, &bytes) {
                    Ok(()) => {}
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                        if files::read_stable_with_limit(&slot, MAX_ASSET)? != bytes {
                            return Err("asset-slot-mismatch".into());
                        }
                    }
                    Err(error) => return Err(error.into()),
                }
                if atomic::publish_new(&slot, &target).is_err() {
                    return Ok(Some("asset-publication-conflict"));
                }
                files::sync_regular_file(&target)?;
                files::sync_directory(target.parent().ok_or("missing-asset-parent")?)?;
                files::sync_directory(slot.parent().ok_or("missing-slot-parent")?)?;
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Ok(Some("working-media-missing"));
            }
            Err(error) => return Err(error.into()),
        }
        checkpoint(Checkpoint::AssetPublished(index))?;
    }
    Ok(None)
}

pub(super) fn verify_dependencies(
    proto: &Prototype,
    request: &SaveRequest,
    working: bool,
) -> Result<Option<&'static str>> {
    let Some(a) = &request.acceptance else {
        return Ok(None);
    };
    for asset in &a.assets {
        object_bytes(proto, &asset.hash, asset.size)?;
        if working {
            match files::read_stable_with_limit(&asset_path(proto, &asset.path)?, MAX_ASSET) {
                Ok(bytes) if files::digest(&bytes) == asset.hash => {}
                Ok(bytes) => {
                    let hash = files::digest(&bytes);
                    store_blob(proto, &hash, bytes.len() as u64, &bytes)?;
                    return Ok(Some("working-media-changed"));
                }
                Err(error) if error.kind() == io::ErrorKind::NotFound => {
                    return Ok(Some("working-media-missing"));
                }
                Err(error) => return Err(error.into()),
            }
        }
    }
    if let Some(source) = &a.source {
        check_source(
            source,
            &object_bytes(proto, &source.body_hash, source.size)?,
        )?;
    }
    Ok(None)
}

pub(super) fn commit_domain(conn: &Connection, request: &SaveRequest) -> Result<()> {
    let Some(a) = &request.acceptance else {
        return Ok(());
    };
    let manifest = serde_json::to_string(a)?;
    conn.execute(
        "INSERT OR IGNORE INTO note_versions VALUES(?1,?2,?3,?4)",
        params![a.revision, request.note_id, a.raw_hash, manifest],
    )?;
    // The same immutable version may be revisited. Its original snapshot, not its old baseline, stays.
    let existing: (String, String) = conn.query_row(
        "SELECT note_id,raw_hash FROM note_versions WHERE revision=?1",
        [&a.revision],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    if existing != (request.note_id.clone(), a.raw_hash.clone()) {
        return Err("version-identity-collision".into());
    }
    for asset in &a.assets {
        let metadata = serde_json::to_string(asset)?;
        conn.execute(
            "INSERT OR IGNORE INTO asset_versions VALUES(?1,?2,?3,?4)",
            params![asset.id, asset.hash, asset.path, metadata],
        )?;
        let stored: String = conn.query_row(
            "SELECT metadata FROM asset_versions WHERE id=?1 AND hash=?2 AND path=?3",
            params![asset.id, asset.hash, asset.path],
            |row| row.get(0),
        )?;
        if stored != metadata {
            return Err("asset-version-metadata-conflict".into());
        }
        conn.execute(
            "INSERT OR IGNORE INTO note_assets VALUES(?1,?2,?3,?4)",
            params![a.revision, asset.id, asset.hash, asset.path],
        )?;
    }
    if let Some(source) = &a.source {
        conn.execute(
            "INSERT OR IGNORE INTO source_revisions VALUES(?1,?2,?3,?4)",
            params![
                source.revision_id,
                source.source_id,
                source.body_hash,
                source.format
            ],
        )?;
        conn.execute(
            "INSERT OR IGNORE INTO note_origins VALUES(?1,?2,?3,?4,?5)",
            params![
                a.revision,
                source.revision_id,
                i64::try_from(source.start)?,
                i64::try_from(source.end)?,
                source.quote
            ],
        )?;
    }
    conn.execute(
        "UPDATE cards SET lifecycle='retired' WHERE note_id=?1",
        [&request.note_id],
    )?;
    for variant in &a.variants {
        if conn.execute(
            "UPDATE cards SET lifecycle='active',last_revision=?1 WHERE note_id=?2 AND variant=?3",
            params![a.revision, request.note_id, variant],
        )? != 1
        {
            return Err("missing-card-variant".into());
        }
    }
    conn.execute(
        "UPDATE notes SET accepted_revision=?1 WHERE id=?2",
        params![a.revision, request.note_id],
    )?;
    Ok(())
}

fn validate_asset_path(path: &str) -> Result<()> {
    let name = path.strip_prefix("assets/").ok_or("invalid-asset-path")?;
    let (stem, ext) = name.rsplit_once('.').ok_or("invalid-asset-path")?;
    validate_path(&format!("notes/{stem}.md"))?;
    if !matches!(
        ext,
        "png"
            | "jpg"
            | "jpeg"
            | "webp"
            | "gif"
            | "mp3"
            | "wav"
            | "ogg"
            | "m4a"
            | "webm"
            | "flac"
            | "aac"
    ) {
        return Err("invalid-asset-extension".into());
    }
    Ok(())
}
fn asset_path(proto: &Prototype, path: &str) -> Result<PathBuf> {
    validate_asset_path(path)?;
    checked_directory(&proto.root, "assets")?;
    Ok(proto.root.join(path))
}
