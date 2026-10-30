//! Host-owned identity and peer grants. Nothing here is stored in a learning directory.
use super::{Peer, Result, digest};
use rusqlite::{Connection, OptionalExtension, params};
use std::{
    fs::{File, OpenOptions},
    path::Path,
};

#[cfg(windows)]
mod windows_permissions;

pub(super) struct Identity {
    pub id: String,
    pub name: String,
    pub cert: Vec<u8>,
    pub key: Vec<u8>,
}
pub(super) struct Store(Connection);
fn disk<T>(_: T) -> String {
    "sync-storage-error".into()
}

fn protect(file: &File) -> Result<()> {
    let meta = file.metadata().map_err(disk)?;
    if !meta.is_file() || meta.file_type().is_symlink() {
        return Err(disk(()));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        if meta.nlink() != 1 {
            return Err(disk(()));
        }
        file.set_permissions(std::fs::Permissions::from_mode(0o600))
            .map_err(disk)?;
    }
    #[cfg(windows)]
    {
        use std::os::windows::{fs::MetadataExt, io::AsRawHandle};
        use windows_sys::Win32::Storage::FileSystem::{
            BY_HANDLE_FILE_INFORMATION, GetFileInformationByHandle,
        };
        if meta.file_attributes() & 0x400 != 0 {
            return Err(disk(()));
        }
        // SAFETY: the handle is live and the initialized result buffer is writable.
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0
            || info.nNumberOfLinks != 1
        {
            return Err(disk(()));
        }
        windows_permissions::restrict(file).map_err(disk)?;
    }
    Ok(())
}

impl Store {
    pub fn open(directory: &Path) -> Result<(Self, Identity)> {
        std::fs::create_dir_all(directory).map_err(disk)?;
        let directory = directory.join("device-sync");
        match std::fs::create_dir(&directory) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(disk(error)),
        }
        let metadata = std::fs::symlink_metadata(&directory).map_err(disk)?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(disk(()));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
            let handle = OpenOptions::new()
                .read(true)
                .custom_flags(libc::O_NOFOLLOW | libc::O_DIRECTORY)
                .open(&directory)
                .map_err(disk)?;
            handle
                .set_permissions(std::fs::Permissions::from_mode(0o700))
                .map_err(disk)?;
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
            use windows_sys::Win32::{Foundation::GENERIC_READ, Storage::FileSystem::WRITE_DAC};
            if metadata.file_attributes() & 0x400 != 0 {
                return Err(disk(()));
            }
            let handle = OpenOptions::new()
                .read(true)
                .custom_flags(0x02000000 | 0x00200000)
                .access_mode(GENERIC_READ | WRITE_DAC)
                .open(&directory)
                .map_err(disk)?;
            windows_permissions::restrict(&handle).map_err(disk)?;
        }
        let path = directory.join("device-sync.sqlite3");
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
        let file = options.open(&path).map_err(disk)?;
        protect(&file)?;
        let mut connection = Connection::open(&path).map_err(disk)?;
        connection
            .busy_timeout(std::time::Duration::from_secs(5))
            .map_err(disk)?;
        // DELETE avoids a persistent WAL containing key material beside the protected database.
        connection.execute_batch("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;
            CREATE TABLE IF NOT EXISTS identity(slot INTEGER PRIMARY KEY CHECK(slot=1),name TEXT NOT NULL,cert BLOB NOT NULL,key BLOB NOT NULL);
            CREATE TABLE IF NOT EXISTS peers(group_id TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,address TEXT NOT NULL,cert BLOB NOT NULL,PRIMARY KEY(group_id,id));").map_err(disk)?;
        let tx = connection.transaction().map_err(disk)?;
        let stored: Option<(String, Vec<u8>, Vec<u8>)> = tx
            .query_row("SELECT name,cert,key FROM identity WHERE slot=1", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .optional()
            .map_err(disk)?;
        let (name, cert, key) = match stored {
            Some(stored) => stored,
            None => {
                let generated = rcgen::generate_simple_self_signed(vec!["repeaty-sync".into()])
                    .map_err(|_| "sync-identity-error")?;
                let cert = generated.cert.der().to_vec();
                let key = generated.signing_key.serialize_der();
                let name = format!("Repeaty {}", &digest(&cert)[..8]);
                tx.execute(
                    "INSERT INTO identity VALUES(1,?1,?2,?3)",
                    params![name, cert, key],
                )
                .map_err(disk)?;
                (name, cert, key)
            }
        };
        tx.commit().map_err(disk)?;
        if cert.len() > 8192 || key.len() > 8192 {
            return Err("sync-identity-error".into());
        }
        Ok((
            Self(connection),
            Identity {
                id: digest(&cert),
                name,
                cert,
                key,
            },
        ))
    }
    pub fn peers(&self, group: &str) -> Result<Vec<Peer>> {
        let mut stmt = self
            .0
            .prepare("SELECT id,name,address,cert FROM peers WHERE group_id=?1 ORDER BY id")
            .map_err(disk)?;
        stmt.query_map([group], |r| {
            Ok(Peer {
                id: r.get(0)?,
                name: r.get(1)?,
                address: r.get(2)?,
                cert: r.get(3)?,
            })
        })
        .map_err(disk)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(disk)
    }
    pub fn save(&self, group: &str, peer: &Peer) -> Result<()> {
        self.0.execute("INSERT INTO peers VALUES(?1,?2,?3,?4,?5) ON CONFLICT(group_id,id) DO UPDATE SET name=excluded.name,address=excluded.address,cert=excluded.cert", params![group,peer.id,peer.name,peer.address,peer.cert]).map_err(disk)?;
        Ok(())
    }
    pub fn remove(&self, group: &str, id: &str) -> Result<()> {
        self.0
            .execute(
                "DELETE FROM peers WHERE group_id=?1 AND id=?2",
                params![group, id],
            )
            .map_err(disk)?;
        Ok(())
    }
}
