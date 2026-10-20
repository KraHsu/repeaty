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

#[test]
fn source_snapshots_validate_utf16_excerpts_and_restore_without_changing_cards() {
    let mut db = Database::open(std::path::Path::new(":memory:")).unwrap();
    let mut library = fixture();
    let text = "开头🙂\n原文摘录\nMarkdown **text**";
    let size = text.len();
    db.put_media("source-body", "text/markdown", text.as_bytes())
        .unwrap();
    library["media"] = json!([{"id":"source-body","name":"source.md","type":"text/markdown","size":size,"createdAt":"2026-10-18T00:00:00.000Z"}]);
    library["sources"] = json!([{"id":"source","title":"来源","url":"https://example.org/notes","format":"markdown","mediaId":"source-body","characters":text.encode_utf16().count(),"createdAt":"2026-10-18T00:00:00.000Z"}]);
    library["notes"][0]["frontMedia"] = json!([]);
    library["notes"][0]["backMedia"] = json!([]);
    library["notes"][0]["excerpt"] =
        json!({"sourceId":"source","start":5,"end":9,"quote":"原文摘录"});
    db.commit(commit(0, &library)).unwrap();
    assert_eq!(db.load().unwrap()["library"], library);
    let before = library["notes"][0].clone();
    let mut bad = before.clone();
    bad["excerpt"]["quote"] = json!("错误内容");
    assert!(
        db.commit(input(
            1,
            json!([{"store":"notes","id":bad["id"],"position":0,"value":bad}])
        ))
        .is_err()
    );
    assert_eq!(db.load().unwrap()["revision"], 1);
    assert!(
        db.commit(input(1, json!([{"store":"sources","id":"source"}])))
            .is_err()
    );
    let mut detached = before.clone();
    detached.as_object_mut().unwrap().remove("excerpt");
    let removal: Commit = serde_json::from_value(json!({"expectedRevision":1,"reason":"删除材料前","patches":[{"store":"notes","id":detached["id"],"position":0,"value":detached},{"store":"sources","id":"source"},{"store":"media","id":"source-body"}]})).unwrap();
    db.commit(removal).unwrap();
    assert_eq!(db.load().unwrap()["library"]["cards"], library["cards"]);
    let backups = db.backups().unwrap();
    assert_eq!(
        db.backup(backups[0]["id"].as_str().unwrap()).unwrap(),
        library
    );
    assert_eq!(db.media("source-body").unwrap().1, text.as_bytes());
    assert!(db.put_media("bad-text", "text/plain", &[255, 255]).is_err());
}

#[test]
fn source_only_libraries_get_snapshots_and_sqlite_v2_upgrades_safely() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("sources.sqlite3");
    {
        let connection = rusqlite::Connection::open(&path).unwrap();
        connection.pragma_update(None, "user_version", 2).unwrap();
    }
    let mut db = Database::open(&path).unwrap();
    db.put_media("body", "text/plain", b"original").unwrap();
    let patches = json!([
        {"store":"media","id":"body","position":0,"value":{"id":"body","name":"source.txt","type":"text/plain","size":8,"createdAt":"2026-10-18T00:00:00.000Z"}},
        {"store":"sources","id":"source","position":0,"value":{"id":"source","title":"Only source","format":"plain","url":"","mediaId":"body","characters":8,"createdAt":"2026-10-18T00:00:00.000Z"}}
    ]);
    db.commit(input(0, patches)).unwrap();
    db.backup_now(false).unwrap();
    assert_eq!(db.backups().unwrap().as_array().unwrap().len(), 1);
    drop(db);
    let connection = rusqlite::Connection::open(&path).unwrap();
    assert_eq!(
        connection
            .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
            .unwrap(),
        4
    );
}

#[test]
fn reading_positions_survive_sqlite_v3_upgrade_and_reject_invalid_offsets_atomically() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("reading.sqlite3");
    let mut db = Database::open(&path).unwrap();
    let text = "# Material\n\n中文段落🙂\n\nMore text";
    let mut library = fixture();
    library["media"] = json!([]);
    library["sources"] = json!([]);
    for (id, mime, format) in [
        ("markdown", "text/markdown", "markdown"),
        ("plain", "text/plain", "plain"),
    ] {
        db.put_media(id, mime, text.as_bytes()).unwrap();
        library["media"].as_array_mut().unwrap().push(json!({"id":id,"name":"reading.txt","type":mime,"size":text.len(),"createdAt":"2026-10-19T00:00:00.000Z"}));
        library["sources"].as_array_mut().unwrap().push(json!({"id":id,"title":"Reading","url":"","format":format,"mediaId":id,"characters":text.encode_utf16().count(),"createdAt":"2026-10-19T00:00:00.000Z"}));
    }
    db.commit(commit(0, &library)).unwrap();
    drop(db);
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection.pragma_update(None, "user_version", 3).unwrap();
    drop(connection);
    let mut db = Database::open(&path).unwrap();
    assert_eq!(db.load().unwrap()["library"], library);
    assert_eq!(db.load().unwrap()["revision"], 1);
    let mut marked = library["sources"][0].clone();
    marked["reading"] = json!({"offset":12,"fraction":0.25,"view":"preview","updatedAt":"2026-10-19T01:00:00.000Z"});
    db.commit(input(
        1,
        json!([{"store":"sources","id":"markdown","position":0,"value":marked}]),
    ))
    .unwrap();
    let saved = db.load().unwrap();
    for (index, reading) in [
        (
            0,
            json!({"offset":text.encode_utf16().count()+1,"fraction":0,"view":"source","updatedAt":"2026-10-19T01:00:00.000Z"}),
        ),
        (
            0,
            json!({"offset":1,"fraction":0.2,"view":"source","updatedAt":"2026-10-19T01:00:00.000Z"}),
        ),
        (
            1,
            json!({"offset":1,"fraction":0,"view":"preview","updatedAt":"2026-10-19T01:00:00.000Z"}),
        ),
        (
            0,
            json!({"offset":1,"fraction":1.2,"view":"preview","updatedAt":"2026-10-19T01:00:00.000Z"}),
        ),
    ] {
        let mut invalid = library["sources"][index].clone();
        invalid["reading"] = reading;
        let result = db.commit(input(
            2,
            json!([{"store":"sources","id":invalid["id"],"position":index,"value":invalid}]),
        ));
        assert_eq!(result.unwrap_err().0, StatusCode::BAD_REQUEST);
        assert_eq!(db.load().unwrap(), saved);
    }
    assert_eq!(saved["library"]["cards"], library["cards"]);
    assert_eq!(saved["library"]["reviews"], library["reviews"]);
    let snapshots = db.backups().unwrap();
    let previous = db.backup(snapshots[0]["id"].as_str().unwrap()).unwrap();
    assert!(previous["sources"][0].get("reading").is_none());
    db.commit(commit(2, &previous)).unwrap();
    assert_eq!(db.load().unwrap()["library"], library);
}
