use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{Mutex, mpsc, oneshot};
use tracing::{debug, error, info, warn};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: u64,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<Value>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct McpTool {
    pub name: String,
    pub description: Option<String>,
    #[serde(rename = "inputSchema")]
    pub input_schema: Value,
}
pub struct McpClient {
    _child: Mutex<Option<Child>>,
    next_id: AtomicU64,
    pending_requests: Arc<Mutex<HashMap<u64, oneshot::Sender<JsonRpcResponse>>>>,
    tx_req: mpsc::Sender<String>,
    stderr: Arc<Mutex<String>>,
}

impl McpClient {
    pub async fn new(
        server_name: &str,
        command: &str,
        args: Vec<String>,
        env: HashMap<String, String>,
    ) -> Result<Arc<Self>> {
        info!("Starting MCP Server: {} ({})", server_name, command);

        let mut child = Command::new(command)
            .args(args)
            .envs(env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| anyhow!("Failed to open MCP stdin"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow!("Failed to open MCP stdout"))?;
        let stderr_pipe = child.stderr.take();

        // Channels for writing to stdin and tracking responses
        let (tx_req, mut rx_req) = mpsc::channel::<String>(100);
        let pending_requests = Arc::new(Mutex::new(HashMap::new()));
        let stderr_buf = Arc::new(Mutex::new(String::new()));

        let client = Arc::new(Self {
            _child: Mutex::new(Some(child)),
            next_id: AtomicU64::new(1),
            pending_requests: pending_requests.clone(),
            tx_req,
            stderr: stderr_buf.clone(),
        });

        // Spawn JSON Writer
        let mut stdin_writer = tokio::io::BufWriter::new(stdin);
        tokio::spawn(async move {
            while let Some(msg) = rx_req.recv().await {
                debug!("MCP TX: {}", msg);
                if let Err(e) = stdin_writer
                    .write_all(format!("{}\n", msg).as_bytes())
                    .await
                {
                    error!("Failed to write to MCP stdin: {}", e);
                    break;
                }
                let _ = stdin_writer.flush().await;
            }
        });

        // Spawn JSON Reader
        let pending = pending_requests.clone();
        let server_name_inner = server_name.to_string();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(line_res) = reader.next_line().await {
                match line_res {
                    Some(line) => {
                        debug!("MCP RX [{}]: {}", server_name_inner, line);
                        if let Ok(resp) = serde_json::from_str::<JsonRpcResponse>(&line) {
                            let mut p = pending.lock().await;
                            if let Some(tx) = p.remove(&resp.id) {
                                let _ = tx.send(resp);
                            }
                        } else {
                            warn!("Unparsed MCP RX [{}]: {}", server_name_inner, line);
                        }
                    }
                    None => break,
                }
            }
            warn!("MCP stdout closed for server [{}].", server_name_inner);
            // Fail all pending requests
            let mut p = pending.lock().await;
            p.clear();
        });

        // Spawn Stderr Reader
        let stderr_log = client.stderr.clone();
        if let Some(stderr_pipe) = stderr_pipe {
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr_pipe).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    let mut s = stderr_log.lock().await;
                    if s.len() < 2000 {
                        s.push_str(&line);
                        s.push('\n');
                    }
                    debug!("MCP STDERR: {}", line);
                }
            });
        }

        // Initialize Call with timeout
        match tokio::time::timeout(std::time::Duration::from_secs(15), client.initialize()).await {
            Err(_elapsed) => {
                let err_log = client.stderr.lock().await;
                error!(
                    "MCP Server [{}] failed to initialize (timeout). Stderr: {}",
                    server_name, err_log
                );
                return Err(anyhow!(
                    "MCP Initialization timeout for [{}]. Stderr: {}",
                    server_name,
                    err_log
                ));
            }
            Ok(Err(e)) => {
                let err_log = client.stderr.lock().await;
                error!(
                    "MCP Server [{}] failed to initialize: {}. Stderr: {}",
                    server_name, e, err_log
                );
                return Err(anyhow!(
                    "MCP Initialization failed for [{}]: {}. Stderr: {}",
                    server_name,
                    e,
                    err_log
                ));
            }
            Ok(Ok(())) => {
                info!("MCP Server [{}] initialized successfully", server_name);
            }
        }

        Ok(client)
    }

    pub async fn call(&self, method: &str, params: Option<Value>) -> Result<Value> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id,
            method: method.to_string(),
            params,
        };

        let req_str = serde_json::to_string(&req)?;
        let (tx, rx) = oneshot::channel();

        {
            let mut p = self.pending_requests.lock().await;
            p.insert(id, tx);
        }

        self.tx_req.send(req_str).await?;

        // Wait for response
        let resp = rx.await?;
        if let Some(error) = resp.error {
            return Err(anyhow!("MCP RPC Error: {:?}", error));
        }

        resp.result.ok_or_else(|| anyhow!("MCP RPC Missing result"))
    }

    async fn initialize(&self) -> Result<()> {
        let params = serde_json::json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {
                "roots": { "listChanged": true },
                "sampling": {}
            },
            "clientInfo": {
                "name": "moxxy",
                "version": "0.1.0"
            }
        });

        let resp = self.call("initialize", Some(params)).await?;
        debug!("MCP Initialized: {:?}", resp);

        // Send 'initialized' notification as required by the protocol
        let notif_str = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        })
        .to_string();
        self.tx_req.send(notif_str).await?;

        Ok(())
    }

    pub async fn list_tools(&self) -> Result<Vec<McpTool>> {
        let result = self.call("tools/list", None).await?;
        if let Some(tools_arr) = result.get("tools").and_then(|t| t.as_array()) {
            let tools: Vec<McpTool> = tools_arr
                .iter()
                .filter_map(|t| serde_json::from_value(t.clone()).ok())
                .collect();
            Ok(tools)
        } else {
            Ok(vec![])
        }
    }

    pub async fn call_tool(&self, name: &str, arguments: Value) -> Result<Value> {
        let params = serde_json::json!({
            "name": name,
            "arguments": arguments
        });
        self.call("tools/call", Some(params)).await
    }
}
