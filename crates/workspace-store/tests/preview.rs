use repeaty_workspace::{preview::Sessions, prototype::Prototype};
use std::{fs, path::Path};

fn epoch(sessions: &Sessions) -> String {
    sessions.status().unwrap().epoch
}
fn create(sessions: &mut Sessions, path: &Path) -> repeaty_workspace::preview::Active {
    sessions
        .choose(&epoch(sessions), path, true)
        .unwrap()
        .active
        .unwrap()
}
fn copy_directory(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let destination = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_directory(&entry.path(), &destination);
        } else {
            fs::copy(entry.path(), destination).unwrap();
        }
    }
}

#[test]
fn reopens_the_selected_directory_after_restart_and_close_revokes_old_sessions() {
    let device = tempfile::tempdir().unwrap();
    let root = tempfile::tempdir().unwrap();
    fs::write(device.path().join("legacy-library"), b"unchanged").unwrap();
    let mut sessions = Sessions::open(device.path()).unwrap();
    let first = create(&mut sessions, root.path());
    let first_epoch = epoch(&sessions);
    assert!(sessions.scan(&first.token).unwrap().complete);
    drop(sessions);
    let mut sessions = Sessions::open(device.path()).unwrap();
    let reopened = sessions.status().unwrap().active.unwrap();
    assert_eq!(reopened.id, first.id);
    assert_ne!(reopened.token, first.token);
    assert!(sessions.close(&first_epoch).is_err());
    assert!(sessions.scan(&first.token).is_err());
    let status = sessions.close(&epoch(&sessions)).unwrap();
    assert!(status.active.is_none());
    assert_eq!(status.recent.len(), 1);
    assert!(sessions.scan(&reopened.token).is_err());
    drop(sessions);
    assert!(
        Sessions::open(device.path())
            .unwrap()
            .status()
            .unwrap()
            .active
            .is_none()
    );
    assert_eq!(
        fs::read(device.path().join("legacy-library")).unwrap(),
        b"unchanged"
    );
}

#[test]
fn failed_creation_and_open_leave_the_current_session_and_other_files_untouched() {
    let device = tempfile::tempdir().unwrap();
    let root = tempfile::tempdir().unwrap();
    let other = tempfile::tempdir().unwrap();
    fs::write(other.path().join("notes.md"), b"mine").unwrap();
    let mut sessions = Sessions::open(device.path()).unwrap();
    let first = create(&mut sessions, root.path());
    for create in [false, true] {
        assert!(
            sessions
                .choose(&epoch(&sessions), other.path(), create)
                .is_err()
        );
        assert_eq!(
            sessions.status().unwrap().active.unwrap().token,
            first.token
        );
    }
    assert_eq!(fs::read_dir(other.path()).unwrap().count(), 1);
    assert_eq!(fs::read(other.path().join("notes.md")).unwrap(), b"mine");
    assert!(
        sessions
            .recent(&epoch(&sessions), other.path().to_str().unwrap(), &first.id)
            .is_err()
    );
}

#[test]
fn recent_paths_are_hints_not_permission_to_open_a_replaced_identity() {
    let device = tempfile::tempdir().unwrap();
    let parent = tempfile::tempdir().unwrap();
    let path = parent.path().join("library");
    fs::create_dir(&path).unwrap();
    let mut sessions = Sessions::open(device.path()).unwrap();
    let first = create(&mut sessions, &path);
    sessions.close(&epoch(&sessions)).unwrap();
    fs::rename(&path, parent.path().join("original")).unwrap();
    fs::create_dir(&path).unwrap();
    drop(Prototype::create_in_empty(&path).unwrap());
    let error = sessions
        .recent(&epoch(&sessions), path.to_str().unwrap(), &first.id)
        .unwrap_err();
    assert_eq!(error.to_string(), "workspace-identity-changed");
    assert!(sessions.status().unwrap().active.is_none());
    // A fresh, explicit picker selection can intentionally open the new workspace.
    assert_ne!(
        sessions
            .choose(&epoch(&sessions), &path, false)
            .unwrap()
            .active
            .unwrap()
            .id,
        first.id
    );
}

