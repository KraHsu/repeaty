//! Test driver for the actual desktop storage protocol, without a WebView or network service.
use repeaty_workspace::{
    backup::Summary,
    error::{Error, Result},
    recovery_catalog::{Catalog, Policy},
    sessions::Sessions,
};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    io::{self, BufRead, Write},
    path::{Path, PathBuf},
    sync::atomic::AtomicBool,
};
fn backups(
    sessions: &mut Sessions,
    directory: &Path,
    previews: &mut HashMap<String, (String, Summary)>,
    args: &Value,
) -> Result<Value> {
    let token = args["token"].as_str().ok_or_else(Error::invalid)?;
    let status = sessions.status()?;
    let request = &args["request"];
    let epoch = status["epoch"].as_str().ok_or_else(Error::invalid)?;
    let closed = status["active"].is_null();
    if closed {
        sessions.check_epoch(args["epoch"].as_str().ok_or_else(Error::invalid)?)?;
        if !token.is_empty()
            || !matches!(
                request["type"].as_str(),
                Some("inspect" | "search" | "restore")
            )
        {
            return Err(Error("workspace-not-open"));
        }
    } else if status["active"]["token"].as_str() != Some(token) {
        return Err(Error("stale-workspace-session"));
    }
    let scope = if closed {
        format!("closed:{epoch}")
    } else {
        token.into()
    };
    let id = status["active"]["id"].as_str().unwrap_or("");
    let root = Path::new(status["active"]["path"].as_str().unwrap_or(""));
    let catalog = Catalog::open(directory)?;
    previews.retain(|_, (prior, _)| prior == &scope);
    if previews.len() > 4000 {
        previews.clear();
    }
    let preview = |key: &str| -> Result<Summary> {
        let (prior, value) = previews.get(key).ok_or_else(Error::missing)?;
        if prior != &scope {
            return Err(Error("stale-workspace-session"));
        }
        Ok(value.clone())
    };
    let selected = || -> Result<PathBuf> {
        Ok(PathBuf::from(
            request["path"].as_str().ok_or_else(Error::invalid)?,
        ))
    };
    let key = || request["key"].as_str().ok_or_else(Error::invalid);
    match request["type"].as_str().ok_or_else(Error::invalid)? {
        "configuration" => Ok(serde_json::to_value(catalog.configuration(id)?)?),
        "target" => {
            let path = if request["clear"] == true {
                None
            } else {
                Some(selected()?)
            };
            Ok(serde_json::to_value(catalog.target(
                id,
                root,
                request["slot"].as_u64().ok_or_else(Error::invalid)? as usize,
                path.as_deref(),
            )?)?)
        }
        "policy" => Ok(serde_json::to_value(catalog.set_policy(
            id,
            serde_json::from_value::<Policy>(request["policy"].clone())?,
        )?)?),
        "list" => {
            let (items, errors) = catalog.list(id)?;
            let entries = items
                .into_iter()
                .map(|summary| {
                    let key = uuid::Uuid::new_v4().to_string();
                    let view = json!({"key":key,"summary":summary});
                    previews.insert(key, (scope.clone(), summary));
                    view
                })
                .collect::<Vec<_>>();
            Ok(json!({"entries":entries,"errors":errors}))
        }
        "run" => Ok(serde_json::to_value(catalog.run(
            sessions,
            token,
            id,
            request["automatic"] == true,
            &AtomicBool::new(false),
        )?)?),
        "inspect" => {
            let path = if let Some(key) = request["key"].as_str() {
                PathBuf::from(preview(key)?.archive_path)
            } else {
                selected()?
            };
            let summary = Sessions::inspect_backup(&path)?;
            let key = uuid::Uuid::new_v4().to_string();
            let view = json!({"key":key,"summary":summary});
            previews.insert(key, (scope.clone(), summary));
            Ok(view)
        }
        "search" => {
            let summary = preview(key()?)?;
            Ok(serde_json::to_value(Sessions::search_backup_checked(
                Path::new(&summary.archive_path),
                request["query"].as_str().ok_or_else(Error::invalid)?,
                100,
                &summary.sha256,
            )?)?)
        }
        "restore" => {
            let summary = preview(key()?)?;
            let parent = std::fs::canonicalize(selected()?)?;
            if !closed && parent.starts_with(std::fs::canonicalize(root)?) {
                return Err(Error("backup-target-in-workspace"));
            }
            let target = parent.join(format!("Repeaty-restored-{}", uuid::Uuid::new_v4()));
            let result = if request["paths"].is_array() {
                Sessions::restore_backup_items(
                    Path::new(&summary.archive_path),
                    &target,
                    &summary.sha256,
                    &serde_json::from_value::<Vec<String>>(request["paths"].clone())?,
                )?
            } else {
                sessions.restore_backup(
                    epoch,
                    Path::new(&summary.archive_path),
                    &target,
                    &summary.sha256,
                )?
            };
            Ok(json!({"path":target.to_string_lossy(),"result":result}))
        }
        "maintenance" => sessions.maintenance(token, request["vacuum"] == true),
        _ => Err(Error::invalid()),
    }
}
fn main() -> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = std::env::args().nth(1).ok_or("missing device directory")?;
    let mut sessions = Sessions::open(Path::new(&directory))?;
    // A stable fixture device identity; the production store additionally scopes
    // the journal writer to the selected workspace identity and canonical path.
    let device = repeaty_workspace::files::digest(directory.as_bytes());
    sessions.sync_bind_device(&device)?;
    let mut previews = HashMap::new();
    let stdin = io::stdin();
    let mut out = io::stdout().lock();
    for line in stdin.lock().lines() {
        let input: Value = serde_json::from_str(&line?)?;
        let args = &input["args"];
        let epoch = args["epoch"].as_str().unwrap_or("");
        let result = sessions.sync_bind_device(&device).and_then(|()| {
            let result = match input["command"].as_str().unwrap_or("") {
                "workspace_sync" => sessions.sync_request(
                    args["token"].as_str().unwrap_or(""),
                    args["method"].as_str().unwrap_or(""),
                    args["payload"].clone(),
                ),
                "workspace_backups" => {
                    backups(&mut sessions, Path::new(&directory), &mut previews, args)
                }
                "workspace_status" => sessions.status(),
                "workspace_choose" => sessions.choose(
                    epoch,
                    Path::new(args["path"].as_str().unwrap_or("")),
                    args["mode"] == "create",
                ),
                "workspace_close" => sessions.close(epoch),
                "workspace_recent" => sessions.recent(
                    epoch,
                    args["path"].as_str().unwrap_or(""),
                    args["id"].as_str().unwrap_or(""),
                ),
                "workspace_restore" => sessions.restore(epoch),
                "workspace_backup" => sessions
                    .backup(
                        args["token"].as_str().unwrap_or(""),
                        Path::new(args["path"].as_str().unwrap_or("")),
                    )
                    .map(|v| serde_json::to_value(v).unwrap()),
                "workspace_backup_inspect" => {
                    Sessions::inspect_backup(Path::new(args["path"].as_str().unwrap_or("")))
                        .map(|v| serde_json::to_value(v).unwrap())
                }
                "workspace_backup_search" => Sessions::search_backup(
                    Path::new(args["path"].as_str().unwrap_or("")),
                    args["query"].as_str().unwrap_or(""),
                    args["limit"].as_u64().unwrap_or(30) as usize,
                )
                .map(|v| serde_json::to_value(v).unwrap()),
                "workspace_backup_restore" => sessions.restore_backup(
                    epoch,
                    Path::new(args["path"].as_str().unwrap_or("")),
                    Path::new(args["target"].as_str().unwrap_or("")),
                    args["sha256"].as_str().unwrap_or(""),
                ),
                "workspace_backup_restore_items" => Sessions::restore_backup_items(
                    Path::new(args["path"].as_str().unwrap_or("")),
                    Path::new(args["target"].as_str().unwrap_or("")),
                    args["sha256"].as_str().unwrap_or(""),
                    &serde_json::from_value::<Vec<String>>(args["paths"].clone())
                        .unwrap_or_default(),
                ),
                "workspace_maintenance" => sessions.maintenance(
                    args["token"].as_str().unwrap_or(""),
                    args["vacuum"].as_bool().unwrap_or(false),
                ),
                "workspace_read" => sessions.read(
                    args["token"].as_str().unwrap_or(""),
                    args["request"].clone(),
                ),
                "workspace_changes" => sessions
                    .changes(args["token"].as_str().unwrap_or(""))
                    .map(|value| serde_json::to_value(value).unwrap()),
                "workspace_write" => sessions.write(
                    args["token"].as_str().unwrap_or(""),
                    args["request"].clone(),
                ),
                _ => Err(repeaty_workspace::error::Error("invalid-data")),
            };
            sessions.sync_bind_device(&device)?;
            result
        });
        let response = match result {
            Ok(value) => json!({"id":input["id"],"value":value}),
            Err(error) => json!({"id":input["id"],"error":error.0}),
        };
        writeln!(out, "{response}")?;
        out.flush()?;
    }
    Ok(())
}
