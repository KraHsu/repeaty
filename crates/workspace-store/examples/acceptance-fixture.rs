//! Headless JSON driver for cross-language tests, not an application endpoint or migration tool.
use repeaty_workspace::{
    files,
    prototype::{Prototype, Result, SaveRequest},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    io::{self, Read},
    path::PathBuf,
};

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
enum Command {
    Create {
        root: PathBuf,
    },
    SeedDeck {
        root: PathBuf,
        id: String,
    },
    RegisterDraft {
        root: PathBuf,
        payload: String,
    },
    Save {
        root: PathBuf,
        request: Box<SaveRequest>,
        raw: String,
        incoming: PathBuf,
        exit_at: Option<String>,
    },
    Snapshot {
        root: PathBuf,
        note_id: String,
    },
    Recover {
        root: PathBuf,
    },
}
fn run() -> Result<Value> {
    let mut input = Vec::new();
    io::stdin().take(4 * 1024 * 1024).read_to_end(&mut input)?;
    let command: Command = serde_json::from_slice(&input)?;
    match command {
        Command::Create { root } => {
            Ok(json!({"workspace_id":Prototype::create_in_empty(&root)?.workspace_id()?}))
        }
        Command::SeedDeck { root, id } => {
            Prototype::open(&root)?.seed_deck_for_fixture(&id)?;
            Ok(json!(true))
        }
        Command::RegisterDraft { root, payload } => {
            let proto = Prototype::open(&root)?;
            let draft: Value = serde_json::from_str(&payload)?;
            if draft["workspace_id"] != proto.workspace_id()? {
                return Err("draft-workspace-mismatch".into());
            }
            proto.seed_draft_for_fixture(
                draft["id"].as_str().ok_or("missing-draft-id")?,
                &payload,
            )?;
            Ok(json!(true))
        }
        Command::Snapshot { root, note_id } => Prototype::open(&root)?.domain_snapshot(&note_id),
        Command::Recover { root } => Ok(serde_json::to_value(Prototype::open(&root)?.recover()?)?),
        Command::Save {
            root,
            request,
            raw,
            incoming,
            exit_at,
        } => {
            if request.acceptance.is_none()
                || !std::fs::symlink_metadata(&incoming)?.file_type().is_dir()
            {
                return Err("invalid-fixture-input".into());
            }
            let result = Prototype::open(&root)?.save_with_objects(
                *request,
                raw.as_bytes(),
                |hash| {
                    if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
                        return Err("invalid-object-key".into());
                    }
                    Ok(files::read_stable_with_limit(
                        &incoming.join(hash),
                        10 * 1024 * 1024,
                    )?)
                },
                |point| {
                    if exit_at.as_deref() == Some(format!("{point:?}").as_str()) {
                        std::process::exit(86);
                    }
                    Ok(())
                },
            )?;
            Ok(serde_json::to_value(result)?)
        }
    }
}
fn main() {
    match run() {
        Ok(value) => println!("{value}"),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
