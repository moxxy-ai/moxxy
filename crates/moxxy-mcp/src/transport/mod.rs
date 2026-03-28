pub mod sse;
pub mod stdio;
pub mod streamable_http;

use crate::error::McpError;
use async_trait::async_trait;

/// Transport abstraction for MCP communication.
#[async_trait]
pub trait McpTransport: Send + Sync {
    /// Send a JSON-RPC request and wait for the response.
    async fn request(
        &self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, McpError>;

    /// Send a JSON-RPC notification (no response expected).
    async fn notify(&self, method: &str, params: Option<serde_json::Value>)
    -> Result<(), McpError>;

    /// Check if the transport is still alive.
    fn is_alive(&self) -> bool;

    /// Close the transport connection.
    async fn close(&self) -> Result<(), McpError>;
}
