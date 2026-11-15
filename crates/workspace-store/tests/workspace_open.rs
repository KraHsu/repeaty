use repeaty_workspace::{library::Library, sessions::Sessions};
use serde_json::{Value, json};
use std::{fs, path::Path};

fn epoch(sessions: &Sessions) -> String {
    sessions.status().unwrap()["epoch"].as_str().unwrap().into()
}

fn entries(path: &Path) -> Vec<std::ffi::OsString> {
    let mut names = fs::read_dir(path)
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect::<Vec<_>>();
    names.sort();
    names
}

#[test]
fn explicit_open_initializes_an_empty_folder_and_reopens_the_same_library() {
    let device = tempfile::tempdir().unwrap();
    let folder = tempfile::tempdir().unwrap();
    let mut sessions = Sessions::open(device.path()).unwrap();
    let opened = sessions
        .choose(&epoch(&sessions), folder.path(), false)
        .unwrap();
    let active = &opened["active"];
    let marker: Value =
        serde_json::from_slice(&fs::read(folder.path().join("workspace.json")).unwrap()).unwrap();
    assert_eq!(active["id"], marker["id"]);
    let token = active["token"].as_str().unwrap();
    sessions
        .write(
            token,
            json!({"type":"value","namespace":"settings","id":"example","value":"saved"}),
        )
        .unwrap();
    sessions.close(&epoch(&sessions)).unwrap();

    let reopened = sessions
        .choose(&epoch(&sessions), folder.path(), false)
        .unwrap();
    assert_eq!(reopened["active"]["id"], active["id"]);
    assert_ne!(reopened["active"]["token"], active["token"]);
    drop(sessions);
    let mut restored = Sessions::open(device.path()).unwrap();
    assert_eq!(restored.status().unwrap()["active"]["id"], active["id"]);
    let token = restored.active_identity().unwrap().1.to_owned();
    assert_eq!(
        restored.read(&token, json!({"type":"settings"})).unwrap()["example"],
        "saved"
    );
}

#[test]
fn opening_a_non_workspace_preserves_its_files_and_the_active_session() {
    let device = tempfile::tempdir().unwrap();
    let current = tempfile::tempdir().unwrap();
    let other = tempfile::tempdir().unwrap();
    fs::write(
        other.path().join("keep.md"),
        b"Existing notes must remain untouched.\n",
    )
    .unwrap();
    let before = entries(other.path());
    let mut sessions = Sessions::open(device.path()).unwrap();
    let status = sessions
        .choose(&epoch(&sessions), current.path(), true)
        .unwrap();
    let error = sessions
        .choose(&epoch(&sessions), other.path(), false)
        .unwrap_err();
    assert_eq!(error.0, "workspace-not-initialized");
    assert_eq!(sessions.status().unwrap(), status);
    assert_eq!(entries(other.path()), before);
    assert_eq!(
        fs::read(other.path().join("keep.md")).unwrap(),
        b"Existing notes must remain untouched.\n"
    );
    assert_eq!(
        sessions
            .choose(&epoch(&sessions), other.path(), true)
            .unwrap_err()
            .0,
        "workspace-not-empty"
    );
    assert_eq!(entries(other.path()), before);
}

#[test]
fn missing_marker_is_not_reported_as_a_storage_or_permission_failure() {
    let folder = tempfile::tempdir().unwrap();
    assert_eq!(
        Library::open(folder.path()).err().unwrap().0,
        "workspace-not-initialized"
    );
    assert!(entries(folder.path()).is_empty());
    assert_eq!(
        Library::open(&folder.path().join("missing"))
            .err()
            .unwrap()
            .0,
        "workspace-missing"
    );
}

#[test]
fn automatic_restore_and_recent_never_initialize_a_displaced_empty_folder() {
    let device = tempfile::tempdir().unwrap();
    let parent = tempfile::tempdir().unwrap();
    let folder = parent.path().join("library");
    fs::create_dir(&folder).unwrap();
    let mut sessions = Sessions::open(device.path()).unwrap();
    let opened = sessions.choose(&epoch(&sessions), &folder, true).unwrap();
    drop(sessions);
    fs::rename(&folder, parent.path().join("retained")).unwrap();
    fs::create_dir(&folder).unwrap();

    let mut sessions = Sessions::open(device.path()).unwrap();
    let status = sessions.status().unwrap();
    assert!(status["active"].is_null());
    assert_eq!(status["error"], "workspace-not-initialized");
    assert_eq!(
        sessions.restore(&epoch(&sessions)).unwrap_err().0,
        "workspace-not-initialized"
    );
    assert_eq!(
        sessions
            .recent(
                &epoch(&sessions),
                folder.to_str().unwrap(),
                opened["active"]["id"].as_str().unwrap()
            )
            .unwrap_err()
            .0,
        "workspace-not-initialized"
    );
    assert!(entries(&folder).is_empty());
}

#[test]
fn invalid_workspace_markers_are_never_replaced_or_initialized() {
    let device = tempfile::tempdir().unwrap();
    let folder = tempfile::tempdir().unwrap();
    let mut sessions = Sessions::open(device.path()).unwrap();
    for raw in [
        "not JSON".to_owned(),
        json!({"format":"repeaty-workspace","version":999,"id":uuid::Uuid::new_v4().to_string()})
            .to_string(),
    ] {
        fs::write(folder.path().join("workspace.json"), &raw).unwrap();
        assert_eq!(
            sessions
                .choose(&epoch(&sessions), folder.path(), false)
                .unwrap_err()
                .0,
            "workspace-incompatible"
        );
        assert_eq!(
            entries(folder.path()),
            vec![std::ffi::OsString::from("workspace.json")]
        );
        assert_eq!(
            fs::read_to_string(folder.path().join("workspace.json")).unwrap(),
            raw
        );
    }
}

#[test]
fn an_incomplete_library_is_not_reinitialized() {
    let device = tempfile::tempdir().unwrap();
    let folder = tempfile::tempdir().unwrap();
    let library = Library::create(folder.path()).unwrap();
    let id = library.id.clone();
    drop(library);
    fs::remove_file(folder.path().join(".repeaty/state.sqlite3")).unwrap();
    let mut sessions = Sessions::open(device.path()).unwrap();
    assert_eq!(
        sessions
            .choose(&epoch(&sessions), folder.path(), false)
            .unwrap_err()
            .0,
        "workspace-missing"
    );
    let marker: Value =
        serde_json::from_slice(&fs::read(folder.path().join("workspace.json")).unwrap()).unwrap();
    assert_eq!(marker["id"], id);
    assert!(!folder.path().join(".repeaty/state.sqlite3").exists());
}
