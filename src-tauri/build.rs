fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "export_begin",
            "export_write",
            "export_finish",
            "export_cancel",
            "desktop_config",
            "set_endpoint",
            "upstream_request",
            "local_plugin",
            "open_external",
        ]),
    ))
    .expect("build Tauri application");
}
