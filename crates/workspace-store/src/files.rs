use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Seek, Write},
    path::Path,
};

pub const MAX_TEXT_BYTES: u64 = 2 * 1024 * 1024;

pub fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

/// Prototype roots are private and fixed. Full capability-based directory traversal is an M1 gate.
pub fn regular_file(path: &Path) -> io::Result<File> {
    open_regular(path, false)
}

// FlushFileBuffers requires a writable handle on Windows, unlike Unix fsync.
pub fn sync_regular_file(path: &Path) -> io::Result<()> {
    open_regular(path, true)?.sync_all()
}

fn open_regular(path: &Path, writable: bool) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true).write(writable);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = options.open(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "not a regular file",
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "hard-linked file",
            ));
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "reparse point"));
        }
    }
    Ok(file)
}

pub fn read_stable(path: &Path) -> io::Result<Vec<u8>> {
    let mut file = regular_file(path)?;
    let before = file.metadata()?;
    if before.len() > MAX_TEXT_BYTES {
        return Err(io::ErrorKind::FileTooLarge.into());
    }
    let mut first = Vec::new();
    (&mut file)
        .take(MAX_TEXT_BYTES + 1)
        .read_to_end(&mut first)?;
    file.rewind()?;
    let mut second = Vec::new();
    (&mut file)
        .take(MAX_TEXT_BYTES + 1)
        .read_to_end(&mut second)?;
    let after = file.metadata()?;
    if first != second
        || first.len() as u64 > MAX_TEXT_BYTES
        || before.len() != after.len()
        || before.modified()? != after.modified()?
    {
        return Err(io::Error::new(
            io::ErrorKind::WouldBlock,
            "file changed while reading",
        ));
    }
    Ok(first)
}

pub fn write_new(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    sync_directory(path.parent().ok_or(io::ErrorKind::InvalidInput)?)
}

pub fn create_private_dir(path: &Path) -> io::Result<()> {
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path)?;
    sync_directory(path.parent().ok_or(io::ErrorKind::InvalidInput)?)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyncCoverage {
    FileAndDirectory,
    FileOnly,
}

pub const fn sync_coverage() -> SyncCoverage {
    if cfg!(unix) {
        SyncCoverage::FileAndDirectory
    } else {
        SyncCoverage::FileOnly
    }
}

pub fn sync_directory(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        File::open(path)?.sync_all()
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Ok(())
    } // Explicit FileOnly coverage; no claim of Windows power-loss durability.
}
