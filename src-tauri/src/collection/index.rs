//! Rebuildable device cache. Source directories and learning-library files are never written.
use super::{Collection, Entry, Listing, Result, directory, modified, open_regular, segments};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::Seek,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::State;
const TEXT_LIMIT: u64 = 1024 * 1024;
const TOTAL_LIMIT: u64 = 128 * 1024 * 1024;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatus {
    files: usize,
    skipped: usize,
    indexed_at: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    path: String,
    snippet: String,
    size: u64,
    modified: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    hits: Vec<SearchHit>,
    more: bool,
    indexed_at: u64,
}
fn storage(error: rusqlite::Error) -> String {
    #[cfg(test)]
    eprintln!("source index: {error}");
    let _ = error;
    "source-index-failed".into()
}
fn database(path: &Path) -> Result<Connection> {
    // The cache is private device data. Refuse a substituted database or sidecar link.
    for suffix in ["", "-journal", "-wal", "-shm"] {
        let name = format!("{}{suffix}", path.to_string_lossy());
        match std::fs::symlink_metadata(&name) {
            Ok(meta) if super::linked(&meta) || !meta.is_file() => {
                return Err("unsafe-source-index".into());
            }
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(super::disk(e)),
            _ => (),
        }
        if Path::new(&name).exists() {
            let parent = path.parent().ok_or("unsafe-source-index")?;
            let directory =
                cap_std::fs::Dir::open_ambient_dir(parent, cap_std::ambient_authority())
                    .map_err(super::disk)?;
            let filename = Path::new(&name)
                .file_name()
                .and_then(|n| n.to_str())
                .ok_or("unsafe-source-index")?;
            super::open_regular(&directory, filename).map_err(|_| "unsafe-source-index")?;
        }
    }
    let db = Connection::open(path).map_err(storage)?;
    db.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(storage)?;
    db.execute_batch("PRAGMA journal_mode=DELETE; PRAGMA trusted_schema=OFF;
        CREATE TABLE IF NOT EXISTS roots (id TEXT PRIMARY KEY, path TEXT NOT NULL, indexed_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS documents (id INTEGER PRIMARY KEY, root TEXT NOT NULL, path TEXT NOT NULL, size INTEGER NOT NULL, modified TEXT NOT NULL, UNIQUE(root,path));
        CREATE VIRTUAL TABLE IF NOT EXISTS fulltext USING fts5(path, body, tokenize='trigram');").map_err(storage)?;
    Ok(db)
}
pub(super) fn clear(path: &Path, id: &str) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }
    let mut db = database(path)?;
    let tx = db.transaction().map_err(storage)?;
    tx.execute(
        "DELETE FROM fulltext WHERE rowid IN (SELECT id FROM documents WHERE root=?1)",
        [id],
    )
    .map_err(storage)?;
    tx.execute("DELETE FROM documents WHERE root=?1", [id])
        .map_err(storage)?;
    tx.execute("DELETE FROM roots WHERE id=?1", [id])
        .map_err(storage)?;
    tx.commit().map_err(storage)
}
fn read_text(
    root: &cap_std::fs::Dir,
    entry: &Entry,
    check: &dyn Fn() -> Result<()>,
) -> Result<String> {
    let parts = segments(&entry.path)?;
    let mut parent = root.try_clone().map_err(super::disk)?;
    for part in &parts[..parts.len() - 1] {
        parent = directory(&parent, Path::new(part))?;
    }
    let mut file = open_regular(&parent, parts[parts.len() - 1])?;
    let before = file.metadata().map_err(super::disk)?;
    if before.len() != entry.size || modified(&before)? != entry.modified {
        return Err("source-file-changed".into());
    }
    let bytes = super::read_bytes(&mut file, TEXT_LIMIT, check)?;
    file.rewind().map_err(super::disk)?;
    let again = super::read_bytes(&mut file, TEXT_LIMIT, check)?;
    let after = file.metadata().map_err(super::disk)?;
    if bytes != again
        || bytes.len() as u64 != entry.size
        || after.len() != entry.size
        || modified(&after)? != entry.modified
    {
        return Err("source-file-changed".into());
    }
    let text = String::from_utf8(bytes).map_err(|_| "source-text-encoding")?;
    if text.contains('\0') {
        return Err("source-text-encoding".into());
    }
    Ok(text.strip_prefix('\u{feff}').unwrap_or(&text).to_owned())
}
fn current<'a>(
    inner: &'a super::Inner,
    scope: &str,
    id: &str,
    epoch: u64,
) -> Result<&'a super::Grant> {
    if inner.check(scope)? != epoch {
        return Err("stale-collection-scope".into());
    }
    inner
        .grants
        .iter()
        .find(|g| g.id == id && g.scope == scope)
        .ok_or_else(|| "source-grant-missing".into())
}
fn build(
    db: &mut Connection,
    root: &cap_std::fs::Dir,
    id: &str,
    root_path: &str,
    mut listing: Listing,
    before_commit: impl Fn() -> Result<()>,
) -> Result<IndexStatus> {
    let mut total = 0;
    let mut skipped = listing.skipped.len();
    listing.files.retain(|entry| {
        let extension = entry.path.rsplit('.').next().unwrap_or("");
        let eligible = ["md", "txt", "markdown"]
            .iter()
            .any(|ext| extension.eq_ignore_ascii_case(ext))
            && entry.size <= TEXT_LIMIT;
        if !eligible {
            skipped += 1;
        }
        eligible
    });
    for entry in &listing.files {
        before_commit()?;
        total += entry.size;
        if total > TOTAL_LIMIT {
            return Err("source-index-limit".into());
        }
    }
    let tx = db.transaction().map_err(storage)?;
    let old_path: Option<String> = tx
        .query_row("SELECT path FROM roots WHERE id=?1", [id], |row| row.get(0))
        .optional()
        .map_err(storage)?;
    if old_path.as_deref() != Some(root_path) {
        tx.execute(
            "DELETE FROM fulltext WHERE rowid IN (SELECT id FROM documents WHERE root=?1)",
            [id],
        )
        .map_err(storage)?;
        tx.execute("DELETE FROM documents WHERE root=?1", [id])
            .map_err(storage)?;
    }
    let mut old: HashMap<String, (i64, i64, String)> = {
        let mut query = tx
            .prepare("SELECT path,id,size,modified FROM documents WHERE root=?1")
            .map_err(storage)?;
        query
            .query_map([id], |row| {
                Ok((row.get(0)?, (row.get(1)?, row.get(2)?, row.get(3)?)))
            })
            .map_err(storage)?
            .collect::<std::result::Result<_, _>>()
            .map_err(storage)?
    };
    let mut indexed = 0;
    for entry in &listing.files {
        before_commit()?;
        let previous = old.remove(&entry.path);
        if previous
            .as_ref()
            .is_some_and(|(_, size, stamp)| *size == entry.size as i64 && *stamp == entry.modified)
        {
            indexed += 1;
            continue;
        }
        let text = match read_text(root, entry, &before_commit) {
            Ok(text) => text,
            Err(error) if error == "source-text-encoding" => {
                skipped += 1;
                if let Some((rowid, _, _)) = previous {
                    tx.execute("DELETE FROM fulltext WHERE rowid=?1", [rowid])
                        .map_err(storage)?;
                    tx.execute("DELETE FROM documents WHERE id=?1", [rowid])
                        .map_err(storage)?;
                }
                continue;
            }
            Err(error) => return Err(error),
        };
        tx.execute("INSERT INTO documents(root,path,size,modified) VALUES (?1,?2,?3,?4) ON CONFLICT(root,path) DO UPDATE SET size=excluded.size,modified=excluded.modified", params![id, entry.path, entry.size as i64, entry.modified]).map_err(storage)?;
        let rowid: i64 = tx
            .query_row(
                "SELECT id FROM documents WHERE root=?1 AND path=?2",
                params![id, entry.path],
                |row| row.get(0),
            )
            .map_err(storage)?;
        tx.execute("DELETE FROM fulltext WHERE rowid=?1", [rowid])
            .map_err(storage)?;
        tx.execute(
            "INSERT INTO fulltext(rowid,path,body) VALUES (?1,?2,?3)",
            params![rowid, entry.path, text],
        )
        .map_err(storage)?;
        indexed += 1;
    }
    for (_, (rowid, _, _)) in old {
        before_commit()?;
        tx.execute("DELETE FROM fulltext WHERE rowid=?1", [rowid])
            .map_err(storage)?;
        tx.execute("DELETE FROM documents WHERE id=?1", [rowid])
            .map_err(storage)?;
    }
    let indexed_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "source-index-failed")?
        .as_millis() as u64;
    tx.execute("INSERT INTO roots(id,path,indexed_at) VALUES (?1,?2,?3) ON CONFLICT(id) DO UPDATE SET path=excluded.path,indexed_at=excluded.indexed_at", params![id, root_path, indexed_at as i64]).map_err(storage)?;
    before_commit()?;
    tx.commit().map_err(storage)?;
    Ok(IndexStatus {
        files: indexed,
        skipped,
        indexed_at,
    })
}
fn search(
    db: &Connection,
    id: &str,
    root_path: &str,
    query: &str,
    limit: usize,
) -> Result<SearchResult> {
    let query = query.trim();
    if query.is_empty() || query.len() > 1000 || limit == 0 || limit > 100 {
        return Err("invalid-source-query".into());
    }
    let indexed_at: i64 = db
        .query_row(
            "SELECT indexed_at FROM roots WHERE id=?1 AND path=?2",
            params![id, root_path],
            |row| row.get(0),
        )
        .optional()
        .map_err(storage)?
        .ok_or("source-index-missing")?;
    let short = query.chars().count() < 3;
    let expression = if short {
        format!(
            "%{}%",
            query
                .replace('!', "!!")
                .replace('%', "!%")
                .replace('_', "!_")
        )
    } else {
        format!("\"{}\"", query.replace('"', "\"\""))
    };
    let sql = if short {
        "SELECT d.path,substr(f.body,max(1,instr(lower(f.body),lower(?4))-60),240),d.size,d.modified FROM fulltext f JOIN documents d ON d.id=f.rowid WHERE d.root=?1 AND (f.body LIKE ?2 ESCAPE '!' OR f.path LIKE ?2 ESCAPE '!') ORDER BY d.path LIMIT ?3"
    } else {
        "SELECT d.path,snippet(fulltext,1,'','',' … ',40),d.size,d.modified FROM fulltext JOIN documents d ON d.id=fulltext.rowid WHERE d.root=?1 AND fulltext MATCH ?2 ORDER BY rank,d.path LIMIT ?3"
    };
    let mut statement = db.prepare(sql).map_err(storage)?;
    let map = |row: &rusqlite::Row<'_>| -> rusqlite::Result<SearchHit> {
        Ok(SearchHit {
            path: row.get(0)?,
            snippet: row.get(1)?,
            size: row.get::<_, i64>(2)? as u64,
            modified: row.get(3)?,
        })
    };
    let mut hits = if short {
        statement
            .query_map(params![id, expression, (limit + 1) as i64, query], map)
            .map_err(storage)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(storage)?
    } else {
        statement
            .query_map(params![id, expression, (limit + 1) as i64], map)
            .map_err(storage)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(storage)?
    };
    let more = hits.len() > limit;
    hits.truncate(limit);
    Ok(SearchResult {
        hits,
        more,
        indexed_at: indexed_at as u64,
    })
}
#[tauri::command]
pub async fn collection_directory_index(
    window: tauri::WebviewWindow,
    state: State<'_, Collection>,
    expected_scope: String,
    id: String,
) -> Result<IndexStatus> {
    crate::main_window(&window)?;
    let manager = state.0.clone();
    let serial = state.1.clone();
    let lease = manager
        .lock()
        .map_err(|_| "source-index-failed")?
        .begin(&expected_scope, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        lease.check()?;
        let _serial = serial.lock().map_err(|_| "source-index-failed")?;
        lease.check()?;
        let (root, root_path, cache, epoch) = {
            let inner = manager.lock().map_err(|_| "source-index-failed")?;
            let grant = current(&inner, &expected_scope, &id, inner.epoch)?;
            (
                inner.root(&expected_scope, &id)?,
                grant.path.to_string_lossy().into_owned(),
                inner.index_path.clone(),
                inner.epoch,
            )
        };
        let mut listing = Listing {
            files: vec![],
            skipped: vec![],
            complete: true,
        };
        super::walk_checked(&root, "", 0, &mut 0, &mut listing, &|| lease.check())?;
        let mut db = database(&cache)?;
        build(&mut db, &root, &id, &root_path, listing, || {
            lease.check()?;
            current(
                &*manager.lock().map_err(|_| "source-index-failed")?,
                &expected_scope,
                &id,
                epoch,
            )
            .map(|_| ())
        })
    })
    .await
    .map_err(|_| "source-index-failed")?
}
#[tauri::command]
pub async fn collection_directory_search(
    window: tauri::WebviewWindow,
    state: State<'_, Collection>,
    expected_scope: String,
    id: String,
    query: String,
    limit: usize,
) -> Result<SearchResult> {
    crate::main_window(&window)?;
    let manager = state.0.clone();
    let serial = state.1.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _serial = serial.lock().map_err(|_| "source-index-failed")?;
        let (root_path, cache, epoch) = {
            let inner = manager.lock().map_err(|_| "source-index-failed")?;
            let grant = current(&inner, &expected_scope, &id, inner.epoch)?;
            (
                grant.path.to_string_lossy().into_owned(),
                inner.index_path.clone(),
                inner.epoch,
            )
        };
        let result = search(&database(&cache)?, &id, &root_path, &query, limit)?;
        current(
            &*manager.lock().map_err(|_| "source-index-failed")?,
            &expected_scope,
            &id,
            epoch,
        )?;
        Ok(result)
    })
    .await
    .map_err(|_| "source-index-failed")?
}
#[cfg(test)]
mod tests {
    use super::super::walk;
    use super::*;
    fn rebuild(
        db: &mut Connection,
        source: &Path,
        id: &str,
        before_commit: impl Fn() -> Result<()>,
    ) -> Result<IndexStatus> {
        let root = super::super::open_root(source).unwrap();
        let mut listing = Listing {
            files: vec![],
            skipped: vec![],
            complete: true,
        };
        walk(&root, "", 0, &mut 0, &mut listing).unwrap();
        build(
            db,
            &root,
            id,
            &source.to_string_lossy(),
            listing,
            before_commit,
        )
    }
    #[test]
    fn indexes_chinese_and_latin_text_and_updates_rename_delete_without_source_writes() {
        let device = tempfile::tempdir().unwrap();
        let source = tempfile::tempdir().unwrap();
        std::fs::write(
            source.path().join("study.md"),
            "# 学习材料\nChinese grammar 语法练习",
        )
        .unwrap();
        std::fs::write(source.path().join("excluded.pdf"), "ignored").unwrap();
        let mut db = database(&device.path().join("cache.sqlite3")).unwrap();
        let status = rebuild(&mut db, source.path(), "grant", || Ok(())).unwrap();
        assert_eq!(status.files, 1);
        assert_eq!(status.skipped, 1);
        let root = source.path().to_string_lossy();
        for query in ["学习", "学习材料", "grammar"] {
            assert_eq!(
                search(&db, "grant", &root, query, 10).unwrap().hits[0].path,
                "study.md"
            );
        }
        std::fs::rename(
            source.path().join("study.md"),
            source.path().join("renamed.txt"),
        )
        .unwrap();
        rebuild(&mut db, source.path(), "grant", || Ok(())).unwrap();
        assert_eq!(
            search(&db, "grant", &root, "grammar", 10).unwrap().hits[0].path,
            "renamed.txt"
        );
        std::fs::remove_file(source.path().join("renamed.txt")).unwrap();
        rebuild(&mut db, source.path(), "grant", || Ok(())).unwrap();
        assert!(
            search(&db, "grant", &root, "grammar", 10)
                .unwrap()
                .hits
                .is_empty()
        );
        assert_eq!(std::fs::read_dir(source.path()).unwrap().count(), 1);
    }
    #[test]
    fn cancelled_or_stale_index_keeps_previous_snapshot_and_relink_hides_old_results() {
        let device = tempfile::tempdir().unwrap();
        let source = tempfile::tempdir().unwrap();
        std::fs::write(source.path().join("a.md"), "original result").unwrap();
        let mut db = database(&device.path().join("cache.sqlite3")).unwrap();
        rebuild(&mut db, source.path(), "grant", || Ok(())).unwrap();
        std::fs::write(source.path().join("a.md"), "replacement content").unwrap();
        assert!(
            rebuild(&mut db, source.path(), "grant", || Err(
                "stale-collection-scope".into()
            ))
            .is_err()
        );
        assert_eq!(
            search(
                &db,
                "grant",
                &source.path().to_string_lossy(),
                "original",
                10
            )
            .unwrap()
            .hits
            .len(),
            1
        );
        assert!(search(&db, "grant", "relinked-directory", "original", 10).is_err());
    }
    #[test]
    fn literal_queries_cannot_change_fts_syntax_or_escape_the_grant() {
        let device = tempfile::tempdir().unwrap();
        let source = tempfile::tempdir().unwrap();
        std::fs::write(source.path().join("a.md"), "100% _ query \"quoted\" test").unwrap();
        let mut db = database(&device.path().join("cache.sqlite3")).unwrap();
        rebuild(&mut db, source.path(), "grant-a", || Ok(())).unwrap();
        let root = source.path().to_string_lossy();
        assert!(search(&db, "grant-b", &root, "test", 10).is_err());
        assert_eq!(
            search(&db, "grant-a", &root, "%", 10).unwrap().hits.len(),
            1
        );
        assert!(
            search(&db, "grant-a", &root, "query OR secret", 10)
                .unwrap()
                .hits
                .is_empty()
        );
        assert_eq!(
            search(&db, "grant-a", &root, "\"quoted\"", 10)
                .unwrap()
                .hits
                .len(),
            1
        );
    }
    #[test]
    fn revocation_clears_only_its_derived_index_and_rejects_hard_linked_cache() {
        let device = tempfile::tempdir().unwrap();
        let source = tempfile::tempdir().unwrap();
        let cache = device.path().join("cache.sqlite3");
        std::fs::write(source.path().join("a.md"), "retained source").unwrap();
        let mut db = database(&cache).unwrap();
        rebuild(&mut db, source.path(), "grant-a", || Ok(())).unwrap();
        rebuild(&mut db, source.path(), "grant-b", || Ok(())).unwrap();
        drop(db);
        clear(&cache, "grant-a").unwrap();
        let db = database(&cache).unwrap();
        assert!(
            search(
                &db,
                "grant-a",
                &source.path().to_string_lossy(),
                "source",
                10
            )
            .is_err()
        );
        assert_eq!(
            search(
                &db,
                "grant-b",
                &source.path().to_string_lossy(),
                "source",
                10
            )
            .unwrap()
            .hits
            .len(),
            1
        );
        drop(db);
        std::fs::hard_link(&cache, device.path().join("linked.sqlite3")).unwrap();
        assert!(database(&cache).is_err());
        assert_eq!(
            std::fs::read_to_string(source.path().join("a.md")).unwrap(),
            "retained source"
        );
    }
    #[test]
    fn cancellation_during_incremental_indexing_rolls_back_the_entire_new_snapshot() {
        let device = tempfile::tempdir().unwrap();
        let source = tempfile::tempdir().unwrap();
        for name in ["a.md", "b.md"] {
            std::fs::write(source.path().join(name), "original source").unwrap();
        }
        let mut db = database(&device.path().join("cache.sqlite3")).unwrap();
        rebuild(&mut db, source.path(), "grant", || Ok(())).unwrap();
        for name in ["a.md", "b.md"] {
            std::fs::write(source.path().join(name), "replacement content").unwrap();
        }
        let checks = std::cell::Cell::new(0);
        let result = rebuild(&mut db, source.path(), "grant", || {
            checks.set(checks.get() + 1);
            if checks.get() >= 9 {
                Err("source-operation-cancelled".into())
            } else {
                Ok(())
            }
        });
        assert!(matches!(result, Err(error) if error == "source-operation-cancelled"));
        assert_eq!(
            search(
                &db,
                "grant",
                &source.path().to_string_lossy(),
                "original",
                10
            )
            .unwrap()
            .hits
            .len(),
            2
        );
        assert!(
            search(
                &db,
                "grant",
                &source.path().to_string_lossy(),
                "replacement",
                10
            )
            .unwrap()
            .hits
            .is_empty()
        );
    }
}
