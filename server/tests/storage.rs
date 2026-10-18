use axum::http::StatusCode;
use repeaty_server::{
    db::{Commit, Database, STORES},
    error::Error,
};
use serde_json::{Value, json};

fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/library.json")).unwrap()
}
fn commit(revision: i64, library: &Value) -> Commit {
    serde_json::from_value(json!({"expectedRevision":revision,"patches":STORES.iter().flat_map(|store|library[store].as_array().unwrap().iter().enumerate().map(move |(position,value)|json!({"store":store,"id":value["id"],"position":position,"value":value}))).collect::<Vec<_>>()})).unwrap()
}
fn input(revision: i64, patches: Value) -> Commit {
    serde_json::from_value(json!({"expectedRevision":revision,"patches":patches})).unwrap()
}
#[test]
fn sqlite_persists_records_and_rejects_stale_writers() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("db.sqlite3");
    let mut first = Database::open(&path).unwrap();
    assert_eq!(first.load().unwrap()["revision"], 0);
    let library = fixture();
    assert_eq!(first.commit(commit(0, &library)).unwrap(), 1);
    let mut second = Database::open(&path).unwrap();
    assert_eq!(second.load().unwrap()["library"], library);
    let error = second.commit(commit(0, &library)).unwrap_err();
    assert_eq!(error.0, StatusCode::CONFLICT);
    drop(first);
    drop(second);
    assert_eq!(
        Database::open(&path).unwrap().load().unwrap()["library"],
        library
    );
}
#[test]
fn invalid_records_and_references_roll_back_the_whole_transaction() {
    let mut db = Database::open(std::path::Path::new(":memory:")).unwrap();
    let library = fixture();
    db.commit(commit(0, &library)).unwrap();
    let note_id = &library["notes"][0]["id"];
    assert!(
        db.commit(input(1, json!([{"store":"notes","id":note_id}])))
            .is_err()
    );
    assert_eq!(db.load().unwrap()["library"], library);
    let mut invalid = library.clone();
    invalid["cards"][0]["schedule"]["state"] = json!(8);
    assert!(db.commit(commit(1, &invalid)).is_err());
    let mut bad_note = library["notes"][0].clone();
    bad_note["frontMedia"] = json!(["missing"]);
    assert!(
        db.commit(input(
            1,
            json!([{"store":"notes","id":note_id,"position":0,"value":bad_note}])
        ))
        .is_err()
    );
    assert_eq!(db.load().unwrap()["revision"], 1);
    assert!(
        db.commit(input(
            1,
            json!([{"store":"decks; DROP TABLE notes;--","id":"oops"}])
        ))
        .is_err()
    );
}
#[test]
fn snapshots_restore_deleted_text_and_media_without_copying_blobs() {
    let mut db = Database::open(std::path::Path::new(":memory:")).unwrap();
    let mut library = fixture();
    let meta = json!({"id":"image","name":"image.png","type":"image/png","size":4,"createdAt":"2026-10-18T00:00:00.000Z"});
    library["media"] = json!([meta]);
    library["notes"][0]["frontMedia"] = json!(["image"]);
    db.put_media("image", "image/png", b"1234").unwrap();
    db.put_media("image", "image/png", b"1234").unwrap();
    assert!(db.put_media("image", "image/png", b"changed").is_err());
    db.commit(commit(0, &library)).unwrap();
    db.backup_now(true).unwrap();
    let id = db.backups().unwrap()[0]["id"].as_str().unwrap().to_string();
    let deletions: Vec<_> = STORES
        .iter()
        .flat_map(|store| {
            library[store]
                .as_array()
                .unwrap()
                .iter()
                .map(move |v| json!({"store":store,"id":v["id"]}))
        })
        .collect();
    db.commit(input(1, json!(deletions))).unwrap();
    assert_eq!(db.load().unwrap()["library"]["notes"], json!([]));
    assert_eq!(db.backup(&id).unwrap(), library);
    assert_eq!(db.media("image").unwrap().1, b"1234");
    db.commit(commit(2, &db.backup(&id).unwrap())).unwrap();
    assert_eq!(db.load().unwrap()["library"], library);
}
#[test]
fn retains_only_ten_snapshots_and_validates_media_size() {
    let mut db = Database::open(std::path::Path::new(":memory:")).unwrap();
    let mut library = fixture();
    db.commit(commit(0, &library)).unwrap();
    for revision in 1..14 {
        db.backup_now(true).unwrap();
        library["notes"][0]["front"] = json!(format!("Question {revision}"));
        db.commit(commit(revision, &library)).unwrap();
    }
    assert_eq!(db.backups().unwrap().as_array().unwrap().len(), 10);
    assert!(matches!(
        db.media("unknown"),
        Err(Error(StatusCode::NOT_FOUND, _))
    ));
    assert!(db.put_media("bad", "image/svg+xml", b"<script/>").is_err());
}
