use super::*;

fn object(bytes: &[u8], id: &str) -> Object {
    Object {
        kind: "media".into(),
        id: id.into(),
        mime: "application/octet-stream".into(),
        hash: files::digest(bytes),
        size: bytes.len() as u64,
    }
}
fn write(library: &mut Library, object: &Object, bytes: &[u8], index: usize) -> Result<Value> {
    let start = index * CHUNK;
    let content = &bytes[start..bytes.len().min(start + CHUNK)];
    library.sync_object_request("objects/write",json!({"object":object,"offset":start,"data":STANDARD.encode(content),"chunkHash":files::digest(content)}))
}
fn count(library: &Library) -> i64 {
    library
        .db
        .connection
        .query_row("SELECT count(*) FROM assets", [], |r| r.get(0))
        .unwrap()
}

#[test]
fn chunks_are_out_of_order_idempotent_and_resume_after_reopen_without_partial_references() {
    let directory = tempfile::tempdir().unwrap();
    let mut library = Library::create(directory.path()).unwrap();
    let content = vec![42; CHUNK * 2 + 19];
    let item = object(&content, "asset-a");
    assert_eq!(
        write(&mut library, &item, &content, 2).unwrap()["received"],
        json!([2])
    );
    assert_eq!(
        write(&mut library, &item, &content, 0).unwrap()["received"],
        json!([0, 2])
    );
    assert_eq!(
        write(&mut library, &item, &content, 0).unwrap()["received"],
        json!([0, 2])
    );
    assert_eq!(count(&library), 0);
    assert_eq!(
        library
            .sync_object_request("objects/finish", json!({"object":item}))
            .unwrap_err()
            .0,
        "sync-object-incomplete"
    );
    assert!(
        !directory
            .path()
            .join(".repeaty/media")
            .join(item.target().unwrap())
            .exists()
    );
    drop(library);
    let mut library = Library::open(directory.path()).unwrap();
    assert_eq!(
        library
            .sync_object_request("objects/info", json!({"object":item}))
            .unwrap()["received"],
        json!([0, 2])
    );
    write(&mut library, &item, &content, 1).unwrap();
    assert_eq!(
        library
            .sync_object_request("objects/finish", json!({"object":item}))
            .unwrap()["complete"],
        true
    );
    assert_eq!(count(&library), 1);
    let read = library
        .sync_object_request("objects/read", json!({"object":item,"offset":CHUNK*2}))
        .unwrap();
    assert_eq!(
        STANDARD.decode(read["data"].as_str().unwrap()).unwrap(),
        vec![42; 19]
    );
    let alias = Object {
        id: "asset-b".into(),
        ..item.clone()
    };
    library
        .sync_object_request("objects/finish", json!({"object":alias}))
        .unwrap();
    assert_eq!(count(&library), 2);
    let inventory = library
        .sync_object_request("objects/info", json!({}))
        .unwrap();
    assert_eq!(inventory["objects"].as_array().unwrap().len(), 2);
    assert!(
        !inventory
            .to_string()
            .contains(directory.path().to_str().unwrap())
    );
    let different = object(b"different", "asset-a");
    write(&mut library, &different, b"different", 0).unwrap();
    assert_eq!(
        library
            .sync_object_request("objects/finish", json!({"object":different}))
            .unwrap_err()
            .0,
        "sync-object-conflict"
    );
    assert_eq!(library.db.media("asset-a").unwrap().1, content);
}

#[test]
fn hash_and_injected_disk_full_failures_keep_verified_chunks_and_can_retry() {
    let directory = tempfile::tempdir().unwrap();
    let mut library = Library::create(directory.path()).unwrap();
    let content = vec![7; CHUNK + 29];
    let item = object(&content, "asset");
    let wrong=library.sync_object_request("objects/write",json!({"object":item,"offset":0,"data":STANDARD.encode(&content[..CHUNK]),"chunkHash":files::digest(b"wrong")}));
    assert_eq!(wrong.unwrap_err().0, "sync-hash-mismatch");
    assert_eq!(count(&library), 0);
    write(&mut library, &item, &content, 0).unwrap();
    FAIL_WRITE.with(|f| f.set(true));
    assert_eq!(
        write(&mut library, &item, &content, 1).unwrap_err().0,
        "sync-disk-full"
    );
    assert_eq!(
        library
            .sync_object_request("objects/info", json!({"object":item}))
            .unwrap()["received"],
        json!([0])
    );
    write(&mut library, &item, &content, 1).unwrap();
    FAIL_WRITE.with(|f| f.set(true));
    assert_eq!(
        library
            .sync_object_request("objects/finish", json!({"object":item}))
            .unwrap_err()
            .0,
        "sync-disk-full"
    );
    assert_eq!(count(&library), 0);
    assert_eq!(
        library
            .sync_object_request("objects/info", json!({"object":item}))
            .unwrap()["received"],
        json!([0, 1])
    );
    library
        .sync_object_request("objects/finish", json!({"object":item}))
        .unwrap();
    assert_eq!(library.db.media("asset").unwrap().1, content);
}

