//! Retired records stay in the workspace, outside the active study projection.
//! Capture and reactivation share the active record transaction, including full code bodies.
use crate::{
    error::{Error, Result},
    records::Patch,
};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde_json::{Value, json};
pub fn schema(db: &Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE retired_notes(id TEXT PRIMARY KEY,data TEXT NOT NULL,retired_at TEXT NOT NULL);
      CREATE INDEX retired_notes_order ON retired_notes(retired_at DESC,id);
      CREATE TABLE retired_documents(id TEXT PRIMARY KEY,path TEXT NOT NULL,hash TEXT NOT NULL);
      CREATE TABLE retired_cards(id TEXT PRIMARY KEY,note_id TEXT NOT NULL,variant TEXT NOT NULL,data TEXT NOT NULL,retired_at TEXT NOT NULL);
      CREATE INDEX retired_cards_note ON retired_cards(note_id);
      CREATE TABLE retired_records(store TEXT NOT NULL,id TEXT NOT NULL,card_id TEXT NOT NULL,position INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(store,id));
      CREATE INDEX retired_records_card ON retired_records(card_id,store);
      CREATE TABLE retired_media(id TEXT PRIMARY KEY,data TEXT NOT NULL);")?;
    Ok(())
}
pub fn capture(tx: &Transaction<'_>, patches: &[Patch]) -> Result<()> {
    for patch in patches
        .iter()
        .filter(|patch| patch.value.is_none() && !patch.position_only)
    {
        match patch.store.as_str() {
            "notes" => {
                tx.execute("INSERT INTO retired_notes SELECT id,data,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM notes WHERE id=?1 ON CONFLICT(id) DO UPDATE SET data=excluded.data,retired_at=excluded.retired_at",[&patch.id])?;
                tx.execute("INSERT INTO retired_documents SELECT id,path,hash FROM documents WHERE kind='note' AND id=?1 ON CONFLICT(id) DO UPDATE SET path=excluded.path,hash=excluded.hash",[&patch.id])?;
            }
            "cards" => {
                tx.execute("INSERT INTO retired_cards SELECT id,note_id,json_extract(data,'$.variant'),data,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM cards WHERE id=?1 ON CONFLICT(id) DO UPDATE SET note_id=excluded.note_id,variant=excluded.variant,data=excluded.data,retired_at=excluded.retired_at",[&patch.id])?;
                for (store, condition) in [
                    ("reviews", "card_id=?1"),
                    ("practices", "card_id=?1"),
                    (
                        "attempts",
                        "practice_id IN (SELECT id FROM practices WHERE card_id=?1)",
                    ),
                ] {
                    tx.execute(&format!("INSERT INTO retired_records SELECT '{store}',id,?1,position,data FROM {store} WHERE {condition} ON CONFLICT(store,id) DO UPDATE SET card_id=excluded.card_id,position=excluded.position,data=excluded.data"),[&patch.id])?;
                }
            }
            "media" => {
                tx.execute("INSERT INTO retired_media SELECT id,data FROM media WHERE id=?1 ON CONFLICT(id) DO UPDATE SET data=excluded.data",[&patch.id])?;
            }
            _ => {}
        }
    }
    Ok(())
}
pub fn reactivate(tx: &Transaction<'_>, patches: &[Patch]) -> Result<()> {
    for patch in patches.iter().filter(|patch| patch.value.is_some()) {
        match patch.store.as_str() {
            "notes" => {
                tx.execute("DELETE FROM retired_notes WHERE id=?1", [&patch.id])?;
                tx.execute("DELETE FROM retired_documents WHERE id=?1", [&patch.id])?;
            }
            "cards" => {
                tx.execute("DELETE FROM retired_records WHERE card_id=?1", [&patch.id])?;
                tx.execute("DELETE FROM retired_cards WHERE id=?1", [&patch.id])?;
            }
            _ => {}
        }
    }
    Ok(())
}
fn records(db: &Connection, sql: &str, id: &str) -> Result<Vec<Value>> {
    let mut stmt = db.prepare(sql)?;
    let rows = stmt
        .query_map([id], |row| row.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    rows.iter()
        .map(|raw| serde_json::from_str(raw).map_err(Into::into))
        .collect()
}
pub fn listing(db: &Connection, query: &str, offset: i64) -> Result<Value> {
    if query.len() > 1000 || !(0..=1000000).contains(&offset) {
        return Err(Error::invalid());
    }
    let condition = "(?1='' OR instr(lower(json_extract(n.data,'$.front')),lower(?1))>0)";
    let total: i64 = if query.is_empty() {
        db.query_row("SELECT count(*) FROM retired_notes", [], |r| r.get(0))?
    } else {
        db.query_row(
            &format!("SELECT count(*) FROM retired_notes n WHERE {condition}"),
            [query],
            |r| r.get(0),
        )?
    };
    let mut stmt=db.prepare(&format!("SELECT n.id,substr(json_extract(n.data,'$.front'),1,120),n.retired_at,d.path,(SELECT count(*) FROM retired_cards c WHERE c.note_id=n.id) FROM retired_notes n LEFT JOIN retired_documents d ON d.id=n.id WHERE {condition} ORDER BY n.retired_at DESC,n.id LIMIT 50 OFFSET ?2"))?;
    let notes=stmt.query_map(params![query,offset],|row|Ok(json!({"id":row.get::<_,String>(0)?,"title":row.get::<_,String>(1)?,"retiredAt":row.get::<_,String>(2)?,"path":row.get::<_,Option<String>>(3)?,"cards":row.get::<_,i64>(4)?})))?.collect::<std::result::Result<Vec<_>,_>>()?;
    Ok(json!({"notes":notes,"total":total}))
}
pub fn note(db: &Connection, id: &str) -> Result<Value> {
    let note: Option<String> = db
        .query_row("SELECT data FROM retired_notes WHERE id=?1", [id], |r| {
            r.get(0)
        })
        .optional()?;
    let document=db.query_row("SELECT path,hash FROM retired_documents WHERE id=?1",[id],|r|Ok(json!({"id":id,"kind":"note","path":r.get::<_,String>(0)?,"hash":r.get::<_,String>(1)?}))).optional()?;
    let cards = records(
        db,
        "SELECT data FROM retired_cards WHERE note_id=?1 ORDER BY retired_at DESC,id",
        id,
    )?;
    let mut result = json!({"revision":db.query_row("SELECT revision FROM workspace WHERE id=1",[],|r|r.get::<_,i64>(0))?,"note":note.map(|raw|serde_json::from_str::<Value>(&raw)).transpose()?,"document":document,"cards":cards});
    for store in ["reviews", "practices", "attempts"] {
        let data = if store == "attempts" {
            "json_remove(r.data,'$.code','$.result.detail')"
        } else {
            "r.data"
        };
        result[store] = json!(records(
            db,
            &format!(
                "SELECT {data} FROM retired_records r JOIN retired_cards c ON c.id=r.card_id WHERE c.note_id=?1 AND r.store='{store}' ORDER BY r.position,r.id"
            ),
            id
        )?);
    }
    result["media"] = json!(records(
        db,
        "SELECT m.data FROM retired_media m WHERE m.id IN (SELECT value FROM retired_notes n,json_each(json_extract(n.data,'$.frontMedia')) WHERE n.id=?1 UNION SELECT value FROM retired_notes n,json_each(json_extract(n.data,'$.backMedia')) WHERE n.id=?1 UNION SELECT json_extract(value,'$.mediaId') FROM retired_notes n,json_each(json_extract(n.data,'$.inlineMedia')) WHERE n.id=?1)",
        id
    )?);
    Ok(result)
}
pub fn attempt(db: &Connection, id: &str, revision: i64) -> Result<Value> {
    if db.query_row("SELECT revision FROM workspace WHERE id=1", [], |r| {
        r.get::<_, i64>(0)
    })? != revision
    {
        return Err(Error::conflict());
    }
    let raw: String = db
        .query_row(
            "SELECT data FROM retired_records WHERE store='attempts' AND id=?1",
            params![id],
            |r| r.get(0),
        )
        .optional()?
        .ok_or_else(Error::missing)?;
    Ok(serde_json::from_str(&raw)?)
}
