use crate::error::McpError;
use crate::protocol::{JsonRpcNotification, JsonRpcRequest, JsonRpcResponse};
use crate::transport::McpTransport;
use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tokio::sync::Mutex;

/// MCP transport using the Streamable HTTP protocol (MCP spec 2025-03-26).
///
/// Each request is an independent HTTP POST to the server URL.
/// The server may respond with `application/json` (single response) or
/// `text/event-stream` (SSE stream containing the response).
/// No background listener task is needed - simpler than the legacy SSE transport.
pub struct StreamableHttpTransport {
    /// The server URL to POST requests to.
    url: String,
    /// HTTP headers for requests.
    headers: HashMap<String, String>,
    /// Session ID tracked from `Mcp-Session-Id` response header.
    session_id: Arc<Mutex<Option<String>>>,
    /// Next request ID.
    next_id: AtomicU64,
    /// Whether the transport is alive.
    alive: Arc<AtomicBool>,
    /// HTTP client.
    client: reqwest::Client,
}

impl StreamableHttpTransport {
    /// Create a new Streamable HTTP transport.
    pub fn new(url: &str, headers: &HashMap<String, String>) -> Self {
        Self {
            url: url.to_string(),
            headers: headers.clone(),
            session_id: Arc::new(Mutex::new(None)),
            next_id: AtomicU64::new(1),
            alive: Arc::new(AtomicBool::new(true)),
            client: reqwest::Client::new(),
        }
    }

    /// Build a POST request with the standard headers.
    fn build_post(&self) -> reqwest::RequestBuilder {
        let mut builder = self
            .client
            .post(&self.url)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream");

        for (key, val) in &self.headers {
            builder = builder.header(key, val);
        }

        builder
    }

    /// Track the session ID from response headers.
    async fn track_session_id(&self, response: &reqwest::Response) {
        if let Some(session_id) = response.headers().get("mcp-session-id")
            && let Ok(val) = session_id.to_str()
        {
            let mut sid = self.session_id.lock().await;
            *sid = Some(val.to_string());
        }
    }

    /// Add session ID header to a request builder if we have one.
    async fn with_session_id(
        &self,
        mut builder: reqwest::RequestBuilder,
    ) -> reqwest::RequestBuilder {
        let sid = self.session_id.lock().await;
        if let Some(ref id) = *sid {
            builder = builder.header("Mcp-Session-Id", id);
        }
        builder
    }

    /// Parse a JSON-RPC response from either a JSON body or an SSE stream.
    async fn parse_response(
        &self,
        response: reqwest::Response,
    ) -> Result<JsonRpcResponse, McpError> {
        self.track_session_id(&response).await;

        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        if content_type.contains("text/event-stream") {
            self.parse_sse_response(response).await
        } else {
            // Default: parse as JSON
            let body = response.text().await.map_err(|e| {
                McpError::ConnectionFailed(format!("Failed to read response body: {e}"))
            })?;
            serde_json::from_str::<JsonRpcResponse>(&body).map_err(|e| {
                McpError::InvalidResponse(format!("Failed to parse JSON response: {e}"))
            })
        }
    }

