use repeaty_workspace::{
    atomic::{self, ReplaceMethod},
    files,
    prototype::{Checkpoint, NewCard, Prototype, Result, SaveOutcome, SaveRequest},
};
use rusqlite::{Connection, params};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    process::Command,
};

const OLD: &str = "---\nrepeaty: {version: 1, kind: note, id: note-old, type: basic, format: markdown, deckId: deck}\n---\n原问题🙂\r\n\n<!-- repeaty:answer -->\n原答案\r\n";
const NEW: &str = "---\nrepeaty: {version: 1, kind: note, id: note-old, type: basic, format: markdown, deckId: deck}\n---\n修改后的问题🙂\n<!-- repeaty:answer -->\n新答案\n";
const DRAFT_NOTE: &str = "---\nrepeaty: {version: 1, kind: note, id: from-draft, type: basic, format: markdown, deckId: deck}\n---\n新问题\n<!-- repeaty:answer -->\n答案\n";
const CARD_STATE: &str = "{\"due\":\"2027-01-01T10:00:00.000Z\",\"stability\":8.12345678901234,\"reviews\":[\"old-review\"],\"suspended\":false}\n";

fn card(id: &str) -> NewCard {
    NewCard {
        id: id.into(),
        variant: "forward".into(),
        state_json: CARD_STATE.into(),
    }
}
fn update_request() -> SaveRequest {
    SaveRequest {
        operation_id: "edit-1".into(),
        note_id: "note-old".into(),
        path: "notes/old.md".into(),
        expected_hash: Some(files::digest(OLD.as_bytes())),
        draft_id: None,
        new_cards: vec![],
    }
}
fn draft_request() -> SaveRequest {
    SaveRequest {
        operation_id: "confirm-1".into(),
        note_id: "from-draft".into(),
        path: "notes/from-draft.md".into(),
        expected_hash: None,
        draft_id: Some("draft-1".into()),
        new_cards: vec![card("original-new-card-id")],
    }
}
fn setup() -> (tempfile::TempDir, Prototype) {
    let root = tempfile::tempdir().unwrap();
    let mut proto = Prototype::create_in_empty(root.path()).unwrap();
    proto
        .seed_note_for_fixture(
            "note-old",
            "notes/old.md",
            OLD.as_bytes(),
            &[card("original-card-id")],
        )
        .unwrap();
    proto
        .seed_draft_for_fixture(
            "draft-1",
            "{\"front\":\"\",\"back\":\"未完成\",\"uploads\":[\"original-image\"]}",
        )
        .unwrap();
    (root, proto)
}
fn db(root: &Path) -> Connection {
    Connection::open(root.join("state.prototype.sqlite3")).unwrap()
}
fn count(root: &Path, table: &str) -> i64 {
    db(root)
        .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .unwrap()
}
fn accepted(root: &Path) -> String {
    db(root)
        .query_row(
            "SELECT accepted_hash FROM notes WHERE id='note-old'",
            [],
            |row| row.get(0),
        )
        .unwrap()
}
fn consumed(root: &Path) -> Option<String> {
    db(root)
        .query_row(
            "SELECT consumed_by FROM drafts WHERE id='draft-1'",
            [],
            |row| row.get(0),
        )
        .unwrap()
}
fn object(root: &Path, bytes: &[u8]) -> PathBuf {
    let hash = files::digest(bytes);
    root.join(".repeaty/objects/sha256")
        .join(&hash[..2])
        .join(hash)
}
fn displaced(root: &Path) -> PathBuf {
    root.join(".repeaty/transactions/edit-1").join(
        if atomic::replace_method() == ReplaceMethod::Exchange {
            "slot"
        } else {
            "displaced"
        },
    )
}
fn assert_committed(outcome: &SaveOutcome) {
    assert!(
        matches!(outcome, SaveOutcome::Committed { .. }),
        "{outcome:?}"
    );
}
fn interrupted(point: Checkpoint, at: Checkpoint) -> Result<()> {
    if point == at {
        Err("injected-interruption".into())
    } else {
        Ok(())
    }
}

