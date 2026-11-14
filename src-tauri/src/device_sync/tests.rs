use super::*;
use tokio::io::AsyncWriteExt;

async fn service(directory: &Path) -> Arc<SyncService> {
    let service = SyncService::new(
        directory,
        Arc::new(|scope, method, payload| {
            Ok(json!({"group":scope.group_id,"method":method,"payload":payload}))
        }),
    )
    .unwrap();
    service
        .activate(Scope {
            token: id(),
            group_id: "test-group".into(),
        })
        .unwrap();
    service.listen("127.0.0.1:0").await.unwrap();
    service
}
async fn pending(service: &SyncService) -> String {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Some(id) = service.status().unwrap()["pending"][0]["id"].as_str() {
                return id.to_owned();
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("pending pairing")
}
async fn pair(a: &Arc<SyncService>, b: &Arc<SyncService>) -> Invitation {
    let invitation = a.invite().unwrap();
    let client = b.clone();
    let copy = invitation.clone();
    let joining = tokio::spawn(async move { client.join(copy).await });
    let request = pending(a).await;
    assert!(a.status().unwrap()["peers"].as_array().unwrap().is_empty());
    a.approve(&request, true).unwrap();
    joining.await.unwrap().unwrap();
    invitation
}

#[tokio::test]
async fn real_tls_pairing_is_manual_scoped_mutual_and_persistent() {
    let da = tempfile::tempdir().unwrap();
    let db = tempfile::tempdir().unwrap();
    let a = service(da.path()).await;
    let b = service(db.path()).await;
    assert_ne!(a.identity.id, b.identity.id);
    let old_id = a.identity.id.clone();
    let invitation = pair(&a, &b).await;
    let result = b
        .peer_request(&a.identity.id, "journal/status", json!({"round":7}))
        .await
        .unwrap();
    assert_eq!(result["payload"]["round"], 7);
    let result = a
        .peer_request(&b.identity.id, "objects/info", json!({"hash":"test"}))
        .await
        .unwrap();
    assert_eq!(result["method"], "objects/info");
    assert_eq!(
        b.join(invitation).await.unwrap_err(),
        "sync-pairing-expired"
    );
    assert_eq!(
        b.peer_request(&a.identity.id, "filesystem/read", Value::Null)
            .await
            .unwrap_err(),
        "sync-method-denied"
    );
    let diagnostic = a.diagnostics().unwrap().to_string();
    for private in [
        &a.identity.id,
        &a.identity.name,
        &URL_SAFE_NO_PAD.encode(&a.identity.cert),
        "127.0.0.1",
    ] {
        assert!(!diagnostic.contains(private));
    }
    a.stop().unwrap();
    b.stop().unwrap();
    drop(a);
    drop(b);
    let reopened = SyncService::new(da.path(), Arc::new(|_, _, _| Ok(Value::Null))).unwrap();
    assert_eq!(reopened.identity.id, old_id);
    assert_eq!(reopened.status().unwrap()["enabled"], false);
    reopened
        .activate(Scope {
            token: id(),
            group_id: "test-group".into(),
        })
        .unwrap();
    assert_eq!(
        reopened.status().unwrap()["peers"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    reopened
        .activate(Scope {
            token: id(),
            group_id: "other-group".into(),
        })
        .unwrap();
    assert!(
        reopened.status().unwrap()["peers"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn real_tls_rejection_expiry_wrong_pin_and_anonymous_calls_fail() {
    let da = tempfile::tempdir().unwrap();
    let db = tempfile::tempdir().unwrap();
    let dc = tempfile::tempdir().unwrap();
    let a = service(da.path()).await;
    let b = service(db.path()).await;
    let c = service(dc.path()).await;
    let invitation = a.invite().unwrap();
    let client = b.clone();
    let join = tokio::spawn(async move { client.join(invitation).await });
    a.approve(&pending(&a).await, false).unwrap();
    assert_eq!(join.await.unwrap().unwrap_err(), "sync-pairing-rejected");
    assert!(b.status().unwrap()["peers"].as_array().unwrap().is_empty());
    let mut expired = a.invite().unwrap();
    expired.expires_at = now() - 1;
    assert_eq!(
        b.join(expired).await.unwrap_err(),
        "sync-invalid-invitation"
    );
    let mut wrong = a.invite().unwrap();
    wrong.device_id = c.identity.id.clone();
    wrong.certificate = URL_SAFE_NO_PAD.encode(&c.identity.cert);
    assert_eq!(
        b.join(wrong).await.unwrap_err(),
        "sync-authentication-failed"
    );
    let peer = Peer {
        id: a.identity.id.clone(),
        name: a.identity.name.clone(),
        address: a.status().unwrap()["listenAddress"]
            .as_str()
            .unwrap()
            .into(),
        cert: a.identity.cert.clone(),
    };
    let mut stream = transport::connect(&b.identity, &peer, false).await.unwrap();
    transport::write(
        &mut stream,
        &Request::Hello {
            version: 1,
            group_id: "test-group".into(),
        },
        SMALL_FRAME,
    )
    .await
    .unwrap();
    assert!(
        matches!(transport::read::<_,Reply>(&mut stream,SMALL_FRAME).await.unwrap(),Reply::Error{code} if code=="sync-authentication-failed")
    );
    a.stop().unwrap();
    b.stop().unwrap();
    c.stop().unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn real_tls_revocation_pause_switch_and_cancel_stop_requests() {
    let da = tempfile::tempdir().unwrap();
    let db = tempfile::tempdir().unwrap();
    let entered = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let signal = entered.clone();
    let a = SyncService::new(
        da.path(),
        Arc::new(move |_, _, _| {
            signal.store(true, std::sync::atomic::Ordering::Release);
            std::thread::sleep(Duration::from_millis(300));
            Ok(json!("late"))
        }),
    )
    .unwrap();
    a.activate(Scope {
        token: id(),
        group_id: "test-group".into(),
    })
    .unwrap();
    a.listen("127.0.0.1:0").await.unwrap();
    let b = service(db.path()).await;
    pair(&a, &b).await;
    let client = b.clone();
    let peer = a.identity.id.clone();
    let call = tokio::spawn(async move {
        client
            .peer_request(&peer, "journal/status", Value::Null)
            .await
    });
    tokio::time::timeout(Duration::from_secs(5), async {
        while !entered.load(std::sync::atomic::Ordering::Acquire) {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    a.revoke(&b.identity.id).unwrap();
    assert!(call.await.unwrap().is_err());
    assert!(
        b.peer_request(&a.identity.id, "journal/status", Value::Null)
            .await
            .is_err()
    );
    pair(&a, &b).await;
    a.pause(true).unwrap();
    assert!(
        b.peer_request(&a.identity.id, "journal/status", Value::Null)
            .await
            .is_err()
    );
    a.pause(false).unwrap();
    let client = b.clone();
    let peer = a.identity.id.clone();
    let call = tokio::spawn(async move {
        client
            .peer_request(&peer, "journal/status", Value::Null)
            .await
    });
    tokio::time::sleep(Duration::from_millis(20)).await;
    b.cancel().unwrap();
    assert_eq!(call.await.unwrap().unwrap_err(), "sync-cancelled");
    let invitation = a.invite().unwrap();
    a.activate(Scope {
        token: id(),
        group_id: "different-group".into(),
    })
    .unwrap();
    assert_eq!(a.status().unwrap()["enabled"], false);
    assert!(b.join(invitation).await.is_err());
    b.stop().unwrap();
}

#[tokio::test]
async fn real_tls_message_budget_and_protocol_version_are_enforced() {
    let da = tempfile::tempdir().unwrap();
    let db = tempfile::tempdir().unwrap();
    let a = service(da.path()).await;
    let b = service(db.path()).await;
    pair(&a, &b).await;
    let context = b.context().unwrap();
    let peer = b.peer(&context, &a.identity.id).unwrap();
    let mut stream = transport::connect(&b.identity, &peer, true).await.unwrap();
    transport::write(
        &mut stream,
        &Request::Hello {
            version: 1,
            group_id: "test-group".into(),
        },
        SMALL_FRAME,
    )
    .await
    .unwrap();
    let _: Reply = transport::read(&mut stream, SMALL_FRAME).await.unwrap();
    stream.write_u32(MAX_FRAME as u32 + 1).await.unwrap();
    stream.flush().await.unwrap();
    assert!(
        matches!(transport::read::<_,Reply>(&mut stream,SMALL_FRAME).await.unwrap(),Reply::Error{code} if code=="sync-message-limit")
    );
    let mut stream = transport::connect(&b.identity, &peer, true).await.unwrap();
    transport::write(
        &mut stream,
        &Request::Hello {
            version: 99,
            group_id: "test-group".into(),
        },
        SMALL_FRAME,
    )
    .await
    .unwrap();
    assert!(
        matches!(transport::read::<_,Reply>(&mut stream,SMALL_FRAME).await.unwrap(),Reply::Error{code} if code=="sync-incompatible")
    );
    a.stop().unwrap();
    b.stop().unwrap();
}

#[test]
fn bind_addresses_never_select_public_or_unspecified_interfaces() {
    for address in [
        "0.0.0.0:123",
        "[::]:123",
        "8.8.8.8:123",
        "example.org:123",
        "[::ffff:8.8.8.8]:123",
    ] {
        assert!(transport::address(address).is_err());
    }
    for address in [
        "127.0.0.1:0",
        "192.168.1.10:123",
        "10.0.0.2:123",
        "[::1]:123",
        "[fd00::1]:123",
    ] {
        assert!(transport::address(address).is_ok());
    }
}

#[tokio::test]
async fn real_tls_pending_disconnect_and_expired_ticket_cannot_be_approved() {
    let da = tempfile::tempdir().unwrap();
    let db = tempfile::tempdir().unwrap();
    let a = service(da.path()).await;
    let b = service(db.path()).await;
    let invitation = a.invite().unwrap();
    let client = b.clone();
    let join = tokio::spawn(async move { client.join(invitation).await });
    let pending_id = pending(&a).await;
    b.cancel().unwrap();
    assert_eq!(join.await.unwrap().unwrap_err(), "sync-cancelled");
    tokio::time::timeout(Duration::from_secs(5), async {
        while !a.status().unwrap()["pending"]
            .as_array()
            .unwrap()
            .is_empty()
        {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(
        a.approve(&pending_id, true).unwrap_err(),
        "sync-pairing-expired"
    );
    assert!(a.status().unwrap()["peers"].as_array().unwrap().is_empty());
    let invitation = a.invite().unwrap();
    a.lock()
        .unwrap()
        .invitations
        .insert(digest(invitation.ticket.as_bytes()), now() - 1);
    assert_eq!(
        b.join(invitation).await.unwrap_err(),
        "sync-pairing-expired"
    );
    a.stop().unwrap();
    b.stop().unwrap();
}

#[cfg(windows)]
#[test]
fn windows_identity_directory_and_database_have_protected_current_user_acl() {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::{
            Authorization::{GetSecurityInfo, SE_FILE_OBJECT},
            DACL_SECURITY_INFORMATION, GetSecurityDescriptorControl, SE_DACL_PROTECTED,
        },
    };
    let temp = tempfile::tempdir().unwrap();
    let service = SyncService::new(temp.path(), Arc::new(|_, _, _| Ok(Value::Null))).unwrap();
    let mut options = std::fs::OpenOptions::new();
    use std::os::windows::fs::OpenOptionsExt;
    options.read(true).custom_flags(0x02000000);
    for path in [
        temp.path().join("device-sync"),
        temp.path().join("device-sync/device-sync.sqlite3"),
    ] {
        let file = options.open(path).unwrap();
        let mut descriptor = std::ptr::null_mut();
        // SAFETY: file is live and descriptor points to a valid output pointer.
        assert_eq!(
            unsafe {
                GetSecurityInfo(
                    file.as_raw_handle(),
                    SE_FILE_OBJECT,
                    DACL_SECURITY_INFORMATION,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    &mut descriptor,
                )
            },
            0
        );
        let mut control = 0;
        let mut revision = 0;
        // SAFETY: GetSecurityInfo returned a security descriptor which remains allocated.
        assert_ne!(
            unsafe { GetSecurityDescriptorControl(descriptor, &mut control, &mut revision) },
            0
        );
        assert_ne!(control & SE_DACL_PROTECTED, 0);
        // SAFETY: ownership of this LocalAlloc allocation was returned by GetSecurityInfo.
        unsafe {
            LocalFree(descriptor);
        }
    }
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn real_tls_transfers_resumable_objects_between_two_real_workspaces() {
    use base64::engine::general_purpose::STANDARD;
    use repeaty_workspace::library::Library;
    let app_a = tempfile::tempdir().unwrap();
    let app_b = tempfile::tempdir().unwrap();
    let dir_a = tempfile::tempdir().unwrap();
    let dir_b = tempfile::tempdir().unwrap();
    let library_a = Arc::new(Mutex::new(Library::create(dir_a.path()).unwrap()));
    let library_b = Arc::new(Mutex::new(Library::create(dir_b.path()).unwrap()));
    let content = vec![91; 262144 + 53];
    library_a.lock().unwrap().write(json!({"type":"media","id":"shared-media","mime":"application/octet-stream","body":STANDARD.encode(&content)})).unwrap();
    let factory = |path: &Path, library: Arc<Mutex<Library>>| {
        let token = library.lock().unwrap().token.clone();
        let service = SyncService::new(
            path,
            Arc::new(move |scope, method, payload| {
                let mut library = library.lock().map_err(|_| "sync-storage-error")?;
                library
                    .guard(&scope.token)
                    .map_err(|_| "sync-workspace-changed")?;
                library
                    .sync_object_request(method, payload)
                    .map_err(|error| error.0.to_owned())
            }),
        )
        .unwrap();
        service
            .activate(Scope {
                token,
                group_id: "test-group".into(),
            })
            .unwrap();
        service
    };
    let a = factory(app_a.path(), library_a.clone());
    let b = factory(app_b.path(), library_b.clone());
    a.listen("127.0.0.1:0").await.unwrap();
    b.listen("127.0.0.1:0").await.unwrap();
    pair(&a, &b).await;
    let inventory = b
        .peer_request(&a.identity.id, "objects/info", json!({}))
        .await
        .unwrap();
    let object = inventory["objects"][0].clone();
    let chunk = b
        .peer_request(
            &a.identity.id,
            "objects/read",
            json!({"object":object,"offset":262144}),
        )
        .await
        .unwrap();
    a.peer_request(&b.identity.id,"objects/write",json!({"object":object,"offset":chunk["offset"],"data":chunk["data"],"chunkHash":chunk["chunkHash"]})).await.unwrap();
    b.cancel().unwrap();
    let progress = a
        .peer_request(&b.identity.id, "objects/info", json!({"object":object}))
        .await
        .unwrap();
    assert_eq!(progress["received"], json!([1]));
    let chunk = b
        .peer_request(
            &a.identity.id,
            "objects/read",
            json!({"object":object,"offset":0}),
        )
        .await
        .unwrap();
    a.peer_request(
        &b.identity.id,
        "objects/write",
        json!({"object":object,"offset":0,"data":chunk["data"],"chunkHash":chunk["chunkHash"]}),
    )
    .await
    .unwrap();
    a.peer_request(&b.identity.id, "objects/finish", json!({"object":object}))
        .await
        .unwrap();
    assert_eq!(
        std::fs::read(
            dir_b
                .path()
                .join(".repeaty/media")
                .join(format!("{}.bin", object["hash"].as_str().unwrap()))
        )
        .unwrap(),
        content
    );
    assert_eq!(
        a.peer_request(&b.identity.id, "objects/info", json!({}))
            .await
            .unwrap()["objects"][0]["id"],
        "shared-media"
    );
    a.stop().unwrap();
    b.stop().unwrap();
}

#[tokio::test]
async fn stale_async_commands_cannot_claim_a_new_scope_after_workspace_switch() {
    let da = tempfile::tempdir().unwrap();
    let db = tempfile::tempdir().unwrap();
    let a = service(da.path()).await;
    let b = service(db.path()).await;
    let old = a.context().unwrap().scope;
    let invitation = b.invite().unwrap();
    let gate = Arc::new(tokio::sync::Barrier::new(2));
    let waiting = gate.clone();
    let service = a.clone();
    let task = tokio::spawn(async move {
        waiting.wait().await;
        assert_eq!(
            service
                .listen_for(old.clone(), "127.0.0.1:0")
                .await
                .unwrap_err(),
            "sync-workspace-changed"
        );
        assert_eq!(
            service.join_for(old.clone(), invitation).await.unwrap_err(),
            "sync-workspace-changed"
        );
        assert_eq!(
            service
                .peer_request_for(old, "unused", "journal/status", Value::Null)
                .await
                .unwrap_err(),
            "sync-workspace-changed"
        );
    });
    a.activate(Scope {
        token: id(),
        group_id: "next-group".into(),
    })
    .unwrap();
    a.listen("127.0.0.1:0").await.unwrap();
    let expected = a.status().unwrap();
    gate.wait().await;
    task.await.unwrap();
    assert_eq!(a.status().unwrap(), expected);
    a.stop().unwrap();
    b.stop().unwrap();
}
