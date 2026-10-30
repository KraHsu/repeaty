//! One-shot JSON CLI facade. It never opens a WebView or a learning database.
use super::{MAX_REQUEST_BODY, stdio::Proxy};
use rmcp::model::CallToolRequestParams;
use serde_json::{Map, Value, json};
use std::{
    ffi::OsString,
    io::{IsTerminal, Read, Write},
    path::PathBuf,
    time::Duration,
};

enum Input {
    Json(String),
    File(PathBuf),
    Stdin,
}

struct Options {
    command: String,
    connection: Option<PathBuf>,
    input: Option<Input>,
}

fn parse(arguments: Vec<OsString>) -> Result<Options, &'static str> {
    let mut options = Options {
        command: String::new(),
        connection: None,
        input: None,
    };
    let mut args = arguments.into_iter();
    while let Some(arg) = args.next() {
        match arg.to_str().ok_or("invalid-arguments")? {
            "--connection-file" => {
                if options.connection.is_some() {
                    return Err("invalid-arguments");
                }
                let path = PathBuf::from(args.next().ok_or("invalid-arguments")?);
                if !path.is_absolute() {
                    return Err("invalid-arguments");
                }
                options.connection = Some(path);
            }
            "--json" | "--request-file" => {
                if options.input.is_some() {
                    return Err("invalid-arguments");
                }
                let value = args.next().ok_or("invalid-arguments")?;
                options.input = Some(if arg == "--json" {
                    Input::Json(value.into_string().map_err(|_| "invalid-arguments")?)
                } else if value == "-" {
                    Input::Stdin
                } else {
                    Input::File(value.into())
                });
            }
            "-" => {
                if options.input.is_some() {
                    return Err("invalid-arguments");
                }
                options.input = Some(Input::Stdin);
            }
            "--help" | "-h" => options.command = "help".into(),
            "--version" | "-V" => options.command = "version".into(),
            value if !value.starts_with('-') && options.command.is_empty() => {
                options.command = value.into()
            }
            _ => return Err("invalid-arguments"),
        }
    }
    if options.command.is_empty() {
        options.command = "help".into();
    }
    if !matches!(
        options.command.as_str(),
        "help" | "version" | "status" | "query" | "preview" | "apply" | "operation"
    ) {
        return Err("invalid-arguments");
    }
    Ok(options)
}

fn help() -> Value {
    json!({
        "name":"repeaty", "version":env!("CARGO_PKG_VERSION"), "protocolVersion":1,
        "usage":"repeaty --cli <help|version|status|query|preview|apply|operation> [--json <object> | --request-file <path|-> | -] [--connection-file <absolute path>]",
        "commands":{
            "help":"Print this help without opening the desktop application.",
            "version":"Print the executable and command protocol versions; works offline.",
            "status":"Read current library scope, revision, automation grants and capabilities.",
            "query":"Read the authorized library using the versioned query contract.",
            "preview":"Validate commands and return a reviewable plan without saving changes.",
            "apply":"Apply a previously reviewed plan through the application's atomic transaction.",
            "operation":"Read an operation receipt after a timeout, restart or lost response."
        },
        "requirements":[
            "Keep the Repeaty desktop application running with the intended local library open and its local MCP connection enabled.",
            "Enable library automation reads explicitly in settings; preview/apply additionally require write authorization.",
            "No Node.js runtime, graphical interaction or separate database access is used by this CLI.",
            "Write requests require a preview, current revision and a stable operation ID. The host binds every call to its current library; changing libraries invalidates previews. Retrying changed arguments with the same ID is rejected.",
            "A timeout or client cancellation does not prove a write was rolled back. Query its receipt before retrying."
        ],
        "input":{
            "format":"Exactly one JSON object using the public automation contract; maximum 512 KiB.",
            "stdin":"Use --request-file - or a bare -. Non-terminal stdin is read automatically when no payload option is supplied.",
            "connection":"Defaults to the current user's Repeaty application-data mcp.connection.json. --connection-file overrides it; no bearer token is printed."
        },
        "output":"Exactly one JSON line: {ok:true,data:{...}} or {ok:false,error:{code:...}}. Diagnostics never include request contents or credentials.",
        "requestSchemas": super::automation::schemas(),
        "exitCodes":{"0":"Success", "1":"Application rejected the operation", "2":"Invalid command or request JSON", "3":"Connection, library, permission or response unavailable", "4":"Required recovery backup failed"}
    })
}

