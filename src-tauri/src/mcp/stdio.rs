//! Headless stdio facade for local AI clients. Every call resolves the current UI-owned listener.
use super::{
    MAX_PENDING, MAX_REQUEST_BODY, MAX_RESULT, Reader, connection::Connection, tools,
    valid_arguments,
};
use rmcp::{
    ErrorData, RoleServer, ServerHandler, ServiceExt,
    model::{
        CallToolRequestParams, CallToolResponse, CallToolResult, ListToolsResult,
        PaginatedRequestParams, ServerConfig,
    },
    service::RequestContext,
    transport::{
        StreamableHttpClientTransport, streamable_http_client::StreamableHttpClientTransportConfig,
    },
};
use serde_json::json;
use std::{
    ffi::OsString,
    path::PathBuf,
    pin::Pin,
    sync::Arc,
    task::{Context, Poll},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, ReadBuf},
    sync::Semaphore,
};

#[derive(Clone)]
struct Proxy {
    path: PathBuf,
    slots: Arc<Semaphore>,
}
impl Proxy {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            slots: Arc::new(Semaphore::new(MAX_PENDING)),
        }
    }
    async fn call(&self, request: CallToolRequestParams) -> Result<CallToolResult, &'static str> {
        let _slot = self.slots.try_acquire().map_err(|_| "too-many-requests")?;
        let connection = Connection::read(&self.path)?;
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(8))
            .build()
            .map_err(|_| "library-unavailable")?;
        let config = StreamableHttpClientTransportConfig::with_uri(connection.url)
            .auth_header(connection.token);
        let transport = StreamableHttpClientTransport::with_client(client, config);
        let server = ().serve(transport).await.map_err(|_| "library-unavailable")?;
        let response = server
            .call_tool(request)
            .await
            .map_err(|_| "library-unavailable");
        let _ = server.cancel().await;
        let response = response?;
        if serde_json::to_vec(&response)
            .map_err(|_| "library-unavailable")?
            .len()
            > MAX_RESULT
        {
            return Err("library-unavailable");
        }
        Ok(response)
    }
}
impl ServerHandler for Proxy {
    fn get_info(&self) -> ServerConfig {
        Reader::info()
    }
    async fn list_tools(
        &self,
        request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        if request.is_some_and(|request| request.cursor.is_some()) {
            return Err(ErrorData::invalid_params("No further tool pages", None));
        }
        Ok(ListToolsResult::with_all_items(tools()))
    }
    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        if !valid_arguments(
            &request.name,
            request.arguments.as_ref().unwrap_or(&Default::default()),
        ) {
            return Ok(
                CallToolResult::structured_error(json!({"code":"invalid-arguments"})).into(),
            );
        }
        let result = tokio::select! {
            response = tokio::time::timeout(Duration::from_secs(10), self.call(request)) => response.unwrap_or(Err("read-timeout")),
            _ = context.ct.cancelled() => Err("library-unavailable"),
        };
        Ok(match result {
            Ok(response) => response,
            Err(code) => CallToolResult::structured_error(json!({"code":code})),
        }
        .into())
    }
}

// The SDK's stdio reader has no line limit. Bound each JSON-RPC frame before parsing it.
struct BoundedInput<R> {
    input: R,
    length: usize,
}
impl<R: AsyncRead + Unpin> AsyncRead for BoundedInput<R> {
    fn poll_read(
        self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        let this = self.get_mut();
        let before = buffer.filled().len();
        match Pin::new(&mut this.input).poll_read(context, buffer) {
            Poll::Ready(Ok(())) => {
                for byte in &buffer.filled()[before..] {
                    if *byte == b'\n' {
                        this.length = 0;
                    } else {
                        this.length += 1;
                        if this.length > MAX_REQUEST_BODY {
                            buffer.set_filled(before);
                            return Poll::Ready(Err(std::io::Error::new(
                                std::io::ErrorKind::InvalidData,
                                "MCP request exceeds 512 KiB",
                            )));
                        }
                    }
                }
                Poll::Ready(Ok(()))
            }
            other => other,
        }
    }
}

