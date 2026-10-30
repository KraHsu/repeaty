//! Full retired exports are explicit. Triggers record only changed retirement rows,
//! so ordinary grading never reads full attempts or scans the retirement archive.
use crate::error::{Error, Result};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::collections::{BTreeMap, BTreeSet};

const TABLES: &[(&str, &[&str])] = &[
    ("retired_notes", &["id", "data", "retired_at"]),
    (
        "retired_cards",
        &["id", "note_id", "variant", "data", "retired_at"],
    ),
    (
        "retired_records",
        &["store", "id", "card_id", "position", "data"],
    ),
    ("retired_media", &["id", "data"]),
    ("retired_documents", &["id", "path", "hash"]),
];
fn expression(columns: &[&str], prefix: &str) -> String {
    format!(
        "json_object({})",
        columns
            .iter()
            .map(|column| format!("'{column}',{prefix}{column}"))
            .collect::<Vec<_>>()
            .join(",")
    )
}
fn key(table: &str, prefix: &str) -> String {
    if table == "retired_records" {
        format!("json_array({prefix}store,{prefix}id)")
    } else {
        format!("{prefix}id")
    }
}
pub fn history_schema(db: &Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS retired_history(revision INTEGER NOT NULL,table_name TEXT NOT NULL,id TEXT NOT NULL,data TEXT,PRIMARY KEY(revision,table_name,id));
        CREATE TABLE IF NOT EXISTS retired_history_baseline(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL);
        INSERT OR IGNORE INTO retired_history_baseline SELECT 1,revision FROM workspace WHERE id=1;")?;
    for (table, columns) in TABLES {
        let exists: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
            [table],
            |row| row.get(0),
        )?;
        if !exists {
            continue;
        }
        for event in ["INSERT", "UPDATE", "DELETE"] {
            let prefix = if event == "INSERT" { "NEW." } else { "OLD." };
            let id = key(table, prefix);
            let data = if event == "INSERT" {
                format!(
                    "(SELECT {} FROM {table} WHERE {}={id})",
                    expression(columns, ""),
                    key(table, "")
                )
            } else {
                expression(columns, "OLD.")
            };
            // Outer UPSERT conflict policies can override a trigger's OR IGNORE.
            // Avoid a duplicate insert entirely when several cards share one note.
            db.execute_batch(&format!("CREATE TRIGGER IF NOT EXISTS {table}_history_{event} BEFORE {event} ON {table} BEGIN
                INSERT INTO retired_history SELECT revision+1,'{table}',{id},{data} FROM workspace WHERE workspace.id=1
                AND NOT EXISTS(SELECT 1 FROM retired_history h WHERE h.revision=workspace.revision+1 AND h.table_name='{table}' AND h.id={id}); END;"))?;
        }
    }
    Ok(())
}

fn rows(db: &Connection, table: &str, columns: &[&str]) -> Result<BTreeMap<String, Value>> {
    let mut statement = db.prepare(&format!(
        "SELECT {},{} FROM {table}",
        key(table, ""),
        expression(columns, "")
    ))?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(|(id, raw)| Ok((id, serde_json::from_str(&raw)?)))
        .collect()
}
fn body(row: &Value) -> Result<Value> {
    Ok(serde_json::from_str(
        row["data"].as_str().ok_or_else(Error::invalid)?,
    )?)
}
pub fn validate(
    tx: &Transaction<'_>,
    entries: &[Value],
    validators: &HashMap<String, jsonschema::Validator>,
) -> Result<()> {
    if entries.len() > 100_000 {
        return Err(Error::invalid());
    }
    let mut ids: BTreeMap<&str, BTreeMap<String, &Value>> = BTreeMap::new();
    let mut groups = BTreeSet::new();
    for entry in entries {
        if entry["revision"].as_u64().is_none() {
            return Err(Error::invalid());
        }
        let note = &entry["note"];
        let cards = entry["cards"].as_array().ok_or_else(Error::invalid)?;
        let group = note["id"]
            .as_str()
            .or_else(|| cards.first().and_then(|card| card["noteId"].as_str()))
            .ok_or_else(Error::invalid)?;
        if !groups.insert(group.to_owned()) {
            return Err(Error::invalid());
        }
        if note.is_null() {
            if !tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM notes WHERE id=?1)",
                [group],
                |row| row.get::<_, bool>(0),
            )? {
                return Err(Error::invalid());
            }
        } else if !validators["notes"].is_valid(note) {
            return Err(Error::invalid());
        }
        for store in [
            "notes",
            "cards",
            "reviews",
            "practices",
            "attempts",
            "media",
        ] {
            let rows: Vec<&Value> = if store == "notes" {
                if note.is_null() { vec![] } else { vec![note] }
            } else {
                entry[store]
                    .as_array()
                    .ok_or_else(Error::invalid)?
                    .iter()
                    .collect()
            };
            let known = ids.entry(store).or_default();
            for row in rows {
                if !validators[store].is_valid(row) {
                    return Err(Error::invalid());
                }
                let id = row["id"].as_str().ok_or_else(Error::invalid)?;
                if let Some(previous) = known.insert(id.into(), row)
                    && (store != "media" || previous != row)
                {
                    return Err(Error::invalid());
                }
                let active: Option<String> = tx
                    .query_row(
                        &format!("SELECT data FROM {store} WHERE id=?1"),
                        [id],
                        |row| row.get(0),
                    )
                    .optional()?;
                if active.as_ref().is_some_and(|raw| {
                    store != "notes"
                        && (store != "media"
                            || serde_json::from_str::<Value>(raw).ok().as_ref() != Some(row))
                }) {
                    return Err(Error::invalid());
                }
                if store == "cards" && row["noteId"] != group {
                    return Err(Error::invalid());
                }
                if store == "notes" {
                    crate::materials::plugin(&row["plugin"])?;
                }
                if store == "practices" {
                    crate::materials::plugin(&row["question"]["plugin"])?;
                }
                if store == "media" && (row["size"].as_u64().unwrap_or(u64::MAX) > crate::records::media_limit(row["type"].as_str().unwrap_or("")) as u64
                        || !tx.query_row("SELECT EXISTS(SELECT 1 FROM assets WHERE id=?1 AND mime=?2 AND size=?3)", params![id,row["type"].as_str(),row["size"].as_i64()], |row| row.get::<_,bool>(0))?) {
                    return Err(Error::invalid());
                }
            }
            let limit = match store {
                "notes" | "practices" => 100_000,
                "cards" => 200_000,
                "media" => 1_600_000,
                _ => 500_000,
            };
            if known.len() > limit {
                return Err(Error::invalid());
            }
        }
        let card_ids: BTreeSet<_> = cards.iter().filter_map(|row| row["id"].as_str()).collect();
        let variants: BTreeSet<_> = cards
            .iter()
            .filter_map(|row| row["variant"].as_str())
            .collect();
        if variants.len() != cards.len() {
            return Err(Error::invalid());
        }
        let practice_ids: BTreeSet<_> = entry["practices"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|row| row["id"].as_str())
            .collect();
        for store in ["reviews", "practices"] {
            if entry[store]
                .as_array()
                .into_iter()
                .flatten()
                .any(|row| !card_ids.contains(row["cardId"].as_str().unwrap_or("")))
            {
                return Err(Error::invalid());
            }
        }
        if entry["attempts"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|row| !practice_ids.contains(row["practiceId"].as_str().unwrap_or("")))
        {
            return Err(Error::invalid());
        }
        let document = &entry["document"];
        if !document.is_null() {
            let raw = document["raw"].as_str().ok_or_else(Error::invalid)?;
            let path = document["path"].as_str().ok_or_else(Error::invalid)?;
            if note.is_null()
                || document["id"] != group
                || document["kind"] != "note"
                || !path.starts_with("notes/")
                || path.contains(['\\', ':'])
                || path
                    .split('/')
                    .any(|p| p.is_empty() || p == "." || p == "..")
                || raw.len() as u64 > crate::files::MAX_TEXT_BYTES
                || crate::files::digest(raw.as_bytes()) != document["hash"]
            {
                return Err(Error::invalid());
            }
        }
    }
    let empty = BTreeMap::new();
    let cards = ids.get("cards").unwrap_or(&empty);
    let reviews = ids.get("reviews").unwrap_or(&empty);
    let practices = ids.get("practices").unwrap_or(&empty);
    for row in reviews.values() {
        let card = row["cardId"].as_str().ok_or_else(Error::invalid)?;
        if !cards.contains_key(card)
            || row["practiceId"].as_str().is_some_and(|id| {
                practices
                    .get(id)
                    .is_none_or(|practice| practice["cardId"] != card)
            })
        {
            return Err(Error::invalid());
        }
    }
    for row in practices.values() {
        if !cards.contains_key(row["cardId"].as_str().unwrap_or("")) {
            return Err(Error::invalid());
        }
        if let Some(id) = row["reviewId"].as_str()
            && reviews.get(id).is_none_or(|review| {
                review["practiceId"] != row["id"]
                    || review["cardId"] != row["cardId"]
                    || review["rating"] != row["rating"]
            })
        {
            return Err(Error::invalid());
        }
    }
    for row in ids.get("attempts").unwrap_or(&empty).values() {
        if !practices.contains_key(row["practiceId"].as_str().unwrap_or("")) {
            return Err(Error::invalid());
        }
        let status = row["status"].as_str().unwrap_or("");
        if (matches!(status, "pending" | "completed") && !row["submissionId"].is_string())
            || (status == "completed") != row["result"].is_object()
        {
            return Err(Error::invalid());
        }
    }
    for note in ids.get("notes").unwrap_or(&empty).values() {
        for field in ["frontMedia", "backMedia"] {
            for id in note[field]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
            {
                let valid = if let Some(media) = ids.get("media").and_then(|items| items.get(id)) {
                    media["type"].as_str().is_some_and(|mime| {
                        mime.starts_with("image/") || mime.starts_with("audio/")
                    })
                } else {
                    tx.query_row("SELECT EXISTS(SELECT 1 FROM media WHERE id=?1 AND (json_extract(data,'$.type') LIKE 'image/%' OR json_extract(data,'$.type') LIKE 'audio/%'))", [id], |row| row.get::<_,bool>(0))?
                };
                if !valid {
                    return Err(Error::invalid());
                }
            }
        }
        for reference in note["inlineMedia"].as_array().into_iter().flatten() {
            if !tx.query_row("SELECT EXISTS(SELECT 1 FROM assets WHERE id=?1 AND substr(path,1,64)=?2 AND (mime LIKE 'image/%' OR mime LIKE 'audio/%'))",params![reference["mediaId"].as_str(),reference["hash"].as_str()],|row|row.get::<_,bool>(0))? { return Err(Error::invalid()); }
        }
        if let Some(excerpt) = note.get("excerpt") {
            let raw: String = tx
                .query_row(
                    "SELECT data FROM sources WHERE id=?1",
                    [excerpt["sourceId"].as_str().unwrap_or("")],
                    |row| row.get(0),
                )
                .map_err(|_| Error::invalid())?;
            let source: Value = serde_json::from_str(&raw)?;
            let media_id = excerpt["mediaId"]
                .as_str()
                .or_else(|| {
                    source["versions"]
                        .as_array()
                        .and_then(|versions| versions.first())
                        .and_then(|version| version["mediaId"].as_str())
                })
                .or_else(|| source["mediaId"].as_str())
                .ok_or_else(Error::invalid)?;
            let snapshot = std::iter::once(&source)
                .chain(source["versions"].as_array().into_iter().flatten())
                .find(|snapshot| snapshot["mediaId"] == media_id)
                .ok_or_else(Error::invalid)?;
            let bytes: Vec<u8> = tx.query_row(
                "SELECT asset_bytes(path) FROM assets WHERE id=?1",
                [snapshot["mediaId"].as_str().unwrap_or("")],
                |row| row.get(0),
            )?;
            let text: Vec<u16> = std::str::from_utf8(&bytes)
                .map_err(|_| Error::invalid())?
                .encode_utf16()
                .collect();
            let quote: Vec<u16> = excerpt["quote"]
                .as_str()
                .unwrap_or("")
                .encode_utf16()
                .collect();
            if text.get(
                excerpt["start"].as_u64().unwrap_or(u64::MAX) as usize
                    ..excerpt["end"].as_u64().unwrap_or(0) as usize,
            ) != Some(quote.as_slice())
            {
                return Err(Error::invalid());
            }
            let mut bound_reference = excerpt.clone();
            bound_reference["mediaId"] = json!(media_id);
            crate::materials::reference(snapshot, &bound_reference, &text)?;
            for locator in note["plugin"]["variantLocators"]
                .as_object()
                .into_iter()
                .flat_map(|map| map.values())
            {
                let mut reference = bound_reference.clone();
                reference["locator"] = locator.clone();
                crate::materials::reference(snapshot, &reference, &text)?;
            }
        } else if note["plugin"]["variantLocators"]
            .as_object()
            .is_some_and(|map| !map.is_empty())
        {
            return Err(Error::invalid());
        }
    }
    Ok(())
}
pub fn export(db: &Connection, revision: i64, backup_id: Option<&str>) -> Result<Vec<Value>> {
    let current: i64 = db.query_row("SELECT revision FROM workspace WHERE id=1", [], |row| {
        row.get(0)
    })?;
    if revision != current {
        return Err(Error::conflict());
    }
    let target = if let Some(id) = backup_id {
        db.query_row(
            "SELECT revision FROM checkpoints WHERE id=?1",
            [id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .ok_or_else(Error::missing)?
    } else {
        current
    };
    let baseline: i64 = db.query_row(
        "SELECT revision FROM retired_history_baseline WHERE id=1",
        [],
        |row| row.get(0),
    )?;
    if target < baseline {
        return Err(Error("retired-history-unavailable"));
    }
    let mut tables = BTreeMap::new();
    for (table, columns) in TABLES {
        tables.insert(*table, rows(db, table, columns)?);
    }
    if target < current {
        let mut statement = db.prepare("SELECT table_name,id,data FROM retired_history WHERE revision>?1 ORDER BY revision DESC")?;
        let changes = statement.query_map([target], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })?;
        for change in changes {
            let (table, id, data) = change?;
            let entries = tables.get_mut(table.as_str()).ok_or_else(Error::invalid)?;
            if let Some(raw) = data {
                entries.insert(id, serde_json::from_str(&raw)?);
            } else {
                entries.remove(&id);
            }
        }
    }
    let mut ids: BTreeSet<String> = tables["retired_notes"].keys().cloned().collect();
    for card in tables["retired_cards"].values() {
        ids.insert(card["note_id"].as_str().ok_or_else(Error::invalid)?.into());
    }
    let mut result = Vec::new();
    for id in ids {
        let note = tables["retired_notes"]
            .get(&id)
            .map(body)
            .transpose()?
            .unwrap_or(Value::Null);
        let cards: Vec<_> = tables["retired_cards"]
            .values()
            .filter(|row| row["note_id"] == id)
            .map(body)
            .collect::<Result<_>>()?;
        let card_ids: BTreeSet<_> = cards
            .iter()
            .filter_map(|card| card["id"].as_str())
            .collect();
        let document = tables["retired_documents"]
            .get(&id)
            .map(|row| json!({"id":id,"kind":"note","path":row["path"],"hash":row["hash"]}))
            .unwrap_or(Value::Null);
        let mut value = json!({"revision":current,"note":note,"document":document,"cards":cards});
        for store in ["reviews", "practices", "attempts"] {
            let mut entries: Vec<_> = tables["retired_records"]
                .values()
                .filter(|row| {
                    row["store"] == store
                        && row["card_id"]
                            .as_str()
                            .is_some_and(|id| card_ids.contains(id))
                })
                .collect();
            entries.sort_by_key(|row| {
                (
                    row["position"].as_i64().unwrap_or(0),
                    row["id"].as_str().unwrap_or(""),
                )
            });
            value[store] = json!(entries.into_iter().map(body).collect::<Result<Vec<_>>>()?);
        }
        let mut media_ids = BTreeSet::new();
        for key in ["frontMedia", "backMedia"] {
            for id in note[key]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
            {
                media_ids.insert(id);
            }
        }
        for entry in note["inlineMedia"].as_array().into_iter().flatten() {
            if let Some(id) = entry["mediaId"].as_str() {
                media_ids.insert(id);
            }
        }
        value["media"] = json!(
            tables["retired_media"]
                .iter()
                .filter(|(id, _)| media_ids.contains(id.as_str()))
                .map(|(_, row)| body(row))
                .collect::<Result<Vec<_>>>()?
        );
        result.push(value);
    }
    Ok(result)
}

/// Structural and cross-record validation is performed by Database before this replacement.
pub fn replace(tx: &Transaction<'_>, entries: &[Value]) -> Result<()> {
    for (table, _) in TABLES {
        tx.execute(&format!("DELETE FROM {table}"), [])?;
    }
    let retired_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    for entry in entries {
        let note = &entry["note"];
        if !note.is_null() {
            tx.execute(
                "INSERT INTO retired_notes VALUES(?1,?2,?3)",
                params![note["id"].as_str(), note.to_string(), retired_at],
            )?;
        }
        let document = &entry["document"];
        if !document.is_null() {
            tx.execute(
                "INSERT INTO retired_documents VALUES(?1,?2,?3)",
                params![
                    document["id"].as_str(),
                    document["path"].as_str(),
                    document["hash"].as_str()
                ],
            )?;
        }
        let mut practices = BTreeMap::new();
        for practice in entry["practices"].as_array().into_iter().flatten() {
            practices.insert(
                practice["id"].as_str().unwrap_or(""),
                practice["cardId"].as_str().unwrap_or(""),
            );
        }
        for card in entry["cards"].as_array().into_iter().flatten() {
            tx.execute(
                "INSERT INTO retired_cards VALUES(?1,?2,?3,?4,?5)",
                params![
                    card["id"].as_str(),
                    card["noteId"].as_str(),
                    card["variant"].as_str(),
                    card.to_string(),
                    retired_at
                ],
            )?;
        }
        for store in ["reviews", "practices", "attempts"] {
            for (position, row) in entry[store].as_array().into_iter().flatten().enumerate() {
                let card = if store == "attempts" {
                    practices
                        .get(row["practiceId"].as_str().unwrap_or(""))
                        .copied()
                } else {
                    row["cardId"].as_str()
                }
                .ok_or_else(Error::invalid)?;
                tx.execute(
                    "INSERT INTO retired_records VALUES(?1,?2,?3,?4,?5)",
                    params![
                        store,
                        row["id"].as_str(),
                        card,
                        position as i64,
                        row.to_string()
                    ],
                )?;
            }
        }
        for media in entry["media"].as_array().into_iter().flatten() {
            tx.execute("INSERT INTO retired_media VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data", params![media["id"].as_str(),media.to_string()])?;
        }
    }
    Ok(())
}
