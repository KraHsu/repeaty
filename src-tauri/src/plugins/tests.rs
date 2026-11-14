use super::*;

fn fixture() -> (tempfile::TempDir, tempfile::TempDir, Plugins, Dir) {
    let workspace = tempfile::tempdir().unwrap();
    drop(repeaty_workspace::library::Library::create(workspace.path()).unwrap());
    let device = tempfile::tempdir().unwrap();
    let host = Plugins::new(device.path()).unwrap();
    let root = Dir::open_ambient_dir(workspace.path(), cap_std::ambient_authority()).unwrap();
    (workspace, device, host, root)
}
fn bundle(id: &str) -> Value {
    json!({"manifest":{"id":id,"name":"Sample","version":"1.0.0","apiVersion":1,"dataVersion":1,"kind":"local","permissions":{"origins":["https://example.org"],"files":true,"secrets":true}},"main":"export default {};"})
}
fn call(host: &Plugins, root: &Dir, id: &str, op: &str, value: Value) -> Result<Value> {
    host.operation(root.try_clone().unwrap(), id, op, value, None)
}
fn install_trusted(host: &Plugins, root: &Dir, id: &str) {
    call(host, root, id, "install", bundle(id)).unwrap();
    let hash = package(root, id).unwrap().hash();
    call(host, root, id, "trust", json!({"hash":hash})).unwrap();
}
#[test]
fn models_permission_is_explicit_and_requires_trust_in_the_current_package() {
    let (_workspace, _device, host, root) = fixture();
    install_trusted(&host, &root, "sample");
    assert_eq!(
        host.models_authorized(&root, "sample").unwrap_err(),
        "permission-denied"
    );
    let mut enabled = bundle("sample");
    enabled["manifest"]["permissions"]["models"] = json!(true);
    call(&host, &root, "sample", "install", enabled).unwrap();
    assert_eq!(
        host.models_authorized(&root, "sample").unwrap_err(),
        "plugin-not-trusted"
    );
    let hash = package(&root, "sample").unwrap().hash();
    call(&host, &root, "sample", "trust", json!({"hash":hash})).unwrap();
    host.models_authorized(&root, "sample").unwrap();
    assert!(host.models_authorized(&root, "../escape").is_err());
}
#[test]
fn install_update_remove_are_independent_of_plugin_data_and_require_exact_device_trust() {
    let (workspace, _device, host, root) = fixture();
    assert_eq!(
        call(&host, &root, "", "list", Value::Null).unwrap(),
        json!([])
    );
    call(&host, &root, "sample", "install", bundle("sample")).unwrap();
    assert_eq!(
        call(
            &host,
            &root,
            "sample",
            "files",
            json!({"action":"write","path":"draft.json","body":"kept"})
        )
        .unwrap_err(),
        "plugin-not-trusted"
    );
    let hash = package(&root, "sample").unwrap().hash();
    assert_eq!(
        call(
            &host,
            &root,
            "sample",
            "trust",
            json!({"hash":"0".repeat(64)})
        )
        .unwrap_err(),
        "plugin-file-changed"
    );
    call(&host, &root, "sample", "trust", json!({"hash":hash})).unwrap();
    call(
        &host,
        &root,
        "sample",
        "files",
        json!({"action":"write","path":"nested/draft.json","body":"kept"}),
    )
    .unwrap();
    call(
        &host,
        &root,
        "sample",
        "files",
        json!({"action":"write","path":"nested/draft.json","body":"updated"}),
    )
    .unwrap();
    let mut next = bundle("sample");
    next["main"] = json!("export default {new:true}");
    next["styles"] = json!(".sample {color:red}");
    call(&host, &root, "sample", "install", next.clone()).unwrap();
    assert_eq!(
        call(&host, &root, "sample", "read", Value::Null).unwrap(),
        next
    );
    assert_eq!(
        call(
            &host,
            &root,
            "sample",
            "files",
            json!({"action":"read","path":"nested/draft.json"})
        )
        .unwrap_err(),
        "plugin-not-trusted"
    );
    let hash = package(&root, "sample").unwrap().hash();
    call(&host, &root, "sample", "trust", json!({"hash":hash})).unwrap();
    assert_eq!(
        call(
            &host,
            &root,
            "sample",
            "files",
            json!({"action":"read","path":"nested/draft.json"})
        )
        .unwrap(),
        "updated"
    );
    call(&host, &root, "sample", "remove", Value::Null).unwrap();
    assert!(call(&host, &root, "sample", "read", Value::Null).is_err());
    assert_eq!(
        std::fs::read_to_string(
            workspace
                .path()
                .join(".repeaty/plugin-data/sample/nested/draft.json")
        )
        .unwrap(),
        "updated"
    );
}
#[test]
fn invalid_or_oversized_replacements_leave_current_package_intact_and_bad_packages_do_not_hide_good_ones()
 {
    let (workspace, _device, host, root) = fixture();
    install_trusted(&host, &root, "good");
    let mut next = bundle("good");
    next["main"] = json!("x".repeat(CODE_LIMIT + 1));
    assert!(call(&host, &root, "good", "install", next).is_err());
    assert_eq!(
        call(&host, &root, "good", "read", Value::Null).unwrap(),
        bundle("good")
    );
    for id in ["../escape", "", "Upper", "a/b"] {
        assert!(call(&host, &root, id, "install", bundle(id)).is_err());
    }
    std::fs::create_dir(workspace.path().join(".repeaty/plugins/broken")).unwrap();
    std::fs::write(
        workspace
            .path()
            .join(".repeaty/plugins/broken/manifest.json"),
        "not JSON",
    )
    .unwrap();
    let listed = call(&host, &root, "", "list", Value::Null).unwrap();
    assert_eq!(listed.as_array().unwrap().len(), 2);
    assert_eq!(listed[0]["id"], "broken");
    assert!(listed[0]["error"].is_string());
    assert_eq!(listed[1]["manifest"]["id"], "good");
    call(&host, &root, "broken", "remove", Value::Null).unwrap();
}
#[test]
fn damaged_non_utf8_and_oversized_packages_can_be_removed_or_reinstalled() {
    for oversized in [false, true] {
        for reinstall in [false, true] {
            let (workspace, _device, host, root) = fixture();
            install_trusted(&host, &root, "sample");
            call(
                &host,
                &root,
                "sample",
                "files",
                json!({"action":"write","path":"draft","body":"kept"}),
            )
            .unwrap();
            let main = workspace.path().join(".repeaty/plugins/sample/main.js");
            if oversized {
                // A sparse ordinary file exercises metadata validation without reading its body.
                File::create(main)
                    .unwrap()
                    .set_len(CODE_LIMIT as u64 + 1)
                    .unwrap();
            } else {
                std::fs::write(main, [0xff, 0xfe]).unwrap();
            }
            let error = call(&host, &root, "sample", "read", Value::Null).unwrap_err();
            assert_eq!(
                error,
                if oversized {
                    "plugin-limit"
                } else {
                    "invalid-plugin"
                }
            );
            if reinstall {
                let mut next = bundle("sample");
                next["main"] = json!("export default { repaired: true };");
                call(&host, &root, "sample", "install", next.clone()).unwrap();
                assert_eq!(
                    call(&host, &root, "sample", "read", Value::Null).unwrap(),
                    next
                );
            } else {
                call(&host, &root, "sample", "remove", Value::Null).unwrap();
                assert!(!workspace.path().join(".repeaty/plugins/sample").exists());
            }
            assert_eq!(
                std::fs::read_to_string(workspace.path().join(".repeaty/plugin-data/sample/draft"))
                    .unwrap(),
                "kept"
            );
        }
    }
}
#[test]
fn data_paths_cannot_escape_the_plugin_or_follow_a_changed_package() {
    let (workspace, _device, host, root) = fixture();
    install_trusted(&host, &root, "sample");
    for path in [
        "../outside",
        "/outside",
        "C:/outside",
        "a/../../outside",
        "a\\outside",
    ] {
        assert!(
            call(
                &host,
                &root,
                "sample",
                "files",
                json!({"action":"write","path":path,"body":"bad"})
            )
            .is_err()
        );
    }
    assert_eq!(
        call(
            &host,
            &root,
            "sample",
            "files",
            json!({"action":"read","path":"missing"})
        )
        .unwrap(),
        Value::Null
    );
    std::fs::write(
        workspace.path().join(".repeaty/plugins/sample/main.js"),
        "changed",
    )
    .unwrap();
    assert_eq!(
        call(
            &host,
            &root,
            "sample",
            "files",
            json!({"action":"write","path":"draft","body":"bad"})
        )
        .unwrap_err(),
        "plugin-not-trusted"
    );
    assert!(
        !workspace
            .path()
            .join(".repeaty/plugin-data/sample/draft")
            .exists()
    );
}
#[test]
fn plugin_permissions_and_secrets_are_scoped_and_revisions_survive_clear_and_restart() {
    let (_workspace, device, host, root) = fixture();
    install_trusted(&host, &root, "one");
    install_trusted(&host, &root, "two");
    let set = json!({"action":"set","slot":"example","origin":"https://example.org","values":{"session":"private","csrf":"token"}});
    let state = call(&host, &root, "one", "secrets", set.clone()).unwrap();
    assert_eq!(state["slots"][0]["revision"], 1);
    assert!(!state.to_string().contains("private"));
    assert_eq!(
        call(&host, &root, "two", "secrets", json!({"action":"state"})).unwrap(),
        json!({"slots":[]})
    );
    call(
        &host,
        &root,
        "one",
        "secrets",
        json!({"action":"clear","slot":"example"}),
    )
    .unwrap();
    assert_eq!(
        call(&host, &root, "one", "secrets", json!({"action":"state"})).unwrap(),
        json!({"slots":[]})
    );
    assert_eq!(
        call(&host, &root, "one", "secrets", set).unwrap()["slots"][0]["revision"],
        3
    );
    drop(host);
    let host = Plugins::new(device.path()).unwrap();
    assert_eq!(
        call(&host, &root, "one", "secrets", json!({"action":"state"})).unwrap()["slots"][0]["revision"],
        3
    );
    let mut denied = bundle("denied");
    denied["manifest"]["permissions"] = json!({});
    call(&host, &root, "denied", "install", denied).unwrap();
    let hash = package(&root, "denied").unwrap().hash();
    call(&host, &root, "denied", "trust", json!({"hash":hash})).unwrap();
    assert_eq!(
        call(
            &host,
            &root,
            "denied",
            "files",
            json!({"action":"read","path":"missing"})
        )
        .unwrap_err(),
        "permission-denied"
    );
    assert_eq!(
        call(&host, &root, "denied", "secrets", json!({"action":"state"})).unwrap_err(),
        "permission-denied"
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(device.path().join("plugin-secrets.sqlite3"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
}
#[test]
fn canonical_package_hash_matches_sorted_json_and_normalizes_absent_styles() {
    let package = Package::parse(bundle("sample"), "sample").unwrap();
    assert_eq!(
        canonical(&json!({"z":[{"b":2,"a":1}],"a":"文"})),
        "{\"a\":\"文\",\"z\":[{\"a\":1,\"b\":2}]}"
    );
    let mut explicit = package.raw.clone();
    explicit["styles"] = json!("");
    assert_eq!(
        Package::parse(explicit, "sample").unwrap().hash(),
        package.hash()
    );
}

#[test]
fn offline_assets_roundtrip_and_every_asset_byte_is_covered_by_device_trust() {
    let (workspace, _device, host, root) = fixture();
    let mut original = bundle("sample");
    original["assets"] = json!({"worker.mjs":{"type":"text/javascript","base64":"Ly8geAo="},"fonts/demo.bin":{"type":"application/octet-stream","base64":"AAEC/w=="}});
    call(&host, &root, "sample", "install", original.clone()).unwrap();
    let hash = package(&root, "sample").unwrap().hash();
    call(&host, &root, "sample", "trust", json!({"hash":hash})).unwrap();
    assert_eq!(
        call(&host, &root, "sample", "read", Value::Null).unwrap(),
        original
    );
    let mut changed = original.clone();
    changed["assets"]["worker.mjs"]["base64"] = json!("Ly8geQo=");
    std::fs::write(
        workspace.path().join(".repeaty/plugins/sample/assets.json"),
        changed["assets"].to_string(),
    )
    .unwrap();
    assert_ne!(package(&root, "sample").unwrap().hash(), hash);
    assert_eq!(
        call(&host, &root, "sample", "trust", json!({"hash":hash})).unwrap_err(),
        "plugin-file-changed"
    );
    call(&host, &root, "sample", "install", bundle("sample")).unwrap();
    assert!(
        !workspace
            .path()
            .join(".repeaty/plugins/sample/assets.json")
            .exists()
    );
}

#[test]
fn offline_asset_validation_matches_frontend_paths_base64_mime_and_byte_limits() {
    for path in [
        "",
        "../worker.mjs",
        "/worker.mjs",
        "font\\data",
        "con",
        "x/NUL.txt",
        "font/..",
        "font/name.",
        "a//b",
    ] {
        assert!(
            validate_assets(&json!({path:{"type":"application/octet-stream","base64":"AA=="}}))
                .is_err(),
            "{path}"
        );
    }
    for encoded in ["A", "AA=", "AB==", "AA?=", "AAA===", " AA=="] {
        assert!(
            validate_assets(
                &json!({"data.bin":{"type":"application/octet-stream","base64":encoded}})
            )
            .is_err(),
            "{encoded}"
        );
    }
    for mime in [
        "",
        "text/javascript; charset=utf-8",
        "a/b/c",
        "application/",
    ] {
        assert!(validate_assets(&json!({"data.bin":{"type":mime,"base64":"AA=="}})).is_err());
    }
    assert!(
        validate_assets(
            &json!({"data.bin":{"type":"application/octet-stream","base64":"AA==","extra":true}})
        )
        .is_err()
    );
    let large = STANDARD.encode(vec![0; 8 * 1024 * 1024]);
    assert!(
        validate_assets(&json!({"data.bin":{"type":"application/octet-stream","base64":large}}))
            .is_ok()
    );
    assert!(validate_assets(&json!({"data.bin":{"type":"application/octet-stream","base64":STANDARD.encode(vec![0;8*1024*1024+1])}})).is_err());
    let assets: serde_json::Map<String, Value> = (0..4)
        .map(|index| {
            (
                format!("data{index}.bin"),
                json!({"type":"application/octet-stream","base64":large}),
            )
        })
        .collect();
    assert!(validate_assets(&Value::Object(assets)).is_err());
}

#[test]
fn offline_asset_hash_matches_javascript_sorted_utf8_golden_fixture() {
    // Computed independently with Node crypto + the frontend sorted JSON algorithm.
    let value = json!({"manifest":{"id":"asset-golden","name":"Offline","version":"1.0.0","apiVersion":1,"dataVersion":1,"kind":"frontend"},"main":"export default {};","assets":{"worker.mjs":{"type":"text/javascript","base64":"Ly8geAo="},"fonts/demo.bin":{"type":"application/octet-stream","base64":"AAEC/w=="}}});
    assert_eq!(
        Package::parse(value, "asset-golden").unwrap().hash(),
        "9f2e5bab05dffd68e9b8920c5d79d5ffff0d3d6ab8c6d442341879d873a23ac2"
    );
}

#[test]
fn readme_round_trips_without_execution_and_changes_require_exact_trust() {
    let (workspace, _device, host, root) = fixture();
    let mut documented = bundle("sample");
    let readme = "# 使用说明\n\n保留原文 😀\n<script>not executable</script>\n";
    documented["readme"] = json!(readme);
    call(&host, &root, "sample", "install", documented.clone()).unwrap();
    let readme_path = workspace.path().join(".repeaty/plugins/sample/README.md");
    assert_eq!(std::fs::read_to_string(&readme_path).unwrap(), readme);
    // Metadata and documentation are available before the device trusts executable code.
    assert_eq!(
        call(&host, &root, "sample", "read", Value::Null).unwrap(),
        documented
    );
    assert_eq!(
        call(&host, &root, "", "list", Value::Null).unwrap()[0]["readme"],
        readme
    );
    let hash = package(&root, "sample").unwrap().hash();
    call(&host, &root, "sample", "trust", json!({"hash":hash})).unwrap();
    std::fs::write(&readme_path, "# Changed documentation\n").unwrap();
    assert_ne!(package(&root, "sample").unwrap().hash(), hash);
    assert_eq!(
        call(
            &host,
            &root,
            "sample",
            "files",
            json!({"action":"read","path":"draft.json"})
        )
        .unwrap_err(),
        "plugin-not-trusted"
    );
    assert_eq!(
        call(&host, &root, "sample", "trust", json!({"hash":hash})).unwrap_err(),
        "plugin-file-changed"
    );
    assert_eq!(
        call(&host, &root, "sample", "read", Value::Null).unwrap()["readme"],
        "# Changed documentation\n"
    );
    // Replacing with a package that has no README removes the previous optional file.
    call(&host, &root, "sample", "install", bundle("sample")).unwrap();
    assert!(!readme_path.exists());
    assert!(
        package(&root, "sample")
            .unwrap()
            .raw
            .get("readme")
            .is_none()
    );
}

#[test]
fn readme_utf8_limits_preserve_the_current_package_when_replacement_is_invalid() {
    let (_workspace, _device, host, root) = fixture();
    let mut original = bundle("sample");
    original["readme"] = json!("# Original");
    call(&host, &root, "sample", "install", original.clone()).unwrap();
    for readme in [
        json!(123),
        json!("x".repeat(README_LIMIT + 1)),
        json!("界".repeat(README_LIMIT / 3 + 1)),
    ] {
        let mut changed = original.clone();
        changed["readme"] = readme;
        assert!(call(&host, &root, "sample", "install", changed).is_err());
        assert_eq!(
            call(&host, &root, "sample", "read", Value::Null).unwrap(),
            original
        );
    }
    let mut largest = original;
    largest["readme"] = json!("x".repeat(README_LIMIT));
    assert!(Package::parse(largest, "sample").is_ok());
}

#[test]
fn hard_linked_readme_cannot_read_files_outside_the_package() {
    let (workspace, _device, host, root) = fixture();
    call(&host, &root, "sample", "install", bundle("sample")).unwrap();
    let outside = tempfile::tempdir().unwrap();
    let original = outside.path().join("private.md");
    std::fs::write(&original, "private text").unwrap();
    std::fs::hard_link(
        &original,
        workspace.path().join(".repeaty/plugins/sample/README.md"),
    )
    .unwrap();
    assert_eq!(
        call(&host, &root, "sample", "read", Value::Null).unwrap_err(),
        "unsafe-plugin-file"
    );
}
#[test]
fn package_hash_matches_frontend_unicode_golden_fixture_without_styles() {
    // Shared with src/plugins/package.test.ts; keep the payload and digest in sync.
    let raw = json!({
        "manifest": {
            "permissions": {
                "files": true,
                "secrets": false,
                "origins": ["https://example.org", "https://leetcode.cn"]
            },
            "main": "main.js",
            "description": "代码与样式保持原字节\n第二行",
            "kind": "frontend",
            "dataVersion": 3,
            "apiVersion": 1,
            "version": "2.3.4-beta.2",
            "name": "  中文 😀  ",
            "id": "golden-example"
        },
        "main": "export default { text: \"中文 😀\" }\n"
    });
    assert_eq!(
        Package::parse(raw.clone(), "golden-example")
            .unwrap()
            .hash(),
        "bfe649aa1c524811ec02555538e2b9eba94bd5013b53b7bcd051558a08e1a59c"
    );
    let mut documented = raw;
    documented["readme"] = json!("# 使用说明 😀\n\n保持原字节。\n");
    assert_eq!(
        Package::parse(documented, "golden-example").unwrap().hash(),
        "f9183d1ef163549c51c471907707bb2a3b43105465c75726de0b4d55c889ec15"
    );
}
#[test]
fn hard_linked_data_cannot_read_or_overwrite_files_outside_the_plugin() {
    let (workspace, _device, host, root) = fixture();
    install_trusted(&host, &root, "sample");
    let outside = tempfile::tempdir().unwrap();
    let target = outside.path().join("original");
    std::fs::write(&target, "unchanged").unwrap();
    let folder = workspace.path().join(".repeaty/plugin-data/sample");
    std::fs::create_dir_all(&folder).unwrap();
    std::fs::hard_link(&target, folder.join("link")).unwrap();
    assert_eq!(
        call(
            &host,
            &root,
            "sample",
            "files",
            json!({"action":"read","path":"link"})
        )
        .unwrap_err(),
        "unsafe-plugin-file"
    );
    assert_eq!(
        call(
            &host,
            &root,
            "sample",
            "files",
            json!({"action":"write","path":"link","body":"bad"})
        )
        .unwrap_err(),
        "unsafe-plugin-file"
    );
    std::fs::hard_link(
        &target,
        workspace.path().join(".repeaty/plugins/sample/linked-file"),
    )
    .unwrap();
    for (operation, payload) in [("remove", Value::Null), ("install", bundle("sample"))] {
        assert_eq!(
            call(&host, &root, "sample", operation, payload).unwrap_err(),
            "unsafe-plugin-file"
        );
    }
    assert_eq!(std::fs::read_to_string(target).unwrap(), "unchanged");
}
#[tokio::test]
async fn workspace_token_guards_prevent_old_plugin_operations_after_switch() {
    let (workspace, device, host, _root) = fixture();
    let mut sessions = repeaty_workspace::sessions::Sessions::open(device.path()).unwrap();
    let epoch = sessions.status().unwrap()["epoch"]
        .as_str()
        .unwrap()
        .to_owned();
    let selected = sessions.choose(&epoch, workspace.path(), false).unwrap();
    let old = selected["active"]["token"].as_str().unwrap().to_owned();
    let epoch = selected["epoch"].as_str().unwrap().to_owned();
    sessions.close(&epoch).unwrap();
    drop(sessions);
    let workspaces = crate::workspaces::Workspaces::new(device.path());
    assert!(
        host.call(
            &workspaces,
            old,
            "sample".into(),
            "install".into(),
            bundle("sample")
        )
        .await
        .is_err()
    );
    assert!(!workspace.path().join(".repeaty/plugins/sample").exists());
}
#[cfg(unix)]
#[test]
fn package_and_data_links_are_rejected_without_touching_the_target() {
    let (workspace, _device, host, root) = fixture();
    install_trusted(&host, &root, "sample");
    let outside = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(
        outside.path(),
        workspace.path().join(".repeaty/plugins/linked"),
    )
    .unwrap();
    assert!(call(&host, &root, "linked", "read", Value::Null).is_err());
    assert!(call(&host, &root, "linked", "install", bundle("linked")).is_err());
    let parent = workspace.path().join(".repeaty/plugin-data");
    std::fs::create_dir(&parent).unwrap();
    std::os::unix::fs::symlink(outside.path(), parent.join("sample")).unwrap();
    assert!(
        call(
            &host,
            &root,
            "sample",
            "files",
            json!({"action":"write","path":"bad","body":"bad"})
        )
        .is_err()
    );
    assert!(!outside.path().join("bad").exists());
}
#[cfg(windows)]
#[test]
fn package_junctions_are_rejected_without_windows_symlink_privileges() {
    use std::os::windows::process::CommandExt;
    let (workspace, _device, host, root) = fixture();
    install_trusted(&host, &root, "sample");
    let outside = tempfile::tempdir().unwrap();
    let linked = workspace.path().join(".repeaty/plugins/linked");
    let status = std::process::Command::new("cmd.exe")
        .args(["/d", "/c"])
        .raw_arg(format!(
            "mklink /J \"{}\" \"{}\"",
            linked.to_string_lossy().replace('/', "\\"),
            outside.path().display()
        ))
        .status()
        .unwrap();
    assert!(status.success());
    assert!(call(&host, &root, "linked", "read", Value::Null).is_err());
    assert!(call(&host, &root, "linked", "install", bundle("linked")).is_err());
    assert!(!outside.path().join("main.js").exists());
}
