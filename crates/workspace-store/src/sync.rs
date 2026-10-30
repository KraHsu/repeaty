//! Immutable transaction journal. Receiving does not modify the accepted learning projection.
use crate::{
    error::{Error, Result},
    records::STORES,
};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;

pub type Clock = BTreeMap<String, u64>;
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Apply {
    pub expected_clock: Clock,
    pub clock: Clock,
    pub applied_ids: Vec<String>,
    pub values: Value,
    pub resolutions: Vec<Value>,
    pub retired_media: BTreeMap<String, Value>,
}
fn fail(code: &'static str) -> Error {
    Error(code)
}
pub fn schema(db: &Connection) -> Result<()> {
    crate::sync_objects::schema(db)?;
    db.execute_batch("CREATE TABLE IF NOT EXISTS sync_state(id INTEGER PRIMARY KEY CHECK(id=1),group_id TEXT NOT NULL,clock TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sync_events(cursor INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,device TEXT NOT NULL,sequence INTEGER NOT NULL,data TEXT NOT NULL,UNIQUE(device,sequence));
        CREATE TABLE IF NOT EXISTS sync_archives(group_id TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(group_id,id));
        CREATE TABLE IF NOT EXISTS sync_changes(store TEXT NOT NULL,id TEXT NOT NULL,before TEXT,after TEXT,position INTEGER,before_position INTEGER,PRIMARY KEY(store,id));")?;
    if !db
        .prepare("SELECT name FROM pragma_table_info('sync_changes') WHERE name='before_position'")?
        .exists([])?
    {
        db.execute_batch("ALTER TABLE sync_changes ADD COLUMN before_position INTEGER;")?;
    }
    for store in STORES {
        trigger(
            db,
            store,
            &format!("'{store}'"),
            "id",
            "data",
            "position",
            "1",
        )?;
    }
    for (table, store, data, position) in [
        ("retired_notes", "'retired:notes'", "data", "0"),
        ("retired_cards", "'retired:cards'", "data", "0"),
        ("retired_records", "'retired:'||$store", "data", "position"),
        ("retired_media", "'retired:media'", "data", "0"),
        (
            "retired_documents",
            "'retired:documents'",
            "json_object('id',$id,'kind','note','path',$path,'hash',$hash)",
            "0",
        ),
        ("values_store", "'values:'||$namespace", "data", "0"),
    ] {
        let exists: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
            [table],
            |r| r.get(0),
        )?;
        if exists {
            trigger(
                db,
                table,
                store,
                "id",
                data,
                position,
                if table == "values_store" {
                    "($namespace LIKE 'plugin:%' OR ($namespace='settings' AND $id LIKE 'plugin:%'))"
                } else {
                    "1"
                },
            )?;
        }
    }
    Ok(())
}
fn expression(raw: &str, prefix: &str) -> String {
    if raw.contains('$') {
        raw.replace('$', &format!("{prefix}."))
    } else if matches!(raw, "id" | "data" | "position") {
        format!("{prefix}.{raw}")
    } else {
        raw.into()
    }
}
fn trigger(
    db: &Connection,
    table: &str,
    store: &str,
    id: &str,
    data: &str,
    position: &str,
    filter: &str,
) -> Result<()> {
    for action in ["INSERT", "UPDATE", "DELETE"] {
        let prefix = if action == "DELETE" { "OLD" } else { "NEW" };
        let before = if action == "INSERT" {
            "NULL".into()
        } else {
            expression(data, "OLD")
        };
        let after = if action == "DELETE" {
            "NULL".into()
        } else {
            expression(data, "NEW")
        };
        let pos = if action == "DELETE" {
            "NULL".into()
        } else {
            expression(position, "NEW")
        };
        let before_pos = if action == "INSERT" {
            "NULL".into()
        } else {
            expression(position, "OLD")
        };
        db.execute_batch(&format!("DROP TRIGGER IF EXISTS {table}_sync_{action}; CREATE TRIGGER {table}_sync_{action} AFTER {action} ON {table}
            WHEN EXISTS(SELECT 1 FROM sync_state) AND {} BEGIN
            INSERT INTO sync_changes(store,id,before,after,position,before_position) VALUES({},{},{before},{after},{pos},{before_pos})
            ON CONFLICT(store,id) DO UPDATE SET after=excluded.after,position=excluded.position; END;",
            expression(filter,prefix),expression(store,prefix),expression(id,prefix)))?;
    }
    Ok(())
}
pub fn status(db: &Connection) -> Result<Value> {
    let state: Option<(String, String)> = db
        .query_row(
            "SELECT group_id,clock FROM sync_state WHERE id=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    match state {
        None => Ok(json!({"groupId":null,"clock":{},"pending":0})),
        Some((group, raw)) => {
            let clock: Clock = serde_json::from_str(&raw)?;
            let pending: i64=db.query_row("SELECT count(*) FROM sync_events WHERE sequence>COALESCE((SELECT value FROM json_each(?1) WHERE key=device),0)",[&raw],|r|r.get(0))?;
            Ok(json!({"groupId":group,"clock":clock,"pending":pending}))
        }
    }
}
pub fn snapshot(db: &Connection) -> Result<Value> {
    let mut result = json!({"records":{},"values":{},"retired":{}});
    for store in STORES {
        let mut stmt = db.prepare(&format!(
            "SELECT id,position,data FROM {store} ORDER BY position,id"
        ))?;
        result["records"][store] = json!({});
        for row in stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
            ))
        })? {
            let (id, position, raw) = row?;
            result["records"][store][id] =
                json!({"position":position,"value":serde_json::from_str::<Value>(&raw)?});
        }
    }
    let mut stmt=db.prepare("SELECT namespace,id,data FROM values_store WHERE namespace LIKE 'plugin:%' OR (namespace='settings' AND id LIKE 'plugin:%')")?;
    for row in stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
        ))
    })? {
        let (ns, id, raw) = row?;
        if result["values"].get(&ns).is_none() {
            result["values"][&ns] = json!({});
        }
        result["values"][ns][id] =
            json!({"position":0,"value":serde_json::from_str::<Value>(&raw)?});
    }
    for (table, store, data, pos) in [
        ("retired_notes", "'notes'", "data", "0"),
        ("retired_cards", "'cards'", "data", "0"),
        ("retired_records", "store", "data", "position"),
        ("retired_media", "'media'", "data", "0"),
        (
            "retired_documents",
            "'documents'",
            "json_object('id',id,'kind','note','path',path,'hash',hash)",
            "0",
        ),
    ] {
        let mut stmt = db.prepare(&format!("SELECT {store},id,{pos},{data} FROM {table}"))?;
        for row in stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, String>(3)?,
            ))
        })? {
            let (store, id, position, raw) = row?;
            if result["retired"].get(&store).is_none() {
                result["retired"][&store] = json!({});
            }
            result["retired"][store][id] =
                json!({"position":position,"value":serde_json::from_str::<Value>(&raw)?});
        }
    }
    Ok(result)
}
fn valid_device(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && !["__proto__", "constructor", "prototype"].contains(&value)
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}
fn valid_change(change: &Value) -> bool {
    let Some(fields) = change.as_object() else {
        return false;
    };
    if fields
        .keys()
        .any(|key| !["store", "id", "before", "after", "position"].contains(&key.as_str()))
        || !fields.contains_key("before")
        || !fields.contains_key("after")
    {
        return false;
    }
    let Some(store) = change["store"].as_str() else {
        return false;
    };
    let Some(id) = change["id"].as_str() else {
        return false;
    };
    if id.is_empty() || id.len() > 2048 || change["before"].is_null() && change["after"].is_null() {
        return false;
    }
    let valid_store = STORES.contains(&store)
        || store.strip_prefix("retired:").is_some_and(|s| {
            [
                "notes",
                "cards",
                "reviews",
                "practices",
                "attempts",
                "media",
                "documents",
            ]
            .contains(&s)
        })
        || store.strip_prefix("values:plugin:").is_some_and(|s| {
            !s.is_empty()
                && s.len() <= 64
                && s.bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        })
        || (store == "values:settings" && id.starts_with("plugin:"));
    valid_store
        && (change.get("position").is_none()
            || !change["after"].is_null()
                && change["position"].as_u64().is_some_and(|n| n <= 1_600_000))
}
pub fn start(db: &mut Connection, group: &str, device: &str) -> Result<Value> {
    if uuid::Uuid::parse_str(group).is_err() || !valid_device(device) {
        return Err(Error::invalid());
    }
    let current = status(db)?;
    if let Some(existing) = current["groupId"].as_str() {
        return if existing == group {
            Ok(current)
        } else {
            Err(fail("sync-already-grouped"))
        };
    }
    let tx = db.transaction()?;
    let state = snapshot(&tx)?;
    tx.execute("INSERT INTO sync_state VALUES(1,?1,'{}')", [group])?;
    let mut changes = Vec::new();
    for section in ["records", "values", "retired"] {
        for (store, rows) in state[section].as_object().ok_or_else(Error::invalid)? {
            for (id, row) in rows.as_object().ok_or_else(Error::invalid)? {
                changes.push(json!({"store":if section=="records" {store.clone()} else {format!("{section}:{store}")},"id":id,"before":null,"after":row["value"],"position":row["position"]}));
            }
        }
    }
    // Baselines are split by complete records, within the same transaction.
    let mut chunk = Vec::new();
    let mut bytes = 0;
    for change in changes {
        let size = change.to_string().len();
        if size > 32 * 1024 * 1024 {
            return Err(fail("sync-event-limit"));
        }
        if !chunk.is_empty() && (bytes + size > 32 * 1024 * 1024 || chunk.len() >= 10_000) {
            append(&tx, device, std::mem::take(&mut chunk))?;
            bytes = 0;
        }
        bytes += size;
        chunk.push(change);
    }
    if !chunk.is_empty() {
        append(&tx, device, chunk)?;
    }
    tx.pragma_update(None, "user_version", 18)?;
    tx.commit()?;
    status(db)
}
fn append(tx: &Transaction<'_>, device: &str, changes: Vec<Value>) -> Result<()> {
    if changes.is_empty() {
        return Ok(());
    }
    if !valid_device(device) {
        return Err(fail("sync-device-required"));
    }
    if changes.len() > 100_000 || changes.iter().any(|change| !valid_change(change)) {
        return Err(fail("sync-invalid-event"));
    }
    let (group, raw): (String, String) = tx.query_row(
        "SELECT group_id,clock FROM sync_state WHERE id=1",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let mut clock: Clock = serde_json::from_str(&raw)?;
    let sequence = clock
        .entry(device.into())
        .or_insert(0)
        .checked_add(1)
        .ok_or_else(Error::invalid)?;
    let id = format!("{device}:{sequence}");
    let event = json!({"protocol":1,"groupId":group,"id":id,"deviceId":device,"sequence":sequence,"clock":clock,"changes":changes});
    if event.to_string().len() > 64 * 1024 * 1024 {
        return Err(fail("sync-event-limit"));
    }
    tx.execute(
        "INSERT INTO sync_events(id,device,sequence,data) VALUES(?1,?2,?3,?4)",
        params![id, device, sequence as i64, event.to_string()],
    )?;
    clock.insert(device.into(), sequence);
    tx.execute(
        "UPDATE sync_state SET clock=?1 WHERE id=1",
        [serde_json::to_string(&clock)?],
    )?;
    Ok(())
}
pub fn flush(tx: &Transaction<'_>, device: Option<&str>) -> Result<()> {
    let mut changes = Vec::new();
    let mut stmt=tx.prepare("SELECT store,id,before,after,position FROM sync_changes WHERE before IS NOT after OR (after IS NOT NULL AND position IS NOT before_position) ORDER BY store,id")?;
    for row in stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, Option<String>>(2)?,
            r.get::<_, Option<String>>(3)?,
            r.get::<_, Option<i64>>(4)?,
        ))
    })? {
        let (store, id, before, after, pos) = row?;
        let mut change = json!({"store":store,"id":id,"before":before.map(|raw|serde_json::from_str::<Value>(&raw)).transpose()?,"after":after.map(|raw|serde_json::from_str::<Value>(&raw)).transpose()?});
        if !change["after"].is_null() {
            change["position"] = json!(pos.unwrap_or(0));
        }
        changes.push(change);
    }
    drop(stmt);
    if !changes.is_empty() {
        append(tx, device.ok_or(fail("sync-device-required"))?, changes)?;
    }
    tx.execute("DELETE FROM sync_changes", [])?;
    Ok(())
}
pub fn list(db: &Connection, clock: &Clock, limit: usize) -> Result<Value> {
    if clock.len() > 128 || limit == 0 || limit > 256 {
        return Err(Error::invalid());
    }
    let mut stmt=db.prepare("SELECT data FROM sync_events WHERE sequence>COALESCE((SELECT value FROM json_each(?1) WHERE key=device),0) ORDER BY device,sequence LIMIT ?2")?;
    let rows = stmt.query_map(params![serde_json::to_string(clock)?, limit as i64], |r| {
        r.get::<_, String>(0)
    })?;
    let mut events = Vec::new();
    let mut bytes = 0;
    for row in rows {
        let raw = row?;
        if bytes + raw.len() > 48 * 1024 * 1024 && !events.is_empty() {
            break;
        }
        bytes += raw.len();
        events.push(serde_json::from_str::<Value>(&raw)?);
    }
    Ok(json!(events))
}
pub fn received_clock(db: &Connection) -> Result<Clock> {
    // Only contiguous sequences are acknowledged; out-of-order delivery cannot hide a gap.
    let mut clock = Clock::new();
    let mut stmt =
        db.prepare("SELECT device,sequence FROM sync_events ORDER BY device,sequence")?;
    for row in stmt.query_map([], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? as u64))
    })? {
        let (device, seq) = row?;
        let value = clock.entry(device).or_default();
        if seq == *value + 1 {
            *value = seq;
        }
    }
    Ok(clock)
}
pub fn receive(db: &mut Connection, events: &[Value]) -> Result<Value> {
    if events.len() > 256 || serde_json::to_vec(events)?.len() > 64 * 1024 * 1024 {
        return Err(fail("sync-event-limit"));
    }
    let tx = db.transaction()?;
    let state = status(&tx)?;
    if state["groupId"].is_null() {
        return Err(fail("sync-not-enabled"));
    }
    for event in events {
        let device = event["deviceId"].as_str().ok_or_else(Error::invalid)?;
        let seq = event["sequence"]
            .as_u64()
            .filter(|n| *n > 0 && *n < 9_007_199_254_740_991)
            .ok_or_else(Error::invalid)?;
        let id = format!("{device}:{seq}");
        let clock: Clock = serde_json::from_value(event["clock"].clone())?;
        if !valid_device(device)
            || event["id"] != id
            || event["protocol"] != 1
            || event["groupId"] != state["groupId"]
            || clock.len() > 128
            || clock.get(device).copied() != Some(seq - 1)
            || clock
                .iter()
                .any(|(key, value)| !valid_device(key) || *value > 9_007_199_254_740_991)
            || event["changes"]
                .as_array()
                .is_none_or(|c| c.len() > 100_000 || c.iter().any(|change| !valid_change(change)))
            || event.as_object().is_none_or(|fields| fields.len() != 7)
        {
            return Err(fail("sync-invalid-event"));
        }
        let mut keys = std::collections::HashSet::new();
        if event["changes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|change| !keys.insert((change["store"].as_str(), change["id"].as_str())))
        {
            return Err(fail("sync-invalid-event"));
        }
        let raw = serde_json::to_string(event)?;
        let prior: Option<String> = tx
            .query_row("SELECT data FROM sync_events WHERE id=?1", [&id], |r| {
                r.get(0)
            })
            .optional()?;
        if let Some(prior) = prior {
            if serde_json::from_str::<Value>(&prior)? != *event {
                return Err(fail("sync-event-identity-conflict"));
            }
        } else {
            tx.execute(
                "INSERT INTO sync_events(id,device,sequence,data) VALUES(?1,?2,?3,?4)",
                params![id, device, seq as i64, raw],
            )?;
        }
    }
    tx.commit()?;
    Ok(json!({"receivedClock":received_clock(db)?}))
}
pub fn apply(tx: &Transaction<'_>, request: &Apply, device: Option<&str>) -> Result<()> {
    let current: Clock = serde_json::from_value(status(tx)?["clock"].clone())?;
    if current != request.expected_clock {
        return Err(fail("sync-preview-stale"));
    }
    let mut next = current.clone();
    for id in &request.applied_ids {
        let raw: String = tx.query_row("SELECT data FROM sync_events WHERE id=?1", [id], |r| {
            r.get(0)
        })?;
        let event: Value = serde_json::from_str(&raw)?;
        let deps: Clock = serde_json::from_value(event["clock"].clone())?;
        if deps
            .iter()
            .any(|(device, seq)| next.get(device).copied().unwrap_or(0) < *seq)
        {
            return Err(fail("sync-missing-dependency"));
        }
        let device = event["deviceId"].as_str().ok_or_else(Error::invalid)?;
        let seq = event["sequence"].as_u64().ok_or_else(Error::invalid)?;
        if seq != next.get(device).copied().unwrap_or(0) + 1 {
            return Err(fail("sync-invalid-clock"));
        }
        next.insert(device.into(), seq);
    }
    if next != request.clock {
        return Err(fail("sync-invalid-clock"));
    }
    for (id, value) in &request.retired_media {
        if value["id"]!=*id || !tx.query_row("SELECT EXISTS(SELECT 1 FROM assets WHERE id=?1 AND mime=json_extract(?2,'$.type') AND size=json_extract(?2,'$.size'))",params![id,value.to_string()],|r|r.get::<_,bool>(0))? {return Err(Error::invalid());}
        tx.execute("INSERT INTO retired_media VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data",params![id,value.to_string()])?;
    }
    for (namespace, rows) in request.values.as_object().ok_or_else(Error::invalid)? {
        if namespace != "settings" && !namespace.starts_with("plugin:") {
            return Err(Error::invalid());
        }
        for (id, row) in rows.as_object().ok_or_else(Error::invalid)? {
            if namespace == "settings" && !id.starts_with("plugin:") {
                return Err(Error::invalid());
            }
            if row.is_null() {
                tx.execute(
                    "DELETE FROM values_store WHERE namespace=?1 AND id=?2",
                    params![namespace, id],
                )?;
            } else {
                tx.execute("INSERT INTO values_store VALUES(?1,?2,?3) ON CONFLICT(namespace,id) DO UPDATE SET data=excluded.data",params![namespace,id,row.to_string()])?;
            }
        }
    }
    tx.execute(
        "UPDATE sync_state SET clock=?1 WHERE id=1",
        [serde_json::to_string(&next)?],
    )?;
    tx.execute("DELETE FROM sync_changes", [])?;
    // Imported projection writes are not new local edits. Only the explicit causal
    // resolution is authored here, including a no-op when the user chose the remote branch.
    if !request.resolutions.is_empty() {
        append(
            tx,
            device.ok_or(fail("sync-device-required"))?,
            request.resolutions.clone(),
        )?;
    }
    Ok(())
}

impl crate::library::Library {
    pub fn sync_bind_device(&mut self, device: &str) -> Result<()> {
        if !valid_device(device) {
            return Err(Error::invalid());
        }
        // A restored library has a new workspace identity. Two separate copies on
        // the same device must not author the same (writer, sequence) identities.
        let writer = crate::files::digest(
            format!("{device}\n{}\n{}", self.id, self.root.to_string_lossy()).as_bytes(),
        );
        self.db.sync_device = Some(writer);
        Ok(())
    }
    pub fn sync_request(&mut self, method: &str, payload: Value) -> Result<Value> {
        self.guard(&self.token.clone())?;
        match method {
            "leave" => {
                let tx = self.db.connection.transaction()?;
                tx.execute("INSERT INTO sync_archives SELECT s.group_id,e.id,e.data FROM sync_events e CROSS JOIN sync_state s WHERE 1 ON CONFLICT(group_id,id) DO NOTHING",[])?;
                tx.execute_batch(
                    "DELETE FROM sync_changes;DELETE FROM sync_events;DELETE FROM sync_state;",
                )?;
                tx.commit()?;
                status(&self.db.connection)
            }
            "start" => start(
                &mut self.db.connection,
                payload["groupId"].as_str().ok_or_else(Error::invalid)?,
                self.db
                    .sync_device
                    .as_deref()
                    .ok_or(fail("sync-device-required"))?,
            ),
            "journal/status" => {
                let mut value = status(&self.db.connection)?;
                value["receivedClock"] = json!(received_clock(&self.db.connection)?);
                Ok(value)
            }
            "journal/list" => list(
                &self.db.connection,
                &serde_json::from_value(payload["clock"].clone())?,
                payload["limit"].as_u64().unwrap_or(128) as usize,
            ),
            "journal/receive" => receive(
                &mut self.db.connection,
                payload["events"].as_array().ok_or_else(Error::invalid)?,
            ),
            "objects/info" | "objects/read" | "objects/write" | "objects/finish" => {
                self.sync_object_request(method, payload)
            }
            "snapshot" => Ok(
                json!({"snapshot":snapshot(&self.db.connection)?,"status":status(&self.db.connection)?,"revision":self.db.connection.query_row("SELECT revision FROM workspace WHERE id=1",[],|r|r.get::<_,i64>(0))?}),
            ),
            _ => Err(Error::invalid()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        library::Library,
        records::{Commit, Patch},
    };
    fn library() -> (tempfile::TempDir, Library) {
        let dir = tempfile::tempdir().unwrap();
        let mut lib = Library::create(dir.path()).unwrap();
        lib.sync_bind_device("device-a").unwrap();
        (dir, lib)
    }
    fn begin(lib: &mut Library, group: &str) {
        lib.sync_request("start", json!({"groupId":group})).unwrap();
    }
    fn value(lib: &mut Library, id: &str, value: Value) {
        lib.write(json!({"type":"value","namespace":"plugin:sample","id":id,"value":value}))
            .unwrap();
    }
    #[test]
    fn durable_values_baseline_and_atomic_local_events_exclude_device_preferences() {
        let (dir, mut lib) = library();
        value(&mut lib, "entry", json!({"data":"before"}));
        lib.write(
            json!({"type":"value","namespace":"settings","id":"repeaty.plugins","value":"private"}),
        )
        .unwrap();
        let group = uuid::Uuid::new_v4().to_string();
        begin(&mut lib, &group);
        let writer = lib.db.sync_device.clone().unwrap();
        let initial = list(&lib.db.connection, &Clock::new(), 128).unwrap();
        assert_eq!(initial.as_array().unwrap().len(), 1);
        assert_eq!(initial[0]["changes"].as_array().unwrap().len(), 1);
        value(&mut lib, "entry", json!({"data":"after"}));
        let events = list(&lib.db.connection, &Clock::new(), 128).unwrap();
        assert_eq!(events[1]["clock"][&writer], 1);
        assert_eq!(events[1]["changes"][0]["before"]["data"], "before");
        assert_eq!(events[1]["changes"][0]["after"]["data"], "after");
        assert_eq!(status(&lib.db.connection).unwrap()["pending"], 0);
        drop(lib);
        let mut reopened = Library::open(dir.path()).unwrap();
        reopened.sync_bind_device("device-a").unwrap();
        assert_eq!(reopened.db.sync_device.as_ref(), Some(&writer));
        assert_eq!(
            list(&reopened.db.connection, &Clock::new(), 128).unwrap(),
            events
        );
    }
    #[test]
    fn receive_is_staging_idempotent_and_rejects_equivocation_and_wrong_group() {
        let (_dir, mut lib) = library();
        let group = uuid::Uuid::new_v4().to_string();
        begin(&mut lib, &group);
        let event = json!({"protocol":1,"groupId":group,"id":"remote:1","deviceId":"remote","sequence":1,"clock":{"remote":0},"changes":[{"store":"values:plugin:sample","id":"a","before":null,"after":"remote","position":0}]});
        receive(&mut lib.db.connection, &[event.clone()]).unwrap();
        receive(&mut lib.db.connection, &[event.clone()]).unwrap();
        assert_eq!(status(&lib.db.connection).unwrap()["pending"], 1);
        assert!(
            snapshot(&lib.db.connection).unwrap()["values"]
                .as_object()
                .unwrap()
                .is_empty()
        );
        assert!(
            status(&lib.db.connection).unwrap()["clock"]
                .as_object()
                .unwrap()
                .is_empty()
        );
        let mut bad = event.clone();
        bad["changes"][0]["after"] = json!("forged");
        assert_eq!(
            receive(&mut lib.db.connection, &[bad]).unwrap_err().0,
            "sync-event-identity-conflict"
        );
        let mut wrong = event;
        wrong["groupId"] = json!(uuid::Uuid::new_v4().to_string());
        assert!(receive(&mut lib.db.connection, &[wrong]).is_err());
    }
    #[test]
    fn gaps_are_not_acknowledged_and_apply_is_causal_and_transactional() {
        let (_dir, mut lib) = library();
        let group = uuid::Uuid::new_v4().to_string();
        begin(&mut lib, &group);
        let event = |seq: u64| json!({"protocol":1,"groupId":group,"id":format!("remote:{seq}"),"deviceId":"remote","sequence":seq,"clock":{"remote":seq-1},"changes":[]});
        receive(&mut lib.db.connection, &[event(2)]).unwrap();
        assert_eq!(
            received_clock(&lib.db.connection).unwrap().get("remote"),
            Some(&0)
        );
        receive(&mut lib.db.connection, &[event(1)]).unwrap();
        assert_eq!(
            received_clock(&lib.db.connection).unwrap().get("remote"),
            Some(&2)
        );
        let mut request = Apply {
            expected_clock: Clock::new(),
            clock: Clock::from([("remote".into(), 2)]),
            applied_ids: vec!["remote:2".into(), "remote:1".into()],
            values: json!({"plugin:sample":{"a":"data"}}),
            resolutions: vec![],
            retired_media: BTreeMap::new(),
        };
        {
            let tx = lib.db.connection.transaction().unwrap();
            assert!(apply(&tx, &request, lib.db.sync_device.as_deref()).is_err());
        }
        assert_eq!(status(&lib.db.connection).unwrap()["pending"], 2);
        request.applied_ids.reverse();
        {
            let tx = lib.db.connection.transaction().unwrap();
            apply(&tx, &request, lib.db.sync_device.as_deref()).unwrap();
            flush(&tx, lib.db.sync_device.as_deref()).unwrap();
            tx.commit().unwrap();
        }
        assert_eq!(status(&lib.db.connection).unwrap()["pending"], 0);
        assert_eq!(
            snapshot(&lib.db.connection).unwrap()["values"]["plugin:sample"]["a"]["value"],
            "data"
        );
        assert_eq!(
            list(&lib.db.connection, &Clock::new(), 128)
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            2
        );
    }
    #[test]
    fn grading_journal_reads_only_changed_rows_and_failed_commit_rolls_back() {
        let (_dir, mut lib) = library();
        let group = uuid::Uuid::new_v4().to_string();
        begin(&mut lib, &group);
        let patch = Patch {
            store: "savedSearches".into(),
            id: "search".into(),
            position: Some(0),
            value: Some(
                json!({"id":"search","name":"Search","query":"tag:test","deckId":"","state":"all"}),
            ),
            position_only: false,
        };
        let commit = Commit {
            expected_revision: 0,
            patches: vec![patch],
            reason: None,
            operation_history: None,
            retired: None,
        };
        lib.db.commit(commit.clone()).unwrap();
        let prior = list(&lib.db.connection, &Clock::new(), 128).unwrap();
        assert!(lib.db.commit(commit).is_err());
        assert_eq!(list(&lib.db.connection, &Clock::new(), 128).unwrap(), prior);
        assert_eq!(
            lib.db
                .connection
                .query_row("SELECT count(*) FROM sync_changes", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    #[test]
    fn position_only_edits_are_logged_and_leaving_archives_events_without_deleting_data() {
        let (_dir, mut lib) = library();
        let group = uuid::Uuid::new_v4().to_string();
        begin(&mut lib, &group);
        let patches = ["a", "b"]
            .into_iter()
            .enumerate()
            .map(|(position, id)| Patch {
                store: "savedSearches".into(),
                id: id.into(),
                position: Some(position as i64),
                value: Some(json!({"id":id,"name":id,"query":"","deckId":"","state":"all"})),
                position_only: false,
            })
            .collect();
        lib.db
            .commit(Commit {
                expected_revision: 0,
                patches,
                reason: None,
                operation_history: None,
                retired: None,
            })
            .unwrap();
        let patches = ["b", "a"]
            .into_iter()
            .enumerate()
            .map(|(position, id)| Patch {
                store: "savedSearches".into(),
                id: id.into(),
                position: Some(position as i64),
                value: None,
                position_only: true,
            })
            .collect();
        lib.db
            .commit(Commit {
                expected_revision: 1,
                patches,
                reason: None,
                operation_history: None,
                retired: None,
            })
            .unwrap();
        let events = list(&lib.db.connection, &Clock::new(), 128).unwrap();
        assert_eq!(events[1]["changes"][0]["id"], "a");
        assert_eq!(events[1]["changes"][0]["position"], 1);
        assert_eq!(
            events[1]["changes"][0]["before"],
            events[1]["changes"][0]["after"]
        );
        let before = lib.db.load().unwrap();
        let left = lib.sync_request("leave", Value::Null).unwrap();
        assert!(left["groupId"].is_null());
        assert_eq!(lib.db.load().unwrap(), before);
        assert_eq!(
            lib.db
                .connection
                .query_row("SELECT count(*) FROM sync_archives", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            2
        );
        begin(&mut lib, &uuid::Uuid::new_v4().to_string());
        assert_eq!(
            list(&lib.db.connection, &Clock::new(), 128)
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }
}
