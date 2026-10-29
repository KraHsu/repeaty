//! Test driver for the actual desktop storage protocol, without a WebView or network service.
use repeaty_workspace::sessions::Sessions;
use serde_json::{Value, json};
use std::{
    io::{self, BufRead, Write},
    path::Path,
};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let directory = std::env::args().nth(1).ok_or("missing device directory")?;
    let mut sessions = Sessions::open(Path::new(&directory))?;
    let stdin = io::stdin();
    let mut out = io::stdout().lock();
    for line in stdin.lock().lines() {
        let input: Value = serde_json::from_str(&line?)?;
        let args = &input["args"];
        let epoch = args["epoch"].as_str().unwrap_or("");
        let result = match input["command"].as_str().unwrap_or("") {
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
        let response = match result {
            Ok(value) => json!({"id":input["id"],"value":value}),
            Err(error) => json!({"id":input["id"],"error":error.0}),
        };
        writeln!(out, "{response}")?;
        out.flush()?;
    }
    Ok(())
}
