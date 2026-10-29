use crate::{
    main_window,
    workspaces::{self, Workspaces},
};
use repeaty_workspace::{
    backup::Summary,
    error::{Error, Result as StoreResult},
    recovery_catalog::{Catalog, Policy},
    sessions::Sessions,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use tauri::State;
use tauri_plugin_dialog::DialogExt;

pub struct Backups {
    directory: PathBuf,
    previews: Arc<Mutex<HashMap<String, (String, Summary)>>>,
    jobs: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}
impl Backups {
    pub fn new(directory: &Path) -> Self {
        Self {
            directory: directory.into(),
            previews: Default::default(),
            jobs: Default::default(),
        }
    }
    pub fn cancel_all(&self) {
        if let Ok(jobs) = self.jobs.lock() {
            for cancel in jobs.values() {
                cancel.store(true, Ordering::Release);
            }
        }
        if let Ok(mut previews) = self.previews.lock() {
            previews.clear();
        }
    }
}
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum Request {
    Configuration,
    Target {
        slot: usize,
        clear: bool,
    },
    Policy {
        policy: Policy,
    },
    List,
    Run {
        automatic: bool,
        job: String,
    },
    Inspect {
        key: Option<String>,
    },
    Search {
        key: String,
        query: String,
    },
    Restore {
        key: String,
        paths: Option<Vec<String>>,
        job: String,
    },
    Maintenance {
        vacuum: bool,
    },
}
fn active(sessions: &mut Sessions, token: &str) -> StoreResult<(String, PathBuf, String)> {
    let status = sessions.status()?;
    let active = &status["active"];
    if active["token"].as_str() != Some(token) {
        return Err(Error("stale-workspace-session"));
    }
    Ok((
        active["id"].as_str().ok_or(Error::invalid())?.into(),
        PathBuf::from(active["path"].as_str().ok_or(Error::invalid())?),
        status["epoch"].as_str().ok_or(Error::invalid())?.into(),
    ))
}
#[tauri::command]
pub fn workspace_backup_cancel(
    window: tauri::WebviewWindow,
    state: State<'_, Backups>,
    job: String,
) -> Result<(), String> {
    main_window(&window)?;
    if let Some(cancel) = state.jobs.lock().map_err(|_| "storage-error")?.get(&job) {
        cancel.store(true, Ordering::Release);
    }
    Ok(())
}
#[tauri::command]
pub async fn workspace_backups(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    workspaces: State<'_, Workspaces>,
    state: State<'_, Backups>,
    token: String,
    request: Request,
) -> Result<Value, String> {
    main_window(&window)?;
    // Validate scope before opening a native dialog; validate again after it closes.
    let expected = token.clone();
    workspaces::run(&workspaces, move |s| active(s, &expected)).await?;
    let pick_folder = matches!(
        request,
        Request::Target { clear: false, .. } | Request::Restore { .. }
    );
    let pick_file = matches!(request, Request::Inspect { key: None });
    let selected = if pick_folder || pick_file {
        let selected = tauri::async_runtime::spawn_blocking(move || {
            if pick_folder {
                app.dialog().file().blocking_pick_folder()
            } else {
                app.dialog()
                    .file()
                    .add_filter("Repeaty workspace", &["repeaty-workspace"])
                    .blocking_pick_file()
            }
        })
        .await
        .map_err(|_| "storage-error")?;
        let Some(file) = selected else {
            return Ok(Value::Null);
        };
        Some(file.into_path().map_err(|_| "invalid-data")?)
    } else {
        None
    };
    let job = match &request {
        Request::Run { job, .. } | Request::Restore { job, .. } => Some(job.clone()),
        _ => None,
    };
    let cancel = Arc::new(AtomicBool::new(false));
    if let Some(job) = &job {
        uuid::Uuid::parse_str(job).map_err(|_| "invalid-data")?;
        let mut jobs = state.jobs.lock().map_err(|_| "storage-error")?;
        if !jobs.is_empty() {
            return Err("backup-busy".into());
        }
        jobs.insert(job.clone(), cancel.clone());
    }
    let previews = state.previews.clone();
    let directory = state.directory.clone();
    let result = workspaces::run(&workspaces, move |sessions| {
        let (id, root, epoch) = active(sessions, &token)?;
        let catalog = Catalog::open(&directory)?;
        let preview = |key: &str| -> StoreResult<Summary> {
            let previews = previews.lock().map_err(|_| Error::internal())?;
            let (scope, summary) = previews.get(key).ok_or(Error::missing())?;
            if scope != &token {
                return Err(Error("stale-workspace-session"));
            }
            // Summary is an opaque capability: callers cannot supply arbitrary paths to search/restore.
            Ok(summary.clone())
        };
        match request {
            Request::Configuration => Ok(serde_json::to_value(catalog.configuration(&id)?)?),
            Request::Target { slot, clear } => Ok(serde_json::to_value(catalog.target(
                &id,
                &root,
                slot,
                if clear { None } else { selected.as_deref() },
            )?)?),
            Request::Policy { policy } => {
                Ok(serde_json::to_value(catalog.set_policy(&id, policy)?)?)
            }
            Request::List => {
                let (items, errors) = catalog.list(&id)?;
                let mut saved = previews.lock().map_err(|_| Error::internal())?;
                // Keep the map bounded and drop capabilities from old workspace sessions.
                saved.retain(|_, (scope, _)| scope == &token);
                if saved.len() > 4000 {
                    saved.clear();
                }
                let entries = items
                    .into_iter()
                    .map(|summary| {
                        let key = uuid::Uuid::new_v4().to_string();
                        let view = json!({"key":key,"summary":summary});
                        saved.insert(key, (token.clone(), summary));
                        view
                    })
                    .collect::<Vec<_>>();
                Ok(json!({"entries":entries,"errors":errors}))
            }
            Request::Run { automatic, .. } => Ok(serde_json::to_value(
                catalog.run(sessions, &token, &id, automatic, &cancel)?,
            )?),
            Request::Inspect { key } => {
                let path = match key {
                    Some(key) => PathBuf::from(preview(&key)?.archive_path),
                    None => selected.ok_or(Error::invalid())?,
                };
                let summary = Sessions::inspect_backup(&path)?;
                let key = uuid::Uuid::new_v4().to_string();
                let view = json!({"key":key,"summary":summary});
                let mut saved = previews.lock().map_err(|_| Error::internal())?;
                saved.retain(|_, (scope, _)| scope == &token);
                if saved.len() > 4000 {
                    saved.clear();
                }
                saved.insert(key, (token, summary));
                Ok(view)
            }
            Request::Search { key, query } => {
                if query.chars().count() > 200 {
                    return Err(Error::invalid());
                }
                let summary = preview(&key)?;
                Ok(serde_json::to_value(Sessions::search_backup_checked(
                    Path::new(&summary.archive_path),
                    &query,
                    100,
                    &summary.sha256,
                )?)?)
            }
            Request::Restore { key, paths, .. } => {
                let summary = preview(&key)?;
                let parent = selected.ok_or(Error::invalid())?;
                let target = parent.join(format!("Repeaty-restored-{}", uuid::Uuid::new_v4()));
                let result = if let Some(paths) = paths {
                    if paths.is_empty() || paths.len() > 100 {
                        return Err(Error::invalid());
                    }
                    Sessions::restore_backup_items_with_cancel(
                        Path::new(&summary.archive_path),
                        &target,
                        &summary.sha256,
                        &paths,
                        &cancel,
                    )?
                } else {
                    sessions.restore_backup_with_cancel(
                        &epoch,
                        Path::new(&summary.archive_path),
                        &target,
                        &summary.sha256,
                        &cancel,
                    )?
                };
                Ok(json!({"path":target.to_string_lossy(),"result":result}))
            }
            Request::Maintenance { vacuum } => sessions.maintenance(&token, vacuum),
        }
    })
    .await;
    if let Some(job) = job {
        state.jobs.lock().map_err(|_| "storage-error")?.remove(&job);
    }
    result
}
