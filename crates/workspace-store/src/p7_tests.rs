use crate::{
    backup,
    library::Library,
    records::{Commit, Patch},
};
use serde_json::{Value, json};
use std::sync::atomic::AtomicBool;

fn receipt(id: &str, actor: &str, request: &str) -> Value {
    json!({"id":id,"actorId":actor,"requestId":request,"operationId":"undo-1","fingerprint":"a".repeat(64),"createdAt":"2026-10-30T00:00:00.000Z","result":{"revision":1,"resultIds":{"sources":[],"folders":[],"collections":[],"notes":[],"decks":["historical-deck"],"cards":[]}}})
}
fn patch(value: Value, position: i64) -> Patch {
    Patch {
        store: "automationReceipts".into(),
        id: value["id"].as_str().unwrap().into(),
        value: Some(value),
        position: Some(position),
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
fn version(library: &Library) -> u32 {
    library
        .db
        .connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap()
}

#[test]
fn p7_receipts_are_actor_scoped_immutable_atomic_and_gate_old_readers() {
    let parent = tempfile::tempdir().unwrap();
    let mut library = Library::create(parent.path()).unwrap();
    let original = receipt("receipt", "actor", "request");
    let mut bad = original.clone();
    bad["fingerprint"] = json!("bad");
    assert!(library.db.commit(commit(0, vec![patch(bad, 0)])).is_err());
    assert_eq!(version(&library), 10);
    library
        .db
        .commit(commit(0, vec![patch(original.clone(), 0)]))
        .unwrap();
    assert_eq!(version(&library), 17);
    let saved = library.db.load().unwrap();
    assert_eq!(saved["library"]["version"], 19);
    for bad in [receipt("other-id", "actor", "request"), {
        let mut changed = original.clone();
        changed["result"]["revision"] = json!(2);
        changed
    }] {
        assert!(library.db.commit(commit(1, vec![patch(bad, 0)])).is_err());
        assert_eq!(library.db.load().unwrap(), saved);
    }
    assert!(
        library
            .db
            .commit(commit(
                0,
                vec![patch(receipt("second", "other-actor", "request"), 1)]
            ))
            .is_err()
    );
    library
        .db
        .commit(commit(
            1,
            vec![patch(receipt("second", "other-actor", "request"), 1)],
        ))
        .unwrap();
    let mut undo = commit(2, vec![]);
    undo.operation_history = Some(
        json!({"schemaVersion":1,"undo":[{"changes":[{"store":"automationReceipts"}]}],"redo":[],"mediaIds":[]}),
    );
    assert!(library.db.commit(undo).is_err());
    assert_eq!(library.db.load().unwrap()["revision"], 2);
}

#[test]
fn p7_receipts_keep_original_result_through_checkpoint_reopen_and_complete_backup() {
    let parent = tempfile::tempdir().unwrap();
    let root = parent.path().join("library");
    std::fs::create_dir(&root).unwrap();
    let mut library = Library::create(&root).unwrap();
    let original = receipt("receipt", "actor", "request");
    library
        .db
        .commit(commit(0, vec![patch(original.clone(), 0)]))
        .unwrap();
    library.db.backup_now(true).unwrap();
    let checkpoint = library.db.backups().unwrap()[0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    library
        .db
        .commit(commit(
            1,
            vec![patch(receipt("second", "actor", "request-2"), 1)],
        ))
        .unwrap();
    assert_eq!(
        library.db.backup(&checkpoint).unwrap()["automationReceipts"],
        json!([original])
    );
    let current = library.db.load().unwrap();
    drop(library);
    let library = Library::open(&root).unwrap();
    let archive = parent.path().join("full.repeaty-workspace");
    let saved = backup::create(&library, &archive, &AtomicBool::new(false)).unwrap();
    let restored_root = parent.path().join("restored");
    backup::restore(
        &archive,
        &restored_root,
        &saved.sha256,
        &AtomicBool::new(false),
    )
    .unwrap();
    let mut restored = Library::open(&restored_root).unwrap();
    assert_eq!(version(&restored), 17);
    assert_eq!(restored.db.load().unwrap()["library"], current["library"]);
}

#[test]
fn p7_collections_preserve_ordered_soft_members_through_checkpoint_and_restore() {
    let parent = tempfile::tempdir().unwrap();
    let root = parent.path().join("library");
    std::fs::create_dir(&root).unwrap();
    let mut library = Library::create(&root).unwrap();
    let original = json!({"id":"collection","name":"Reading list","sourceIds":["missing-source","another-source"],"archived":false,"createdAt":"2026-10-30T00:00:00.000Z","updatedAt":"2026-10-30T00:00:00.000Z"});
    let change = |value: Value| Patch {
        store: "materialCollections".into(),
        id: "collection".into(),
        value: Some(value),
        position: Some(0),
        position_only: false,
    };
    let mut duplicate = original.clone();
    duplicate["sourceIds"] = json!(["same", "same"]);
    assert!(
        library
            .db
            .commit(commit(0, vec![change(duplicate)]))
            .is_err()
    );
    assert_eq!(version(&library), 10);
    library
        .db
        .commit(commit(0, vec![change(original.clone())]))
        .unwrap();
    assert_eq!(version(&library), 17);
    library.db.backup_now(true).unwrap();
    let checkpoint = library.db.backups().unwrap()[0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut archived = original.clone();
    archived["archived"] = json!(true);
    archived["sourceIds"] = json!(["another-source", "missing-source"]);
    library
        .db
        .commit(commit(1, vec![change(archived.clone())]))
        .unwrap();
    assert_eq!(
        library.db.backup(&checkpoint).unwrap()["materialCollections"],
        json!([original])
    );
    drop(library);
    let mut library = Library::open(&root).unwrap();
    assert_eq!(
        library.db.load().unwrap()["library"]["materialCollections"],
        json!([archived])
    );
    let archive = parent.path().join("collections.repeaty-workspace");
    let saved = backup::create(&library, &archive, &AtomicBool::new(false)).unwrap();
    let restored_root = parent.path().join("restored");
    backup::restore(
        &archive,
        &restored_root,
        &saved.sha256,
        &AtomicBool::new(false),
    )
    .unwrap();
    let mut restored = Library::open(&restored_root).unwrap();
    assert_eq!(version(&restored), 17);
    assert_eq!(
        restored.db.load().unwrap()["library"]["materialCollections"],
        json!([archived])
    );
}
