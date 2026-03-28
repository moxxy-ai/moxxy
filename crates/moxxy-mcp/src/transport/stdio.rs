use crate::error::McpError;
use crate::protocol::{JsonRpcNotification, JsonRpcRequest, JsonRpcResponse};
use crate::transport::McpTransport;
use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{Mutex, oneshot};

/// MCP transport over stdio (spawns a child process).
///
/// Sends JSON-RPC messages via stdin, reads responses from stdout (line-delimited JSON).
/// A background task reads stdout lines and dispatches responses to waiting callers.
pub struct StdioTransport {
    stdin: Arc<Mutex<tokio::process::ChildStdin>>,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<JsonRpcResponse>>>>,
    next_id: AtomicU64,
    alive: Arc<AtomicBool>,
    child: Arc<Mutex<Child>>,
    _reader_handle: tokio::task::JoinHandle<()>,
}

impl StdioTransport {
    /// Spawn a child process and set up the stdio transport.
    pub async fn spawn(
        command: &str,
        args: &[String],
        env: &HashMap<String, String>,
    ) -> Result<Self, McpError> {
        let mut cmd = Command::new(command);
        cmd.args(args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null());

        for (key, val) in env {
            cmd.env(key, val);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| McpError::ConnectionFailed(format!("Failed to spawn '{command}': {e}")))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| McpError::ConnectionFailed("Failed to get stdin".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| McpError::ConnectionFailed("Failed to get stdout".into()))?;

        let pending: Arc<Mutex<HashMap<u64, oneshot::Sender<JsonRpcResponse>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let alive = Arc::new(AtomicBool::new(true));

        let pending_clone = pending.clone();
        let alive_clone = alive.clone();

        // Background task: read stdout lines and dispatch JSON-RPC responses
        let reader_handle = tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();

            loop {
                match lines.next_line().await {
                    Ok(Some(line)) => {
                        let line = line.trim().to_string();
                        if line.is_empty() {
                            continue;
                        }
                        match serde_json::from_str::<JsonRpcResponse>(&line) {
                            Ok(resp) => {
                                if let Some(id) = resp.id {
                                    let mut map = pending_clone.lock().await;
                                    if let Some(sender) = map.remove(&id) {
                                        let _ = sender.send(resp);
                                    }
                                }
                                // Notifications from server (no id) are silently ignored for now
                            }
                            Err(e) => {
                                tracing::debug!(line = %line, error = %e, "Failed to parse JSON-RPC response from MCP server");
                            }
                        }
                    }
                    Ok(None) => {
                        // stdout closed - process exited
                        tracing::info!("MCP stdio transport: stdout closed");
                        alive_clone.store(false, Ordering::SeqCst);

                        // Fail all pending requests
                        let mut map = pending_clone.lock().await;
                        for (_, sender) in map.drain() {
                            let _ = sender.send(JsonRpcResponse {
                                jsonrpc: "2.0".to_string(),
                                id: None,
                                result: None,
                                error: Some(crate::protocol::JsonRpcError {
                                    code: -1,
                                    message: "Server disconnected".into(),
                                    data: None,
                                }),
                            });
                        }
                        break;
                    }
                    Err(e) => {
                        tracing::error!(error = %e, "MCP stdio transport: read error");
                        alive_clone.store(false, Ordering::SeqCst);
                        break;
                    }
                }
            }
        });

        Ok(Self {
            stdin: Arc::new(Mutex::new(stdin)),
            pending,
            next_id: AtomicU64::new(1),
            alive,
            child: Arc::new(Mutex::new(child)),
            _reader_handle: reader_handle,
        })
    }

    async fn send_raw(&self, data: &[u8]) -> Result<(), McpError> {
        if !self.alive.load(Ordering::SeqCst) {
            return Err(McpError::ServerDisconnected);
        }
        let mut stdin = self.stdin.lock().await;
        stdin
            .write_all(data)
            .await
            .map_err(|e| McpError::ConnectionFailed(format!("Write to stdin failed: {e}")))?;
        stdin
            .write_all(b"\n")
            .await
            .map_err(|e| McpError::ConnectionFailed(format!("Write newline failed: {e}")))?;
        stdin
            .flush()
            .await
            .map_err(|e| McpError::ConnectionFailed(format!("Flush stdin failed: {e}")))?;
        Ok(())
    }
}

#[async_trait]
impl McpTransport for StdioTransport {
    async fn request(
        &self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, McpError> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let request = JsonRpcRequest::new(id, method, params);
        let data = serde_json::to_vec(&request)?;

        let (tx, rx) = oneshot::channel();
        {
            let mut map = self.pending.lock().await;
            map.insert(id, tx);
        }

        self.send_raw(&data).await?;

        let response = tokio::time::timeout(std::time::Duration::from_secs(30), rx)
            .await
            .map_err(|_| McpError::Timeout(format!("Request '{method}' timed out after 30s")))?
            .map_err(|_| McpError::ServerDisconnected)?;

        if let Some(err) = response.error {
            return Err(McpError::ProtocolError(err.to_string()));
        }

        response
            .result
            .ok_or_else(|| McpError::InvalidResponse("No result in response".into()))
    }

    async fn notify(
        &self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<(), McpError> {
        let notification = JsonRpcNotification::new(method, params);
        let data = serde_json::to_vec(&notification)?;
        self.send_raw(&data).await
    }

    fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    async fn close(&self) -> Result<(), McpError> {
        self.alive.store(false, Ordering::SeqCst);

        // Send shutdown notification
        let _ = self.notify("notifications/cancelled", None).await;

        // Try graceful shutdown: wait up to 5 seconds, then kill
        let mut child = self.child.lock().await;
        let kill_result =
            tokio::time::timeout(std::time::Duration::from_secs(5), child.wait()).await;

        match kill_result {
            Ok(Ok(_)) => {}
            _ => {
                let _ = child.kill().await;
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn spawn_nonexistent_command_fails() {
        let result = StdioTransport::spawn("nonexistent_command_xyz", &[], &HashMap::new()).await;
        assert!(result.is_err());
        match result {
            Err(McpError::ConnectionFailed(_)) => {}
            _ => panic!("Expected ConnectionFailed error"),
        }
    }

    #[tokio::test]
    async fn spawn_echo_and_close() {
        // Use 'cat' as a simple echo server - it reads stdin and writes to stdout
        let transport = StdioTransport::spawn("cat", &[], &HashMap::new()).await;
        if let Ok(transport) = transport {
            assert!(transport.is_alive());
            transport.close().await.unwrap();
        }
    }
}
