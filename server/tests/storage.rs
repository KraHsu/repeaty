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
        7
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

#[test]
fn reading_queue_upgrades_v4_and_retains_positions_excerpts_and_snapshots() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("queue.sqlite3");
    let mut db = Database::open(&path).unwrap();
    let text = "Reading 中文🙂\n\nMore context";
    db.put_media("queue-text", "text/plain", text.as_bytes())
        .unwrap();
    let mut library = fixture();
    library["media"] = json!([{"id":"queue-text","name":"reading.txt","type":"text/plain","size":text.len(),"createdAt":"2026-10-19T00:00:00Z"}]);
    library["sources"] = json!([{"id":"queue-source","title":"Reading","url":"","format":"plain","mediaId":"queue-text","characters":text.encode_utf16().count(),"createdAt":"2026-10-19T00:00:00Z","reading":{"offset":8,"fraction":0,"view":"source","updatedAt":"2026-10-19T01:00:00Z"}}]);
    library["notes"][0]["excerpt"] =
        json!({"sourceId":"queue-source","start":0,"end":7,"quote":"Reading"});
    db.commit(commit(0, &library)).unwrap();
    drop(db);
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection.pragma_update(None, "user_version", 4).unwrap();
    drop(connection);
    let mut db = Database::open(&path).unwrap();
    assert_eq!(db.load().unwrap()["library"], library);
    let mut source = library["sources"][0].clone();
    source["queue"] = json!({"state":"active","availableOn":"2026-10-21"});
    db.commit(input(
        1,
        json!([{"store":"sources","id":"queue-source","position":0,"value":source}]),
    ))
    .unwrap();
    let deferred = db.load().unwrap();
    drop(db);
    let mut db = Database::open(&path).unwrap();
    assert_eq!(db.load().unwrap(), deferred);
    for queue in [
        json!({"state":"unknown","availableOn":"2026-10-21"}),
        json!({"state":"active","availableOn":"2026-02-30"}),
        json!({"state":"archived","availableOn":"2026-10-21T00:00:00Z"}),
        json!({"state":"active"}),
    ] {
        let mut invalid = source.clone();
        invalid["queue"] = queue;
        let result = db.commit(input(
            2,
            json!([{"store":"sources","id":"queue-source","position":0,"value":invalid}]),
        ));
        assert_eq!(result.unwrap_err().0, StatusCode::BAD_REQUEST);
        assert_eq!(db.load().unwrap(), deferred);
    }
    source["queue"]["state"] = json!("archived");
    db.commit(input(
        2,
        json!([{"store":"sources","id":"queue-source","position":0,"value":source}]),
    ))
    .unwrap();
    let archived = db.load().unwrap();
    assert_eq!(
        archived["library"]["sources"][0]["reading"],
        library["sources"][0]["reading"]
    );
    for store in [
        "notes",
        "cards",
        "reviews",
        "media",
        "practices",
        "attempts",
    ] {
        assert_eq!(archived["library"][store], library[store]);
    }
    let snapshots = db.backups().unwrap();
    let previous = db.backup(snapshots[0]["id"].as_str().unwrap()).unwrap();
    db.commit(commit(3, &previous)).unwrap();
    assert_eq!(db.load().unwrap()["library"], library);
}

