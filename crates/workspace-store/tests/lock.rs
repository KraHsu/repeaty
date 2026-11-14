// A parallel process spawn can temporarily inherit a flock open-file description before exec.
// Holding that inherited descriptor deterministically reproduces the CI reopen race.
#[cfg(unix)]
#[test]
fn closing_the_workspace_explicitly_unlocks_inherited_descriptors() {
    use repeaty_workspace::prototype::Prototype;
    struct Child {
        pid: libc::pid_t,
        signal: libc::c_int,
    }
    impl Drop for Child {
        fn drop(&mut self) {
            // SAFETY: These are the parent-owned pipe descriptor and direct child PID below.
            unsafe {
                libc::close(self.signal);
                while libc::waitpid(self.pid, std::ptr::null_mut(), 0) == -1 {
                    if std::io::Error::last_os_error().raw_os_error() != Some(libc::EINTR) {
                        break;
                    }
                }
            }
        }
    }
    let root = tempfile::tempdir().unwrap();
    let proto = Prototype::create_in_empty(root.path()).unwrap();
    let mut pipe = [-1; 2];
    // SAFETY: Valid two-element output buffer. The child only uses async-signal-safe calls.
    assert_eq!(unsafe { libc::pipe(pipe.as_mut_ptr()) }, 0);
    // SAFETY: No Rust allocation, locking, destructors, or unwinding occurs in the child.
    let pid = unsafe { libc::fork() };
    if pid == 0 {
        let mut signal = 0_u8;
        // SAFETY: Child owns its descriptor copies and a one-byte stack buffer; _exit never returns.
        unsafe {
            libc::close(pipe[1]);
            libc::read(pipe[0], std::ptr::from_mut(&mut signal).cast(), 1);
            libc::_exit(0);
        }
    }
    assert!(pid > 0, "fork failed");
    // SAFETY: Only the child reads from this pipe; the parent retains the write side until cleanup.
    unsafe { libc::close(pipe[0]) };
    let _child = Child {
        pid,
        signal: pipe[1],
    };
    assert!(Prototype::open(root.path()).is_err()); // Still excludes a second live writer.
    drop(proto);
    let _reopened = Prototype::open(root.path()).expect("closing must release the inherited lock");
}
