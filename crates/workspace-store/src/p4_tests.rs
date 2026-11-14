use crate::{
    library::Library,
    records::{Commit, Patch},
    retirement,
};
use serde_json::{Value, json};
const DATE: &str = "2026-10-30T00:00:00.000Z";
fn patch(store: &str, value: Value, position: i64) -> Patch {
    Patch {
        store: store.into(),
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
fn source(id: &str, media: &str, text: &str) -> Value {
    json!({"id":id,"title":id,"url":"","format":"plain","mediaId":media,"characters":text.encode_utf16().count(),"createdAt":DATE})
}
fn media(id: &str, mime: &str, size: usize) -> Value {
    json!({"id":id,"name":id,"type":mime,"size":size,"createdAt":DATE})
}
fn note(id: &str) -> Value {
    json!({"id":id,"deckId":"deck","type":"plugin","front":"question","back":"","format":"plain","tags":[],"frontMedia":[],"backMedia":[],"plugin":{"id":"visual-occlusion","version":1,"variants":["region-a","region-b"],"data":{}},"createdAt":DATE,"updatedAt":DATE})
}
fn card(id: &str, note: &str, variant: &str) -> Value {
    json!({"id":id,"noteId":note,"variant":variant,"schedule":{"due":DATE,"stability":12,"difficulty":4,"elapsed_days":3,"scheduled_days":7,"learning_steps":0,"reps":5,"lapses":1,"state":2},"suspended":false,"leech":false,"createdAt":DATE,"updatedAt":DATE})
}
fn version(library: &Library) -> u32 {
    library
        .db
        .connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap()
}

#[test]
fn document_resources_annotation_and_sequence_validate_and_raise_reader_gate_atomically() {
    let directory = tempfile::tempdir().unwrap();
    let mut library = Library::create(directory.path()).unwrap();
    for (id, mime, bytes) in [
        ("text", "text/plain", b"word".as_slice()),
        ("original", "application/epub+zip", b"zip"),
        ("font", "application/octet-stream", b"font"),
    ] {
        library.db.put_media(id, mime, bytes).unwrap();
    }
    let mut root = source("book", "text", "word");
    root["document"] = json!({"schemaVersion":1,"providerId":"document-reader","readerId":"epub","format":"epub","originalMediaId":"original","container":true,"data":{"count":1},"resources":[{"path":"fonts/body.woff2","mediaId":"font"}]});
    let mut chapter = source("chapter", "text", "word");
    chapter["document"] = root["document"].clone();
    chapter["document"]["container"] = json!(false);
    chapter["document"]["path"] = json!("chapters/one.xhtml");
    chapter["studySequence"] =
        json!({"groupId":"book","index":0,"mode":"sequential","completed":false});
    chapter["annotations"] = json!([{"id":uuid::Uuid::new_v4().to_string(),"mediaId":"text","start":0,"end":4,"quote":"word","body":"annotation","createdAt":DATE,"updatedAt":DATE,"locator":{"schemaVersion":1,"sourceId":"chapter","versionId":"text","kind":"epub","href":"chapters/one.xhtml","start":0,"end":4}}]);
    let patches = vec![
        patch("media", media("text", "text/plain", 4), 0),
        patch("media", media("original", "application/epub+zip", 3), 1),
        patch("media", media("font", "application/octet-stream", 4), 2),
        patch("sources", root.clone(), 0),
        patch("sources", chapter.clone(), 1),
    ];
    let mut invalid = patches.clone();
    invalid[4].value.as_mut().unwrap()["annotations"][0]["locator"]["href"] = json!("other.xhtml");
    assert!(library.db.commit(commit(0, invalid)).is_err());
    assert_eq!(version(&library), 10);
    library.db.commit(commit(0, patches)).unwrap();
    assert_eq!(version(&library), 14);
    // Independent directory organization is allowed; the logical book sequence remains valid.
    chapter["studySequence"]["completed"] = json!(true);
    library
        .db
        .commit(commit(1, vec![patch("sources", chapter.clone(), 1)]))
        .unwrap();
    let mut invalid = chapter.clone();
    invalid["studySequence"]["groupId"] = json!("missing");
    assert!(
        library
            .db
            .commit(commit(2, vec![patch("sources", invalid, 1)]))
            .is_err()
    );
    let removal = Patch {
        store: "media".into(),
        id: "font".into(),
        value: None,
        position: None,
        position_only: false,
    };
    assert!(library.db.commit(commit(2, vec![removal])).is_err());
    let mut invalid = root;
    invalid["document"]["resources"][0]["path"] = json!("../outside");
    assert!(
        library
            .db
            .commit(commit(2, vec![patch("sources", invalid, 0)]))
            .is_err()
    );
    assert_eq!(library.db.load().unwrap()["revision"], 2);
    drop(library);
    assert!(Library::open(directory.path()).is_ok());
}

#[test]
fn formula_locator_requires_markdown_exact_delimiters_and_unique_leaves() {
    let mut snapshot = source("formula", "formula-text", "$x+y$");
    snapshot["format"] = json!("markdown");
    let mut reference = json!({"sourceId":"formula","mediaId":"formula-text","start":0,"end":5,"quote":"$x+y$","locator":{"schemaVersion":1,"sourceId":"formula","versionId":"formula-text","kind":"formula","start":0,"end":5,"latex":"x+y","leaves":[0,2]}});
    crate::materials::reference(&snapshot, &reference, &[]).unwrap();
    reference["locator"]["latex"] = json!("different");
    assert!(crate::materials::reference(&snapshot, &reference, &[]).is_err());
    reference["locator"]["latex"] = json!("x+y");
    reference["locator"]["leaves"] = json!([0, 0]);
    assert!(crate::materials::reference(&snapshot, &reference, &[]).is_err());
    reference["locator"]["leaves"] = json!([0]);
    snapshot["format"] = json!("plain");
    assert!(crate::materials::reference(&snapshot, &reference, &[]).is_err());
}

#[test]
fn large_document_bytes_roundtrip_while_images_keep_the_ten_mebibyte_limit() {
    let directory = tempfile::tempdir().unwrap();
    let mut library = Library::create(directory.path()).unwrap();
    let bytes = vec![b'x'; crate::records::MAX_MEDIA + 1];
    for (id, mime) in [
        ("pdf", "application/pdf"),
        ("epub", "application/epub+zip"),
        ("html", "text/html"),
    ] {
        library.db.put_media(id, mime, &bytes).unwrap();
        assert_eq!(library.db.media(id).unwrap().1.len(), bytes.len());
    }
    assert!(library.db.put_media("image", "image/png", &bytes).is_err());
    assert!(library.db.put_media("plain", "text/plain", &bytes).is_err());
    library
        .db
        .commit(commit(
            0,
            vec![patch(
                "media",
                media("pdf", "application/pdf", bytes.len()),
                0,
            )],
        ))
        .unwrap();
    assert_eq!(version(&library), 14);
}

#[test]
fn portable_retirement_preserves_variants_full_attempts_and_checkpoint_state_without_grade_scans() {
    let directory = tempfile::tempdir().unwrap();
    let mut library = Library::create(directory.path()).unwrap();
    let deck = json!({"id":"deck","name":"Deck","description":"","color":"sage","createdAt":DATE,"newLimit":20,"reviewLimit":200,"burySiblings":true,"leechThreshold":8,"desiredRetention":0.9});
    let note = note("note");
    let active_card = card("card-a", "note", "plugin:region-a");
    let retired_card = card("card-b", "note", "plugin:region-b");
    library
        .db
        .commit(commit(
            0,
            vec![
                patch("decks", deck, 0),
                patch("notes", note.clone(), 0),
                patch("cards", active_card.clone(), 0),
                patch("cards", retired_card.clone(), 1),
            ],
        ))
        .unwrap();
    assert_eq!(version(&library), 14);
    let practice = json!({"id":"practice","cardId":"card-b","contentRevision":"v1","question":{"front":"q","back":"a","format":"plain","plugin":{"id":"visual-occlusion","version":1,"data":{}}},"startedAt":DATE});
    let attempt = json!({"id":"attempt","practiceId":"practice","submittedAt":DATE,"updatedAt":DATE,"language":"typescript","code":"complete code body","elapsedMs":10,"status":"completed","submissionId":"1","result":{"outcome":"accepted","status":"ok","runtime":"1","memory":"2","detail":"complete diagnostics"}});
    library
        .db
        .commit(commit(
            1,
            vec![
                patch("practices", practice, 0),
                patch("attempts", attempt, 0),
            ],
        ))
        .unwrap();
    library.db.backup_now(true).unwrap();
    let before_id = library.db.backups().unwrap()[0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let removed = vec![
        Patch {
            store: "cards".into(),
            id: "card-b".into(),
            value: None,
            position: None,
            position_only: false,
        },
        Patch {
            store: "practices".into(),
            id: "practice".into(),
            value: None,
            position: None,
            position_only: false,
        },
        Patch {
            store: "attempts".into(),
            id: "attempt".into(),
            value: None,
            position: None,
            position_only: false,
        },
    ];
    library
        .db
        .commit_callbacks(
            commit(2, removed.clone()),
            |tx| retirement::capture(tx, &removed),
            |_| Ok(()),
        )
        .unwrap();
    let exported = retirement::export(&library.db.connection, 3, None).unwrap();
    assert_eq!(exported.len(), 1);
    assert_eq!(exported[0]["note"], note);
    assert_eq!(
        retirement::listing(&library.db.connection, "", 0).unwrap()["total"],
        0
    );
    assert_eq!(
        exported[0]["cards"][0]["schedule"],
        retired_card["schedule"]
    );
    assert_eq!(exported[0]["attempts"][0]["code"], "complete code body");
    assert_eq!(
        exported[0]["attempts"][0]["result"]["detail"],
        "complete diagnostics"
    );
    assert!(
        retirement::export(&library.db.connection, 3, Some(&before_id))
            .unwrap()
            .is_empty()
    );
    library.db.backup_now(true).unwrap();
    let after_id = library.db.backups().unwrap()[0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let log_count: i64 = library
        .db
        .connection
        .query_row("SELECT count(*) FROM retired_history", [], |r| r.get(0))
        .unwrap();
    let mut graded = active_card;
    graded["schedule"]["reps"] = json!(6);
    library
        .db
        .commit(commit(3, vec![patch("cards", graded, 0)]))
        .unwrap();
    assert_eq!(
        library
            .db
            .connection
            .query_row("SELECT count(*) FROM retired_history", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        log_count
    );
    let mut clear = commit(4, vec![]);
    clear.retired = Some(vec![]);
    library.db.commit(clear).unwrap();
    assert!(
        retirement::export(&library.db.connection, 5, None)
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        retirement::export(&library.db.connection, 5, Some(&after_id)).unwrap()[0]["attempts"][0]["code"],
        "complete code body"
    );
    let mut restore = commit(5, vec![]);
    restore.retired = Some(exported.clone());
    library.db.commit(restore).unwrap();
    let mut edited = note.clone();
    edited["front"] = json!("edited active question");
    let changes = vec![patch("notes", edited, 0)];
    library
        .db
        .commit_callbacks(
            commit(6, changes.clone()),
            |_| Ok(()),
            |tx| retirement::reactivate(tx, &changes),
        )
        .unwrap();
    assert_eq!(
        retirement::export(&library.db.connection, 7, None).unwrap()[0]["note"],
        note
    );
    let mut invalid = exported;
    invalid[0]["attempts"][0]
        .as_object_mut()
        .unwrap()
        .remove("code");
    let mut restore = commit(7, vec![]);
    restore.retired = Some(invalid);
    assert!(library.db.commit(restore).is_err());
    assert_eq!(
        retirement::export(&library.db.connection, 7, None).unwrap()[0]["attempts"][0]["code"],
        "complete code body"
    );
    assert!(retirement::export(&library.db.connection, 5, None).is_err());
    drop(library);
    let reopened = Library::open(directory.path()).unwrap();
    assert_eq!(version(&reopened), 14);
}

#[test]
fn portable_retired_document_and_exclusive_media_restore_in_one_revision() {
    let directory = tempfile::tempdir().unwrap();
    let mut library = Library::create(directory.path()).unwrap();
    let bytes = b"offline retired image";
    library.db.put_media("image", "image/png", bytes).unwrap();
    let mut archived = note("retired");
    archived["frontMedia"] = json!(["image"]);
    let raw = "---\nrepeaty: {version: 1, kind: note, id: retired, type: plugin, frontMedia: [image]}\ncustom: keep this unknown field\n---\nquestion\n<!-- repeaty:answer -->\nanswer\n";
    let entry = json!({"revision":0,"note":archived,"document":{"id":"retired","kind":"note","path":"notes/retired.md","raw":raw,"hash":crate::files::digest(raw.as_bytes())},"cards":[card("retired-card","retired","plugin:region-a")],"reviews":[],"practices":[],"attempts":[],"media":[media("image","image/png",bytes.len())]});
    let request = |revision, entries: Value| {
        serde_json::from_value::<crate::library::Save>(json!({"operationId":uuid::Uuid::new_v4().to_string(),"expectedRevision":revision,"patches":[],"documents":[],"retired":entries})).unwrap()
    };
    let mut invalid = entry.clone();
    invalid["document"]["hash"] = json!("a".repeat(64));
    assert!(library.save(request(0, json!([invalid]))).is_err());
    assert_eq!(library.db.load().unwrap()["revision"], 0);
    library.save(request(0, json!([entry]))).unwrap();
    let exported = library
        .read(json!({"type":"retired-notes","revision":1}))
        .unwrap();
    assert_eq!(exported[0]["document"]["raw"], raw);
    assert_eq!(exported[0]["media"][0]["id"], "image");
    assert_eq!(library.db.media("image").unwrap().1, bytes);
    assert!(
        library.db.load().unwrap()["library"]["media"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    library.db.backup_now(true).unwrap();
    let backup = library.db.backups().unwrap()[0]["id"].clone();
    library.save(request(1, json!([]))).unwrap();
    let old = library
        .read(json!({"type":"retired-notes","revision":2,"backupId":backup}))
        .unwrap();
    assert_eq!(old[0]["document"]["raw"], raw);
    library.save(request(2, old)).unwrap();
    drop(library);
    let mut reopened = Library::open(directory.path()).unwrap();
    assert_eq!(
        reopened
            .read(json!({"type":"retired-notes","revision":3}))
            .unwrap()[0]["document"]["raw"],
        raw
    );
    assert_eq!(reopened.db.media("image").unwrap().1, bytes);
}

#[test]
fn portable_unversioned_retired_excerpts_resolve_the_original_snapshot() {
    let directory = tempfile::tempdir().unwrap();
    let mut library = Library::create(directory.path()).unwrap();
    library
        .db
        .put_media("first-text", "text/plain", b"original passage")
        .unwrap();
    library
        .db
        .put_media("new-text", "text/plain", b"new text")
        .unwrap();
    let first = source("book", "first-text", "original passage");
    let mut archived = note("retired");
    archived["excerpt"] = json!({"sourceId":"book","start":0,"end":8,"quote":"original"});
    let retired = json!({"revision":0,"note":archived,"document":null,"cards":[card("old-card","retired","plugin:region-a")],"reviews":[],"practices":[],"attempts":[],"media":[]});
    let mut initial = commit(
        0,
        vec![
            patch("media", media("first-text", "text/plain", 16), 0),
            patch("sources", first.clone(), 0),
        ],
    );
    initial.retired = Some(vec![retired.clone()]);
    library.db.commit(initial).unwrap();
    let mut current = source("book", "new-text", "new text");
    current["versions"] = json!([{"title":"book","url":"","format":"plain","mediaId":"first-text","characters":16,"acceptedAt":DATE}]);
    let mut updated = commit(
        1,
        vec![
            patch("media", media("new-text", "text/plain", 8), 1),
            patch("sources", current, 0),
        ],
    );
    updated.retired = Some(vec![retired.clone()]);
    library.db.commit(updated).unwrap();
    let mut wrong = retired;
    wrong["note"]["excerpt"]["quote"] = json!("new text");
    let mut changed = commit(2, vec![]);
    changed.retired = Some(vec![wrong]);
    assert!(library.db.commit(changed).is_err());
    assert_eq!(library.db.load().unwrap()["revision"], 2);
}
