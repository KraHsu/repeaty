//! Cross-record material invariants supplement the exported structural JSON schemas.
use crate::error::{Error, Result};
use rusqlite::{OptionalExtension, Transaction};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

pub(crate) fn document(tx: &Transaction<'_>, snapshot: &Value) -> Result<()> {
    let value = &snapshot["document"];
    if value.is_null() {
        return Ok(());
    }
    let mime: Option<String> = tx
        .query_row(
            "SELECT json_extract(data,'$.type') FROM media WHERE id=?1",
            [value["originalMediaId"].as_str().unwrap_or("")],
            |row| row.get(0),
        )
        .optional()?;
    let Some(mime) = mime else {
        return Err(Error::invalid());
    };
    let valid = match value["format"].as_str().unwrap_or("") {
        "pdf" => mime == "application/pdf",
        "epub" => mime == "application/epub+zip",
        "image" => mime.starts_with("image/"),
        "html" => mime == "text/html",
        _ => true,
    };
    if !valid
        || value["path"]
            .as_str()
            .is_some_and(|path| !material_path(path))
        || value
            .get("data")
            .is_some_and(|data| data.to_string().len() > 16 * 1024)
    {
        return Err(Error::invalid());
    }
    let mut paths = HashSet::new();
    for resource in value["resources"].as_array().into_iter().flatten() {
        let path = resource["path"].as_str().ok_or_else(Error::invalid)?;
        if !material_path(path)
            || !paths.insert(path)
            || !tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM media WHERE id=?1)",
                [resource["mediaId"].as_str().unwrap_or("")],
                |row| row.get::<_, bool>(0),
            )?
        {
            return Err(Error::invalid());
        }
    }
    Ok(())
}
pub(crate) fn material_path(path: &str) -> bool {
    !path.is_empty()
        && path.encode_utf16().count() <= 2048
        && !path.contains(['\\', ':'])
        && !path.chars().any(|c| c <= '\u{1f}')
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

fn region(value: &Value) -> bool {
    let x = value["x"].as_f64().unwrap_or(-1.0);
    let y = value["y"].as_f64().unwrap_or(-1.0);
    let width = value["width"].as_f64().unwrap_or(0.0);
    let height = value["height"].as_f64().unwrap_or(0.0);
    x >= 0.0 && y >= 0.0 && width > 0.0 && height > 0.0 && x + width <= 1.0 && y + height <= 1.0
}
pub(crate) fn reference(snapshot: &Value, reference: &Value, text: &[u16]) -> Result<()> {
    let locator = &reference["locator"];
    if locator.is_null() {
        return Ok(());
    }
    if locator["sourceId"] != reference["sourceId"]
        || locator["versionId"] != snapshot["mediaId"]
        || locator["versionId"] != reference["mediaId"]
    {
        return Err(Error::invalid());
    }
    let kind = locator["kind"].as_str().unwrap_or("");
    if kind != "text" && kind != "formula" && snapshot["document"]["format"] != kind {
        return Err(Error::invalid());
    }
    let valid = match kind {
        "text" => {
            let quote: Vec<u16> = locator["quote"]
                .as_str()
                .unwrap_or("")
                .encode_utf16()
                .collect();
            let start = locator["start"].as_u64().unwrap_or(u64::MAX) as usize;
            let end = locator["end"].as_u64().unwrap_or(0) as usize;
            locator["start"] == reference["start"]
                && locator["end"] == reference["end"]
                && !locator["quote"].as_str().unwrap_or("").trim().is_empty()
                && text.get(start..end) == Some(quote.as_slice())
        }
        "pdf" => locator["regions"]
            .as_array()
            .is_some_and(|regions| !regions.is_empty() && regions.iter().all(region)),
        "image" => region(locator),
        "formula" => {
            let start = locator["start"].as_u64().unwrap_or(u64::MAX);
            let end = locator["end"].as_u64().unwrap_or(0);
            let leaves = locator["leaves"].as_array().ok_or_else(Error::invalid)?;
            snapshot["format"] == "markdown"
                && end > start
                && end <= snapshot["characters"].as_u64().unwrap_or(0)
                && !locator["latex"].as_str().unwrap_or("").trim().is_empty()
                && leaves
                    .iter()
                    .filter_map(Value::as_u64)
                    .collect::<HashSet<_>>()
                    .len()
                    == leaves.len()
                && (reference["start"].is_null()
                    || locator["start"] == reference["start"] && locator["end"] == reference["end"])
                && reference["quote"].as_str().is_none_or(|quote| {
                    formula_quote(quote, locator["latex"].as_str().unwrap_or(""))
                })
        }
        "epub" => {
            let href = locator["href"].as_str().unwrap_or("");
            let paired = match (locator["start"].as_u64(), locator["end"].as_u64()) {
                (None, None) => true,
                (Some(start), Some(end)) => end > start,
                _ => false,
            };
            !href.is_empty()
                && (snapshot["document"]["path"].is_null() || snapshot["document"]["path"] == href)
                && !href.starts_with(['/', '\\'])
                && !href.split(['/', '\\']).any(|p| p == "..")
                && !href.split('/').next().unwrap_or("").contains(':')
                && paired
        }
        _ => false,
    };
    if valid { Ok(()) } else { Err(Error::invalid()) }
}
fn formula_quote(quote: &str, latex: &str) -> bool {
    [("$$", "$$"), ("\\[", "\\]"), ("\\(", "\\)"), ("$", "$")]
        .iter()
        .any(|(open, close)| {
            quote
                .strip_prefix(open)
                .and_then(|rest| rest.strip_suffix(close))
                .is_some_and(|inner| !inner.is_empty() && inner.trim() == latex.trim())
        })
}

pub(crate) fn plugin(value: &Value) -> Result<()> {
    if value.is_null() {
        return Ok(());
    }
    let keys: HashSet<&str> = value["variants"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    if value["variants"]
        .as_array()
        .is_some_and(|items| items.len() != keys.len())
        || value["variantLocators"]
            .as_object()
            .is_some_and(|locators| locators.keys().any(|key| !keys.contains(key.as_str())))
    {
        return Err(Error::invalid());
    }
    Ok(())
}

pub(crate) fn sequences(tx: &Transaction<'_>) -> Result<()> {
    let mut statement = tx.prepare("SELECT id,json_extract(data,'$.parentSourceId'),json_extract(data,'$.studySequence'),json_extract(data,'$.document.container') FROM sources")?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<bool>>(3)?,
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let roots: HashSet<_> = rows
        .iter()
        .filter(|row| row.2.is_none() && row.3 == Some(true))
        .map(|row| row.0.as_str())
        .collect();
    let mut groups: HashMap<String, (String, HashSet<u64>)> = HashMap::new();
    for (_, _, sequence, _) in &rows {
        let Some(raw) = sequence else {
            continue;
        };
        let sequence: Value = serde_json::from_str(raw)?;
        let id = sequence["groupId"].as_str().ok_or_else(Error::invalid)?;
        let mode = sequence["mode"].as_str().ok_or_else(Error::invalid)?;
        if !roots.contains(id) {
            return Err(Error::invalid());
        }
        let group = groups
            .entry(id.into())
            .or_insert_with(|| (mode.into(), HashSet::new()));
        if group.0 != mode
            || !group
                .1
                .insert(sequence["index"].as_u64().ok_or_else(Error::invalid)?)
        {
            return Err(Error::invalid());
        }
    }
    Ok(())
}

pub(crate) fn needs_p4(value: &Value) -> bool {
    if !value["studySequence"].is_null()
        || !value["plugin"]["variants"].is_null()
        || !value["plugin"]["variantLocators"].is_null()
        || !value["question"]["plugin"]["variants"].is_null()
        || value["variant"]
            .as_str()
            .is_some_and(|variant| variant.starts_with("plugin:"))
        || value["annotations"]
            .as_array()
            .is_some_and(|annotations| annotations.iter().any(|entry| !entry["locator"].is_null()))
    {
        return true;
    }
    std::iter::once(value)
        .chain(value["versions"].as_array().into_iter().flatten())
        .any(|snapshot| {
            ["path", "data", "resources", "container"]
                .iter()
                .any(|key| !snapshot["document"][*key].is_null())
                || snapshot["reading"]["locator"]["kind"] == "formula"
                || snapshot["excerpt"]["locator"]["kind"] == "formula"
                || snapshot["origin"]["locator"]["kind"] == "formula"
        })
}

pub(crate) fn reading(snapshot: &Value, source_id: &str) -> Result<()> {
    let locator = &snapshot["reading"]["locator"];
    if locator.is_null() {
        return Ok(());
    }
    if locator["sourceId"].as_str() != Some(source_id)
        || locator["versionId"] != snapshot["mediaId"]
    {
        return Err(Error::invalid());
    }
    if locator["kind"] == "text" {
        let start = locator["start"].as_u64().unwrap_or(u64::MAX);
        let end = locator["end"].as_u64().unwrap_or(0);
        let quote = locator["quote"].as_str().unwrap_or("");
        if end <= start
            || end > snapshot["characters"].as_u64().unwrap_or(0)
            || end - start != quote.encode_utf16().count() as u64
            || quote.trim().is_empty()
        {
            return Err(Error::invalid());
        }
        return Ok(());
    }
    reference(
        snapshot,
        &serde_json::json!({"sourceId":source_id,"mediaId":snapshot["mediaId"],"locator":locator}),
        &[],
    )
}

pub(crate) fn hierarchy(tx: &Transaction<'_>, source: &Value) -> Result<()> {
    fn depth(
        tx: &Transaction<'_>,
        node: &Value,
        path: &mut HashSet<String>,
        known: &mut HashMap<String, usize>,
    ) -> Result<usize> {
        let id = node["id"].as_str().ok_or_else(Error::invalid)?;
        if let Some(value) = known.get(id) {
            return Ok(*value);
        }
        if path.len() > 32 || !path.insert(id.to_owned()) {
            return Err(Error::invalid());
        }
        let mut result = 0;
        for parent in [
            node["parentSourceId"].as_str(),
            node["origin"]["sourceId"].as_str(),
        ]
        .into_iter()
        .flatten()
        {
            let raw: String = tx
                .query_row("SELECT data FROM sources WHERE id=?1", [parent], |row| {
                    row.get(0)
                })
                .map_err(|_| Error::invalid())?;
            result = result.max(1 + depth(tx, &serde_json::from_str(&raw)?, path, known)?);
        }
        if result > 32 {
            return Err(Error::invalid());
        }
        path.remove(id);
        known.insert(id.to_owned(), result);
        Ok(result)
    }
    depth(tx, source, &mut HashSet::new(), &mut HashMap::new()).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::records::{Commit, Database, Patch};
    use cap_std::{ambient_authority, fs::Dir};
    use serde_json::json;
    use std::sync::Arc;

    fn patch(store: &str, value: Value) -> Patch {
        Patch {
            store: store.into(),
            id: value["id"].as_str().unwrap().into(),
            position: Some(0),
            value: Some(value),
            position_only: false,
        }
    }
    fn commit(revision: i64, patches: Vec<Patch>) -> Commit {
        Commit {
            expected_revision: revision,
            patches,
            reason: None,
            operation_history: None,
            retired: None,
        }
    }
    fn source(id: &str, media: &str) -> Value {
        json!({"id":id,"title":"Material","url":"","format":"plain","mediaId":media,"characters":4,"createdAt":"2026-10-29T00:00:00.000Z"})
    }
    fn media(id: &str, mime: &str, size: usize) -> Value {
        json!({"id":id,"name":"original","type":mime,"size":size,"createdAt":"2026-10-29T00:00:00.000Z"})
    }
    fn version(db: &Database) -> u32 {
        db.connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap()
    }

    #[test]
    fn material_transaction_gates_old_readers_without_upgrading_on_failure_or_ordinary_saves() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("state.sqlite3");
        let assets = Arc::new(Dir::open_ambient_dir(root.path(), ambient_authority()).unwrap());
        let mut db = Database::open(&path, assets.clone()).unwrap();
        db.connection.execute_batch("CREATE TABLE retired_media(id TEXT PRIMARY KEY,data TEXT); CREATE TABLE card_drafts(id TEXT PRIMARY KEY,data TEXT);").unwrap();
        db.put_media("text", "text/plain", b"text").unwrap();
        db.commit(commit(
            0,
            vec![
                patch("media", media("text", "text/plain", 4)),
                patch("sources", source("plain", "text")),
            ],
        ))
        .unwrap();
        assert_eq!(version(&db), 10);
        db.put_media("projection", "text/plain", b"text").unwrap();
        db.put_media("original", "application/pdf", b"%PDF")
            .unwrap();
        let mut imported = source("imported", "projection");
        imported["document"] = json!({"schemaVersion":1,"providerId":"example.reader","readerId":"pdf","format":"pdf","originalMediaId":"original","importKey":"a".repeat(64)});
        imported["parentSourceId"] = json!("plain");
        imported["reading"] = json!({"offset":0,"fraction":0,"view":"source","updatedAt":"2026-10-29T00:00:00.000Z","locator":{"schemaVersion":1,"sourceId":"imported","versionId":"projection","kind":"pdf","regions":[{"page":0,"x":0.1,"y":0.2,"width":0.4,"height":0.3},{"page":1,"x":0.0,"y":0.0,"width":1.0,"height":1.0}]}});
        let receipt = json!({"id":"operation","pluginId":"example.reader","operationId":"import-once","kind":"import","fingerprint":"b".repeat(64),"result":{"sourceIds":["imported"],"noteIds":[]},"createdAt":"2026-10-29T00:00:00.000Z"});
        let mut changes = vec![
            patch("media", media("projection", "text/plain", 4)),
            patch("media", media("original", "application/pdf", 4)),
            patch("sources", imported.clone()),
            patch("materialReceipts", receipt.clone()),
        ];
        changes[0].position = Some(1);
        changes[1].position = Some(2);
        changes[2].position = Some(1);
        assert!(
            db.commit_with(commit(1, changes.clone()), |_| Err(Error::invalid()))
                .is_err()
        );
        assert_eq!(version(&db), 10);
        assert_eq!(
            db.load().unwrap()["library"]["sources"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        let mut invalid = changes.clone();
        invalid[2].value.as_mut().unwrap()["reading"]["locator"]["versionId"] =
            json!("different-version");
        assert!(db.commit(commit(1, invalid)).is_err());
        assert_eq!(version(&db), 10);
        db.commit(commit(1, changes)).unwrap();
        assert_eq!(version(&db), 11);
        drop(db);
        let mut db = Database::open(&path, assets.clone()).unwrap();
        assert_eq!(version(&db), 11);
        let library = db.load().unwrap()["library"].clone();
        assert_eq!(library["version"], 19);
        assert!(library["sources"].as_array().unwrap().contains(&imported));
        assert_eq!(library["materialReceipts"][0], receipt);
        assert_eq!(
            db.media("original").unwrap(),
            ("application/pdf".into(), b"%PDF".to_vec())
        );
        imported["document"]["readerId"] = json!("changed");
        let mut rewritten_source = patch("sources", imported);
        rewritten_source.position = Some(1);
        assert!(db.commit(commit(2, vec![rewritten_source])).is_err());
        let mut rewritten = receipt;
        rewritten["fingerprint"] = json!("c".repeat(64));
        assert!(
            db.commit(commit(2, vec![patch("materialReceipts", rewritten)]))
                .is_err()
        );
        assert_eq!(db.load().unwrap()["revision"], 2);
        db.connection
            .pragma_update(None, "user_version", 19)
            .unwrap();
        drop(db);
        assert!(Database::open(&path, assets).is_err());
    }

    #[test]
    fn folder_moves_validate_descendant_depth_and_commit_atomically() {
        let root = tempfile::tempdir().unwrap();
        let assets = Arc::new(Dir::open_ambient_dir(root.path(), ambient_authority()).unwrap());
        let mut db = Database::open(&root.path().join("state.sqlite3"), assets).unwrap();
        db.connection.execute_batch("CREATE TABLE retired_media(id TEXT PRIMARY KEY,data TEXT); CREATE TABLE card_drafts(id TEXT PRIMARY KEY,data TEXT);").unwrap();
        let mut folders = Vec::new();
        for index in 0..33 {
            let mut value = json!({"id":format!("folder-{index}"),"name":format!("Folder {index}"),"order":index,"createdAt":"2026-10-30T00:00:00.000Z"});
            if index > 0 && index != 31 {
                value["parentId"] = json!(format!("folder-{}", index - 1));
            }
            let mut change = patch("materialFolders", value);
            change.position = Some(index);
            folders.push(change);
        }
        db.commit(commit(0, folders.clone())).unwrap();
        assert_eq!(version(&db), 13);
        let before = db.load().unwrap();
        let mut change = folders[31].clone();
        change.value.as_mut().unwrap()["parentId"] = json!("folder-30");
        assert!(db.commit(commit(1, vec![change.clone()])).is_err());
        assert_eq!(db.load().unwrap(), before);
        change.value.as_mut().unwrap()["parentId"] = json!("folder-29");
        db.commit(commit(1, vec![change])).unwrap();
        let mut cycle = folders[0].clone();
        cycle.value.as_mut().unwrap()["parentId"] = json!("folder-32");
        assert!(db.commit(commit(2, vec![cycle])).is_err());
        assert_eq!(db.load().unwrap()["revision"], 2);
    }
}
