fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "mcp_attach",
            "mcp_workspace",
            "mcp_reply",
            "mcp_status",
            "mcp_start",
            "mcp_stop",
            "mcp_configuration",
            "mcp_client_configuration",
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
