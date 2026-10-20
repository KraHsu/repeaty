//! A private, process-owned rendezvous file keeps stdio client configurations stable.
use serde::{Deserialize, Serialize};
use std::{
    fs::{File, OpenOptions, TryLockError},
    io::{Read, Write},
    path::{Path, PathBuf},
};

const MAX_CONNECTION_BYTES: u64 = 4096;

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Connection {
    version: u8,
    pub url: String,
    pub token: String,
}
pub(super) struct Lease {
    path: PathBuf,
    _lock: File,
}
impl Lease {
    pub fn publish(path: &Path, url: &str, token: &str) -> Result<Self, &'static str> {
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let lock = options
            .open(path.with_extension("lock"))
            .map_err(|_| "mcp-connection-file-failed")?;
        lock.try_lock().map_err(|error| match error {
            TryLockError::WouldBlock => "mcp-already-running",
            _ => "mcp-connection-file-failed",
        })?;
        let parent = path.parent().ok_or("mcp-connection-file-failed")?;
        let mut temporary =
            tempfile::NamedTempFile::new_in(parent).map_err(|_| "mcp-connection-file-failed")?;
        let connection = Connection {
            version: 1,
            url: url.into(),
            token: token.into(),
        };
        serde_json::to_writer(temporary.as_file_mut(), &connection)
            .map_err(|_| "mcp-connection-file-failed")?;
        temporary
            .flush()
            .map_err(|_| "mcp-connection-file-failed")?;
        temporary
            .persist(path)
            .map_err(|_| "mcp-connection-file-failed")?;
        Ok(Self {
            path: path.into(),
            _lock: lock,
        })
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        // Remove under the exclusive lease so an older process cannot delete a new endpoint.
        let _ = std::fs::remove_file(&self.path);
    }
}
impl Connection {
    pub fn read(path: &Path) -> Result<Self, &'static str> {
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .open(path.with_extension("lock"))
            .map_err(|_| "library-unavailable")?;
        // An unowned file is stale, even if another process has since reused its port.
        if !matches!(lock.try_lock(), Err(TryLockError::WouldBlock)) {
            return Err("library-unavailable");
        }
        let file = File::open(path).map_err(|_| "library-unavailable")?;
        if !file
            .metadata()
            .is_ok_and(|meta| meta.is_file() && meta.len() <= MAX_CONNECTION_BYTES)
        {
            return Err("library-unavailable");
        }
        let mut bytes = Vec::new();
        file.take(MAX_CONNECTION_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "library-unavailable")?;
        if bytes.len() as u64 > MAX_CONNECTION_BYTES {
            return Err("library-unavailable");
        }
        let value: Self = serde_json::from_slice(&bytes).map_err(|_| "library-unavailable")?;
        let url = reqwest::Url::parse(&value.url).map_err(|_| "library-unavailable")?;
        if value.version != 1
            || value.token.len() != 64
            || !value.token.bytes().all(|byte| byte.is_ascii_hexdigit())
            || url.scheme() != "http"
            || url.host_str() != Some("127.0.0.1")
            || url.port().is_none_or(|port| port == 0)
            || url.path() != "/mcp"
            || url.query().is_some()
            || url.fragment().is_some()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err("library-unavailable");
        }
        Ok(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const TOKEN: &str = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

    #[test]
    fn leases_are_exclusive_private_revocable_and_reusable_after_restart() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("mcp.connection.json");
        let lease = Lease::publish(&path, "http://127.0.0.1:43123/mcp", TOKEN).unwrap();
        assert_eq!(Connection::read(&path).unwrap().token, TOKEN);
        assert!(matches!(
            Lease::publish(&path, "http://127.0.0.1:43124/mcp", TOKEN),
            Err("mcp-already-running")
        ));
        assert_eq!(
            Connection::read(&path).unwrap().url,
            "http://127.0.0.1:43123/mcp"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        drop(lease);
        assert!(!path.exists());
        let _new = Lease::publish(&path, "http://127.0.0.1:43124/mcp", TOKEN).unwrap();
        assert_eq!(
            Connection::read(&path).unwrap().url,
            "http://127.0.0.1:43124/mcp"
        );
    }

    #[test]
    fn stale_oversized_and_external_connection_files_cannot_send_credentials() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("mcp.connection.json");
        let lease = Lease::publish(&path, "http://127.0.0.1:43123/mcp", TOKEN).unwrap();
        for url in [
            "https://127.0.0.1:43123/mcp",
            "http://example.org:43123/mcp",
            "http://localhost:43123/mcp",
            "http://user@127.0.0.1:43123/mcp",
            "http://127.0.0.1:43123/mcp?token=secret",
            "http://127.0.0.1:43123/other",
            "http://127.0.0.1:0/mcp",
        ] {
            std::fs::write(
                &path,
                serde_json::to_vec(&Connection {
                    version: 1,
                    url: url.into(),
                    token: TOKEN.into(),
                })
                .unwrap(),
            )
            .unwrap();
            assert!(Connection::read(&path).is_err(), "{url}");
        }
        std::fs::write(&path, "x".repeat(5000)).unwrap();
        assert!(Connection::read(&path).is_err());
        let stale = serde_json::to_vec(&Connection {
            version: 1,
            url: "http://127.0.0.1:43123/mcp".into(),
            token: TOKEN.into(),
        })
        .unwrap();
        drop(lease);
        std::fs::write(&path, stale).unwrap();
        assert!(Connection::read(&path).is_err());
    }
}
