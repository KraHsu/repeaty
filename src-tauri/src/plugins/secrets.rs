use super::{Permissions, Result, disk, regular};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};
use std::{collections::BTreeMap, fs::OpenOptions, path::Path};

#[derive(Clone)]
pub(super) struct Snapshot {
    pub revision: i64,
    pub origin: String,
    pub values: BTreeMap<String, String>,
}
pub(super) struct Secrets(Connection);
fn failed(_: rusqlite::Error) -> String {
    "plugin-storage-error".into()
}
fn slot_valid(slot: &str) -> bool {
    !slot.is_empty()
        && slot.len() <= 128
        && slot
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
}
impl Secrets {
    pub fn open(path: &Path) -> Result<Self> {
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            use windows_sys::Win32::{
                Foundation::{GENERIC_READ, GENERIC_WRITE},
                Storage::FileSystem::WRITE_DAC,
            };
            options
                .custom_flags(0x00200000)
                .access_mode(GENERIC_READ | GENERIC_WRITE | WRITE_DAC);
        }
        let file = options.open(path).map_err(disk)?;
        regular(&file)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(std::fs::Permissions::from_mode(0o600))
                .map_err(disk)?;
        }
        #[cfg(windows)]
        super::windows_permissions::restrict(&file).map_err(disk)?;
        let connection = Connection::open(path).map_err(failed)?;
        connection
            .busy_timeout(std::time::Duration::from_secs(5))
            .map_err(failed)?;
        connection.execute_batch("PRAGMA secure_delete=ON;
            CREATE TABLE IF NOT EXISTS plugin_secrets(plugin TEXT NOT NULL,slot TEXT NOT NULL,origin TEXT NOT NULL,revision INTEGER NOT NULL,values_json TEXT,PRIMARY KEY(plugin,slot));
            CREATE TABLE IF NOT EXISTS plugin_trust(hash TEXT PRIMARY KEY);").map_err(failed)?;
        Ok(Self(connection))
    }
    pub fn trust(&self, hash: &str) -> Result<()> {
        if hash.len() != 64
            || !hash
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err("invalid-data".into());
        }
        self.0
            .execute("INSERT OR IGNORE INTO plugin_trust VALUES(?1)", [hash])
            .map_err(failed)?;
        Ok(())
    }
    pub fn trusted(&self, hash: &str) -> Result<bool> {
        self.0
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM plugin_trust WHERE hash=?1)",
                [hash],
                |row| row.get(0),
            )
            .map_err(failed)
    }
    pub fn trust_state(&self) -> Result<Value> {
        let mut statement = self
            .0
            .prepare("SELECT hash FROM plugin_trust ORDER BY hash")
            .map_err(failed)?;
        let hashes = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(failed)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(failed)?;
        Ok(json!({"hashes":hashes}))
    }
    pub fn snapshot(&self, id: &str, slot: &str) -> Result<Option<Snapshot>> {
        if !slot_valid(slot) {
            return Err("invalid-data".into());
        }
        let row: Option<(String,i64,String)> = self.0.query_row("SELECT origin,revision,values_json FROM plugin_secrets WHERE plugin=?1 AND slot=?2 AND values_json IS NOT NULL", params![id,slot], |row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).optional().map_err(failed)?;
        row.map(|(origin, revision, raw)| {
            Ok(Snapshot {
                origin,
                revision,
                values: serde_json::from_str(&raw).map_err(|_| "plugin-storage-error")?,
            })
        })
        .transpose()
    }
    fn state(&self, id: &str, slot: Option<&str>) -> Result<Value> {
        if slot.is_some_and(|slot| !slot_valid(slot)) {
            return Err("invalid-data".into());
        }
        let mut statement = self.0.prepare("SELECT slot,origin,revision FROM plugin_secrets WHERE plugin=?1 AND values_json IS NOT NULL AND (?2 IS NULL OR slot=?2) ORDER BY slot").map_err(failed)?;
        let slots = statement.query_map(params![id,slot], |row|Ok(json!({"slot":row.get::<_,String>(0)?,"origin":row.get::<_,String>(1)?,"revision":row.get::<_,i64>(2)?}))).map_err(failed)?.collect::<std::result::Result<Vec<_>,_>>().map_err(failed)?;
        Ok(json!({"slots":slots}))
    }
    pub fn operation(
        &mut self,
        id: &str,
        permissions: &Permissions,
        payload: Value,
    ) -> Result<Value> {
        match payload["action"].as_str() {
            Some("state") => self.state(id, payload["slot"].as_str()),
            Some(action @ ("set" | "clear")) => {
                let slot = payload["slot"]
                    .as_str()
                    .filter(|s| slot_valid(s))
                    .ok_or("invalid-data")?;
                let tx = self.0.transaction().map_err(failed)?;
                let old: Option<(String, i64)> = tx
                    .query_row(
                        "SELECT origin,revision FROM plugin_secrets WHERE plugin=?1 AND slot=?2",
                        params![id, slot],
                        |row| Ok((row.get(0)?, row.get(1)?)),
                    )
                    .optional()
                    .map_err(failed)?;
                let (origin, values) = if action == "set" {
                    let origin = payload["origin"].as_str().ok_or("invalid-data")?;
                    if super::http::origin(origin)? != origin
                        || !permissions.origins.iter().any(|allowed| allowed == origin)
                    {
                        return Err("permission-denied".into());
                    }
                    let values: BTreeMap<String, String> =
                        serde_json::from_value(payload["values"].clone())
                            .map_err(|_| "invalid-data")?;
                    if values.is_empty()
                        || values.len() > 64
                        || values.iter().any(|(key, value)| {
                            key.is_empty()
                                || key.len() > 64
                                || !key
                                    .bytes()
                                    .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
                                || value.len() > 8192
                                || value.chars().any(char::is_control)
                        })
                    {
                        return Err("invalid-data".into());
                    }
                    (
                        origin.to_owned(),
                        Some(serde_json::to_string(&values).map_err(|_| "invalid-data")?),
                    )
                } else {
                    (
                        old.as_ref().map(|old| old.0.clone()).unwrap_or_default(),
                        None,
                    )
                };
                let revision = old
                    .map(|old| old.1)
                    .unwrap_or(0)
                    .checked_add(1)
                    .filter(|r| *r <= 9_007_199_254_740_991)
                    .ok_or("plugin-limit")?;
                let count: i64 = tx
                    .query_row(
                        "SELECT COUNT(*) FROM plugin_secrets WHERE plugin=?1",
                        [id],
                        |row| row.get(0),
                    )
                    .map_err(failed)?;
                if count >= 128 && !tx.query_row("SELECT EXISTS(SELECT 1 FROM plugin_secrets WHERE plugin=?1 AND slot=?2)",params![id,slot],|row|row.get::<_,bool>(0)).map_err(failed)? { return Err("plugin-limit".into()); }
                tx.execute("INSERT INTO plugin_secrets VALUES(?1,?2,?3,?4,?5) ON CONFLICT(plugin,slot) DO UPDATE SET origin=excluded.origin,revision=excluded.revision,values_json=excluded.values_json",params![id,slot,origin,revision,values]).map_err(failed)?;
                tx.commit().map_err(failed)?;
                self.state(id, None)
            }
            _ => Err("invalid-data".into()),
        }
    }
}
