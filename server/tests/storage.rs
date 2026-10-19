use axum::http::StatusCode;
use repeaty_server::{
    db::{Commit, Database, ReadAttempts, STORES},
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
fn history_bodies_are_paged_with_byte_limits_without_losing_unicode_or_order() {
    let mut db = Database::open(std::path::Path::new(":memory:")).unwrap();
    let mut library = fixture();
    library["practices"] = json!([{
        "id":"practice", "cardId":library["cards"][0]["id"], "contentRevision":"snapshot",
        "question":{"front":"Problem","back":"","format":"plain","plugin":{"id":"leetcode","version":1,"data":{}}},
        "startedAt":"2026-10-18T00:00:00.000Z"
    }]);
    let code = "学".repeat(50_000);
    library["attempts"] = Value::Array((0..300).map(|i| json!({
        "id":format!("attempt-{i}"), "practiceId":"practice", "language":"python3", "code":code,
        "submittedAt":"2026-10-18T00:00:00.000Z", "updatedAt":"2026-10-18T00:00:00.000Z",
        "elapsedMs":1000, "status":"completed", "submissionId":(i+1).to_string(),
        "result":{"outcome":"accepted","status":"通过","runtime":"1 ms","memory":"10 MB","detail":"详细输出".repeat(2000)}
    })).collect());
    db.commit(commit(0, &library)).unwrap();
    let summary = db.load_summary().unwrap();
    assert!(
        summary["library"]["attempts"]
            .as_array()
            .unwrap()
            .iter()
            .all(|entry| entry.get("code").is_none() && entry["result"].get("detail").is_none())
    );
    let mut offset = 0;
    while offset < 300 {
        let result = db
            .read_attempts(ReadAttempts::Batch {
                offset,
                revision: 1,
            })
            .unwrap();
        assert!(result.to_string().len() <= 4 * 1024 * 1024 + 2048);
        let values = result["attempts"].as_array().unwrap();
        assert!(!values.is_empty() && values.len() <= 128);
        for value in values {
            assert_eq!(value, &library["attempts"][offset as usize]);
            offset += 1;
        }
    }
    assert_eq!(
        db.read_attempts(ReadAttempts::Batch {
            offset,
            revision: 1
        })
        .unwrap()["attempts"],
        json!([])
    );
    assert_eq!(
        db.read_attempts(ReadAttempts::One {
            id: "attempt-0".into(),
            revision: 0
        })
        .unwrap_err()
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        db.read_attempts(ReadAttempts::Batch {
            offset: 500_001,
            revision: 1
        })
        .unwrap_err()
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(db.load().unwrap()["library"]["attempts"][0]["code"], code);
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

#[test]
fn practice_evidence_survives_snapshots_and_invalid_references_are_rejected() {
    let mut db = Database::open(std::path::Path::new(":memory:")).unwrap();
    let mut library = fixture();
    library["practices"] = json!([{
        "id":"practice", "cardId":library["cards"][0]["id"], "contentRevision":"sha256",
        "question":{"front":"Problem","back":"","format":"plain",
            "plugin":{"id":"leetcode","version":1,"data":{}}},
        "startedAt":"2026-10-18T00:00:00.000Z"
    }]);
    library["attempts"] = json!([{
        "id":"attempt", "practiceId":"practice", "language":"python3", "code":"return value",
        "submittedAt":"2026-10-18T00:00:00.000Z", "updatedAt":"2026-10-18T00:00:00.000Z",
        "elapsedMs":1000, "status":"completed", "submissionId":"123",
        "result":{"outcome":"accepted","status":"通过","runtime":"1 ms","memory":"10 MB","detail":""}
    }]);
    db.commit(commit(0, &library)).unwrap();
    db.backup_now(true).unwrap();
    let snapshot = db.backups().unwrap()[0]["id"].as_str().unwrap().to_string();
    assert_eq!(db.backup(&snapshot).unwrap(), library);
    let mut broken = library.clone();
    broken["attempts"][0]["practiceId"] = json!("another-account-practice");
    assert!(db.commit(commit(1, &broken)).is_err());
    let mut broken = library.clone();
    broken["attempts"][0]
        .as_object_mut()
        .unwrap()
        .remove("submissionId");
    assert!(db.commit(commit(1, &broken)).is_err());
    let mut broken = library.clone();
    broken["practices"][0]["reviewId"] = json!("missing-review");
    assert!(db.commit(commit(1, &broken)).is_err());
    assert_eq!(db.load().unwrap()["library"], library);
    let deletions: Vec<_> = STORES
        .iter()
        .flat_map(|store| {
            library[store]
                .as_array()
                .unwrap()
                .iter()
                .map(move |entry| json!({"store":store,"id":entry["id"]}))
        })
        .collect();
    db.commit(input(1, json!(deletions))).unwrap();
    assert_eq!(db.backup(&snapshot).unwrap(), library);
}