#[test]
fn unavailable_last_directory_reports_a_problem_without_recreating_it() {
    let device = tempfile::tempdir().unwrap();
    let parent = tempfile::tempdir().unwrap();
    let path = parent.path().join("library");
    fs::create_dir(&path).unwrap();
    let mut sessions = Sessions::open(device.path()).unwrap();
    create(&mut sessions, &path);
    drop(sessions);
    fs::rename(&path, parent.path().join("moved")).unwrap();
    let sessions = Sessions::open(device.path()).unwrap();
    let status = sessions.status().unwrap();
    assert!(status.active.is_none());
    assert_eq!(status.restore_error.as_deref(), Some("workspace-missing"));
    assert!(!path.exists());
    assert_eq!(status.recent.len(), 1);
}

#[test]
fn stale_picker_results_cannot_replace_a_newer_session_even_after_close() {
    let device = tempfile::tempdir().unwrap();
    let first = tempfile::tempdir().unwrap();
    let second = tempfile::tempdir().unwrap();
    let mut sessions = Sessions::open(device.path()).unwrap();
    let stale = epoch(&sessions);
    create(&mut sessions, first.path());
    sessions.close(&epoch(&sessions)).unwrap();
    assert!(sessions.choose(&stale, second.path(), true).is_err());
    assert_eq!(fs::read_dir(second.path()).unwrap().count(), 0);
}

#[test]
fn recent_list_is_bounded_and_selection_is_persisted_before_the_old_session_is_released() {
    let device = tempfile::tempdir().unwrap();
    let mut sessions = Sessions::open(device.path()).unwrap();
    let roots: Vec<_> = (0..10).map(|_| tempfile::tempdir().unwrap()).collect();
    for root in &roots {
        create(&mut sessions, root.path());
    }
    assert_eq!(sessions.status().unwrap().recent.len(), 8);
    assert_eq!(
        sessions.status().unwrap().recent[0].path,
        roots[9].path().canonicalize().unwrap().to_str().unwrap()
    );
    // Make the device preferences read-only at SQLite level; failure keeps the live session.
    let token = sessions.status().unwrap().active.unwrap().token;
    let db = rusqlite::Connection::open(device.path().join("workspace-preview.sqlite3")).unwrap();
    db.execute_batch("CREATE TRIGGER refuse_selection BEFORE INSERT ON selected BEGIN SELECT RAISE(ABORT,'read-only'); END;").unwrap();
    assert!(
        sessions
            .choose(&epoch(&sessions), roots[0].path(), false)
            .is_err()
    );
    assert_eq!(sessions.status().unwrap().active.unwrap().token, token);
    assert!(sessions.scan(&token).is_ok());
}

#[test]
fn same_workspace_copies_share_a_device_lock_and_cannot_write_in_two_sessions() {
    let device = tempfile::tempdir().unwrap();
    let first = tempfile::tempdir().unwrap();
    let copy = tempfile::tempdir().unwrap();
    drop(Prototype::create_in_empty(first.path()).unwrap());
    copy_directory(first.path(), copy.path());
    let mut a = Sessions::open(device.path()).unwrap();
    a.choose(&epoch(&a), first.path(), false).unwrap();
    let mut b = Sessions::open(device.path()).unwrap();
    assert!(b.status().unwrap().active.is_none());
    assert!(b.choose(&epoch(&b), copy.path(), false).is_err());
    a.close(&epoch(&a)).unwrap();
    assert!(b.choose(&epoch(&b), copy.path(), false).is_ok());
}

