use repeaty_workspace::{
    atomic::{self, ReplaceMethod},
    files,
};
use std::{
    fs::{self, OpenOptions},
    io::{Seek, SeekFrom, Write},
    path::Path,
};

fn retained<'a>(candidate: &'a Path, backup: &'a Path) -> &'a Path {
    if atomic::replace_method() == ReplaceMethod::Exchange {
        candidate
    } else {
        backup
    }
}

#[test]
fn replacement_retains_the_actual_last_moment_version() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("题目.md");
    let candidate = dir.path().join("candidate");
    let backup = dir.path().join("backup");
    files::write_new(&target, b"baseline").unwrap();
    files::write_new(&candidate, b"application proposal").unwrap();
    // Simulates an editor writing after the application's preflight hash check.
    fs::write(&target, b"last moment editor text").unwrap();
    atomic::replace_preserving(&target, &candidate, &backup).unwrap();
    assert_eq!(
        files::read_stable(&target).unwrap(),
        b"application proposal"
    );
    assert_eq!(
        files::read_stable(retained(&candidate, &backup)).unwrap(),
        b"last moment editor text"
    );
}

#[test]
fn an_old_editor_handle_keeps_writing_to_a_retained_file() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("old.md");
    let candidate = dir.path().join("candidate");
    let backup = dir.path().join("backup");
    files::write_new(&target, b"old").unwrap();
    files::write_new(&candidate, b"new").unwrap();
    let mut editor = OpenOptions::new().write(true).open(&target).unwrap();
    atomic::replace_preserving(&target, &candidate, &backup).unwrap();
    editor.seek(SeekFrom::Start(0)).unwrap();
    editor.write_all(b"late editor write").unwrap();
    editor.sync_all().unwrap();
    assert_eq!(files::read_stable(&target).unwrap(), b"new");
    assert_eq!(
        files::read_stable(retained(&candidate, &backup)).unwrap(),
        b"late editor write"
    );
}

#[test]
fn new_file_publication_cannot_overwrite_an_editor_file() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("new.md");
    let candidate = dir.path().join("candidate");
    files::write_new(&candidate, b"application").unwrap();
    files::write_new(&target, b"editor won the vacant name").unwrap();
    assert!(atomic::publish_new(&candidate, &target).is_err());
    assert_eq!(fs::read(&target).unwrap(), b"editor won the vacant name");
    assert_eq!(fs::read(&candidate).unwrap(), b"application");
}

#[test]
fn new_file_publication_moves_the_complete_file() {
    let dir = tempfile::tempdir().unwrap();
    let candidate = dir.path().join("candidate");
    let target = dir.path().join("new.md");
    let bytes = "中文🙂\r\n\nend\r".as_bytes();
    files::write_new(&candidate, bytes).unwrap();
    atomic::publish_new(&candidate, &target).unwrap();
    assert_eq!(fs::read(&target).unwrap(), bytes);
    assert!(!candidate.exists());
}

#[test]
fn missing_target_never_causes_an_overwrite_fallback() {
    let dir = tempfile::tempdir().unwrap();
    let candidate = dir.path().join("candidate");
    let target = dir.path().join("missing.md");
    files::write_new(&candidate, b"application").unwrap();
    assert!(atomic::replace_preserving(&target, &candidate, &dir.path().join("backup")).is_err());
    assert!(!target.exists());
    assert_eq!(fs::read(&candidate).unwrap(), b"application");
}

#[test]
fn bounded_reads_and_create_new_refuse_special_or_existing_files() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("text");
    files::write_new(&target, b"original").unwrap();
    assert!(files::write_new(&target, b"replacement").is_err());
    assert_eq!(files::read_stable(&target).unwrap(), b"original");
    assert!(files::read_stable(dir.path()).is_err());
    let huge = OpenOptions::new().write(true).open(&target).unwrap();
    huge.set_len(files::MAX_TEXT_BYTES + 1).unwrap();
    assert_eq!(
        files::read_stable(&target).unwrap_err().kind(),
        std::io::ErrorKind::FileTooLarge
    );
}

#[cfg(unix)]
#[test]
fn symlink_inputs_are_not_followed() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("real");
    files::write_new(&target, b"private").unwrap();
    let link = dir.path().join("link");
    std::os::unix::fs::symlink(&target, &link).unwrap();
    assert!(files::read_stable(&link).is_err());
}
