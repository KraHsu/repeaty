use crate::{
    library::Library,
    records::{Commit, Patch},
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
fn commit(expected_revision: i64, patches: Vec<Patch>) -> Commit {
    Commit {
        expected_revision,
        patches,
        reason: None,
        operation_history: None,
        retired: None,
    }
}
fn source(id: &str, media: &str, text: &str) -> Value {
    json!({"id":id,"title":id,"url":"","format":"plain","mediaId":media,"characters":text.len(),"createdAt":DATE})
}
fn media(id: &str, text: &str) -> Value {
    json!({"id":id,"name":id,"type":"text/plain","size":text.len(),"createdAt":DATE})
}
fn note() -> Value {
    json!({"id":"note","deckId":"deck","type":"basic","front":"question","back":"answer","format":"plain","tags":[],"frontMedia":[],"backMedia":[],"createdAt":DATE,"updatedAt":DATE,
        "excerpt":{"sourceId":"book","start":0,"end":4,"quote":"same"}})
}
fn card() -> Value {
    json!({"id":"card","noteId":"note","variant":"forward","schedule":{"due":DATE,"stability":12,"difficulty":4,"elapsed_days":3,"scheduled_days":7,"learning_steps":0,"reps":5,"lapses":1,"state":2},"suspended":false,"leech":false,"createdAt":DATE,"updatedAt":DATE})
}
fn retired() -> Value {
    json!({"revision":0,"note":note(),"document":null,"cards":[card()],"reviews":[],"practices":[],"attempts":[],"media":[]})
}
fn setup(kind: &str) -> (tempfile::TempDir, Library, Value) {
    let directory = tempfile::tempdir().unwrap();
    let mut library = Library::create(directory.path()).unwrap();
    let mut current = source("book", "latest", "same latest text");
    current["versions"] = json!([
        {"title":"book","url":"","format":"plain","mediaId":"first","characters":15,"acceptedAt":DATE},
        {"title":"book","url":"","format":"plain","mediaId":"middle","characters":16,"acceptedAt":DATE}
    ]);
    let mut patches = Vec::new();
    for (position, (id, body)) in [
        ("first", "same first text"),
        ("middle", "same middle text"),
        ("latest", "same latest text"),
        ("excerpt", "same"),
    ]
    .into_iter()
    .enumerate()
    {
        library
            .db
            .put_media(id, "text/plain", body.as_bytes())
            .unwrap();
        patches.push(patch("media", media(id, body), position as i64));
    }
    patches.push(patch("sources", current.clone(), 0));
    let retired = if kind == "retired" {
        Some(vec![retired()])
    } else {
        if kind == "note" {
            patches.push(patch("decks", json!({"id":"deck","name":"Deck","description":"","color":"sage","createdAt":DATE,"newLimit":20,"reviewLimit":200,"burySiblings":true,"leechThreshold":8,"desiredRetention":0.9}), 0));
            patches.push(patch("notes", note(), 0));
            patches.push(patch("cards", card(), 0));
        } else {
            let mut excerpt = source("child", "excerpt", "same");
            excerpt["kind"] = json!("excerpt");
            excerpt["origin"] = json!({"sourceId":"book","start":0,"end":4});
            patches.push(patch("sources", excerpt, 1));
        }
        None
    };
    let mut initial = commit(0, patches);
    initial.retired = retired;
    library.db.commit(initial).unwrap();
    (directory, library, current)
}

#[test]
fn unversioned_references_cannot_rebind_when_the_first_snapshot_is_removed_or_reordered() {
    for kind in ["note", "source", "retired"] {
        let (_directory, mut library, current) = setup(kind);
        for reorder in [false, true] {
            let mut changed = current.clone();
            if reorder {
                changed["versions"].as_array_mut().unwrap().reverse();
            } else {
                changed["versions"].as_array_mut().unwrap().remove(0);
            }
            assert!(
                library
                    .db
                    .commit(commit(1, vec![patch("sources", changed, 0)]))
                    .is_err(),
                "{kind} silently rebound its first snapshot, reorder={reorder}"
            );
            let saved = library.db.load().unwrap();
            assert_eq!(saved["revision"], 1);
            assert_eq!(saved["library"]["sources"][0], current);
        }
    }
}

#[test]
fn unversioned_references_allow_removing_an_unreferenced_snapshot_and_promoting_the_same_identity()
{
    for kind in ["note", "source", "retired"] {
        let (_directory, mut library, mut current) = setup(kind);
        current["versions"].as_array_mut().unwrap().remove(1);
        library
            .db
            .commit(commit(1, vec![patch("sources", current, 0)]))
            .unwrap();
        // The first identity can become current without changing where an old quote resolves.
        let promoted = source("book", "first", "same first text");
        library
            .db
            .commit(commit(2, vec![patch("sources", promoted.clone(), 0)]))
            .unwrap();
        let saved = library.db.load().unwrap();
        assert_eq!(saved["revision"], 3);
        assert_eq!(saved["library"]["sources"][0], promoted);
    }
}

#[test]
fn portable_replacement_can_rekey_unversioned_reference_snapshots_atomically() {
    for kind in ["note", "source", "retired"] {
        let (_directory, mut library, mut current) = setup(kind);
        let mut patches = Vec::new();
        for (position, (id, body)) in [
            ("restored-first", "same first text"),
            ("restored-middle", "same middle text"),
            ("restored-latest", "same latest text"),
        ]
        .into_iter()
        .enumerate()
        {
            library
                .db
                .put_media(id, "text/plain", body.as_bytes())
                .unwrap();
            patches.push(patch("media", media(id, body), position as i64 + 4));
        }
        current["mediaId"] = json!("restored-latest");
        current["versions"][0]["mediaId"] = json!("restored-first");
        current["versions"][1]["mediaId"] = json!("restored-middle");
        patches.push(patch("sources", current.clone(), 0));
        let mut restored = commit(1, patches);
        restored.retired = Some(if kind == "retired" {
            vec![retired()]
        } else {
            vec![]
        });
        library.db.commit(restored).unwrap();
        let saved = library.db.load().unwrap();
        assert_eq!(saved["revision"], 2);
        assert_eq!(saved["library"]["sources"][0], current);
    }
}
