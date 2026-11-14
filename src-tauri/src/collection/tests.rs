use super::*;
use std::fs;
fn listing(root: &Dir) -> Result<Listing> {
    let mut result = Listing {
        files: vec![],
        skipped: vec![],
        complete: true,
    };
    walk(root, "", 0, &mut 0, &mut result)?;
    Ok(result)
}
#[test]
fn reads_nested_unicode_files_without_writing_the_source() {
    let source = tempfile::tempdir().unwrap();
    fs::create_dir(source.path().join("材料")).unwrap();
    fs::write(source.path().join("材料/学习.md"), "# 中文\n测试").unwrap();
    let root = open_root(source.path()).unwrap();
    let result = listing(&root).unwrap();
    assert!(result.complete);
    assert_eq!(result.files.len(), 1);
    let entry = &result.files[0];
    assert_eq!(entry.path, "材料/学习.md");
    let before = fs::metadata(source.path().join(&entry.path))
        .unwrap()
        .modified()
        .unwrap();
    let content = read_file(&root, &entry.path, Some(entry.size), Some(&entry.modified)).unwrap();
    assert_eq!(
        STANDARD.decode(content.bytes).unwrap(),
        "# 中文\n测试".as_bytes()
    );
    assert_eq!(
        before,
        fs::metadata(source.path().join(&entry.path))
            .unwrap()
            .modified()
            .unwrap()
    );
    assert_eq!(fs::read_dir(source.path()).unwrap().count(), 1);
}
#[test]
fn filters_private_and_temporary_entries() {
    let source = tempfile::tempdir().unwrap();
    for name in [".obsidian", ".git", ".repeaty", "node_modules"] {
        fs::create_dir(source.path().join(name)).unwrap();
        fs::write(source.path().join(name).join("secret.txt"), "private").unwrap();
    }
    for name in [
        "draft.tmp",
        "editor.swp",
        "~draft.md",
        "desktop.ini",
        "good.txt",
    ] {
        fs::write(source.path().join(name), "body").unwrap();
    }
    let root = open_root(source.path()).unwrap();
    let result = listing(&root).unwrap();
    assert_eq!(result.files.len(), 1);
    assert_eq!(result.files[0].path, "good.txt");
    assert_eq!(result.skipped.len(), 8);
    for path in [
        ".obsidian/secret.txt",
        "node_modules/secret.txt",
        "draft.tmp",
    ] {
        assert!(read_file(&root, path, None, None).is_err());
    }
}
#[test]
fn rejects_escape_windows_streams_and_ambiguous_paths() {
    for path in [
        "../secret",
        "/abs",
        "a/../b",
        "a\\b",
        "a//b",
        "C:/secret",
        "note.md:secret",
        "a/.",
        "a/dir.",
        "a/file ",
    ] {
        assert!(segments(path).is_err(), "{path}");
    }
    assert_eq!(segments("目录/文章.md").unwrap(), vec!["目录", "文章.md"]);
}
#[test]
fn detects_changed_files_and_refuses_oversized_content() {
    let source = tempfile::tempdir().unwrap();
    fs::write(source.path().join("a.txt"), "old").unwrap();
    let root = open_root(source.path()).unwrap();
    let entry = listing(&root).unwrap().files.remove(0);
    fs::write(source.path().join("a.txt"), "different").unwrap();
    assert!(
        matches!(read_file(&root, "a.txt", Some(entry.size), Some(&entry.modified)), Err(e) if e == "source-file-changed")
    );
    let file = fs::File::create(source.path().join("large.pdf")).unwrap();
    file.set_len(FILE_LIMIT + 1).unwrap();
    assert!(
        matches!(read_file(&root, "large.pdf", None, None), Err(e) if e == "source-file-too-large")
    );
    assert!(
        listing(&root)
            .unwrap()
            .skipped
            .iter()
            .any(|s| s.path == "large.pdf" && s.reason == "file-too-large")
    );
}
#[test]
fn hard_links_are_not_a_directory_read_escape() {
    let source = tempfile::tempdir().unwrap();
    let other = tempfile::NamedTempFile::new().unwrap();
    fs::hard_link(other.path(), source.path().join("linked.txt")).unwrap();
    let root = open_root(source.path()).unwrap();
    assert!(
        matches!(read_file(&root, "linked.txt", None, None), Err(e) if e == "unsafe-source-path")
    );
    assert!(listing(&root).unwrap().files.is_empty());
}
#[cfg(unix)]
#[test]
fn symbolic_links_cannot_escape_or_reenter_the_granted_root() {
    let source = tempfile::tempdir().unwrap();
    let other = tempfile::tempdir().unwrap();
    fs::write(other.path().join("secret.txt"), "private").unwrap();
    std::os::unix::fs::symlink(other.path(), source.path().join("outside")).unwrap();
    let root = open_root(source.path()).unwrap();
    assert!(read_file(&root, "outside/secret.txt", None, None).is_err());
    assert!(listing(&root).unwrap().files.is_empty());
}
#[test]
fn grants_are_device_local_persisted_and_scope_checked_before_relinking() {
    let device = tempfile::tempdir().unwrap();
    let first = tempfile::tempdir().unwrap();
    let second = tempfile::tempdir().unwrap();
    let collection = Collection::new(device.path()).unwrap();
    let mut inner = collection.0.lock().unwrap();
    inner.scope = "library-a".into();
    let grant = inner
        .grant(None, first.path().into(), "library-a", 0)
        .unwrap();
    assert_eq!(inner.grants.len(), 1);
    inner.scope = "library-b".into();
    inner.epoch += 1;
    assert!(
        inner
            .grant(Some(grant.id.clone()), second.path().into(), "library-a", 0)
            .is_err()
    );
    assert_eq!(inner.grants[0].path, first.path().canonicalize().unwrap());
    assert!(
        inner
            .grant(
                Some(grant.id.clone()),
                second.path().join("missing"),
                "library-b",
                2
            )
            .is_err()
    );
    assert_eq!(inner.grants[0].path, first.path().canonicalize().unwrap());
    assert!(inner.root("library-b", &grant.id).is_err());
    let other = inner
        .grant(Some(grant.id.clone()), second.path().into(), "library-b", 2)
        .unwrap();
    assert_ne!(other.id, grant.id);
    assert_eq!(inner.grants.len(), 2);
    drop(inner);
    let reloaded = Collection::new(device.path()).unwrap();
    assert_eq!(
        reloaded.0.lock().unwrap().grants[1].path,
        second.path().canonicalize().unwrap()
    );
    assert_eq!(fs::read_dir(first.path()).unwrap().count(), 0);
    assert_eq!(fs::read_dir(second.path()).unwrap().count(), 0);
}
#[test]
fn traversal_overflow_is_an_error_not_a_complete_partial_listing() {
    let source = tempfile::tempdir().unwrap();
    fs::write(source.path().join("a.txt"), "body").unwrap();
    let root = open_root(source.path()).unwrap();
    let mut result = Listing {
        files: vec![],
        skipped: vec![],
        complete: true,
    };
    let mut visited = ENTRY_COUNT;
    assert_eq!(
        walk(&root, "", 0, &mut visited, &mut result).unwrap_err(),
        "source-directory-too-large"
    );
}
#[test]
fn native_identity_and_session_token_cannot_be_spoofed_by_scope_binding() {
    let device = tempfile::tempdir().unwrap();
    let collection = Collection::new(device.path()).unwrap();
    let identity = Arc::new(Mutex::new(("library-a".into(), "session-1".into())));
    collection.attach_workspace(identity.clone());
    let mut inner = collection.0.lock().unwrap();
    inner.scope = "library-a".into();
    inner.session_token = "session-1".into();
    assert!(inner.check("library-a").is_ok());
    *identity.lock().unwrap() = ("library-b".into(), "session-2".into());
    assert!(inner.check("library-a").is_err());
    inner.scope = "library-b".into();
    assert!(inner.check("library-b").is_err());
    inner.session_token = "session-2".into();
    assert!(inner.check("library-b").is_ok());
    *identity.lock().unwrap() = ("library-b".into(), "new-session-after-reopen".into());
    assert!(inner.check("library-b").is_err());
}
#[test]
fn cancellation_stops_traversal_and_file_reads_and_does_not_cancel_the_next_job() {
    let device = tempfile::tempdir().unwrap();
    let source = tempfile::tempdir().unwrap();
    fs::write(source.path().join("large.txt"), vec![b'x'; 200_000]).unwrap();
    let collection = Collection::new(device.path()).unwrap();
    let mut inner = collection.0.lock().unwrap();
    inner.scope = "library-a".into();
    let grant = inner
        .grant(None, source.path().into(), "library-a", 0)
        .unwrap();
    let lease = inner.begin("library-a", &grant.id).unwrap();
    lease.counter.fetch_add(1, Ordering::AcqRel);
    let root = inner.root("library-a", &grant.id).unwrap();
    let mut result = Listing {
        files: vec![],
        skipped: vec![],
        complete: true,
    };
    assert_eq!(
        walk_checked(&root, "", 0, &mut 0, &mut result, &|| lease.check()).unwrap_err(),
        "source-operation-cancelled"
    );
    let next = inner.begin("library-a", &grant.id).unwrap();
    assert!(next.check().is_ok());
    let calls = std::cell::Cell::new(0);
    let error = read_file_checked(&root, "large.txt", None, None, &|| {
        calls.set(calls.get() + 1);
        if calls.get() == 3 {
            next.counter.fetch_add(1, Ordering::AcqRel);
        }
        next.check()
    })
    .err()
    .unwrap();
    assert_eq!(error, "source-operation-cancelled");
    assert_eq!(calls.get(), 3);
    let future = inner.begin("library-a", &grant.id).unwrap();
    assert!(read_file_checked(&root, "large.txt", None, None, &|| future.check()).is_ok());
}
#[cfg(windows)]
#[test]
fn directory_junctions_are_skipped_without_following_the_target() {
    use std::os::windows::process::CommandExt;
    let source = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("private.txt"), "private").unwrap();
    let linked = source.path().join("outside");
    let result = std::process::Command::new("cmd.exe")
        .args(["/d", "/c"])
        .creation_flags(0x08000000)
        .raw_arg(format!(
            "mklink /J \"{}\" \"{}\"",
            linked.display(),
            outside.path().display()
        ))
        .output()
        .unwrap();
    assert!(result.status.success());
    let root = open_root(source.path()).unwrap();
    assert!(read_file(&root, "outside/private.txt", None, None).is_err());
    let result = listing(&root).unwrap();
    assert!(result.files.is_empty());
    assert_eq!(result.skipped[0].reason, "link");
    assert_eq!(
        fs::read_to_string(outside.path().join("private.txt")).unwrap(),
        "private"
    );
}
