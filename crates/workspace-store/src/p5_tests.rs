use crate::{
    backup,
    library::Library,
    records::{Commit, Patch},
};
use serde_json::{Value, json};
use std::sync::atomic::AtomicBool;

const DATE: &str = "2026-10-30T00:00:00.000Z";
fn patch(store: &str, value: Value, position: i64) -> Patch {
    Patch {
        store: store.into(),
        id: value["id"].as_str().unwrap().into(),
        position: Some(position),
        value: Some(value),
        position_only: false,
    }
}
fn remove(store: &str, id: &str) -> Patch {
    Patch {
        store: store.into(),
        id: id.into(),
        position: None,
        value: None,
        position_only: false,
    }
}
fn commit(revision: i64, patches: Vec<Patch>) -> Commit {
    Commit {
        expected_revision: revision,
        patches,
        reason: None,
        operation_history: None,
        retired: None,
    }
}
fn connection() -> Value {
    json!({"id":"connection","pluginId":"obsidian","connectorId":"vault","title":"Vault","mode":"import","status":"connected","settings":{},"intervalHours":0,"createdAt":DATE,"generation":0})
}
fn candidate() -> Value {
    json!({"id":"candidate","connectionId":"connection","key":"A.md","fingerprint":"a".repeat(64),"kind":"add","title":"A","format":"markdown","url":"","mediaId":"candidate-text","characters":4,"resources":[{"path":"assets/pic.png","mediaId":"image"}],"discoveredAt":DATE})
}
fn media(id: &str, mime: &str, size: usize) -> Value {
    json!({"id":id,"name":id,"type":mime,"size":size,"createdAt":DATE})
}
fn source() -> Value {
    json!({"id":"source","title":"A","url":"","format":"markdown","mediaId":"candidate-text","characters":4,"createdAt":DATE,"binding":{"connectionId":"connection","key":"A.md","fingerprint":"a".repeat(64),"acceptedMediaId":"candidate-text"},"inbox":{"state":"new","capturedAt":DATE,"kind":"connector"},"document":{"schemaVersion":1,"providerId":"obsidian","format":"markdown","originalMediaId":"candidate-text","resources":[{"path":"assets/pic.png","mediaId":"image"}]}})
}
fn version(library: &Library) -> u32 {
    library
        .db
        .connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap()
}
fn prepare(library: &mut Library) -> Vec<Patch> {
    library
        .db
        .put_media("candidate-text", "text/markdown", "新😀文".as_bytes())
        .unwrap();
    library
        .db
        .put_media("image", "image/png", b"image bytes")
        .unwrap();
    vec![
        patch("sourceConnections", connection(), 0),
        patch(
            "media",
            media("candidate-text", "text/markdown", "新😀文".len()),
            0,
        ),
        patch("media", media("image", "image/png", 11), 1),
        patch("sourceCandidates", candidate(), 0),
    ]
}

#[test]
fn collection_candidates_validate_bytes_and_references_before_advancing_schema_gate() {
    let directory = tempfile::tempdir().unwrap();
    let mut library = Library::create(directory.path()).unwrap();
    let patches = prepare(&mut library);
    for invalid in [
        {
            let mut v = candidate();
            v["characters"] = json!(3);
            v
        },
        {
            let mut v = candidate();
            v["connectionId"] = json!("absent");
            v
        },
        {
            let mut v = candidate();
            v["mediaId"] = json!("image");
            v
        },
        {
            let mut v = candidate();
            v["resources"][0]["mediaId"] = json!("absent");
            v
        },
        {
            let mut v = candidate();
            v["resources"][0]["path"] = json!("../outside");
            v
        },
        {
            let mut v = candidate();
            v["resources"] =
                json!([{"path":"same","mediaId":"image"},{"path":"same","mediaId":"image"}]);
            v
        },
        {
            let mut v = candidate();
            v["kind"] = json!("missing");
            v
        },
        {
            let mut v = candidate();
            v.as_object_mut().unwrap().remove("characters");
            v
        },
    ] {
        let mut bad = patches.clone();
        bad[3] = patch("sourceCandidates", invalid, 0);
        assert!(library.db.commit(commit(0, bad)).is_err());
        assert_eq!(version(&library), 10);
        assert_eq!(
            library.db.load().unwrap()["library"]["sourceConnections"],
            json!([])
        );
    }
    library.db.commit(commit(0, patches)).unwrap();
    assert_eq!(version(&library), 15);
    assert_eq!(library.db.load().unwrap()["revision"], 1);
}

