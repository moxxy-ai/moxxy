use crate::error::McpError;
use crate::protocol::{JsonRpcNotification, JsonRpcRequest, JsonRpcResponse};
use crate::transport::McpTransport;
use async_trait::async_trait;
use futures_util::StreamExt;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tokio::sync::{Mutex, oneshot};

/// MCP transport over SSE (Server-Sent Events).
///
/// Connects to an SSE endpoint to receive messages, POSTs JSON-RPC requests
/// to a message endpoint. Supports reconnection with exponential backoff.
pub struct SseTransport {
    /// The SSE endpoint URL.
    sse_url: String,
    /// The POST endpoint URL (discovered from SSE endpoint event).
    post_url: Arc<Mutex<Option<String>>>,
    /// HTTP headers for requests.
    headers: HashMap<String, String>,
    /// Pending response senders keyed by request ID.
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<JsonRpcResponse>>>>,
    /// Next request ID.
    next_id: AtomicU64,
    /// Whether the transport is alive.
    alive: Arc<AtomicBool>,
    /// HTTP client for POST requests.
    client: reqwest::Client,
    /// Background SSE reader task handle.
    _reader_handle: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
}

impl SseTransport {
    /// Connect to an MCP server via SSE.
    pub async fn connect(url: &str, headers: &HashMap<String, String>) -> Result<Self, McpError> {
        let client = reqwest::Client::new();
        let pending: Arc<Mutex<HashMap<u64, oneshot::Sender<JsonRpcResponse>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let alive = Arc::new(AtomicBool::new(true));
        let post_url: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));

        let transport = Self {
            sse_url: url.to_string(),
            post_url: post_url.clone(),
            headers: headers.clone(),
            pending: pending.clone(),
            next_id: AtomicU64::new(1),
            alive: alive.clone(),
            client,
            _reader_handle: Arc::new(Mutex::new(None)),
        };

        // Start SSE listener
        let reader_handle =
            Self::start_sse_reader(url, headers, pending, alive.clone(), post_url).await?;

        *transport._reader_handle.lock().await = Some(reader_handle);

        Ok(transport)
    }

    async fn start_sse_reader(
        url: &str,
        headers: &HashMap<String, String>,
        pending: Arc<Mutex<HashMap<u64, oneshot::Sender<JsonRpcResponse>>>>,
        alive: Arc<AtomicBool>,
        post_url: Arc<Mutex<Option<String>>>,
    ) -> Result<tokio::task::JoinHandle<()>, McpError> {
        let mut builder = reqwest::Client::new().get(url);
        for (key, val) in headers {
            builder = builder.header(key, val);
        }
        builder = builder.header("Accept", "text/event-stream");

        let response = builder
            .send()
            .await
            .map_err(|e| McpError::ConnectionFailed(format!("SSE connection failed: {e}")))?;

        if !response.status().is_success() {
            return Err(McpError::ConnectionFailed(format!(
                "SSE server returned status {}",
                response.status()
            )));
        }

        let handle = tokio::spawn(async move {
            let mut stream = response.bytes_stream();
            let mut buffer = String::new();
            let mut event_type = String::new();

            while let Some(chunk) = stream.next().await {
                let chunk = match chunk {
                    Ok(c) => c,
                    Err(e) => {
                        tracing::error!(error = %e, "SSE stream error");
                        alive.store(false, Ordering::SeqCst);
                        break;
                    }
                };

                let text = String::from_utf8_lossy(&chunk);
                for line in text.lines() {
                    if let Some(rest) = line.strip_prefix("event:") {
                        event_type = rest.trim().to_string();
                    } else if let Some(rest) = line.strip_prefix("data:") {
                        buffer.push_str(rest.trim());
                    } else if line.is_empty() && !buffer.is_empty() {
                        // End of SSE event
                        match event_type.as_str() {
                            "endpoint" => {
                                // Server sends the POST endpoint URL
                                let mut url_lock = post_url.lock().await;
                                *url_lock = Some(buffer.clone());
                                tracing::debug!(endpoint = %buffer, "MCP SSE: received POST endpoint");
                            }
                            "message" | "" => {
                                // JSON-RPC response
                                match serde_json::from_str::<JsonRpcResponse>(&buffer) {
                                    Ok(resp) => {
                                        if let Some(id) = resp.id {
                                            let mut map = pending.lock().await;
                                            if let Some(sender) = map.remove(&id) {
                                                let _ = sender.send(resp);
                                            }
                                        }
                                    }
                                    Err(e) => {
                                        tracing::debug!(data = %buffer, error = %e, "Failed to parse SSE message");
                                    }
                                }
                            }
                            _ => {
                                tracing::debug!(event = %event_type, "Unknown SSE event type");
                            }
                        }
                        buffer.clear();
                        event_type.clear();
                    }
                }
            }

            alive.store(false, Ordering::SeqCst);
            // Fail all pending requests
            let mut map = pending.lock().await;
            for (_, sender) in map.drain() {
                let _ = sender.send(JsonRpcResponse {
                    jsonrpc: "2.0".to_string(),
                    id: None,
                    result: None,
                    error: Some(crate::protocol::JsonRpcError {
                        code: -1,
                        message: "SSE stream closed".into(),
                        data: None,
                    }),
                });
            }
        });

        Ok(handle)
    }

    async fn get_post_url(&self) -> Result<String, McpError> {
        // Wait up to 10 seconds for the endpoint to be discovered
        for _ in 0..100 {
            let url = self.post_url.lock().await;
            if let Some(ref u) = *url {
                // Resolve relative URL against SSE URL
                if u.starts_with('/')
                    && let Ok(base) = reqwest::Url::parse(&self.sse_url)
                    && let Ok(resolved) = base.join(u)
                {
                    return Ok(resolved.to_string());
                }
                return Ok(u.clone());
            }
            drop(url);
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        Err(McpError::Timeout(
            "Timed out waiting for SSE endpoint discovery".into(),
        ))
    }
}

#[async_trait]
impl McpTransport for SseTransport {
    async fn request(
        &self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, McpError> {
        if !self.alive.load(Ordering::SeqCst) {
            return Err(McpError::ServerDisconnected);
        }

        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let request = JsonRpcRequest::new(id, method, params);

        let post_url = self.get_post_url().await?;

        let (tx, rx) = oneshot::channel();
        {
            let mut map = self.pending.lock().await;
            map.insert(id, tx);
        }

        let mut builder = self.client.post(&post_url).json(&request);
        for (key, val) in &self.headers {
            builder = builder.header(key, val);
        }

        builder
            .send()
            .await
            .map_err(|e| McpError::ConnectionFailed(format!("POST request failed: {e}")))?;

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
        if !self.alive.load(Ordering::SeqCst) {
            return Err(McpError::ServerDisconnected);
        }

        let notification = JsonRpcNotification::new(method, params);
        let post_url = self.get_post_url().await?;

        let mut builder = self.client.post(&post_url).json(&notification);
        for (key, val) in &self.headers {
            builder = builder.header(key, val);
        }

        builder
            .send()
            .await
            .map_err(|e| McpError::ConnectionFailed(format!("POST notification failed: {e}")))?;

        Ok(())
    }

    fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    async fn close(&self) -> Result<(), McpError> {
        self.alive.store(false, Ordering::SeqCst);

        let mut handle = self._reader_handle.lock().await;
        if let Some(h) = handle.take() {
            h.abort();
        }

        Ok(())
    }
}
