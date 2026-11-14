use crate::{
    device_sync::{Invitation, Scope, SyncService},
    main_window,
    workspaces::{Workspaces, run, run_checked},
};
use serde_json::{Value, json};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn device_sync_request(
    window: tauri::WebviewWindow,
    state: State<'_, Workspaces>,
    service: State<'_, Arc<SyncService>>,
    token: String,
    method: String,
    payload: Value,
) -> Result<Value, String> {
    main_window(&window)?;
    let check = token.clone();
    let host = service.inner().clone();
    let status = run(&state, move |s| {
        let mut status = s.sync_request(&check, "journal/status", Value::Null)?;
        if let Some(group) = status["groupId"].as_str() {
            host.activate(Scope {
                token: check,
                group_id: group.into(),
            })
            .map_err(|_| repeaty_workspace::error::Error("sync-unavailable"))?;
        } else {
            host.deactivate();
        }
        status["transport"] = host
            .status()
            .map_err(|_| repeaty_workspace::error::Error("sync-unavailable"))?;
        Ok(status)
    })
    .await?;
    if method == "leave" {
        let host = service.inner().clone();
        return run(&state, move |s| {
            let status = s.sync_request(&token, "journal/status", Value::Null)?;
            if status["groupId"].is_null() {
                return Ok(status);
            }
            let peers = host
                .status()
                .map_err(|_| repeaty_workspace::error::Error("sync-unavailable"))?;
            for peer in peers["peers"].as_array().into_iter().flatten() {
                if let Some(id) = peer["id"].as_str() {
                    host.revoke(id)
                        .map_err(|_| repeaty_workspace::error::Error("sync-unavailable"))?;
                }
            }
            host.deactivate();
            s.sync_request(&token, "leave", Value::Null)
        })
        .await;
    }
    if method == "start" || method == "join" || method == "prepareJoin" {
        let invitation = if method != "start" {
            Some(
                serde_json::from_value::<Invitation>(payload["invitation"].clone())
                    .map_err(|_| "sync-invalid-invitation")?,
            )
        } else {
            None
        };
        let group = if method != "start" {
            payload["invitation"]["groupId"].as_str()
        } else {
            payload["groupId"].as_str()
        }
        .ok_or("sync-invalid-group")?
        .to_owned();
        let owner = token.clone();
        let host = service.inner().clone();
        run(&state, move |s| {
            s.sync_request(&owner, "start", json!({"groupId":group}))?;
            host.activate(Scope {
                token: owner,
                group_id: group,
            })
            .map_err(|_| repeaty_workspace::error::Error("sync-unavailable"))?;
            Ok(())
        })
        .await?;
        if method != "join" {
            return service.status();
        }
        let invitation = invitation.ok_or("sync-invalid-invitation")?;
        return service
            .inner()
            .join_for(
                Scope {
                    token,
                    group_id: invitation.group_id.clone(),
                },
                invitation,
            )
            .await;
    }
    if method == "status" {
        return Ok(json!({"transport":status["transport"],"journal":status}));
    }
    match method.as_str() {
        "listen" => {
            service
                .inner()
                .listen_for(
                    Scope {
                        token,
                        group_id: status["groupId"].as_str().ok_or("sync-not-enabled")?.into(),
                    },
                    payload["address"].as_str().ok_or("sync-invalid-address")?,
                )
                .await
        }
        "invite" | "approve" | "reject" | "pause" | "resume" | "revoke" | "cancel" | "stop"
        | "diagnostics" | "deactivate" => {
            let host = service.inner().clone();
            run_checked(&state, move |sessions| {
                sessions
                    .sync_request(&token, "journal/status", Value::Null)
                    .map_err(|e| e.0.to_owned())?;
                match method.as_str() {
                    "invite" => {
                        serde_json::to_value(host.invite()?).map_err(|_| "sync-error".into())
                    }
                    "approve" => {
                        host.approve(payload["id"].as_str().ok_or("sync-invalid-peer")?, true)
                    }
                    "reject" => {
                        host.approve(payload["id"].as_str().ok_or("sync-invalid-peer")?, false)
                    }
                    "pause" => host.pause(true),
                    "resume" => host.pause(false),
                    "revoke" => host.revoke(payload["id"].as_str().ok_or("sync-invalid-peer")?),
                    "cancel" => host.cancel(),
                    "stop" => host.stop(),
                    "diagnostics" => host.diagnostics(),
                    "deactivate" => {
                        host.deactivate();
                        Ok(Value::Null)
                    }
                    _ => Err("sync-invalid-method".into()),
                }
            })
            .await
        }
        "peer" => {
            service
                .inner()
                .peer_request_for(
                    Scope {
                        token,
                        group_id: status["groupId"].as_str().ok_or("sync-not-enabled")?.into(),
                    },
                    payload["peerId"].as_str().ok_or("sync-invalid-peer")?,
                    payload["method"].as_str().ok_or("sync-invalid-method")?,
                    payload["payload"].clone(),
                )
                .await
        }
        "snapshot" | "journal/status" | "journal/list" | "journal/receive" | "objects/info"
        | "objects/read" | "objects/write" | "objects/finish" => {
            run(&state, move |s| s.sync_request(&token, &method, payload)).await
        }
        _ => Err("sync-invalid-method".into()),
    }
}
