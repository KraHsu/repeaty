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
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::{
            Authorization::GetSecurityInfo, EqualSid, GetAce, GetSecurityDescriptorControl,
            SE_DACL_PROTECTED,
        },
    };
    #[test]
    fn generic_secret_store_only_grants_the_current_user_and_persists_after_reopen() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("plugin-secrets.sqlite3");
        let mut store = super::super::secrets::Secrets::open(&path).unwrap();
        let permissions = super::super::Permissions {
            origins: vec!["https://example.org".into()],
            secrets: true,
            files: false,
            models: false,
            network: false,
        };
        store.operation("sample",&permissions,serde_json::json!({"action":"set","slot":"site","origin":"https://example.org","values":{"session":"kept"}})).unwrap();
        drop(store);
        let store = super::super::secrets::Secrets::open(&path).unwrap();
        assert_eq!(
            store.snapshot("sample", "site").unwrap().unwrap().values["session"],
            "kept"
        );
        let file = File::open(&path).unwrap();
        let mut acl = null_mut();
        let mut descriptor = null_mut();
        // SAFETY: the file handle is live and all output pointers are valid.
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
        assert!(!descriptor.is_null());
        assert!(!acl.is_null());
        let mut control = 0;
        let mut revision = 0;
        // SAFETY: GetSecurityInfo returned a valid descriptor and ACL retained until LocalFree below.
        unsafe {
            assert_ne!(
                GetSecurityDescriptorControl(descriptor, &mut control, &mut revision),
                0
            );
            assert_ne!(control & SE_DACL_PROTECTED, 0);
            assert_eq!((*acl).AceCount, 1);
            let mut ace = null_mut();
            assert_ne!(GetAce(acl, 0, &mut ace), 0);
            let ace = &*ace.cast::<ACCESS_ALLOWED_ACE>();
            assert_eq!(ace.Header.AceType, 0);
            assert_eq!(ace.Header.AceFlags, 0);
            assert_eq!(ace.Mask, FILE_ALL_ACCESS);
            let user = current_user().unwrap();
            assert_ne!(
                EqualSid(
                    (&ace.SidStart as *const u32).cast_mut().cast(),
                    (*user.as_ptr().cast::<TOKEN_USER>()).User.Sid
                ),
                0
            );
            LocalFree(descriptor);
        }
    }
    #[test]
    fn permission_errors_are_returned_before_the_store_is_used() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("read-only.sqlite3");
        File::create(&path).unwrap();
        let file = File::open(path).unwrap();
        assert_eq!(restrict(&file).unwrap_err().raw_os_error(), Some(5));
    }
}
