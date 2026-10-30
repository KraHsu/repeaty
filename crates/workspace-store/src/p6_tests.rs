use crate::{
    backup,
    error::Error,
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
fn settings() -> Value {
    json!({"id":"study","dayStartHour":4,"maxIntervalDays":36500,"enableShortTerm":true,"cardsPerReading":3,"readingsPerCycle":1,"priorityMode":"legacy","defaultPriority":5,"priorityRatio":5,"readingMode":"legacy","readingInitialDays":1,"readingGrowthMin":1.3,"readingGrowthMax":3,"readingMaxDays":365,"newCardWindowDays":7,"statisticsSince":DATE})
}
fn model(id: &str, deck: Option<&str>) -> Value {
    let weights = [
        0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796,
        1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
    ];
    let mut value = json!({"id":id,"createdAt":DATE,"modelVersion":"FSRS-6","weights":weights,"baselineWeights":weights,"historyFingerprint":"a".repeat(64),"counts":{"reviews":1024,"cards":300,"training":800,"validation":224,"excluded":0},"metrics":{"baseline":{"logLoss":0.5,"rmse":0.3},"candidate":{"logLoss":0.4,"rmse":0.2}},"engine":"fixture"});
    if let Some(deck) = deck {
        value["deckId"] = json!(deck);
    }
    value
}
fn deck(id: &str) -> Value {
    json!({"id":id,"name":"Deck","description":"","color":"sage","createdAt":DATE,"newLimit":20,"reviewLimit":200,"burySiblings":true,"leechThreshold":8,"desiredRetention":0.9})
}
fn activity() -> Value {
    json!({"id":"activity","kind":"reading","studyDay":"2026-10-29","startedAt":DATE,"endedAt":"2026-10-30T00:01:00.000Z","activeMs":45000})
}
fn version(library: &Library) -> u32 {
    library
        .db
        .connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap()
}

#[test]
fn study_records_validate_refinements_atomically_without_advancing_reader_gate_on_failure() {
    let directory = tempfile::tempdir().unwrap();
    let mut library = Library::create(directory.path()).unwrap();
    let mut bad_settings = settings();
    bad_settings["readingGrowthMin"] = json!(4);
    let mut bad_interval = settings();
    bad_interval["readingInitialDays"] = json!(366);
    let mut bad_active = activity();
    bad_active["activeMs"] = json!(60001);
    let mut bad_time = activity();
    bad_time["endedAt"] = json!("2026-10-29T23:59:59.000Z");
    let mut bad_model = model("model", None);
    bad_model["weights"] = json!(vec![0.1; 20]);
    for bad in [
        patch("studySettings", bad_settings, 0),
        patch("studySettings", bad_interval, 0),
        patch("studyActivity", bad_active, 0),
        patch("studyActivity", bad_time, 0),
        patch("fsrsModels", bad_model, 0),
    ] {
        assert!(library.db.commit(commit(0, vec![bad])).is_err());
        assert_eq!(version(&library), 10);
        assert_eq!(library.db.load().unwrap()["revision"], 0);
    }
    let patches = vec![
        patch("studySettings", settings(), 0),
        patch("studyActivity", activity(), 0),
        patch("fsrsModels", model("model", None), 0),
    ];
    assert!(
        library
            .db
            .commit_with(commit(0, patches.clone()), |_| Err(Error::invalid()))
            .is_err()
    );
    assert_eq!(version(&library), 10);
    library.db.commit(commit(0, patches)).unwrap();
    assert_eq!(version(&library), 16);
    // A later P5 transaction must never downgrade the gate and expose unknown records.
    let connection = json!({"id":"connection","pluginId":"obsidian","connectorId":"vault","title":"Vault","mode":"import","status":"connected","settings":{},"intervalHours":0,"createdAt":DATE,"generation":0});
    library
        .db
        .commit(commit(1, vec![patch("sourceConnections", connection, 0)]))
        .unwrap();
    assert_eq!(version(&library), 16);
}

#[test]
fn model_selection_checks_global_and_deck_scopes_and_allows_atomic_replacement() {
    let directory = tempfile::tempdir().unwrap();
    let mut library = Library::create(directory.path()).unwrap();
    library
        .db
        .commit(commit(
            0,
            vec![
                patch("decks", deck("one"), 0),
                patch("decks", deck("two"), 1),
                patch("fsrsModels", model("scoped", Some("one")), 0),
                patch("fsrsModels", model("global", None), 1),
            ],
        ))
        .unwrap();
    let mut global = settings();
    global["activeFsrsModelId"] = json!("missing");
    assert!(
        library
            .db
            .commit(commit(1, vec![patch("studySettings", global.clone(), 0)]))
            .is_err()
    );
    global["activeFsrsModelId"] = json!("scoped");
    assert!(
        library
            .db
            .commit(commit(1, vec![patch("studySettings", global.clone(), 0)]))
            .is_err()
    );
    let mut wrong_deck = deck("two");
    wrong_deck["activeFsrsModelId"] = json!("scoped");
    assert!(
        library
            .db
            .commit(commit(1, vec![patch("decks", wrong_deck, 1)]))
            .is_err()
    );
    let mut inherited_model = deck("two");
    inherited_model["activeFsrsModelId"] = json!("global");
    assert!(
        library
            .db
            .commit(commit(1, vec![patch("decks", inherited_model, 1)]))
            .is_err()
    );
    global["activeFsrsModelId"] = json!("global");
    let mut selected_deck = deck("one");
    selected_deck["activeFsrsModelId"] = json!("scoped");
    library
        .db
        .commit(commit(
            1,
            vec![
                patch("studySettings", global, 0),
                patch("decks", selected_deck, 0),
            ],
        ))
        .unwrap();
    assert!(
        library
            .db
            .commit(commit(2, vec![remove("fsrsModels", "global")]))
            .is_err()
    );
    assert!(
        library
            .db
            .commit(commit(
                2,
                vec![patch("fsrsModels", model("scoped", Some("two")), 0)]
            ))
            .is_err()
    );
    // Clearing a selection in the same transaction permits removal; unrelated history survives.
    library
        .db
        .commit(commit(
            2,
            vec![
                patch("studySettings", settings(), 0),
                remove("fsrsModels", "global"),
            ],
        ))
        .unwrap();
    library
        .db
        .commit(commit(
            3,
            vec![remove("decks", "one"), patch("decks", deck("two"), 0)],
        ))
        .unwrap();
    let snapshot = library.db.load().unwrap();
    assert_eq!(snapshot["library"]["fsrsModels"][0]["deckId"], "one");
    assert_eq!(snapshot["revision"], 4);
}

#[test]
fn study_settings_events_activity_models_survive_checkpoints_reopen_and_complete_backup() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("library");
    std::fs::create_dir(&root).unwrap();
    let mut library = Library::create(&root).unwrap();
    let event = json!({"id":"event","kind":"reading","occurredAt":DATE,"studyDay":"2026-10-29","sourceId":"historical-source"});
    let mut selected = settings();
    selected["activeFsrsModelId"] = json!("model");
    library
        .db
        .commit(commit(
            0,
            vec![
                patch("studySettings", selected.clone(), 0),
                patch("studyEvents", event.clone(), 0),
                patch("studyActivity", activity(), 0),
                patch("fsrsModels", model("model", None), 0),
            ],
        ))
        .unwrap();
    library.db.backup_now(true).unwrap();
    let checkpoint = library.db.backups().unwrap()[0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    selected["dayStartHour"] = json!(6);
    library
        .db
        .commit(commit(
            1,
            vec![
                patch("studySettings", selected.clone(), 0),
                remove("studyEvents", "event"),
            ],
        ))
        .unwrap();
    let old = library.db.backup(&checkpoint).unwrap();
    assert_eq!(old["version"], 18);
    assert_eq!(old["studySettings"][0]["dayStartHour"], 4);
    assert_eq!(old["studyEvents"][0], event);
    let current = library.db.load().unwrap();
    drop(library);
    let mut library = Library::open(&root).unwrap();
    assert_eq!(version(&library), 16);
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
    assert_eq!(version(&restored), 16);
    assert_eq!(restored.db.load().unwrap()["library"], current["library"]);
    assert_eq!(
        restored.db.backup(&checkpoint).unwrap()["studyEvents"][0],
        event
    );
}

#[test]
fn future_reader_gate_is_rejected_by_library_open_and_complete_backup() {
    let directory = tempfile::tempdir().unwrap();
    let library = Library::create(directory.path()).unwrap();
    library
        .db
        .connection
        .pragma_update(None, "user_version", 17)
        .unwrap();
    let archive = directory.path().join("future.repeaty-workspace");
    assert!(backup::create(&library, &archive, &AtomicBool::new(false)).is_err());
    assert!(!archive.exists());
    drop(library);
    assert!(Library::open(directory.path()).is_err());
}

#[test]
fn every_extended_scheduling_field_raises_gate_but_legacy_fields_do_not() {
    for (store, value) in [
        ("decks", json!({"id":"deck","studyPriority":0})),
        ("notes", json!({"id":"note","studyPriority":9})),
        ("sources", json!({"id":"source","studyPriority":5})),
        ("materialFolders", json!({"id":"folder","studyPriority":1})),
        ("decks", json!({"id":"deck","activeFsrsModelId":"model"})),
        (
            "practices",
            json!({"id":"practice","studyDay":"2026-10-29"}),
        ),
        ("sources", json!({"id":"source","readingIntervalDays":2})),
        (
            "sources",
            json!({"id":"source","adaptiveReading":{"intervalDays":366}}),
        ),
        (
            "sources",
            json!({"id":"source","adaptiveReading":{"factor":1.1}}),
        ),
        (
            "sources",
            json!({"id":"source","adaptiveReading":{"factor":3.1}}),
        ),
    ] {
        assert!(crate::study::needs_p6(&patch(store, value, 0)));
    }
    assert!(!crate::study::needs_p6(&patch(
        "sources",
        json!({"id":"source","priority":"high","readingIntervalDays":30,"adaptiveReading":{"intervalDays":365,"factor":1.3}}),
        0
    )));
    assert!(!crate::study::needs_p6(&patch(
        "reviews",
        json!({"id":"review","studyDay":"2026-10-29"}),
        0
    )));
}