#[test]
fn ordinary_edit_and_recovery_keep_original_scheduling_and_ids() {
    let (root, mut proto) = setup();
    assert_committed(&proto.save(update_request(), NEW.as_bytes()).unwrap());
    assert_eq!(accepted(root.path()), files::digest(NEW.as_bytes()));
    assert_eq!(count(root.path(), "changes"), 1);
    assert_eq!(count(root.path(), "cards"), 1);
    assert_eq!(
        db(root.path())
            .query_row(
                "SELECT state_json FROM cards WHERE id='original-card-id'",
                [],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
        CARD_STATE
    );
    assert_eq!(
        fs::read(root.path().join("notes/old.md")).unwrap(),
        NEW.as_bytes()
    );
    assert_eq!(
        fs::read(object(root.path(), OLD.as_bytes())).unwrap(),
        OLD.as_bytes()
    );
    assert_eq!(fs::read(displaced(root.path())).unwrap(), OLD.as_bytes());
    for _ in 0..3 {
        assert_committed(&proto.recover().unwrap()[0]);
        assert_committed(&proto.save(update_request(), NEW.as_bytes()).unwrap());
    }
    assert_eq!(count(root.path(), "changes"), 1);
    assert_eq!(count(root.path(), "cards"), 1);
}

#[test]
fn draft_confirmation_and_retries_create_one_note_and_card() {
    let (root, mut proto) = setup();
    let payload: String = db(root.path())
        .query_row("SELECT payload FROM drafts", [], |row| row.get(0))
        .unwrap();
    for _ in 0..3 {
        assert_committed(&proto.save(draft_request(), DRAFT_NOTE.as_bytes()).unwrap());
    }
    assert_eq!(count(root.path(), "notes"), 2);
    assert_eq!(count(root.path(), "cards"), 2);
    assert_eq!(count(root.path(), "changes"), 1);
    assert_eq!(consumed(root.path()).as_deref(), Some("confirm-1"));
    assert_eq!(
        db(root.path())
            .query_row("SELECT payload FROM drafts", [], |row| row
                .get::<_, String>(0))
            .unwrap(),
        payload
    );
}

#[test]
fn editor_changes_before_preflight_remain_visible_and_keep_the_proposal() {
    let (root, mut proto) = setup();
    fs::write(root.path().join("notes/old.md"), "external edit").unwrap();
    let outcome = proto.save(update_request(), NEW.as_bytes()).unwrap();
    assert!(matches!(
        outcome,
        SaveOutcome::Attention {
            committed: Some(false),
            ..
        }
    ));
    assert_eq!(
        fs::read(root.path().join("notes/old.md")).unwrap(),
        b"external edit"
    );
    assert_eq!(
        fs::read(object(root.path(), NEW.as_bytes())).unwrap(),
        NEW.as_bytes()
    );
    assert_eq!(accepted(root.path()), files::digest(OLD.as_bytes()));
    assert_eq!(count(root.path(), "changes"), 0);
    // Restoring the bytes does not silently clear the unresolved conflict.
    fs::write(root.path().join("notes/old.md"), OLD).unwrap();
    assert!(matches!(
        proto.save(update_request(), NEW.as_bytes()).unwrap(),
        SaveOutcome::Attention { .. }
    ));
    assert_eq!(
        fs::read(root.path().join("notes/old.md")).unwrap(),
        OLD.as_bytes()
    );
}

#[test]
fn an_editor_winning_the_preflight_race_is_preserved_without_automatic_rollback() {
    let (root, mut proto) = setup();
    let target = root.path().join("notes/old.md");
    let result = proto
        .save_with_checkpoint(update_request(), NEW.as_bytes(), |point| {
            if point == Checkpoint::PublishStarted {
                fs::write(&target, "last moment editor text")?;
            }
            Ok(())
        })
        .unwrap();
    assert!(matches!(
        result,
        SaveOutcome::Attention {
            committed: Some(false),
            ..
        }
    ));
    assert_eq!(
        fs::read(displaced(root.path())).unwrap(),
        b"last moment editor text"
    );
    assert_eq!(fs::read(&target).unwrap(), NEW.as_bytes());
    assert_eq!(
        fs::read(object(root.path(), b"last moment editor text")).unwrap(),
        b"last moment editor text"
    );
    assert_eq!(accepted(root.path()), files::digest(OLD.as_bytes()));
    assert_eq!(count(root.path(), "changes"), 0);
    fs::write(&target, "a third editor version").unwrap();
    proto.recover().unwrap();
    assert_eq!(fs::read(&target).unwrap(), b"a third editor version");
}

#[test]
fn late_old_handle_writes_are_found_after_commit_and_restart() {
    let (root, mut proto) = setup();
    let mut editor = OpenOptions::new()
        .write(true)
        .truncate(false)
        .open(root.path().join("notes/old.md"))
        .unwrap();
    assert_committed(&proto.save(update_request(), NEW.as_bytes()).unwrap());
    editor.set_len(0).unwrap();
    editor.write_all(b"late old-handle content").unwrap();
    editor.sync_all().unwrap();
    drop(proto);
    let mut reopened = Prototype::open(root.path()).unwrap();
    assert!(
        matches!(&reopened.recover().unwrap()[0], SaveOutcome::Attention { committed: Some(true), reason, .. } if reason == "displaced-file-changed")
    );
    assert_eq!(accepted(root.path()), files::digest(NEW.as_bytes()));
    assert_eq!(count(root.path(), "changes"), 1);
    assert_eq!(
        fs::read(object(root.path(), OLD.as_bytes())).unwrap(),
        OLD.as_bytes()
    );
    assert_eq!(
        fs::read(object(root.path(), b"late old-handle content")).unwrap(),
        b"late old-handle content"
    );
    assert_eq!(
        fs::read(root.path().join("notes/old.md")).unwrap(),
        NEW.as_bytes()
    );
}

#[test]
fn external_writes_or_deletion_after_publication_do_not_consume_a_draft() {
    for delete in [false, true] {
        let (root, mut proto) = setup();
        let target = root.path().join("notes/from-draft.md");
        let result = proto
            .save_with_checkpoint(draft_request(), DRAFT_NOTE.as_bytes(), |point| {
                if point == Checkpoint::PublicationRecorded {
                    if delete {
                        fs::remove_file(&target)?;
                    } else {
                        fs::write(&target, "new external text")?;
                    }
                }
                Ok(())
            })
            .unwrap();
        assert!(matches!(
            result,
            SaveOutcome::Attention {
                committed: Some(false),
                ..
            }
        ));
        assert_eq!(count(root.path(), "notes"), 1);
        assert_eq!(count(root.path(), "cards"), 1);
        assert_eq!(consumed(root.path()), None);
        drop(proto);
        let mut reopened = Prototype::open(root.path()).unwrap();
        reopened.recover().unwrap();
        assert_eq!(target.exists(), !delete);
        if !delete {
            assert_eq!(fs::read(&target).unwrap(), b"new external text");
        }
    }
}

#[test]
fn new_target_name_collision_does_not_overwrite_or_consume_a_draft() {
    let (root, mut proto) = setup();
    let target = root.path().join("notes/from-draft.md");
    let result = proto
        .save_with_checkpoint(draft_request(), DRAFT_NOTE.as_bytes(), |point| {
            if point == Checkpoint::PublishStarted {
                files::write_new(&target, b"editor-created-file")?;
            }
            Ok(())
        })
        .unwrap();
    assert!(matches!(
        result,
        SaveOutcome::Attention {
            committed: Some(false),
            ..
        }
    ));
    assert_eq!(fs::read(&target).unwrap(), b"editor-created-file");
    assert_eq!(consumed(root.path()), None);
    assert_eq!(count(root.path(), "changes"), 0);
}

#[test]
fn different_operation_or_identity_cannot_reconfirm_a_reserved_or_consumed_draft() {
    let (root, mut proto) = setup();
    assert!(
        proto
            .save_with_checkpoint(draft_request(), DRAFT_NOTE.as_bytes(), |point| interrupted(
                point,
                Checkpoint::ReservationCommitted
            ))
            .is_err()
    );
    let mut retry = draft_request();
    retry.operation_id = "different-operation".into();
    retry.note_id = "different-note".into();
    retry.path = "notes/other.md".into();
    assert!(proto.save(retry.clone(), DRAFT_NOTE.as_bytes()).is_err());
    assert!(!root.path().join("notes/other.md").exists());
    assert_eq!(consumed(root.path()), None);
    assert_committed(&proto.save(draft_request(), DRAFT_NOTE.as_bytes()).unwrap());
    assert!(proto.save(retry, DRAFT_NOTE.as_bytes()).is_err());
    assert_eq!(count(root.path(), "notes"), 2);
    assert_eq!(count(root.path(), "cards"), 2);
}

#[test]
fn operation_id_cannot_be_reused_for_other_bytes_paths_or_ids() {
    let (root, mut proto) = setup();
    assert_committed(&proto.save(update_request(), NEW.as_bytes()).unwrap());
    assert!(proto.save(update_request(), b"another payload").is_err());
    let mut changed = update_request();
    changed.path = "notes/elsewhere.md".into();
    assert!(proto.save(changed, NEW.as_bytes()).is_err());
    let mut changed = update_request();
    changed.note_id = "another-id".into();
    assert!(proto.save(changed, NEW.as_bytes()).is_err());
    assert_eq!(count(root.path(), "changes"), 1);
}

#[test]
fn old_receipts_do_not_roll_back_a_later_legitimate_save() {
    let (root, mut proto) = setup();
    assert_committed(&proto.save(update_request(), NEW.as_bytes()).unwrap());
    let mut second = update_request();
    second.operation_id = "edit-2".into();
    second.expected_hash = Some(files::digest(NEW.as_bytes()));
    assert_committed(&proto.save(second, b"third accepted content").unwrap());
    let outcomes = proto.recover().unwrap();
    assert_eq!(outcomes.len(), 2);
    for outcome in &outcomes {
        assert_committed(outcome);
    }
    assert_eq!(
        accepted(root.path()),
        files::digest(b"third accepted content")
    );
    assert_eq!(count(root.path(), "changes"), 2);
}

#[test]
fn completed_draft_receipt_remains_committed_after_external_deletion() {
    let (root, mut proto) = setup();
    assert_committed(&proto.save(draft_request(), DRAFT_NOTE.as_bytes()).unwrap());
    fs::remove_file(root.path().join("notes/from-draft.md")).unwrap();
    assert!(matches!(
        proto.recover().unwrap()[0],
        SaveOutcome::Attention {
            committed: Some(true),
            ..
        }
    ));
    assert_eq!(consumed(root.path()).as_deref(), Some("confirm-1"));
    assert_eq!(count(root.path(), "notes"), 2);
    assert_eq!(count(root.path(), "changes"), 1);
}

#[test]
fn corrupt_objects_or_journals_stop_recovery_without_changing_visible_files() {
    for journal in [false, true] {
        let (root, mut proto) = setup();
        assert!(
            proto
                .save_with_checkpoint(update_request(), NEW.as_bytes(), |point| interrupted(
                    point,
                    Checkpoint::FilePublished
                ))
                .is_err()
        );
        let path = if journal {
            root.path().join(".repeaty/transactions/edit-1/intent.json")
        } else {
            object(root.path(), NEW.as_bytes())
        };
        fs::write(&path, "corruption").unwrap();
        let result = proto.recover().unwrap();
        assert!(matches!(
            result[0],
            SaveOutcome::Attention {
                committed: Some(false),
                ..
            }
        ));
        assert_eq!(accepted(root.path()), files::digest(OLD.as_bytes()));
        assert_eq!(
            fs::read(root.path().join("notes/old.md")).unwrap(),
            NEW.as_bytes()
        );
        assert_eq!(fs::read(displaced(root.path())).unwrap(), OLD.as_bytes());
        assert_eq!(count(root.path(), "changes"), 0);
    }
}

#[test]
fn a_damaged_completed_journal_does_not_claim_that_sqlite_rolled_back() {
    let (root, mut proto) = setup();
    assert_committed(&proto.save(draft_request(), DRAFT_NOTE.as_bytes()).unwrap());
    fs::write(
        root.path()
            .join(".repeaty/transactions/confirm-1/intent.json"),
        "broken journal",
    )
    .unwrap();
    assert!(matches!(
        proto.recover().unwrap()[0],
        SaveOutcome::Attention {
            committed: Some(true),
            ..
        }
    ));
    assert_eq!(consumed(root.path()).as_deref(), Some("confirm-1"));
    assert_eq!(count(root.path(), "changes"), 1);
}

#[test]
fn card_constraint_failure_rolls_back_note_draft_and_change_together() {
    let (root, mut proto) = setup();
    let mut request = draft_request();
    request.new_cards[0].id = "original-card-id".into();
    assert!(proto.save(request, DRAFT_NOTE.as_bytes()).is_err());
    assert_eq!(count(root.path(), "notes"), 1);
    assert_eq!(count(root.path(), "cards"), 1);
    assert_eq!(count(root.path(), "changes"), 0);
    assert_eq!(consumed(root.path()), None);
    assert_eq!(
        fs::read(root.path().join("notes/from-draft.md")).unwrap(),
        DRAFT_NOTE.as_bytes()
    );
    assert!(matches!(
        proto.recover().unwrap()[0],
        SaveOutcome::Attention {
            committed: Some(false),
            ..
        }
    ));
}

#[test]
fn unchanged_content_does_not_replace_the_live_file() {
    let (root, mut proto) = setup();
    let mut editor = OpenOptions::new()
        .write(true)
        .truncate(false)
        .open(root.path().join("notes/old.md"))
        .unwrap();
    assert_committed(&proto.save(update_request(), OLD.as_bytes()).unwrap());
    editor.set_len(0).unwrap();
    editor.write_all(b"same inode is still visible").unwrap();
    editor.sync_all().unwrap();
    assert_eq!(
        fs::read(root.path().join("notes/old.md")).unwrap(),
        b"same inode is still visible"
    );
    assert_eq!(accepted(root.path()), files::digest(OLD.as_bytes()));
    assert_eq!(
        fs::read(object(root.path(), OLD.as_bytes())).unwrap(),
        OLD.as_bytes()
    );
}

#[test]
fn conflict_evidence_survives_an_interrupted_database_status_update() {
    let (root, mut proto) = setup();
    fs::write(root.path().join("notes/old.md"), "external").unwrap();
    assert!(matches!(
        proto.save(update_request(), NEW.as_bytes()).unwrap(),
        SaveOutcome::Attention { .. }
    ));
    // Simulate the journal flag having reached disk while the status update was interrupted.
    db(root.path())
        .execute(
            "UPDATE operations SET status='pending' WHERE id='edit-1'",
            [],
        )
        .unwrap();
    fs::write(root.path().join("notes/old.md"), OLD).unwrap();
    assert!(matches!(
        proto.save(update_request(), NEW.as_bytes()).unwrap(),
        SaveOutcome::Attention { .. }
    ));
    assert_eq!(
        fs::read(root.path().join("notes/old.md")).unwrap(),
        OLD.as_bytes()
    );
    assert_eq!(count(root.path(), "changes"), 0);
}

#[test]
fn incompatible_roots_paths_and_duplicate_app_writers_are_rejected() {
    let (root, proto) = setup();
    assert!(Prototype::create_in_empty(root.path()).is_err());
    assert!(Prototype::open(root.path()).is_err());
    drop(proto);
    let mut proto = Prototype::open(root.path()).unwrap();
    for path in [
        "../escape.md",
        "/tmp/outside.md",
        "notes/../escape.md",
        "notes/a/b.md",
        "notes/CON.md",
        "notes/COM1.md",
        "notes/a:stream.md",
        "notes/a\\b.md",
    ] {
        let mut request = update_request();
        request.path = path.into();
        assert!(proto.save(request, NEW.as_bytes()).is_err(), "{path}");
    }
    drop(proto);
    db(root.path())
        .pragma_update(None, "user_version", 2000)
        .unwrap();
    assert!(Prototype::open(root.path()).is_err());
    assert_eq!(
        db(root.path())
            .pragma_query_value(None, "user_version", |row| row.get::<_, i32>(0))
            .unwrap(),
        2000
    );
}

#[cfg(unix)]
#[test]
fn symlink_ancestors_and_hard_linked_working_files_are_refused() {
    let (root, mut proto) = setup();
    let link = root.path().join("notes/alias.md");
    fs::hard_link(root.path().join("notes/old.md"), &link).unwrap();
    assert!(proto.save(update_request(), NEW.as_bytes()).is_err());
    fs::remove_file(link).unwrap();
    fs::rename(
        root.path().join(".repeaty/objects"),
        root.path().join("kept-objects"),
    )
    .unwrap();
    let outside = tempfile::tempdir().unwrap();
    fs::create_dir(outside.path().join("sha256")).unwrap();
    std::os::unix::fs::symlink(outside.path(), root.path().join(".repeaty/objects")).unwrap();
    assert!(proto.save(update_request(), NEW.as_bytes()).is_err());
    assert_eq!(
        fs::read_dir(outside.path().join("sha256")).unwrap().count(),
        0
    );
    assert_eq!(accepted(root.path()), files::digest(OLD.as_bytes()));
}

#[test]
fn sqlite_baseline_change_cannot_consume_a_draft_or_overwrite_learning_state() {
    let (root, mut proto) = setup();
    let result = proto.save_with_checkpoint(update_request(), NEW.as_bytes(), |point| {
        if point == Checkpoint::PublicationRecorded {
            db(root.path()).execute(
                "UPDATE notes SET accepted_hash=?1 WHERE id='note-old'",
                [files::digest(b"newer baseline")],
            )?;
        }
        Ok(())
    });
    assert!(result.is_err());
    assert_eq!(accepted(root.path()), files::digest(b"newer baseline"));
    assert_eq!(count(root.path(), "changes"), 0);
    assert_eq!(consumed(root.path()), None);
}

#[test]
fn child_process_exits_at_every_save_boundary_and_recovery_is_idempotent() {
    for scenario in ["edit", "draft"] {
        for checkpoint in Checkpoint::ALL {
            let (root, proto) = setup();
            drop(proto);
            let child = Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "crash_worker", "--nocapture"])
                .env("REPEATY_M0_FIXTURE_ROOT", root.path())
                .env("REPEATY_M0_SCENARIO", scenario)
                .env("REPEATY_M0_EXIT_AT", format!("{checkpoint:?}"))
                .output()
                .unwrap();
            assert_eq!(
                child.status.code(),
                Some(86),
                "{scenario} {checkpoint:?}: {}",
                String::from_utf8_lossy(&child.stderr)
            );
            if checkpoint == Checkpoint::BeforeDatabaseCommit {
                assert_eq!(count(root.path(), "changes"), 0);
                assert_eq!(consumed(root.path()), None);
                assert_eq!(accepted(root.path()), files::digest(OLD.as_bytes()));
            }
            let mut reopened = Prototype::open(root.path()).unwrap();
            let outcomes = reopened.recover().unwrap();
            let published = matches!(
                checkpoint,
                Checkpoint::FilePublished
                    | Checkpoint::PublicationRecorded
                    | Checkpoint::BeforeDatabaseCommit
                    | Checkpoint::DatabaseCommitted
                    | Checkpoint::CompletionRecorded
            );
            if published {
                assert_committed(&outcomes[0]);
                for _ in 0..2 {
                    assert_committed(&reopened.recover().unwrap()[0]);
                }
                assert_eq!(count(root.path(), "changes"), 1);
                if scenario == "draft" {
                    assert_eq!(count(root.path(), "notes"), 2);
                    assert_eq!(count(root.path(), "cards"), 2);
                    assert_eq!(consumed(root.path()).as_deref(), Some("confirm-1"));
                } else {
                    assert_eq!(accepted(root.path()), files::digest(NEW.as_bytes()));
                    assert_eq!(count(root.path(), "cards"), 1);
                }
            } else {
                assert_eq!(count(root.path(), "changes"), 0);
                assert_eq!(count(root.path(), "cards"), 1);
                assert_eq!(consumed(root.path()), None);
                if checkpoint == Checkpoint::PublishStarted {
                    assert!(matches!(outcomes[0], SaveOutcome::Attention { .. }));
                    // Never swap again after an uncertain publication attempt.
                    let (request, bytes) = if scenario == "draft" {
                        (draft_request(), DRAFT_NOTE)
                    } else {
                        (update_request(), NEW)
                    };
                    assert!(matches!(
                        reopened.save(request, bytes.as_bytes()).unwrap(),
                        SaveOutcome::Attention { .. }
                    ));
                    assert_eq!(count(root.path(), "changes"), 0);
                } else {
                    let (request, bytes) = if scenario == "draft" {
                        (draft_request(), DRAFT_NOTE)
                    } else {
                        (update_request(), NEW)
                    };
                    assert_committed(&reopened.save(request, bytes.as_bytes()).unwrap());
                    assert_eq!(count(root.path(), "changes"), 1);
                }
            }
            assert_eq!(
                fs::read(object(root.path(), OLD.as_bytes())).unwrap(),
                OLD.as_bytes()
            );
            let state: String = db(root.path())
                .query_row(
                    "SELECT state_json FROM cards WHERE id=?1",
                    params!["original-card-id"],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(state, CARD_STATE);
            let integrity: String = db(root.path())
                .query_row("PRAGMA integrity_check", [], |row| row.get(0))
                .unwrap();
            assert_eq!(integrity, "ok");
        }
    }
}

#[test]
fn crash_worker() {
    let Some(root) = std::env::var_os("REPEATY_M0_FIXTURE_ROOT") else {
        return;
    };
    let exit_at = std::env::var("REPEATY_M0_EXIT_AT").unwrap();
    let scenario = std::env::var("REPEATY_M0_SCENARIO").unwrap();
    let mut proto = Prototype::open(Path::new(&root)).unwrap();
    let (request, bytes) = if scenario == "draft" {
        (draft_request(), DRAFT_NOTE)
    } else {
        (update_request(), NEW)
    };
    proto
        .save_with_checkpoint(request, bytes.as_bytes(), |point| {
            if format!("{point:?}") == exit_at {
                std::process::exit(86);
            }
            Ok(())
        })
        .unwrap();
    panic!("requested checkpoint was never reached");
}