#[test]
fn reading_priority_upgrades_v5_and_rolls_back_invalid_values_without_changing_learning() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("priority.sqlite3");
    let mut db = Database::open(&path).unwrap();
    let text = "Reading context 中文🙂";
    db.put_media("priority-body", "text/plain", text.as_bytes())
        .unwrap();
    let mut library = fixture();
    library["media"] = json!([{"id":"priority-body","name":"reading.txt","type":"text/plain","size":text.len(),"createdAt":"2026-10-20T00:00:00Z"}]);
    library["sources"] = json!([{"id":"priority-source","title":"Reading","url":"","format":"plain","mediaId":"priority-body","characters":text.encode_utf16().count(),"createdAt":"2026-10-20T00:00:00Z","reading":{"offset":8,"fraction":0,"view":"source","updatedAt":"2026-10-20T01:00:00Z"},"queue":{"state":"active","availableOn":"2026-10-25"}}]);
    library["notes"][0]["excerpt"] =
        json!({"sourceId":"priority-source","start":0,"end":7,"quote":"Reading"});
    db.commit(commit(0, &library)).unwrap();
    db.backup_now(false).unwrap();
    drop(db);
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection.pragma_update(None, "user_version", 5).unwrap();
    drop(connection);
    let mut db = Database::open(&path).unwrap();
    assert_eq!(db.load().unwrap()["library"], library);
    let snapshots = db.backups().unwrap();
    let previous_id = snapshots[0]["id"].as_str().unwrap();
    assert_eq!(db.backup(previous_id).unwrap(), library);
    let mut source = library["sources"][0].clone();
    for (revision, priority) in [(1, "high"), (2, "low"), (3, "normal")] {
        source["priority"] = json!(priority);
        db.commit(input(
            revision,
            json!([{"store":"sources","id":"priority-source","position":0,"value":source}]),
        ))
        .unwrap();
        let saved = db.load().unwrap();
        for invalid_priority in [json!("urgent"), json!(0), json!(null), json!("")] {
            let mut invalid = source.clone();
            invalid["priority"] = invalid_priority;
            let error = db.commit(input(revision + 1, json!([{"store":"sources","id":"priority-source","position":0,"value":invalid}]))).unwrap_err();
            assert_eq!(error.0, StatusCode::BAD_REQUEST);
            assert_eq!(db.load().unwrap(), saved);
        }
    }
    drop(db);
    let mut db = Database::open(&path).unwrap();
    let saved = db.load().unwrap();
    assert_eq!(saved["library"]["sources"][0], source);
    for store in STORES.iter().filter(|store| **store != "sources") {
        assert_eq!(saved["library"][store], library[store]);
    }
    db.commit(commit(4, &db.backup(previous_id).unwrap()))
        .unwrap();
    assert_eq!(db.load().unwrap()["library"], library);
    drop(db);
    let connection = rusqlite::Connection::open(&path).unwrap();
    assert_eq!(
        connection
            .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
            .unwrap(),
        7
    );
}

