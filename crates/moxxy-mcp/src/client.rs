use crate::error::McpError;
use crate::transport::McpTransport;
use moxxy_types::mcp::{McpServerConfig, McpToolDefinition, McpTransportType};
use std::collections::HashMap;
use std::sync::Arc;

/// MCP client capabilities sent during initialization.
const CLIENT_INFO: &str = "moxxy-mcp";
const CLIENT_VERSION: &str = "1.0.0";
const PROTOCOL_VERSION: &str = "2025-03-26";

/// High-level MCP client that manages a single server connection.
///
/// Handles the initialization handshake, tool discovery, and tool invocation.
pub struct McpClient {
    transport: Arc<dyn McpTransport>,
    server_id: String,
    tools: Vec<McpToolDefinition>,
    server_info: Option<serde_json::Value>,
}

impl McpClient {
    /// Connect to an MCP server using the given configuration.
    ///
    /// This spawns the transport, performs the `initialize` → `initialized` handshake,
    /// and discovers available tools via `tools/list`.
    pub async fn connect(config: &McpServerConfig) -> Result<Self, McpError> {
        let transport: Arc<dyn McpTransport> = match config.transport {
            McpTransportType::Stdio => {
                let command = config
                    .command
                    .as_deref()
                    .ok_or_else(|| McpError::ConnectionFailed("No command specified".into()))?;
                Arc::new(
                    crate::transport::stdio::StdioTransport::spawn(
                        command,
                        &config.args,
                        &config.env,
                    )
                    .await?,
                )
            }
            McpTransportType::Sse => Arc::new(
                crate::transport::sse::SseTransport::connect(
                    config
                        .url
                        .as_deref()
                        .ok_or_else(|| McpError::ConnectionFailed("No URL specified".into()))?,
                    &config.headers,
                )
                .await?,
            ),
            McpTransportType::StreamableHttp => Arc::new(
                crate::transport::streamable_http::StreamableHttpTransport::new(
                    config
                        .url
                        .as_deref()
                        .ok_or_else(|| McpError::ConnectionFailed("No URL specified".into()))?,
                    &config.headers,
                ),
            ),
        };

        let mut client = Self {
            transport,
            server_id: config.id.clone(),
            tools: Vec::new(),
            server_info: None,
        };

        client.initialize().await?;
        client.discover_tools().await?;

        Ok(client)
    }

    /// Connect using an existing transport (useful for testing).
    pub async fn connect_with_transport(
        server_id: String,
        transport: Arc<dyn McpTransport>,
    ) -> Result<Self, McpError> {
        let mut client = Self {
            transport,
            server_id,
            tools: Vec::new(),
            server_info: None,
        };

        client.initialize().await?;
        client.discover_tools().await?;

        Ok(client)
    }

    /// Perform the MCP initialization handshake.
    async fn initialize(&mut self) -> Result<(), McpError> {
        let init_params = serde_json::json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {
                "tools": {}
            },
            "clientInfo": {
                "name": CLIENT_INFO,
                "version": CLIENT_VERSION
            }
        });

        let result = self
            .transport
            .request("initialize", Some(init_params))
            .await
            .map_err(|e| {
                McpError::InitializationFailed(format!("Initialize request failed: {e}"))
            })?;

        self.server_info = Some(result);

        // Send initialized notification
        self.transport
            .notify("notifications/initialized", None)
            .await
            .map_err(|e| {
                McpError::InitializationFailed(format!("Initialized notification failed: {e}"))
            })?;

        Ok(())
    }

    /// Discover available tools from the server via `tools/list`.
    async fn discover_tools(&mut self) -> Result<(), McpError> {
        let result = self
            .transport
            .request("tools/list", Some(serde_json::json!({})))
            .await?;

        let tools_value = result.get("tools").ok_or_else(|| {
            McpError::InvalidResponse("No 'tools' field in tools/list response".into())
        })?;

        self.tools = serde_json::from_value(tools_value.clone())
            .map_err(|e| McpError::InvalidResponse(format!("Failed to parse tools: {e}")))?;

        tracing::info!(
            server_id = %self.server_id,
            tool_count = self.tools.len(),
            "MCP server tools discovered"
        );

        Ok(())
    }

    /// Get the list of tools available on this server.
    pub fn tools(&self) -> &[McpToolDefinition] {
        &self.tools
    }

    /// Get the server ID.
    pub fn server_id(&self) -> &str {
        &self.server_id
    }

    /// Get server info from initialization.
    pub fn server_info(&self) -> Option<&serde_json::Value> {
        self.server_info.as_ref()
    }

    /// Check if the connection is alive.
    pub fn is_alive(&self) -> bool {
        self.transport.is_alive()
    }

    /// Call a tool on the MCP server.
    pub async fn call_tool(
        &self,
        name: &str,
        arguments: serde_json::Value,
    ) -> Result<serde_json::Value, McpError> {
        // Verify tool exists
        if !self.tools.iter().any(|t| t.name == name) {
            return Err(McpError::ToolNotFound(format!(
                "Tool '{}' not found on server '{}'",
                name, self.server_id
            )));
        }

        let params = serde_json::json!({
            "name": name,
            "arguments": arguments,
        });

        let result = self.transport.request("tools/call", Some(params)).await?;

        // Extract content from MCP tool response
        if let Some(content) = result.get("content") {
            // MCP returns content as an array of content blocks
            if let Some(arr) = content.as_array() {
                if arr.len() == 1 {
                    // Single content block - extract text
                    if let Some(text) = arr[0].get("text") {
                        return Ok(text.clone());
                    }
                }
                // Multiple blocks or non-text - return the whole content array
                return Ok(content.clone());
            }
            return Ok(content.clone());
        }

        Ok(result)
    }

    /// Re-discover tools (e.g. after server notifies of tool list changes).
    pub async fn refresh_tools(&mut self) -> Result<(), McpError> {
        self.discover_tools().await
    }

    /// Gracefully shut down the connection.
    pub async fn shutdown(&self) -> Result<(), McpError> {
        self.transport.close().await
    }
}

/// Resolve vault references in MCP config values.
///
/// Values like `${vault:github_token}` are replaced with the actual secret
/// from the vault backend.
pub fn resolve_vault_references(
    env: &HashMap<String, String>,
    vault_resolver: &dyn Fn(&str) -> Option<String>,
) -> HashMap<String, String> {
    env.iter()
        .map(|(key, val)| {
            let resolved = if val.starts_with("${vault:") && val.ends_with('}') {
                let vault_key = &val[8..val.len() - 1];
                vault_resolver(vault_key).unwrap_or_else(|| val.clone())
            } else {
                val.clone()
            };
            (key.clone(), resolved)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_vault_references_replaces_vault_syntax() {
        let mut env = HashMap::new();
        env.insert("TOKEN".into(), "${vault:github_token}".into());
        env.insert("PLAIN".into(), "hello".into());

        let resolved = resolve_vault_references(&env, &|key| {
            if key == "github_token" {
                Some("secret123".into())
            } else {
                None
            }
        });

        assert_eq!(resolved["TOKEN"], "secret123");
        assert_eq!(resolved["PLAIN"], "hello");
    }

    #[test]
    fn resolve_vault_references_keeps_unresolved() {
        let mut env = HashMap::new();
        env.insert("TOKEN".into(), "${vault:missing}".into());

        let resolved = resolve_vault_references(&env, &|_| None);

        assert_eq!(resolved["TOKEN"], "${vault:missing}");
    }
}
