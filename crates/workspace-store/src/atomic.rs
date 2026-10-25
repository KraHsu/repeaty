//! Native primitives preserve the displaced inode, including writes through an old editor handle.
//! This is not compare-and-swap. Callers must retain every path on both success and failure.

use serde::{Deserialize, Serialize};
use std::{io, path::Path};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ReplaceMethod {
    Exchange,
    Backup,
    Unsupported,
}

pub fn replace_method() -> ReplaceMethod {
    if cfg!(any(target_os = "linux", target_os = "macos")) {
        ReplaceMethod::Exchange
    } else if cfg!(windows) {
        ReplaceMethod::Backup
    } else {
        ReplaceMethod::Unsupported
    }
}

/// On exchange platforms, `candidate` becomes the retained original. On Windows it is `backup`.
/// Never call again to "undo": a third writer may already have changed the visible target.
pub fn replace_preserving(target: &Path, candidate: &Path, backup: &Path) -> io::Result<()> {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        let _ = backup;
        unix_rename(candidate, target, true)
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::Storage::FileSystem::ReplaceFileW;
        let target = wide_path(target)?;
        let candidate = wide_path(candidate)?;
        let backup = wide_path(backup)?;
        // SAFETY: All paths are owned NUL-terminated UTF-16 buffers; reserved arguments are null.
        let result = unsafe {
            ReplaceFileW(
                target.as_ptr(),
                candidate.as_ptr(),
                backup.as_ptr(),
                0,
                std::ptr::null(),
                std::ptr::null(),
            )
        };
        if result == 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
    {
        let _ = (target, candidate, backup);
        Err(io::ErrorKind::Unsupported.into())
    }
}

/// Publish a complete new file only if the target name is vacant. No overwrite fallback.
pub fn publish_new(candidate: &Path, target: &Path) -> io::Result<()> {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        unix_rename(candidate, target, false)
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::Storage::FileSystem::{MOVEFILE_WRITE_THROUGH, MoveFileExW};
        let candidate = wide_path(candidate)?;
        let target = wide_path(target)?;
        // SAFETY: Valid NUL-terminated paths; no REPLACE_EXISTING flag is supplied.
        if unsafe { MoveFileExW(candidate.as_ptr(), target.as_ptr(), MOVEFILE_WRITE_THROUGH) } == 0
        {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
    {
        let _ = (candidate, target);
        Err(io::ErrorKind::Unsupported.into())
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn unix_rename(from: &Path, to: &Path, exchange: bool) -> io::Result<()> {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};
    let from = CString::new(from.as_os_str().as_bytes())?;
    let to = CString::new(to.as_os_str().as_bytes())?;
    #[cfg(target_os = "linux")]
    // SAFETY: Both strings remain live through the syscall. Flags request swap or no-clobber.
    let result = unsafe {
        libc::renameat2(
            libc::AT_FDCWD,
            from.as_ptr(),
            libc::AT_FDCWD,
            to.as_ptr(),
            if exchange {
                libc::RENAME_EXCHANGE
            } else {
                libc::RENAME_NOREPLACE
            },
        )
    };
    #[cfg(target_os = "macos")]
    // SAFETY: Same ownership as above; macOS provides RENAME_SWAP / RENAME_EXCL.
    let result = unsafe {
        libc::renamex_np(
            from.as_ptr(),
            to.as_ptr(),
            if exchange {
                libc::RENAME_SWAP
            } else {
                libc::RENAME_EXCL
            },
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(windows)]
fn wide_path(path: &Path) -> io::Result<Vec<u16>> {
    use std::os::windows::ffi::OsStrExt;
    let mut value: Vec<_> = path.as_os_str().encode_wide().collect();
    if value.contains(&0) {
        return Err(io::ErrorKind::InvalidInput.into());
    }
    value.push(0);
    Ok(value)
}