#[test]
fn independent_excerpts_survive_sqlite_v6_upgrade_and_validate_provenance_atomically() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("excerpts.sqlite3");
    let mut db = Database::open(&path).unwrap();
    let text = "Same🙂\nSame🙂\nLong original";
    let quote = "Same🙂";
    let mut library = fixture();
    library["notes"][0]["frontMedia"] = json!([]);
    library["notes"][0]["backMedia"] = json!([]);
    library["media"] = json!([{"id":"root-body","name":"original.md","type":"text/markdown","size":text.len(),"createdAt":"2026-10-20T00:00:00Z"}]);
    library["sources"] = json!([{"id":"root","title":"Original","url":"https://example.org/reading","format":"markdown","mediaId":"root-body","characters":text.encode_utf16().count(),"createdAt":"2026-10-20T00:00:00Z","priority":"high","queue":{"state":"active","availableOn":"2026-10-25"},"reading":{"offset":7,"fraction":0,"view":"source","updatedAt":"2026-10-20T01:00:00Z"}}]);
    db.put_media("root-body", "text/markdown", text.as_bytes())
        .unwrap();
    db.commit(commit(0, &library)).unwrap();
    db.backup_now(false).unwrap();
    drop(db);
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection.pragma_update(None, "user_version", 6).unwrap();
    drop(connection);
    let mut db = Database::open(&path).unwrap();
    assert_eq!(db.load().unwrap()["library"], library);
    assert!(
        db.load().unwrap()["library"]["sources"][0]
            .get("kind")
            .is_none()
    );
    db.put_media("child-body", "text/markdown", quote.as_bytes())
        .unwrap();
    let media = json!({"id":"child-body","name":"excerpt.md","type":"text/markdown","size":quote.len(),"createdAt":"2026-10-20T00:00:00Z"});
    let child = json!({"id":"child","title":"Excerpt","url":"https://example.org/reading","format":"markdown","mediaId":"child-body","characters":6,"createdAt":"2026-10-20T00:00:00Z","kind":"excerpt","origin":{"sourceId":"root","start":7,"end":13}});
    let patches = |source: &Value| {
        json!([
            {"store":"media","id":"child-body","position":1,"value":media},
            {"store":"sources","id":"child","position":1,"value":source}
        ])
    };
    for (field, value) in [
        ("origin", json!({"sourceId":"missing","start":7,"end":13})),
        ("origin", json!({"sourceId":"child","start":0,"end":6})),
        ("origin", json!({"sourceId":"root","start":6,"end":12})),
        ("origin", json!({"sourceId":"root","start":7,"end":12})),
        ("origin", json!({"sourceId":"root","start":7,"end":10000})),
        ("kind", json!(null)),
        ("characters", json!(10001)),
        ("format", json!("plain")),
    ] {
        let mut invalid = child.clone();
        invalid[field] = value;
        assert_eq!(
            db.commit(input(1, patches(&invalid))).unwrap_err().0,
            StatusCode::BAD_REQUEST
        );
        assert_eq!(db.load().unwrap()["library"], library);
    }
    db.commit(input(1, patches(&child))).unwrap();
    let saved = db.load().unwrap();
    assert_eq!(saved["library"]["sources"][1], child);
    // A root cannot itself become an excerpt while retaining descendants.
    let mut nested = library["sources"][0].clone();
    nested["kind"] = json!("excerpt");
    assert!(
        db.commit(input(
            2,
            json!([{"store":"sources","id":"root","position":0,"value":nested}])
        ))
        .is_err()
    );
    assert!(
        db.commit(input(2, json!([{"store":"sources","id":"root"}])))
            .is_err()
    );
    // Changing a parent's snapshot must also revalidate existing children.
    db.put_media(
        "replacement",
        "text/markdown",
        "x".repeat(text.encode_utf16().count()).as_bytes(),
    )
    .unwrap();
    let mut replacement = library["sources"][0].clone();
    replacement["mediaId"] = json!("replacement");
    let replacement_media = json!({"id":"replacement","name":"changed.md","type":"text/markdown","size":text.encode_utf16().count(),"createdAt":"2026-10-20T00:00:00Z"});
    assert!(
        db.commit(input(
            2,
            json!([
                {"store":"media","id":"replacement","position":2,"value":replacement_media},
                {"store":"sources","id":"root","position":0,"value":replacement}
            ])
        ))
        .is_err()
    );
    assert_eq!(db.load().unwrap(), saved);
    let mut note = library["notes"][0].clone();
    note["excerpt"] = json!({"sourceId":"child","start":0,"end":6,"quote":quote});
    let mut detached = child.clone();
    detached.as_object_mut().unwrap().remove("origin");
    db.commit(input(
        2,
        json!([
            {"store":"notes","id":note["id"],"position":0,"value":note},
            {"store":"sources","id":"child","position":0,"value":detached},
            {"store":"sources","id":"root"},
            {"store":"media","id":"child-body","position":0,"value":media},
            {"store":"media","id":"root-body"}
        ]),
    ))
    .unwrap();
    drop(db);
    let mut db = Database::open(&path).unwrap();
    let after = db.load().unwrap();
    assert_eq!(after["library"]["sources"], json!([detached]));
    assert_eq!(after["library"]["notes"][0]["excerpt"]["sourceId"], "child");
    assert_eq!(after["library"]["cards"], library["cards"]);
    assert_eq!(after["library"]["reviews"], library["reviews"]);
    assert_eq!(db.media("child-body").unwrap().1, quote.as_bytes());
    let connection = rusqlite::Connection::open(&path).unwrap();
    assert_eq!(
        connection
            .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
            .unwrap(),
        7
    );
}
