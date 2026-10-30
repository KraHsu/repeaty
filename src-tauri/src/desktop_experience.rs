use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tauri::{Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_updater::UpdaterExt;
use tokio_util::sync::CancellationToken;

type Result<T> = std::result::Result<T, String>;
const RELEASE_API: &str = "https://api.github.com/repos/KraHsu/repeaty/releases/latest";
const UPDATE_FEED: &str = "https://github.com/KraHsu/repeaty/releases/latest/download/latest.json";
const RELEASES: &str = "https://github.com/KraHsu/repeaty/releases";
const MAX_METADATA: usize = 1024 * 1024;
const MAX_DOWNLOAD: u64 = 512 * 1024 * 1024;

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Configuration {
    pub start_hidden: bool,
    pub close_to_tray: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    configuration: Configuration,
    autostart: Option<bool>,
    autostart_supported: bool,
    tray_available: bool,
    version: &'static str,
    platform: &'static str,
    architecture: &'static str,
    signed_updates: bool,
    configuration_error: bool,
}

pub struct Experience {
    path: PathBuf,
    configuration: Mutex<(Configuration, bool)>,
    pub tray_available: AtomicBool,
    quitting: AtomicBool,
    update: tokio::sync::Mutex<Option<Candidate>>,
    transfer: Mutex<Option<CancellationToken>>,
}
struct Candidate {
    update: tauri_plugin_updater::Update,
    bytes: Option<Vec<u8>>,
}
impl Experience {
    pub fn new(directory: &Path) -> Self {
        let path = directory.join("desktop-experience.json");
        let read = (|| -> std::result::Result<Configuration, ()> {
            if !path.exists() {
                return Ok(Configuration::default());
            }
            // Do not follow a device preference symlink or read an unbounded file.
            if !std::fs::symlink_metadata(&path)
                .map_err(|_| ())?
                .file_type()
                .is_file()
            {
                return Err(());
            }
            let mut bytes = Vec::new();
            std::fs::File::open(&path)
                .map_err(|_| ())?
                .take(4097)
                .read_to_end(&mut bytes)
                .map_err(|_| ())?;
            if bytes.len() > 4096 {
                return Err(());
            }
            serde_json::from_slice(&bytes).map_err(|_| ())
        })();
        let failed = read.is_err();
        Self {
            path,
            configuration: Mutex::new((read.unwrap_or_default(), failed)),
            tray_available: AtomicBool::new(false),
            quitting: AtomicBool::new(false),
            update: Default::default(),
            transfer: Default::default(),
        }
    }
    fn save(&self, configuration: Configuration) -> Result<()> {
        let mut current = self
            .configuration
            .lock()
            .map_err(|_| "desktop-settings-unavailable")?;
        let parent = self.path.parent().ok_or("desktop-settings-unavailable")?;
        let mut temporary =
            tempfile::NamedTempFile::new_in(parent).map_err(|_| "desktop-settings-unavailable")?;
        temporary
            .write_all(
                &serde_json::to_vec(&configuration).map_err(|_| "desktop-settings-unavailable")?,
            )
            .map_err(|_| "desktop-settings-unavailable")?;
        temporary
            .as_file()
            .sync_all()
            .map_err(|_| "desktop-settings-unavailable")?;
        temporary
            .persist(&self.path)
            .map_err(|_| "desktop-settings-unavailable")?;
        *current = (configuration, false);
        Ok(())
    }
    pub fn start_hidden(&self) -> bool {
        self.tray_available.load(Ordering::Acquire)
            && std::env::args_os().any(|arg| arg == "--background")
            && self.configuration.lock().is_ok_and(|c| c.0.start_hidden)
    }
    pub fn cancel_transfer(&self) {
        if let Ok(mut transfer) = self.transfer.lock()
            && let Some(token) = transfer.take()
        {
            token.cancel();
        }
    }
}
fn key() -> Option<&'static str> {
    option_env!("REPEATY_UPDATER_PUBLIC_KEY").filter(|value| !value.trim().is_empty())
}
pub fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
pub fn install_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    let open = MenuItem::with_id(app, "repeaty-open", "Repeaty", true, None::<&str>)?;
    let quit = MenuItem::with_id(
        app,
        "repeaty-quit",
        "Quit Repeaty / 退出 Repeaty",
        true,
        None::<&str>,
    )?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let Some(icon) = app.default_window_icon() else {
        return Ok(());
    };
    TrayIconBuilder::with_id("repeaty")
        .tooltip("Repeaty")
        .icon(icon.clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show_main(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "repeaty-open" => show_main(app),
            "repeaty-quit" => {
                // This requests the normal frontend save guard, never app.exit().
                show_main(app);
                if let Some(window) = app.get_webview_window("main") {
                    app.state::<Experience>()
                        .quitting
                        .store(true, Ordering::Release);
                    if window.close().is_err() {
                        app.state::<Experience>()
                            .quitting
                            .store(false, Ordering::Release);
                    }
                }
            }
            _ => {}
        })
        .build(app)?;
    app.state::<Experience>()
        .tray_available
        .store(true, Ordering::Release);
    Ok(())
}
fn status(app: &tauri::AppHandle, state: &Experience) -> Result<Status> {
    let config = state
        .configuration
        .lock()
        .map_err(|_| "desktop-settings-unavailable")?;
    let supported = !cfg!(debug_assertions)
        && app
            .try_state::<tauri_plugin_autostart::AutoLaunchManager>()
            .is_some();
    Ok(Status {
        configuration: config.0.clone(),
        configuration_error: config.1,
        autostart: if supported {
            app.autolaunch().is_enabled().ok()
        } else {
            None
        },
        autostart_supported: supported,
        tray_available: state.tray_available.load(Ordering::Acquire),
        version: env!("CARGO_PKG_VERSION"),
        platform: std::env::consts::OS,
        architecture: std::env::consts::ARCH,
        signed_updates: key().is_some() && !cfg!(debug_assertions),
    })
}
#[tauri::command]
pub fn desktop_experience_status(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: State<'_, Experience>,
) -> Result<Status> {
    super::main_window(&window)?;
    status(&app, &state)
}
#[tauri::command]
pub fn desktop_experience_configure(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: State<'_, Experience>,
    configuration: Configuration,
) -> Result<Status> {
    super::main_window(&window)?;
    if (configuration.start_hidden || configuration.close_to_tray)
        && !state.tray_available.load(Ordering::Acquire)
    {
        return Err("desktop-tray-unavailable".into());
    }
    state.save(configuration)?;
    status(&app, &state)
}
#[tauri::command]
pub fn desktop_autostart(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: State<'_, Experience>,
    enabled: bool,
) -> Result<Status> {
    super::main_window(&window)?;
    if !status(&app, &state)?.autostart_supported {
        return Err("desktop-startup-unavailable".into());
    }
    let result = if enabled {
        app.autolaunch().enable()
    } else {
        app.autolaunch().disable()
    };
    result.map_err(|_| "desktop-startup-failed")?;
    status(&app, &state)
}
#[tauri::command]
pub fn desktop_close_action(
    window: tauri::WebviewWindow,
    state: State<'_, Experience>,
) -> Result<&'static str> {
    super::main_window(&window)?;
    let close_to_tray = state
        .configuration
        .lock()
        .map_err(|_| "desktop-settings-unavailable")?
        .0
        .close_to_tray;
    if close_to_tray
        && state.tray_available.load(Ordering::Acquire)
        && !state.quitting.load(Ordering::Acquire)
    {
        window.hide().map_err(|_| "desktop-hide-failed")?;
        Ok("handled")
    } else {
        Ok("close")
    }
}
#[tauri::command]
pub fn desktop_cancel_quit(
    window: tauri::WebviewWindow,
    state: State<'_, Experience>,
) -> Result<()> {
    super::main_window(&window)?;
    state.quitting.store(false, Ordering::Release);
    Ok(())
}