#[test]
fn scanning_preserves_unicode_bom_and_crlf_and_never_edits_working_files() {
    let device = tempfile::tempdir().unwrap();
    let root = tempfile::tempdir().unwrap();
    let mut prototype = Prototype::create_in_empty(root.path()).unwrap();
    let original = "\u{feff}---\r\n正文🙂\r\n";
    prototype
        .seed_note_for_fixture("note", "notes/accepted.md", original.as_bytes(), &[])
        .unwrap();
    drop(prototype);
    fs::create_dir(root.path().join("notes/中文")).unwrap();
    fs::write(root.path().join("notes/中文/新文件.md"), "未登记的正文\r\n").unwrap();
    fs::write(root.path().join("notes/accepted.md"), "外部修改").unwrap();
    fs::write(root.path().join("notes/bad.md"), [0xff, 0xfe]).unwrap();
    let mut sessions = Sessions::open(device.path()).unwrap();
    let active = sessions
        .choose(&epoch(&sessions), root.path(), false)
        .unwrap()
        .active
        .unwrap();
    let scan = sessions.scan(&active.token).unwrap();
    assert!(scan.complete);
    assert_eq!(scan.accepted[0].raw, original);
    assert_eq!(
        scan.observations
            .iter()
            .find(|f| f.path == "notes/accepted.md")
            .unwrap()
            .raw
            .as_deref(),
        Some("外部修改")
    );
    assert_eq!(
        scan.observations
            .iter()
            .find(|f| f.path == "notes/bad.md")
            .unwrap()
            .error
            .as_deref(),
        Some("invalid-utf8")
    );
    assert!(
        scan.observations
            .iter()
            .any(|f| f.path == "notes/中文/新文件.md")
    );
    assert_eq!(
        fs::read_to_string(root.path().join("notes/accepted.md")).unwrap(),
        "外部修改"
    );
}

#[test]
fn a_replaced_root_never_reads_files_from_the_replacement() {
    let device = tempfile::tempdir().unwrap();
    let parent = tempfile::tempdir().unwrap();
    let path = parent.path().join("library");
    fs::create_dir(&path).unwrap();
    let mut sessions = Sessions::open(device.path()).unwrap();
    let active = create(&mut sessions, &path);
    // Windows may prohibit moving an open SQLite directory; that is an equally safe refusal.
    if fs::rename(&path, parent.path().join("moved")).is_ok() {
        fs::create_dir(&path).unwrap();
        fs::create_dir(path.join("notes")).unwrap();
        fs::write(path.join("notes/private.md"), "do not read").unwrap();
        assert!(sessions.scan(&active.token).is_err());
    }
}

#[cfg(unix)]
#[test]
fn scan_does_not_follow_links_read_fifos_or_treat_skipped_trees_as_complete() {
    use std::os::unix::fs::symlink;
    let device = tempfile::tempdir().unwrap();
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("secret.md"), "private").unwrap();
    let mut sessions = Sessions::open(device.path()).unwrap();
    let active = create(&mut sessions, root.path());
    symlink(outside.path(), root.path().join("notes/linked")).unwrap();
    symlink(
        outside.path().join("secret.md"),
        root.path().join("notes/link.md"),
    )
    .unwrap();
    fs::hard_link(
        outside.path().join("secret.md"),
        root.path().join("notes/hard.md"),
    )
    .unwrap();
    let fifo = std::ffi::CString::new(
        root.path()
            .join("notes/pipe.md")
            .as_os_str()
            .as_encoded_bytes(),
    )
    .unwrap();
    // SAFETY: Valid NUL-terminated path; creates only a FIFO within this disposable root.
    assert_eq!(unsafe { libc::mkfifo(fifo.as_ptr(), 0o600) }, 0);
    let scan = sessions.scan(&active.token).unwrap();
    assert!(!scan.complete);
    assert!(scan.observations.iter().all(|f| f.raw.is_none()));
    assert!(!scan.observations.iter().any(|f| f.path.contains("secret")));
}