#[test]
fn candidates_and_bound_sources_keep_unique_identities_and_block_dangling_deletions() {
    let directory = tempfile::tempdir().unwrap();
    let mut library = Library::create(directory.path()).unwrap();
    let mut patches = prepare(&mut library);
    patches.push(patch("sources", source(), 0));
    library.db.commit(commit(0, patches)).unwrap();
    for removal in [
        remove("sourceConnections", "connection"),
        remove("media", "candidate-text"),
        remove("media", "image"),
    ] {
        assert!(library.db.commit(commit(1, vec![removal])).is_err());
    }
    let mut duplicate = candidate();
    duplicate["id"] = json!("second");
    assert!(
        library
            .db
            .commit(commit(1, vec![patch("sourceCandidates", duplicate, 1)]))
            .is_err()
    );
    let mut duplicate = source();
    duplicate["id"] = json!("second");
    assert!(
        library
            .db
            .commit(commit(1, vec![patch("sources", duplicate, 1)]))
            .is_err()
    );
    let mut invalid = source();
    invalid["binding"]["acceptedMediaId"] = json!("absent");
    assert!(
        library
            .db
            .commit(commit(1, vec![patch("sources", invalid, 0)]))
            .is_err()
    );
    let mut disconnected = connection();
    disconnected["status"] = json!("disconnected");
    library
        .db
        .commit(commit(1, vec![patch("sourceConnections", disconnected, 0)]))
        .unwrap();
    assert_eq!(
        library.db.load().unwrap()["library"]["sources"][0]["mediaId"],
        "candidate-text"
    );
    library
        .db
        .commit(commit(
            2,
            vec![
                remove("sources", "source"),
                remove("sourceCandidates", "candidate"),
                remove("sourceConnections", "connection"),
            ],
        ))
        .unwrap();
}

#[test]
fn local_edits_keep_upstream_version_and_candidate_baseline_until_explicit_resolution() {
    let directory = tempfile::tempdir().unwrap();
    let mut library = Library::create(directory.path()).unwrap();
    let mut patches = prepare(&mut library);
    patches.push(patch("sources", source(), 0));
    library.db.commit(commit(0, patches)).unwrap();
    library
        .db
        .put_media("local", "text/markdown", b"local edit")
        .unwrap();
    let mut edited = source();
    let mut previous = source();
    previous.as_object_mut().unwrap().retain(|key, _| {
        [
            "title",
            "url",
            "format",
            "mediaId",
            "characters",
            "document",
        ]
        .contains(&key.as_str())
    });
    previous["acceptedAt"] = json!(DATE);
    edited["mediaId"] = json!("local");
    edited["characters"] = json!(10);
    edited["versions"] = json!([previous]);
    let mut pending = candidate();
    pending["sourceId"] = json!("source");
    pending["baseMediaId"] = json!("candidate-text");
    pending["kind"] = json!("update");
    library
        .db
        .commit(commit(
            1,
            vec![
                patch("media", media("local", "text/markdown", 10), 2),
                patch("sources", edited.clone(), 0),
                patch("sourceCandidates", pending, 0),
            ],
        ))
        .unwrap();
    let mut without_version = edited.clone();
    without_version.as_object_mut().unwrap().remove("versions");
    without_version["binding"]["acceptedMediaId"] = json!("local");
    assert!(
        library
            .db
            .commit(commit(2, vec![patch("sources", without_version, 0)]))
            .is_err()
    );
    // Deliberately removing an accepted material leaves a reviewable candidate, not dangling live content.
    library
        .db
        .commit(commit(2, vec![remove("sources", "source")]))
        .unwrap();
    assert_eq!(
        library.db.load().unwrap()["library"]["sourceCandidates"][0]["sourceId"],
        "source"
    );
}

