use crate::{
    error::{Error, Result},
    leetcode::Credentials,
};
use rusqlite::{Connection, params};
use std::{collections::HashMap, path::Path};

pub(crate) const SITES: [&str; 2] = ["leetcode.cn", "leetcode.com"];

pub(crate) fn valid_cookie(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 8192
        && value.bytes().all(|b| b.is_ascii_graphic() && b != b';')
}

/// Kept outside the study database, checkpoints and portable exports.
/// NULL rows explicitly disable environment credentials, including after restart.
pub(crate) struct CredentialStore {
    connection: Connection,
    effective: HashMap<String, Credentials>,
}
impl CredentialStore {
    pub(crate) fn open(
        path: &Path,
        mut fallback: HashMap<String, Credentials>,
    ) -> std::result::Result<Self, Box<dyn std::error::Error>> {
        if path != Path::new(":memory:") {
            let mut options = std::fs::OpenOptions::new();
            options.read(true).write(true).create(true).truncate(false);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            #[cfg(windows)]
            {
                use std::os::windows::fs::OpenOptionsExt;
                use windows_sys::Win32::{
                    Foundation::{GENERIC_READ, GENERIC_WRITE},
                    Storage::FileSystem::WRITE_DAC,
                };
                options.access_mode(GENERIC_READ | GENERIC_WRITE | WRITE_DAC);
            }
            let file = options.open(path)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
            }
            #[cfg(windows)]
            crate::windows_permissions::restrict(&file)?;
        }
        let connection = Connection::open(path)?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        connection.pragma_update(None, "secure_delete", "ON")?;
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS credentials (
                site TEXT PRIMARY KEY CHECK(site IN ('leetcode.cn','leetcode.com')),
                session TEXT, csrf TEXT,
                CHECK((session IS NULL) = (csrf IS NULL))
            );",
        )?;
        {
            let mut query = connection.prepare("SELECT site, session, csrf FROM credentials")?;
            let rows = query.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            })?;
            for row in rows {
                let (site, session, csrf) = row?;
                match (session, csrf) {
                    (Some(session), Some(csrf))
                        if valid_cookie(&session) && valid_cookie(&csrf) =>
                    {
                        fallback.insert(site, Credentials { session, csrf });
                    }
                    (None, None) => {
                        fallback.remove(&site);
                    }
                    _ => return Err("Invalid stored LeetCode credentials".into()),
                }
            }
        }
        Ok(Self {
            connection,
            effective: fallback,
        })
    }
    pub(crate) fn configured(&self) -> Vec<String> {
        SITES
            .iter()
            .filter(|site| self.effective.contains_key(**site))
            .map(|site| (*site).to_string())
            .collect()
    }
    pub(crate) fn get(&self, site: &str) -> Option<Credentials> {
        self.effective.get(site).cloned()
    }
    pub(crate) fn set(&mut self, site: &str, credentials: Option<Credentials>) -> Result<()> {
        if !SITES.contains(&site)
            || credentials
                .as_ref()
                .is_some_and(|c| !valid_cookie(&c.session) || !valid_cookie(&c.csrf))
        {
            return Err(Error::invalid());
        }
        self.connection.execute(
            "INSERT INTO credentials(site, session, csrf) VALUES (?1,?2,?3)
             ON CONFLICT(site) DO UPDATE SET session=excluded.session, csrf=excluded.csrf",
            params![
                site,
                credentials.as_ref().map(|c| &c.session),
                credentials.as_ref().map(|c| &c.csrf)
            ],
        )?;
        if let Some(credentials) = credentials {
            self.effective.insert(site.into(), credentials);
        } else {
            self.effective.remove(site);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn value(session: &str) -> Credentials {
        Credentials {
            session: session.into(),
            csrf: "test-csrf".into(),
        }
    }
    #[test]
    fn persists_replacements_and_clears_without_restoring_environment_values() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("credentials.sqlite3");
        let fallback = HashMap::from([("leetcode.cn".into(), value("environment"))]);
        let mut store = CredentialStore::open(&path, fallback.clone()).unwrap();
        assert_eq!(store.get("leetcode.cn").unwrap().session, "environment");
        store.set("leetcode.cn", Some(value("first"))).unwrap();
        store
            .set("leetcode.com", Some(value("international")))
            .unwrap();
        store
            .set("leetcode.cn", Some(value("replacement")))
            .unwrap();
        drop(store);
        let mut store = CredentialStore::open(&path, fallback.clone()).unwrap();
        assert_eq!(store.get("leetcode.cn").unwrap().session, "replacement");
        assert_eq!(store.get("leetcode.com").unwrap().session, "international");
        store.set("leetcode.cn", None).unwrap();
        drop(store);
        let store = CredentialStore::open(&path, fallback).unwrap();
        assert!(store.get("leetcode.cn").is_none());
        assert_eq!(store.configured(), vec!["leetcode.com"]);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }
    #[test]
    fn invalid_or_failed_writes_keep_the_previous_configuration() {
        let mut store = CredentialStore::open(Path::new(":memory:"), HashMap::new()).unwrap();
        store.set("leetcode.cn", Some(value("original"))).unwrap();
        for session in ["", "bad;cookie", "bad\r\nheader", "with space"] {
            assert!(store.set("leetcode.cn", Some(value(session))).is_err());
        }
        assert!(store.set("localhost", Some(value("other"))).is_err());
        assert!(
            store
                .set("leetcode.cn", Some(value(&"x".repeat(8193))))
                .is_err()
        );
        store
            .connection
            .pragma_update(None, "query_only", "ON")
            .unwrap();
        assert!(store.set("leetcode.cn", Some(value("not-saved"))).is_err());
        assert!(store.set("leetcode.cn", None).is_err());
        assert_eq!(store.get("leetcode.cn").unwrap().session, "original");
    }
}
