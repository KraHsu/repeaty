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
struct RunningJob {
    id: String,
    jobs: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}
impl Drop for RunningJob {
    fn drop(&mut self) {
        if let Ok(mut jobs) = self.jobs.lock() {
            jobs.remove(&self.id);
        }
    }
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
    fn begin(&self, id: &str) -> Result<(RunningJob, Arc<AtomicBool>), String> {
        uuid::Uuid::parse_str(id).map_err(|_| "invalid-data")?;
        let cancel = Arc::new(AtomicBool::new(false));
        let mut jobs = self.jobs.lock().map_err(|_| "storage-error")?;
        if !jobs.is_empty() {
            return Err("backup-busy".into());
        }
        jobs.insert(id.into(), cancel.clone());
        Ok((
            RunningJob {
                id: id.into(),
                jobs: self.jobs.clone(),
            },
            cancel,
        ))
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
        job: String,
    },
    Search {
        key: String,
        query: String,
        job: String,
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
fn active(
    sessions: &mut Sessions,
    token: &str,
    expected_epoch: Option<&str>,
) -> StoreResult<(String, PathBuf, String)> {
    let status = sessions.status()?;
    let active = &status["active"];
    if token.is_empty() && active.is_null() && expected_epoch == status["epoch"].as_str() {
        return Ok((
            String::new(),
            PathBuf::new(),
            status["epoch"].as_str().ok_or(Error::invalid())?.into(),
        ));
    }
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
    epoch: Option<String>,
    request: Request,
) -> Result<Value, String> {
    main_window(&window)?;
    // Register before the first await, including time spent queued or in a native picker.
    // Dropping the guard releases the slot on cancellation, picker dismissal and every error.
    let (_job, cancel) = match &request {
        Request::Run { job, .. }
        | Request::Restore { job, .. }
        | Request::Inspect { job, .. }
        | Request::Search { job, .. } => {
            let (guard, cancel) = state.begin(job)?;
            (Some(guard), cancel)
        }
        _ => (None, Arc::new(AtomicBool::new(false))),
    };
    // Validate scope before opening a native dialog; validate again after it closes.
    if token.is_empty()
        && !matches!(
            request,
            Request::Inspect { .. } | Request::Search { .. } | Request::Restore { .. }
        )
    {
        return Err("workspace-not-open".into());
    }
    let expected = token.clone();
    let expected_epoch = epoch.clone();
    let (_, _, scope_epoch) = workspaces::run(&workspaces, move |s| {
        active(s, &expected, expected_epoch.as_deref())
    })
    .await?;
    let scope = if token.is_empty() {
        format!("closed:{scope_epoch}")
    } else {
        token.clone()
    };
    if cancel.load(Ordering::Acquire) {
        return Err("backup-cancelled".into());
    }
    let pick_folder = matches!(
        request,
        Request::Target { clear: false, .. } | Request::Restore { .. }
    );
    let pick_file = matches!(request, Request::Inspect { key: None, .. });
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
    let previews = state.previews.clone();
    let directory = state.directory.clone();
    let expected = token.clone();
    let expected_epoch = epoch.clone();
    workspaces::run(&workspaces, move |s| {
        active(s, &expected, expected_epoch.as_deref())
    })
    .await?;
    // Full read-only validation can take minutes. Keep it off the workspace write mutex.
    if matches!(request, Request::Inspect { .. } | Request::Search { .. }) {
        let summary = match &request {
            Request::Inspect { key: Some(key), .. } | Request::Search { key, .. } => {
                let saved = previews.lock().map_err(|_| "storage-error")?;
                let (owner, summary) = saved.get(key).ok_or("not-found")?;
                if owner != &scope {
                    return Err("stale-workspace-session".into());
                }
                Some(summary.clone())
            }
            _ => None,
        };
        let cancelled = cancel.clone();
        let read = tauri::async_runtime::spawn_blocking(
            move || -> StoreResult<(Value, Option<Summary>)> {
                if cancelled.load(Ordering::Acquire) {
                    return Err(Error("backup-cancelled"));
                }
                match request {
                    Request::Inspect { .. } => {
                        let path = summary
                            .map(|s| PathBuf::from(s.archive_path))
                            .or(selected)
                            .ok_or(Error::invalid())?;
                        let verified = Sessions::inspect_backup_with_cancel(&path, &cancelled)?;
                        Ok((Value::Null, Some(verified)))
                    }
                    Request::Search { query, .. } => {
                        if query.chars().count() > 200 {
                            return Err(Error::invalid());
                        }
                        let summary = summary.ok_or(Error::missing())?;
                        if !summary.verified {
                            return Err(Error("backup-confirmation-required"));
                        }
                        Ok((
                            serde_json::to_value(Sessions::search_backup_checked_with_cancel(
                                Path::new(&summary.archive_path),
                                &query,
                                100,
                                &summary.sha256,
                                &cancelled,
                            )?)?,
                            None,
                        ))
                    }
                    _ => unreachable!(),
                }
            },
        )
        .await
        .map_err(|_| "storage-error")?
        .map_err(|e| e.0.to_owned())?;
        let expected = token.clone();
        let expected_epoch = epoch.clone();
        workspaces::run(&workspaces, move |s| {
            active(s, &expected, expected_epoch.as_deref())
        })
        .await?;
        if cancel.load(Ordering::Acquire) {
            return Err("backup-cancelled".into());
        }
        if let Some(summary) = read.1 {
            let key = uuid::Uuid::new_v4().to_string();
            let view = json!({"key":key,"summary":summary});
            let mut saved = previews.lock().map_err(|_| "storage-error")?;
            saved.retain(|_, (owner, _)| owner == &scope);
            if saved.len() > 4000 {
                saved.clear();
            }
            saved.insert(key, (scope, summary));
            return Ok(view);
        }
        return Ok(read.0);
    }
    workspaces::run(&workspaces, move |sessions| {
        if cancel.load(Ordering::Acquire) {
            return Err(Error("backup-cancelled"));
        }
        let (id, root, epoch) = active(sessions, &token, epoch.as_deref())?;
        let catalog = Catalog::open(&directory)?;
        let preview = |key: &str| -> StoreResult<Summary> {
            let previews = previews.lock().map_err(|_| Error::internal())?;
            let (scope, summary) = previews.get(key).ok_or(Error::missing())?;
            if scope
                != &(if token.is_empty() {
                    format!("closed:{epoch}")
                } else {
                    token.clone()
                })
            {
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
            Request::Inspect { .. } | Request::Search { .. } => unreachable!(),
            Request::Restore { key, paths, .. } => {
                let summary = preview(&key)?;
                if !summary.verified {
                    return Err(Error("backup-confirmation-required"));
                }
                let parent = selected.ok_or(Error::invalid())?;
                if !root.as_os_str().is_empty()
                    && std::fs::canonicalize(&parent)?.starts_with(&root)
                {
                    return Err(Error("backup-target-in-workspace"));
                }
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
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pending_picker_and_queued_jobs_remain_cancellable_and_release_on_early_return() {
        let state = Backups::new(Path::new("unused"));
        let id = uuid::Uuid::new_v4().to_string();
        let (guard, cancel) = state.begin(&id).unwrap();
        assert!(state.begin(&uuid::Uuid::new_v4().to_string()).is_err());
        state.cancel_all();
        assert!(cancel.load(Ordering::Acquire));
        drop(guard);
        assert!(state.jobs.lock().unwrap().is_empty());
        assert!(state.begin(&uuid::Uuid::new_v4().to_string()).is_ok());
    }
    #[test]
    fn closed_workspace_access_requires_current_epoch_and_expires_after_open_close() {
        let directory = tempfile::tempdir().unwrap();
        let mut sessions = Sessions::open(&directory.path().join("device")).unwrap();
        let status = sessions.status().unwrap();
        let initial = status["epoch"].as_str().unwrap();
        assert!(active(&mut sessions, "", Some(initial)).is_ok());
        assert!(active(&mut sessions, "", None).is_err());
        assert!(active(&mut sessions, "", Some("stale")).is_err());
        let library = directory.path().join("library");
        std::fs::create_dir(&library).unwrap();
        let opened = sessions.choose(initial, &library, true).unwrap();
        assert!(active(&mut sessions, "", Some(initial)).is_err());
        let closed = sessions.close(opened["epoch"].as_str().unwrap()).unwrap();
        assert!(active(&mut sessions, "", Some(initial)).is_err());
        assert!(active(&mut sessions, "", closed["epoch"].as_str()).is_ok());
    }
}