#[test]
fn collection_state_survives_reopen_checkpoints_and_complete_backup_restore() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("library");
    std::fs::create_dir(&root).unwrap();
    let mut library = Library::create(&root).unwrap();
    let mut patches = prepare(&mut library);
    patches.push(patch("sources", source(), 0));
    library.db.commit(commit(0, patches)).unwrap();
    library.db.backup_now(true).unwrap();
    let checkpoint = library.db.backups().unwrap()[0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut disconnected = connection();
    disconnected["status"] = json!("disconnected");
    let mut dismissed = candidate();
    dismissed["dismissed"] = json!(true);
    library
        .db
        .commit(commit(
            1,
            vec![
                patch("sourceConnections", disconnected, 0),
                patch("sourceCandidates", dismissed, 0),
            ],
        ))
        .unwrap();
    let old = library.db.backup(&checkpoint).unwrap();
    assert_eq!(old["sourceConnections"][0]["status"], "connected");
    assert!(old["sourceCandidates"][0]["dismissed"].is_null());
    let current = library.db.load().unwrap();
    drop(library);
    let mut library = Library::open(&root).unwrap();
    assert_eq!(library.db.load().unwrap(), current);
    let archive = directory.path().join("complete.repeaty-workspace");
    let saved = backup::create(&library, &archive, &AtomicBool::new(false)).unwrap();
    let restored_path = directory.path().join("restored");
    backup::restore(
        &archive,
        &restored_path,
        &saved.sha256,
        &AtomicBool::new(false),
    )
    .unwrap();
    let mut restored = Library::open(&restored_path).unwrap();
    assert_eq!(version(&restored), 15);
    assert_eq!(restored.db.load().unwrap()["library"], current["library"]);
    assert_eq!(
        restored.db.media("candidate-text").unwrap().1,
        "新😀文".as_bytes()
    );
    assert_eq!(
        restored.db.backup(&checkpoint).unwrap()["sourceConnections"][0]["status"],
        "connected"
    );
}

#[test]
fn ordinary_grading_never_reads_candidate_bodies_or_scans_external_sources() {
    let directory = tempfile::tempdir().unwrap();
    let mut library = Library::create(directory.path()).unwrap();
    let mut patches = prepare(&mut library);
    patches.push(patch("decks",json!({"id":"deck","name":"Deck","description":"","color":"sage","createdAt":DATE,"newLimit":20,"reviewLimit":200,"burySiblings":true,"leechThreshold":8,"desiredRetention":0.9}),0));
    patches.push(patch("notes",json!({"id":"note","deckId":"deck","type":"basic","format":"plain","front":"q","back":"a","tags":[],"frontMedia":[],"backMedia":[],"createdAt":DATE,"updatedAt":DATE}),0));
    let mut card = json!({"id":"card","noteId":"note","variant":"forward","schedule":{"due":DATE,"stability":12,"difficulty":4,"elapsed_days":3,"scheduled_days":7,"learning_steps":0,"reps":5,"lapses":1,"state":2},"suspended":false,"leech":false,"createdAt":DATE,"updatedAt":DATE});
    patches.push(patch("cards", card.clone(), 0));
    library.db.commit(commit(0, patches)).unwrap();
    let asset: String = library
        .db
        .connection
        .query_row(
            "SELECT path FROM assets WHERE id='candidate-text'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    std::fs::write(
        directory.path().join(".repeaty/media").join(asset),
        b"deliberately corrupted test fixture",
    )
    .unwrap();
    card["schedule"]["reps"] = json!(6);
    library
        .db
        .commit(commit(
            1,
            vec![
                patch("cards", card, 0),
                patch(
                    "reviews",
                    json!({"id":"review","cardId":"card","rating":3,"reviewedAt":DATE,"nextDue":DATE,"studyDay":"2026-10-30","kind":"review","source":"normal"}),
                    0,
                ),
            ],
        ))
        .unwrap();
    assert_eq!(library.db.load().unwrap()["revision"], 2);
}