fn default_connection() -> Result<PathBuf, &'static str> {
    // Same platform conventions used by Tauri's app_data_dir; no GUI initialization needed.
    #[cfg(windows)]
    let base = std::env::var_os("APPDATA").map(PathBuf::from);
    #[cfg(target_os = "macos")]
    let base = std::env::var_os("HOME")
        .map(|home| PathBuf::from(home).join("Library/Application Support"));
    #[cfg(all(unix, not(target_os = "macos")))]
    let base = std::env::var_os("XDG_DATA_HOME")
        .filter(|path| PathBuf::from(path).is_absolute())
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share")));
    #[cfg(not(any(unix, windows)))]
    let base: Option<PathBuf> = None;
    let base = base
        .filter(|path| path.is_absolute())
        .ok_or("library-unavailable")?;
    let config: Value = serde_json::from_str(include_str!("../../tauri.conf.json"))
        .map_err(|_| "library-unavailable")?;
    let identifier = config["identifier"].as_str().ok_or("library-unavailable")?;
    Ok(base.join(identifier).join("mcp.connection.json"))
}

fn read_bounded(reader: impl Read) -> Result<Vec<u8>, &'static str> {
    let mut bytes = Vec::new();
    reader
        .take((MAX_REQUEST_BODY + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "invalid-arguments")?;
    if bytes.len() > MAX_REQUEST_BODY {
        return Err("invalid-arguments");
    }
    Ok(bytes)
}

fn arguments(input: Option<Input>) -> Result<Map<String, Value>, &'static str> {
    let bytes = match input {
        Some(Input::Json(value)) => {
            if value.len() > MAX_REQUEST_BODY {
                return Err("invalid-arguments");
            }
            value.into_bytes()
        }
        Some(Input::File(path)) => {
            read_bounded(std::fs::File::open(path).map_err(|_| "invalid-arguments")?)?
        }
        Some(Input::Stdin) => read_bounded(std::io::stdin().lock())?,
        None if !std::io::stdin().is_terminal() => read_bounded(std::io::stdin().lock())?,
        None => Vec::new(),
    };
    if bytes.is_empty() {
        return Ok(Map::new());
    }
    serde_json::from_slice::<Value>(&bytes)
        .map_err(|_| "invalid-arguments")?
        .as_object()
        .cloned()
        .ok_or("invalid-arguments")
}

fn tool(command: &str) -> &'static str {
    match command {
        "status" => "repeaty_automation_status",
        "query" => "repeaty_query_library",
        "preview" => "repeaty_preview_changes",
        "apply" => "repeaty_apply_changes",
        "operation" => "repeaty_operation_status",
        _ => unreachable!("CLI parser validates commands"),
    }
}

fn exit_code(code: &str) -> u8 {
    match code {
        "invalid-arguments" | "invalid-command" => 2,
        "library-unavailable"
        | "library-changed"
        | "permission-denied"
        | "read-timeout"
        | "too-many-requests" => 3,
        "backup-failed" => 4,
        _ => 1,
    }
}

async fn execute(options: Options, arguments: Map<String, Value>) -> Result<Value, String> {
    let path = options
        .connection
        .map(Ok)
        .unwrap_or_else(default_connection)?;
    let proxy = Proxy::new(path);
    let request = CallToolRequestParams::new(tool(&options.command)).with_arguments(arguments);
    let response = tokio::time::timeout(Duration::from_secs(40), proxy.call(request))
        .await
        .map_err(|_| "read-timeout")??;
    let data = response.structured_content.ok_or("invalid-response")?;
    if response.is_error == Some(true) {
        return Err(data["code"]
            .as_str()
            .unwrap_or("operation-failed")
            .to_owned());
    }
    Ok(data)
}

fn result(arguments_os: Vec<OsString>) -> Result<Value, String> {
    let options = parse(arguments_os)?;
    match options.command.as_str() {
        "help" => return Ok(help()),
        "version" => {
            return Ok(
                json!({"name":"repeaty","version":env!("CARGO_PKG_VERSION"),"protocolVersion":1}),
            );
        }
        _ => {}
    }
    let payload = arguments(options.input)?;
    let options = Options {
        input: None,
        ..options
    };
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .map_err(|_| "library-unavailable")?;
    runtime.block_on(execute(options, payload))
}

#[cfg(windows)]
fn attach_parent_console_if_needed() {
    // The installed desktop executable uses the Windows GUI subsystem. Preserve redirected
    // handles for AI clients; only attach to an existing parent console when stdout is absent.
    // Never allocate or display a new console for a background helper.
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetStdHandle(kind: u32) -> *mut std::ffi::c_void;
        fn AttachConsole(process: u32) -> i32;
    }
    unsafe {
        let handle = GetStdHandle((-11_i32) as u32);
        if handle.is_null() || handle as isize == -1 {
            AttachConsole(u32::MAX);
        }
    }
}

pub fn run(arguments: Vec<OsString>) -> u8 {
    #[cfg(windows)]
    attach_parent_console_if_needed();
    let (code, output) = match result(arguments) {
        Ok(data) => (0, json!({"ok":true,"data":data})),
        Err(code) => (exit_code(&code), json!({"ok":false,"error":{"code":code}})),
    };
    let mut output_stream = std::io::stdout().lock();
    if serde_json::to_writer(&mut output_stream, &output).is_err()
        || writeln!(output_stream).is_err()
    {
        return 1;
    }
    code
}