    /// Parse an SSE response stream, extracting the last "message" event as a JsonRpcResponse.
    ///
    /// Properly handles chunk boundaries by accumulating raw bytes into a line buffer
    /// and only processing complete lines (terminated by `\n`).
    async fn parse_sse_response(
        &self,
        response: reqwest::Response,
    ) -> Result<JsonRpcResponse, McpError> {
        use futures_util::StreamExt;

        let mut stream = response.bytes_stream();
        // Accumulates raw bytes across chunks to handle split lines
        let mut raw_buf = String::new();
        // Data payload for the current SSE event (multiple `data:` lines joined with \n)
        let mut data_buf = String::new();
        let mut event_type = String::new();
        let mut last_response: Option<JsonRpcResponse> = None;

        while let Some(chunk) = stream.next().await {
            let chunk =
                chunk.map_err(|e| McpError::ConnectionFailed(format!("SSE stream error: {e}")))?;

            raw_buf.push_str(&String::from_utf8_lossy(&chunk));

            // Process all complete lines (terminated by \n)
            while let Some(newline_pos) = raw_buf.find('\n') {
                let line = raw_buf[..newline_pos].trim_end_matches('\r').to_string();
                raw_buf = raw_buf[newline_pos + 1..].to_string();

                if let Some(rest) = line.strip_prefix("event:") {
                    event_type = rest.trim().to_string();
                } else if let Some(rest) = line.strip_prefix("data:") {
                    // SSE spec: multiple data lines are joined with \n
                    if !data_buf.is_empty() {
                        data_buf.push('\n');
                    }
                    data_buf.push_str(rest.strip_prefix(' ').unwrap_or(rest));
                } else if line.is_empty() && !data_buf.is_empty() {
                    // Empty line = end of SSE event
                    if (event_type == "message" || event_type.is_empty())
                        && let Ok(resp) = serde_json::from_str::<JsonRpcResponse>(&data_buf)
                    {
                        last_response = Some(resp);
                    }
                    data_buf.clear();
                    event_type.clear();
                }
            }
        }

        // Check remaining buffer (stream may end without trailing blank line)
        if !data_buf.is_empty()
            && (event_type == "message" || event_type.is_empty())
            && let Ok(resp) = serde_json::from_str::<JsonRpcResponse>(&data_buf)
        {
            last_response = Some(resp);
        }

        last_response.ok_or_else(|| {
            McpError::InvalidResponse("No JSON-RPC response found in SSE stream".into())
        })
    }
}

#[async_trait]
impl McpTransport for StreamableHttpTransport {
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

        let builder = self.build_post().json(&request);
        let builder = self.with_session_id(builder).await;

        let response = builder
            .send()
            .await
            .map_err(|e| McpError::ConnectionFailed(format!("POST request failed: {e}")))?;

        if !response.status().is_success() {
            return Err(McpError::ConnectionFailed(format!(
                "Server returned status {}",
                response.status()
            )));
        }

        let rpc_response = self.parse_response(response).await?;

        if let Some(err) = rpc_response.error {
            return Err(McpError::ProtocolError(err.to_string()));
        }

        rpc_response
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

        let builder = self.build_post().json(&notification);
        let builder = self.with_session_id(builder).await;

        let response = builder
            .send()
            .await
            .map_err(|e| McpError::ConnectionFailed(format!("POST notification failed: {e}")))?;

        // Accept 200 or 202 for notifications
        if !response.status().is_success() {
            return Err(McpError::ConnectionFailed(format!(
                "Notification failed with status {}",
                response.status()
            )));
        }

        // Track session ID from notification responses too
        self.track_session_id(&response).await;

        Ok(())
    }

    fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    async fn close(&self) -> Result<(), McpError> {
        self.alive.store(false, Ordering::SeqCst);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transport_starts_alive() {
        let transport = StreamableHttpTransport::new("http://localhost:8080/mcp", &HashMap::new());
        assert!(transport.is_alive());
    }

    #[tokio::test]
    async fn close_marks_not_alive() {
        let transport = StreamableHttpTransport::new("http://localhost:8080/mcp", &HashMap::new());
        transport.close().await.unwrap();
        assert!(!transport.is_alive());
    }

    #[tokio::test]
    async fn request_fails_when_closed() {
        let transport = StreamableHttpTransport::new("http://localhost:8080/mcp", &HashMap::new());
        transport.close().await.unwrap();
        let err = transport.request("test", None).await.unwrap_err();
        assert!(matches!(err, McpError::ServerDisconnected));
    }

    #[tokio::test]
    async fn notify_fails_when_closed() {
        let transport = StreamableHttpTransport::new("http://localhost:8080/mcp", &HashMap::new());
        transport.close().await.unwrap();
        let err = transport.notify("test", None).await.unwrap_err();
        assert!(matches!(err, McpError::ServerDisconnected));
    }

    #[tokio::test]
    async fn session_id_starts_none() {
        let transport = StreamableHttpTransport::new("http://localhost:8080/mcp", &HashMap::new());
        let sid = transport.session_id.lock().await;
        assert!(sid.is_none());
    }
}