fn trusted_download(url: &reqwest::Url) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some("github.com")
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && url.path().starts_with("/KraHsu/repeaty/releases/download/")
        && url.query().is_none()
        && url.fragment().is_none()
}
fn redirect_policy() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| {
        let url = attempt.url();
        if attempt.previous().len() < 5
            && url.scheme() == "https"
            && matches!(
                url.host_str(),
                Some(
                    "github.com"
                        | "api.github.com"
                        | "release-assets.githubusercontent.com"
                        | "objects.githubusercontent.com"
                )
            )
        {
            attempt.follow()
        } else {
            attempt.stop()
        }
    })
}
async fn metadata(url: &str) -> Result<Option<serde_json::Value>> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(redirect_policy())
        .build()
        .map_err(|_| "desktop-update-unavailable")?;
    let mut response = client
        .get(url)
        .header("User-Agent", "Repeaty-Update-Check")
        .send()
        .await
        .map_err(|_| "desktop-update-network")?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err("desktop-update-network".into());
    }
    if response
        .content_length()
        .is_some_and(|size| size > MAX_METADATA as u64)
    {
        return Err("desktop-update-invalid".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "desktop-update-network")?
    {
        if bytes.len().saturating_add(chunk.len()) > MAX_METADATA {
            return Err("desktop-update-invalid".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|_| "desktop-update-invalid".into())
}
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    version: String,
    current_version: &'static str,
    newer: bool,
    page_url: String,
    notes: String,
    signed: bool,
    downloaded: bool,
}
fn release_metadata(value: serde_json::Value) -> Result<Release> {
    if value["draft"] != false || value["prerelease"] != false {
        return Err("desktop-update-invalid".into());
    }
    let tag = value["tag_name"].as_str().ok_or("desktop-update-invalid")?;
    let version = semver::Version::parse(tag.strip_prefix('v').unwrap_or(tag))
        .map_err(|_| "desktop-update-invalid")?;
    if !version.pre.is_empty() || !version.build.is_empty() {
        return Err("desktop-update-invalid".into());
    }
    let current =
        semver::Version::parse(env!("CARGO_PKG_VERSION")).map_err(|_| "desktop-update-invalid")?;
    Ok(Release {
        version: version.to_string(),
        current_version: env!("CARGO_PKG_VERSION"),
        newer: version > current,
        page_url: format!("{RELEASES}/tag/{tag}"),
        notes: value["body"]
            .as_str()
            .unwrap_or_default()
            .chars()
            .take(20_000)
            .collect(),
        signed: false,
        downloaded: false,
    })
}
#[tauri::command]
pub async fn desktop_update_check(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: State<'_, Experience>,
) -> Result<Option<Release>> {
    super::main_window(&window)?;
    let _guard = state.update.try_lock().map_err(|_| "desktop-update-busy")?;
    drop(_guard);
    // Stable public releases remain available even before a signed updater channel is configured.
    if key().is_none() || cfg!(debug_assertions) {
        return metadata(RELEASE_API)
            .await?
            .map(release_metadata)
            .transpose();
    }
    let mut current = state.update.try_lock().map_err(|_| "desktop-update-busy")?;
    let Some(feed) = metadata(UPDATE_FEED).await? else {
        return Err("desktop-update-channel-unavailable".into());
    };
    let updater = app
        .updater_builder()
        .pubkey(key().unwrap())
        .endpoints(vec![
            UPDATE_FEED
                .parse()
                .map_err(|_| "desktop-update-unavailable")?,
        ])
        .map_err(|_| "desktop-update-unavailable")?
        .timeout(Duration::from_secs(120))
        .configure_client(|builder| builder.redirect(redirect_policy()))
        .build()
        .map_err(|_| "desktop-update-unavailable")?;
    let Some(mut update) = updater
        .restore_update(feed)
        .map_err(|_| "desktop-update-invalid")?
    else {
        *current = None;
        return Ok(None);
    };
    if !trusted_download(&update.download_url) {
        return Err("desktop-update-invalid".into());
    }
    // restore_update does not carry the builder timeout into the download object.
    update.timeout = Some(Duration::from_secs(120));
    let version = semver::Version::parse(&update.version).map_err(|_| "desktop-update-invalid")?;
    if !version.pre.is_empty() || !version.build.is_empty() {
        return Err("desktop-update-invalid".into());
    }
    let same = current.as_ref().is_some_and(|previous| {
        previous.update.version == update.version
            && previous.update.signature == update.signature
            && previous.update.download_url == update.download_url
    });
    let result = Release {
        version: update.version.clone(),
        current_version: env!("CARGO_PKG_VERSION"),
        newer: true,
        page_url: RELEASES.into(),
        notes: update
            .body
            .as_deref()
            .unwrap_or_default()
            .chars()
            .take(20_000)
            .collect(),
        signed: true,
        downloaded: same
            && current
                .as_ref()
                .is_some_and(|previous| previous.bytes.is_some()),
    };
    if !same {
        *current = Some(Candidate {
            update,
            bytes: None,
        });
    }
    Ok(Some(result))
}
#[tauri::command]
pub async fn desktop_update_download(
    window: tauri::WebviewWindow,
    state: State<'_, Experience>,
) -> Result<()> {
    super::main_window(&window)?;
    let mut candidate = state.update.try_lock().map_err(|_| "desktop-update-busy")?;
    let candidate = candidate.as_mut().ok_or("desktop-update-check-required")?;
    let token = CancellationToken::new();
    *state.transfer.lock().map_err(|_| "desktop-update-busy")? = Some(token.clone());
    let mut downloaded = 0u64;
    let mut limited = false;
    let result = tokio::select! { biased;
        _ = token.cancelled() => Err("desktop-update-canceled".to_owned()),
        result = candidate.update.download(|chunk, total| {
            downloaded = downloaded.saturating_add(chunk as u64);
            if downloaded > MAX_DOWNLOAD || total.is_some_and(|size| size > MAX_DOWNLOAD) { limited = true; token.cancel(); }
            let _ = window.emit("repeaty-update-progress", serde_json::json!({"downloaded":downloaded,"total":total}));
        }, || {}) => result.map_err(|_| "desktop-update-verification-failed".to_owned()),
    };
    *state.transfer.lock().map_err(|_| "desktop-update-busy")? = None;
    if limited {
        return Err("desktop-update-size-limit".into());
    }
    if token.is_cancelled() {
        return Err("desktop-update-canceled".into());
    }
    candidate.bytes = Some(result?); // The updater verifies the signature before returning bytes.
    Ok(())
}
#[tauri::command]
pub fn desktop_update_cancel(
    window: tauri::WebviewWindow,
    state: State<'_, Experience>,
) -> Result<()> {
    super::main_window(&window)?;
    state.cancel_transfer();
    Ok(())
}
#[tauri::command]
pub async fn desktop_update_install(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: State<'_, Experience>,
) -> Result<()> {
    super::main_window(&window)?;
    let candidate = state.update.try_lock().map_err(|_| "desktop-update-busy")?;
    let candidate = candidate.as_ref().ok_or("desktop-update-check-required")?;
    let bytes = candidate
        .bytes
        .as_ref()
        .ok_or("desktop-update-download-required")?;
    candidate
        .update
        .verify(bytes)
        .map_err(|_| "desktop-update-verification-failed")?;
    candidate
        .update
        .install(bytes)
        .map_err(|_| "desktop-update-install-failed")?;
    app.restart();
}
#[tauri::command]
pub fn desktop_diagnostics(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: State<'_, Experience>,
) -> Result<serde_json::Value> {
    super::main_window(&window)?;
    let report = status(&app, &state)?;
    // Closed allowlist: no arbitrary errors, workspace paths, hostnames, IDs or settings dumps.
    Ok(
        serde_json::json!({"schema":1,"application":"Repeaty","version":report.version,"platform":report.platform,"architecture":report.architecture,"developmentBuild":cfg!(debug_assertions),"scaleFactor":window.scale_factor().ok(),"maximized":window.is_maximized().ok(),"trayAvailable":report.tray_available,"autostartSupported":report.autostart_supported,"autostartRegistered":report.autostart,"signedUpdateChannel":report.signed_updates,"preferenceReadFailed":report.configuration_error,"windowFrame":"custom"}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn updater_contract_rejects_tampering_and_signed_version_rollback_without_installing() {
        use base64::Engine;
        // Public test vector from tauri-plugin-updater 2.14.1 (MIT / Apache-2.0).
        // This key signs only the bytes "test" and is never used by the release channel.
        let public = "untrusted comment: minisign public key: A49EF4746FA6E6D7\nRWTX5qZvdPSepDGWg2bz8n6ArQnBMwgQK1geVosorcbLzcunD+KJ+cYe";
        let signature = "untrusted comment: signature from tauri secret key\nRUTX5qZvdPSepPF2zsjvP/L/TQtBLRnWRvaq+4omK1UEugtQp/USrGiI1v762sDy3id3aor7bRC9ETyeot6lMHHrWoZ5hjUM1Qc=\ntrusted comment: timestamp:1791649051\tfile:payload\tversion:2.0.0\nDDq2CLOEl5cQmC2eJRHlnZPVViOZsu1CjpPKQoei4A/XBfkDqGO0B+QMrcrHgEQ5qV3mne75tdFWhJpqUXh9AA==";
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.config_mut().plugins.0.insert(
            "updater".into(),
            serde_json::json!({"pubkey":"","requireSignedVersion":true}),
        );
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_updater::Builder::new().build())
            .build(context)
            .unwrap();
        let updater = app
            .updater_builder()
            .pubkey(base64::engine::general_purpose::STANDARD.encode(public))
            .target("test-target")
            .endpoints(vec![UPDATE_FEED.parse().unwrap()])
            .unwrap()
            .executable_path("runtime-path/app")
            .configure_client(|_| panic!("No network allowed in offline signature test"))
            .build()
            .unwrap();
        let mut feed = serde_json::json!({"version":"2.0.0","platforms":{"test-target":{"url":"https://github.com/KraHsu/repeaty/releases/download/v2.0.0/test.exe","signature":base64::engine::general_purpose::STANDARD.encode(signature)}}});
        let update = updater.restore_update(feed.clone()).unwrap().unwrap();
        assert!(update.verify(b"test").is_ok());
        assert!(update.verify(b"tampered").is_err());
        feed["version"] = "99.0.0".into();
        assert!(
            updater
                .restore_update(feed)
                .unwrap()
                .unwrap()
                .verify(b"test")
                .is_err()
        );
    }
    #[test]
    fn corrupt_preferences_do_not_prevent_startup_or_destroy_evidence() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("desktop-experience.json"), "broken").unwrap();
        let state = Experience::new(dir.path());
        assert!(state.configuration.lock().unwrap().1);
        assert!(!state.configuration.lock().unwrap().0.close_to_tray);
        assert_eq!(std::fs::read_to_string(&state.path).unwrap(), "broken");
    }
    #[test]
    fn preferences_round_trip_and_failed_write_preserve_live_values() {
        let dir = tempfile::tempdir().unwrap();
        let state = Experience::new(dir.path());
        state
            .save(Configuration {
                start_hidden: true,
                close_to_tray: true,
            })
            .unwrap();
        assert!(
            Experience::new(dir.path())
                .configuration
                .lock()
                .unwrap()
                .0
                .start_hidden
        );
        let missing = Experience::new(&dir.path().join("missing"));
        assert!(
            missing
                .save(Configuration {
                    start_hidden: true,
                    close_to_tray: true
                })
                .is_err()
        );
        assert!(!missing.configuration.lock().unwrap().0.close_to_tray);
    }
    #[test]
    fn stable_release_checks_reject_injected_tags_and_prereleases() {
        let valid = serde_json::json!({"draft":false,"prerelease":false,"tag_name":"v99.1.0","body":"Notes","html_url":"https://evil.test"});
        let release = release_metadata(valid.clone()).unwrap();
        assert!(release.newer);
        assert_eq!(release.page_url, format!("{RELEASES}/tag/v99.1.0"));
        for tag in [
            "v1.0.0/../../evil",
            "v1.0.0-beta",
            "v1.0.0+build",
            "https://evil.test",
        ] {
            let mut data = valid.clone();
            data["tag_name"] = tag.into();
            assert!(release_metadata(data).is_err());
        }
        let mut draft = valid;
        draft["draft"] = true.into();
        assert!(release_metadata(draft).is_err());
    }
    #[test]
    fn downloads_must_start_in_the_official_release_repository() {
        assert!(trusted_download(
            &"https://github.com/KraHsu/repeaty/releases/download/v1.0.0/app.exe"
                .parse()
                .unwrap()
        ));
        for value in [
            "http://github.com/KraHsu/repeaty/releases/download/x/app.exe",
            "https://github.com/other/repo/releases/download/x/app.exe",
            "https://github.com.evil.test/KraHsu/repeaty/releases/download/x/app.exe",
            "https://github.com/KraHsu/repeaty/releases/download/x/app.exe?token=foo",
        ] {
            assert!(!trusted_download(&value.parse().unwrap()));
        }
    }
}
