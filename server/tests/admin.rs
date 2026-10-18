use repeaty_server::{
    auth::AuthStore,
    db::{Commit, Database},
};
use serde_json::{Value, json};
use std::{
    io::Write,
    process::{Command, Stdio},
};
#[test]
fn explicit_legacy_import_preserves_wal_records_and_refuses_overwrite() {
    let dir = tempfile::tempdir().unwrap();
    let data = dir.path().join("accounts");
    let source = dir.path().join("legacy.sqlite3");
    let mut old = Database::open(&source).unwrap();
    let library: Value = serde_json::from_str(include_str!("fixtures/library.json")).unwrap();
    let patches:Vec<_>=["decks","notes","cards","reviews","savedSearches"].into_iter().flat_map(|store|library[store].as_array().unwrap().iter().enumerate().map(move |(position,value)|json!({"store":store,"position":position,"id":value["id"],"value":value}))).collect();
    old.commit(
        serde_json::from_value::<Commit>(json!({"expectedRevision":0,"patches":patches})).unwrap(),
    )
    .unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_repeaty-server"))
        .env("REPEATY_DATA_DIR", &data)
        .args(["create-user", "alice"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(b"test-account-password\n")
        .unwrap();
    assert!(child.wait().unwrap().success());
    let migrate = || {
        Command::new(env!("CARGO_BIN_EXE_repeaty-server"))
            .env("REPEATY_DATA_DIR", &data)
            .args(["import-library", "alice"])
            .arg(&source)
            .output()
            .unwrap()
    };
    assert!(migrate().status.success());
    let user = AuthStore::open(&data.join("accounts.sqlite3"))
        .unwrap()
        .find("alice")
        .unwrap()
        .unwrap();
    let saved = Database::open(&data.join("users").join(format!("{}.sqlite3", user.id)))
        .unwrap()
        .load()
        .unwrap();
    assert_eq!(saved["library"], library);
    assert_eq!(old.load().unwrap()["library"], library);
    assert!(!migrate().status.success());
    assert!(!data.join("legacy.sqlite3.credentials.sqlite3").exists());
}