pub fn run(arguments: Vec<OsString>) -> Result<(), &'static str> {
    if arguments.len() != 2
        || arguments[0] != "--connection-file"
        || !PathBuf::from(&arguments[1]).is_absolute()
    {
        return Err("usage: --mcp-stdio --connection-file <absolute path>");
    }
    let path = PathBuf::from(&arguments[1]);
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|_| "unable to start stdio runtime")?;
    runtime.block_on(async move {
        let (input, output) = rmcp::transport::stdio();
        let service = Proxy::new(path)
            .serve((BoundedInput { input, length: 0 }, output))
            .await
            .map_err(|_| "stdio initialization failed")?;
        service
            .waiting()
            .await
            .map_err(|_| "stdio connection closed")?;
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::super::{BridgeRequest, Mcp, Reply, Workspace};
    use super::*;
    use rmcp::model::CallToolRequestParams;
    use tokio::io::AsyncReadExt;

    #[tokio::test]
    async fn stdio_discovers_tools_while_offline_and_reconnects_after_listener_rotation() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("connection.json");
        let proxy = Proxy::new(path.clone());
        let (client_io, server_io) = tokio::io::duplex(8192);
        let server = tokio::spawn(async move {
            proxy
                .serve(server_io)
                .await
                .unwrap()
                .waiting()
                .await
                .unwrap()
        });
        let client = ().serve(client_io).await.unwrap();
        assert_eq!(client.list_tools(None).await.unwrap().tools.len(), 5);
        let response = client
            .call_tool(CallToolRequestParams::new("repeaty_study_stats"))
            .await
            .unwrap();
        assert_eq!(
            response.structured_content.unwrap()["code"],
            "library-unavailable"
        );
        let (send, mut receive) = tokio::sync::mpsc::unbounded_channel::<BridgeRequest>();
        let bridge = Arc::new(Mcp::with_connection_file(path));
        let attachment = bridge.attach(Arc::new(move |request| send.send(request).map_err(|_| ())));
        bridge
            .workspace(
                &attachment,
                Workspace {
                    scope: "local:repeaty".into(),
                    scope_epoch: 1,
                    sequence: 1,
                    available: true,
                },
            )
            .unwrap();
        for revision in [7, 8] {
            bridge.start().await.unwrap();
            let call = client.call_tool(CallToolRequestParams::new("repeaty_study_stats"));
            let respond = async {
                let request = receive.recv().await.unwrap();
                bridge
                    .reply(
                        &request.id,
                        &request.scope,
                        Reply::Ok {
                            data: json!({"revision":revision,"totals":{"cards":2}}),
                        },
                    )
                    .unwrap();
            };
            let (response, _) = tokio::join!(call, respond);
            assert_eq!(
                response.unwrap().structured_content.unwrap()["revision"],
                revision
            );
            bridge.stop();
            let response = client
                .call_tool(CallToolRequestParams::new("repeaty_selected_excerpt"))
                .await
                .unwrap();
            assert_eq!(
                response.structured_content.unwrap()["code"],
                "library-unavailable"
            );
        }
        client.cancel().await.unwrap();
        server.await.unwrap();
    }

    #[tokio::test]
    async fn input_is_bounded_per_frame_without_limiting_a_long_lived_session() {
        let input = [
            vec![b'x'; MAX_REQUEST_BODY - 1],
            vec![b'\n'],
            vec![b'y'; MAX_REQUEST_BODY - 1],
            vec![b'\n'],
        ]
        .concat();
        let mut reader = BoundedInput {
            input: input.as_slice(),
            length: 0,
        };
        let mut received = Vec::new();
        reader.read_to_end(&mut received).await.unwrap();
        assert_eq!(received, input);
        let input = vec![b'x'; MAX_REQUEST_BODY + 1];
        let mut reader = BoundedInput {
            input: input.as_slice(),
            length: 0,
        };
        assert!(reader.read_to_end(&mut Vec::new()).await.is_err());
    }
}
