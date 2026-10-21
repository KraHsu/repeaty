use std::{
    fs::File,
    io,
    mem::size_of,
    os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
    ptr::null_mut,
};
use windows_sys::Win32::{
    Foundation::{ERROR_INSUFFICIENT_BUFFER, ERROR_SUCCESS},
    Security::{
        ACCESS_ALLOWED_ACE, ACL, ACL_REVISION, AddAccessAllowedAceEx,
        Authorization::{SE_FILE_OBJECT, SetSecurityInfo},
        DACL_SECURITY_INFORMATION, GetLengthSid, GetTokenInformation, InitializeAcl,
        PROTECTED_DACL_SECURITY_INFORMATION, TOKEN_QUERY, TOKEN_USER, TokenUser,
    },
    Storage::FileSystem::FILE_ALL_ACCESS,
    System::Threading::{GetCurrentProcess, OpenProcessToken},
};

// The TOKEN_USER contains a SID pointing into this buffer. usize storage keeps both
// the structure and its SID aligned, and the buffer stays alive while they are used.
fn current_user() -> io::Result<Vec<usize>> {
    let mut raw = null_mut();
    // SAFETY: the output points to a valid handle slot; the pseudo process handle is borrowed.
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut raw) } == 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: OpenProcessToken returned a new owned handle on success.
    let token = unsafe { OwnedHandle::from_raw_handle(raw) };
    let mut size = 0;
    // SAFETY: a null, zero-length buffer requests the required size without writing to it.
    unsafe { GetTokenInformation(token.as_raw_handle(), TokenUser, null_mut(), 0, &mut size) };
    let error = io::Error::last_os_error();
    if error.raw_os_error() != Some(ERROR_INSUFFICIENT_BUFFER as i32) {
        return Err(error);
    }
    if (size as usize) < size_of::<TOKEN_USER>() {
        return Err(io::Error::other("Invalid Windows token user size"));
    }
    let mut buffer = vec![0usize; (size as usize).div_ceil(size_of::<usize>())];
    // SAFETY: the aligned buffer is at least `size` bytes long; the token handle is live.
    if unsafe {
        GetTokenInformation(
            token.as_raw_handle(),
            TokenUser,
            buffer.as_mut_ptr().cast(),
            size,
            &mut size,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    Ok(buffer)
}

/// Replace inherited and explicit grants with one grant for the actual process user.
/// Errors must stop opening the credential store before SQLite reads or writes it.
pub(crate) fn restrict(file: &File) -> io::Result<()> {
    let user = current_user()?;
    // SAFETY: GetTokenInformation populated an aligned TOKEN_USER and its SID in `user`.
    let sid = unsafe { (*user.as_ptr().cast::<TOKEN_USER>()).User.Sid };
    // SAFETY: the SID belongs to the still-live token information buffer.
    let size = size_of::<ACL>() + size_of::<ACCESS_ALLOWED_ACE>() - size_of::<u32>()
        + unsafe { GetLengthSid(sid) } as usize;
    let mut buffer = vec![0u32; size.div_ceil(size_of::<u32>())];
    let acl = buffer.as_mut_ptr().cast::<ACL>();
    // SAFETY: the ACL buffer is aligned and has room for its header and one complete ACE.
    if unsafe { InitializeAcl(acl, size as u32, ACL_REVISION) } == 0
        || unsafe { AddAccessAllowedAceEx(acl, ACL_REVISION, 0, FILE_ALL_ACCESS, sid) } == 0
    {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: the handle is live and was opened with WRITE_DAC; `acl` is a non-null,
    // initialized ACL. Protection prevents grants from the parent being added again.
    let status = unsafe {
        SetSecurityInfo(
            file.as_raw_handle(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            null_mut(),
            null_mut(),
            acl,
            null_mut(),
        )
    };
    if status != ERROR_SUCCESS {
        return Err(io::Error::from_raw_os_error(status as i32));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::leetcode_credentials::CredentialStore;
    use std::{collections::HashMap, fs::OpenOptions, os::windows::fs::OpenOptionsExt};
    use windows_sys::Win32::{
        Foundation::{GENERIC_READ, GENERIC_WRITE, LocalFree},
        Security::{
            Authorization::{
                ConvertStringSecurityDescriptorToSecurityDescriptorW, GetSecurityInfo,
            },
            EqualSid, GetAce, GetSecurityDescriptorControl, GetSecurityDescriptorDacl,
            PSECURITY_DESCRIPTOR, SE_DACL_PROTECTED,
        },
        Storage::FileSystem::WRITE_DAC,
    };

    struct Descriptor(PSECURITY_DESCRIPTOR);
    impl Drop for Descriptor {
        fn drop(&mut self) {
            // SAFETY: the Windows security APIs allocate these descriptors with LocalAlloc.
            unsafe { LocalFree(self.0) };
        }
    }

    fn assert_private(file: &File) {
        let mut acl = null_mut();
        let mut descriptor = null_mut();
        // SAFETY: all output slots are valid, and the file handle is borrowed and live.
        assert_eq!(
            unsafe {
                GetSecurityInfo(
                    file.as_raw_handle(),
                    SE_FILE_OBJECT,
                    DACL_SECURITY_INFORMATION,
                    null_mut(),
                    null_mut(),
                    &mut acl,
                    null_mut(),
                    &mut descriptor,
                )
            },
            ERROR_SUCCESS
        );
        let descriptor = Descriptor(descriptor);
        let mut control = 0;
        let mut revision = 0;
        // SAFETY: the returned descriptor and its ACL remain live until the end of this scope.
        unsafe {
            assert_ne!(
                GetSecurityDescriptorControl(descriptor.0, &mut control, &mut revision),
                0
            );
            assert_ne!(control & SE_DACL_PROTECTED, 0);
            assert!(!acl.is_null());
            assert_eq!((*acl).AceCount, 1);
            let mut ace = null_mut();
            assert_ne!(GetAce(acl, 0, &mut ace), 0);
            let ace = &*ace.cast::<ACCESS_ALLOWED_ACE>();
            assert_eq!(ace.Header.AceType, 0); // ACCESS_ALLOWED_ACE_TYPE
            assert_eq!(ace.Header.AceFlags, 0);
            assert_eq!(ace.Mask, FILE_ALL_ACCESS);
            let user = current_user().unwrap();
            assert_ne!(
                EqualSid(
                    (&ace.SidStart as *const u32).cast_mut().cast(),
                    (*user.as_ptr().cast::<TOKEN_USER>()).User.Sid,
                ),
                0
            );
        }
    }

    #[test]
    fn credential_store_replaces_broad_grants_and_stays_readable_after_restart() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("力扣 credentials.sqlite3");
        let file = OpenOptions::new()
            .write(true)
            .access_mode(GENERIC_READ | GENERIC_WRITE | WRITE_DAC)
            .create_new(true)
            .open(&path)
            .unwrap();
        // Simulate a legacy file with a broad explicit grant, beyond inherited permissions.
        let sddl: Vec<u16> = "D:(A;;FA;;;WD)".encode_utf16().chain(Some(0)).collect();
        let mut descriptor = null_mut();
        // SAFETY: the SDDL is NUL-terminated, and the descriptor is freed by its guard.
        unsafe {
            assert_ne!(
                ConvertStringSecurityDescriptorToSecurityDescriptorW(
                    sddl.as_ptr(),
                    1,
                    &mut descriptor,
                    null_mut()
                ),
                0
            );
        }
        let descriptor = Descriptor(descriptor);
        let mut present = 0;
        let mut defaulted = 0;
        let mut acl = null_mut();
        // SAFETY: the descriptor, ACL and file stay live through the permission change.
        unsafe {
            assert_ne!(
                GetSecurityDescriptorDacl(descriptor.0, &mut present, &mut acl, &mut defaulted),
                0
            );
            assert_ne!(present, 0);
            assert_eq!(
                SetSecurityInfo(
                    file.as_raw_handle(),
                    SE_FILE_OBJECT,
                    DACL_SECURITY_INFORMATION,
                    null_mut(),
                    null_mut(),
                    acl,
                    null_mut()
                ),
                ERROR_SUCCESS
            );
        }
        drop(file);
        let mut store = CredentialStore::open(&path, HashMap::new()).unwrap();
        assert_private(&File::open(&path).unwrap());
        store
            .set(
                "leetcode.cn",
                Some(crate::leetcode::Credentials {
                    session: "test-session".into(),
                    csrf: "test-csrf".into(),
                }),
            )
            .unwrap();
        drop(store);
        let store = CredentialStore::open(&path, HashMap::new()).unwrap();
        assert_eq!(store.get("leetcode.cn").unwrap().session, "test-session");
        assert_private(&File::open(&path).unwrap());
    }

    #[test]
    fn permission_failures_are_returned_instead_of_ignored() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("credentials.sqlite3");
        File::create(&path).unwrap();
        let read_only = File::open(path).unwrap();
        assert_eq!(restrict(&read_only).unwrap_err().raw_os_error(), Some(5));
    }
}