#[test]
fn document_objects_transfer_separately_and_empty_documents_are_valid() {
    let directory = tempfile::tempdir().unwrap();
    let mut library = Library::create(directory.path()).unwrap();
    let content = "# 原文\n\n保留正文".as_bytes();
    let hash = files::digest(content);
    let item = Object {
        kind: "document".into(),
        id: hash.clone(),
        mime: "text/markdown".into(),
        hash: hash.clone(),
        size: content.len() as u64,
    };
    write(&mut library, &item, content, 0).unwrap();
    library
        .sync_object_request("objects/finish", json!({"object":item}))
        .unwrap();
    assert_eq!(count(&library), 0);
    assert_eq!(
        std::fs::read(directory.path().join(".repeaty/objects").join(hash)).unwrap(),
        content
    );
    assert_eq!(
        library
            .sync_object_request("objects/info", json!({}))
            .unwrap()["objects"][0]["hash"],
        item.hash
    );
    drop(library);
    let mut library = Library::open(directory.path()).unwrap();
    assert_eq!(
        library
            .sync_object_request("objects/info", json!({}))
            .unwrap()["objects"][0]["hash"],
        item.hash
    );
    library
        .db
        .connection
        .execute(
            "INSERT INTO retired_documents VALUES('retired','notes/retired.md',?1)",
            [&item.hash],
        )
        .unwrap();
    assert_eq!(
        library
            .sync_object_request("objects/info", json!({}))
            .unwrap()["objects"][0]["kind"],
        "document"
    );
    let hash = files::digest(b"");
    let empty = Object {
        kind: "document".into(),
        id: hash.clone(),
        mime: "text/markdown".into(),
        hash,
        size: 0,
    };
    library
        .sync_object_request("objects/finish", json!({"object":empty}))
        .unwrap();
    assert_eq!(
        library
            .sync_object_request("objects/info", json!({"object":empty}))
            .unwrap()["complete"],
        true
    );
}

#[test]
fn bad_metadata_hash_paths_corrupt_complete_objects_and_hard_links_are_rejected() {
    let directory = tempfile::tempdir().unwrap();
    let mut library = Library::create(directory.path()).unwrap();
    let item = object(b"payload", "asset");
    let mut unsafe_item = item.clone();
    unsafe_item.hash = "../../outside".into();
    assert_eq!(
        library
            .sync_object_request("objects/info", json!({"object":unsafe_item}))
            .unwrap_err()
            .0,
        "sync-invalid-object"
    );
    write(&mut library, &item, b"payload", 0).unwrap();
    library
        .sync_object_request("objects/finish", json!({"object":item}))
        .unwrap();
    let target = directory
        .path()
        .join(".repeaty/media")
        .join(item.target().unwrap());
    std::fs::write(&target, b"corrupt").unwrap();
    assert_eq!(
        library
            .sync_object_request("objects/info", json!({"object":item}))
            .unwrap_err()
            .0,
        "sync-hash-mismatch"
    );
    std::fs::write(&target, b"payload").unwrap();
    std::fs::hard_link(&target, directory.path().join("duplicate")).unwrap();
    assert_eq!(
        library
            .sync_object_request("objects/info", json!({"object":item}))
            .unwrap_err()
            .0,
        "sync-unsafe-object"
    );
}

#[test]
fn public_assets_are_created_only_on_confirmed_sync_save_and_never_overwrite_external_bytes() {
    let directory = tempfile::tempdir().unwrap();
    let mut library = Library::create(directory.path()).unwrap();
    library.sync_bind_device("test-device").unwrap();
    let group = uuid::Uuid::new_v4().to_string();
    library
        .sync_request("start", json!({"groupId":group}))
        .unwrap();
    let content = b"confirmed payload";
    let object = object(content, "media");
    write(&mut library, &object, content, 0).unwrap();
    library
        .sync_object_request("objects/finish", json!({"object":object}))
        .unwrap();
    let working = directory
        .path()
        .join("assets")
        .join(object.target().unwrap());
    assert!(!working.exists());
    let metadata = json!({"id":"media","name":"synced file","type":object.mime,"size":content.len(),"createdAt":"2026-10-30T00:00:00.000Z"});
    library.sync_request("journal/receive",json!({"events":[{"protocol":1,"groupId":group,"deviceId":"remote","sequence":1,"id":"remote:1","clock":{"remote":0},"changes":[{"store":"media","id":"media","before":null,"after":metadata,"position":0}]}]})).unwrap();
    assert!(!working.exists());
    let request:crate::library::Save=serde_json::from_value(json!({"operationId":uuid::Uuid::new_v4().to_string(),"expectedRevision":0,"patches":[{"store":"media","id":"media","value":metadata,"position":0}],"documents":[],"reason":null,"sync":{"expectedClock":{},"clock":{"remote":1},"appliedIds":["remote:1"],"values":{},"resolutions":[],"retiredMedia":{}},"consumeCardDraft":null})).unwrap();
    library.save(request.clone()).unwrap();
    assert_eq!(std::fs::read(&working).unwrap(), content);
    std::fs::write(&working, b"external edit").unwrap();
    library.save(request.clone()).unwrap();
    assert_eq!(std::fs::read(&working).unwrap(), b"external edit");
    let mut next = request;
    next.operation_id = uuid::Uuid::new_v4().to_string();
    next.expected_revision = 1;
    assert_eq!(library.save(next).unwrap_err().0, "working-file-changed");
    assert_eq!(std::fs::read(&working).unwrap(), b"external edit");
}

#[cfg(unix)]
#[test]
fn staged_directory_and_file_symlinks_are_rejected() {
    use std::os::unix::fs::symlink;
    let directory = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let mut library = Library::create(directory.path()).unwrap();
    let item = object(b"payload", "asset");
    symlink(
        outside.path(),
        directory.path().join(".repeaty/staging").join(item.stage()),
    )
    .unwrap();
    assert!(write(&mut library, &item, b"payload", 0).is_err());
    assert!(std::fs::read_dir(outside.path()).unwrap().next().is_none());
}