#[cfg(test)]
mod tests {
    use super::super::{BridgeRequest, Mcp, Reply, Workspace, automation::Grant};
    use super::*;
    use std::sync::Arc;

    fn args(values: &[&str]) -> Vec<OsString> {
        values.iter().map(OsString::from).collect()
    }

    #[test]
    fn offline_help_and_version_never_need_a_descriptor_or_stdin() {
        assert_eq!(result(args(&["help"])).unwrap()["protocolVersion"], 1);
        assert_eq!(
            result(args(&["--version"])).unwrap()["version"],
            env!("CARGO_PKG_VERSION")
        );
        assert!(result(args(&["help", "--request-file", "missing-file"])).is_ok());
    }

    #[test]
    fn parser_rejects_ambiguous_payloads_paths_and_unknown_commands() {
        for values in [
            vec!["unknown"],
            vec!["query", "--json"],
            vec!["query", "--json", "{}", "-"],
            vec!["query", "--connection-file", "relative.json"],
            vec!["query", "--url", "https://example.com"],
        ] {
            assert!(parse(args(&values)).is_err());
        }
        assert!(matches!(
            parse(args(&["query", "--request-file", "-"]))
                .unwrap()
                .input,
            Some(Input::Stdin)
        ));
    }

    #[test]
    fn payload_is_one_bounded_json_object_and_does_not_echo_private_text() {
        assert_eq!(
            arguments(Some(Input::Json("{\"kind\":\"materials\"}".into()))).unwrap()["kind"],
            "materials"
        );
        for value in [
            "[]".to_owned(),
            "{\"secret\": broken".into(),
            "{}{}".into(),
            " ".repeat(MAX_REQUEST_BODY + 1),
        ] {
            assert_eq!(
                arguments(Some(Input::Json(value))).unwrap_err(),
                "invalid-arguments"
            );
        }
        assert!(read_bounded(&vec![b' '; MAX_REQUEST_BODY][..]).is_ok());
        assert!(read_bounded(&vec![b' '; MAX_REQUEST_BODY + 1][..]).is_err());
        assert_eq!(exit_code("operation-conflict"), 1);
        assert_eq!(exit_code("permission-denied"), 3);
        assert_eq!(exit_code("backup-failed"), 4);
    }

    #[tokio::test]
    async fn cli_uses_the_authenticated_current_host_and_preserves_operation_receipts() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("用户 with spaces.connection.json");
        let bridge = Arc::new(Mcp::with_connection_file(path.clone()));
        let (send, mut receive) = tokio::sync::mpsc::unbounded_channel::<BridgeRequest>();
        let attachment = bridge.attach(Arc::new(move |request| send.send(request).map_err(|_| ())));
        bridge
            .workspace(
                &attachment,
                Workspace {
                    scope: "local:cli-test".into(),
                    scope_epoch: 1,
                    sequence: 1,
                    available: true,
                    ready: Some(true),
                    automation: Grant {
                        read_enabled: true,
                        write_enabled: true,
                    },
                },
            )
            .unwrap();
        bridge.start().await.unwrap();
        let payload = json!({"operationId":"saved-once"})
            .as_object()
            .unwrap()
            .clone();
        let response = execute(
            Options {
                command: "operation".into(),
                connection: Some(path.clone()),
                input: None,
            },
            payload.clone(),
        );
        let answer = async {
            let request = receive.recv().await.unwrap();
            assert_eq!(request.scope, "local:cli-test");
            assert_eq!(request.query.tool, "repeaty_operation_status");
            assert_eq!(request.query.arguments, payload);
            bridge
                .reply(
                    &request.id,
                    &request.scope,
                    Reply::Ok {
                        data: json!({"operationId":"saved-once","revision":9,"replayed":true}),
                    },
                )
                .unwrap();
        };
        let (result, _) = tokio::join!(response, answer);
        assert_eq!(result.unwrap()["revision"], 9);
        bridge
            .workspace(
                &attachment,
                Workspace {
                    scope: "local:cli-test".into(),
                    scope_epoch: 1,
                    sequence: 2,
                    available: true,
                    ready: Some(true),
                    automation: Default::default(),
                },
            )
            .unwrap();
        let rejected = execute(
            Options {
                command: "query".into(),
                connection: Some(path.clone()),
                input: None,
            },
            Map::new(),
        )
        .await;
        assert_eq!(rejected.unwrap_err(), "permission-denied");
        assert!(receive.try_recv().is_err());
        bridge.stop();
        let offline = execute(
            Options {
                command: "status".into(),
                connection: Some(path),
                input: None,
            },
            Map::new(),
        )
        .await;
        assert_eq!(offline.unwrap_err(), "library-unavailable");
    }
}
