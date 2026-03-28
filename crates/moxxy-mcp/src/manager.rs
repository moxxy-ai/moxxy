use crate::client::McpClient;
use crate::error::McpError;
use moxxy_types::mcp::{McpConfig, McpServerConfig, McpToolDefinition};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

/// Type alias for vault resolver closures.
pub type VaultResolverFn = Arc<dyn Fn(&str) -> Option<String> + Send + Sync>;

/// Manages multiple MCP client connections for a single agent.
///
/// Handles lifecycle of MCP servers: connect, disconnect, shutdown.
/// Each connected server's tools are prefixed with `mcp.{server_id}.`.
pub struct McpManager {
    clients: HashMap<String, McpClient>,
    vault_resolver: Option<VaultResolverFn>,
}

impl Default for McpManager {
    fn default() -> Self {
        Self::new()
    }
}

impl McpManager {
    pub fn new() -> Self {
        Self {
            clients: HashMap::new(),
            vault_resolver: None,
        }
    }

    /// Set a vault resolver to resolve `${vault:KEY}` references in MCP env vars and headers.
    pub fn set_vault_resolver(&mut self, resolver: VaultResolverFn) {
        self.vault_resolver = Some(resolver);
    }

    /// Resolve vault references in a server config's env and headers.
    fn resolve_config(&self, config: &McpServerConfig) -> McpServerConfig {
        match &self.vault_resolver {
            Some(resolver) => {
                let mut resolved = config.clone();
                resolved.env = crate::client::resolve_vault_references(&config.env, resolver.as_ref());
                resolved.headers = crate::client::resolve_vault_references(&config.headers, resolver.as_ref());
                resolved
            }
            None => config.clone(),
        }
    }

    /// Connect to all enabled servers in the config.
    /// Returns a list of (server_id, error) for any failed connections.
    pub async fn connect_all(&mut self, config: &McpConfig) -> Vec<(String, McpError)> {
        let mut failures = Vec::new();

        for server_config in &config.servers {
            if !server_config.enabled {
                tracing::info!(server_id = %server_config.id, "Skipping disabled MCP server");
                continue;
            }

            let resolved_config = self.resolve_config(server_config);
            match McpClient::connect(&resolved_config).await {
                Ok(client) => {
                    tracing::info!(
                        server_id = %server_config.id,
                        tools = client.tools().len(),
                        "MCP server connected"
                    );
                    self.clients.insert(server_config.id.clone(), client);
                }
                Err(e) => {
                    tracing::warn!(
                        server_id = %server_config.id,
                        error = %e,
                        "Failed to connect MCP server"
                    );
                    failures.push((server_config.id.clone(), e));
                }
            }
        }

        failures
    }

    /// Connect to a single MCP server.
    /// If a server with the same ID is already connected, it is shut down first.
    pub async fn connect_server(&mut self, config: &McpServerConfig) -> Result<(), McpError> {
        // Shut down existing connection with the same ID before replacing
        if let Some(old_client) = self.clients.remove(&config.id) {
            let _ = old_client.shutdown().await;
        }
        let resolved_config = self.resolve_config(config);
        let client = McpClient::connect(&resolved_config).await?;
        self.clients.insert(config.id.clone(), client);
        Ok(())
    }

    /// Get all tool names for a specific server, prefixed with `mcp.{server_id}.`.
    pub fn tool_names_for_server(&self, server_id: &str) -> Vec<String> {
        self.clients
            .get(server_id)
            .map(|client| {
                client
                    .tools()
                    .iter()
                    .map(|t| format!("mcp.{server_id}.{}", t.name))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Disconnect a single server by ID.
    pub async fn disconnect_server(&mut self, server_id: &str) -> Result<(), McpError> {
        let client = self
            .clients
            .remove(server_id)
            .ok_or_else(|| McpError::ToolNotFound(format!("Server '{server_id}' not connected")))?;
        client.shutdown().await
    }

    /// Shut down all connected servers.
    pub async fn shutdown_all(&mut self) {
        let ids: Vec<String> = self.clients.keys().cloned().collect();
        for id in ids {
            if let Some(client) = self.clients.remove(&id)
                && let Err(e) = client.shutdown().await
            {
                tracing::warn!(server_id = %id, error = %e, "Error shutting down MCP server");
            }
        }
    }

    /// Get all tool names across all connected servers, prefixed with `mcp.{server_id}.`.
    pub fn all_tool_names(&self) -> Vec<String> {
        let mut names = Vec::new();
        for (server_id, client) in &self.clients {
            for tool in client.tools() {
                names.push(format!("mcp.{server_id}.{}", tool.name));
            }
        }
        names
    }

    /// Get a summary of all connected servers and their tools.
    pub fn server_summary(&self) -> Vec<ServerSummary> {
        self.clients
            .iter()
            .map(|(id, client)| ServerSummary {
                id: id.clone(),
                alive: client.is_alive(),
                tools: client
                    .tools()
                    .iter()
                    .map(|t| ToolSummary {
                        name: t.name.clone(),
                        full_name: format!("mcp.{id}.{}", t.name),
                        description: t.description.clone(),
                    })
                    .collect(),
            })
            .collect()
    }

    /// Get a reference to a specific client.
    pub fn get_client(&self, server_id: &str) -> Option<&McpClient> {
        self.clients.get(server_id)
    }

    /// Get a mutable reference to a specific client.
    pub fn get_client_mut(&mut self, server_id: &str) -> Option<&mut McpClient> {
        self.clients.get_mut(server_id)
    }

    /// Call a tool on a specific server.
    /// The `full_name` should be in format `mcp.{server_id}.{tool_name}`.
    pub async fn call_tool(
        &self,
        full_name: &str,
        arguments: serde_json::Value,
    ) -> Result<serde_json::Value, McpError> {
        let (server_id, tool_name) = parse_mcp_tool_name(full_name)?;

        let client = self
            .clients
            .get(server_id)
            .ok_or_else(|| McpError::ToolNotFound(format!("Server '{server_id}' not connected")))?;

        client.call_tool(tool_name, arguments).await
    }

    /// Get all tool definitions across all connected servers.
    pub fn all_tool_definitions(&self) -> Vec<(String, McpToolDefinition)> {
        let mut defs = Vec::new();
        for (server_id, client) in &self.clients {
            for tool in client.tools() {
                defs.push((server_id.clone(), tool.clone()));
            }
        }
        defs
    }

    /// Check if any servers are connected.
    pub fn has_connections(&self) -> bool {
        !self.clients.is_empty()
    }

    /// Get count of connected servers.
    pub fn server_count(&self) -> usize {
        self.clients.len()
    }

    /// Get list of connected server IDs.
    pub fn connected_server_ids(&self) -> Vec<String> {
        self.clients.keys().cloned().collect()
    }
}

/// Parse a full MCP tool name like `mcp.filesystem.read_file` into (server_id, tool_name).
pub fn parse_mcp_tool_name(full_name: &str) -> Result<(&str, &str), McpError> {
    let stripped = full_name
        .strip_prefix("mcp.")
        .ok_or_else(|| McpError::ToolNotFound(format!("Invalid MCP tool name: {full_name}")))?;

    let dot_pos = stripped
        .find('.')
        .ok_or_else(|| McpError::ToolNotFound(format!("Invalid MCP tool name: {full_name}")))?;

    let server_id = &stripped[..dot_pos];
    let tool_name = &stripped[dot_pos + 1..];

    Ok((server_id, tool_name))
}

/// Load MCP config from an agent's directory.
pub fn load_mcp_config(agent_dir: &Path) -> Result<McpConfig, McpError> {
    let config_path = agent_dir.join("mcp.yaml");
    if !config_path.exists() {
        return Ok(McpConfig::default());
    }

    let content = std::fs::read_to_string(&config_path).map_err(McpError::Io)?;

    let config: McpConfig = serde_yaml::from_str(&content)
        .map_err(|e| McpError::InvalidResponse(format!("Failed to parse mcp.yaml: {e}")))?;

    // Validate all server configs
    for server in &config.servers {
        server
            .validate()
            .map_err(|e| McpError::InvalidResponse(format!("Server '{}': {e}", server.id)))?;
    }

    Ok(config)
}

/// Save MCP config to an agent's directory.
pub fn save_mcp_config(agent_dir: &Path, config: &McpConfig) -> Result<(), McpError> {
    let config_path = agent_dir.join("mcp.yaml");
    let content = serde_yaml::to_string(config)
        .map_err(|e| McpError::InvalidResponse(format!("Failed to serialize config: {e}")))?;
    std::fs::write(&config_path, content)?;
    Ok(())
}

/// Summary of a connected MCP server.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ServerSummary {
    pub id: String,
    pub alive: bool,
    pub tools: Vec<ToolSummary>,
}

/// Summary of a single MCP tool.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ToolSummary {
    pub name: String,
    pub full_name: String,
    pub description: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_mcp_tool_name_valid() {
        let (server, tool) = parse_mcp_tool_name("mcp.filesystem.read_file").unwrap();
        assert_eq!(server, "filesystem");
        assert_eq!(tool, "read_file");
    }

    #[test]
    fn parse_mcp_tool_name_with_dots_in_tool() {
        let (server, tool) = parse_mcp_tool_name("mcp.github.issues.list").unwrap();
        assert_eq!(server, "github");
        assert_eq!(tool, "issues.list");
    }

    #[test]
    fn parse_mcp_tool_name_invalid_prefix() {
        let result = parse_mcp_tool_name("not.mcp.tool");
        assert!(result.is_err());
    }

    #[test]
    fn parse_mcp_tool_name_missing_tool() {
        let result = parse_mcp_tool_name("mcp.server");
        assert!(result.is_err());
    }

    #[test]
    fn manager_new_has_no_connections() {
        let manager = McpManager::new();
        assert!(!manager.has_connections());
        assert_eq!(manager.server_count(), 0);
        assert!(manager.all_tool_names().is_empty());
    }

    #[test]
    fn load_config_returns_default_when_no_file() {
        let tmp = tempfile::TempDir::new().unwrap();
        let config = load_mcp_config(tmp.path()).unwrap();
        assert!(config.servers.is_empty());
    }

    #[test]
    fn load_and_save_config_round_trips() {
        use moxxy_types::mcp::McpTransportType;
        let tmp = tempfile::TempDir::new().unwrap();
        let config = McpConfig {
            servers: vec![McpServerConfig {
                id: "test-server".into(),
                transport: McpTransportType::Stdio,
                enabled: true,
                command: Some("echo".into()),
                args: vec!["hello".into()],
                env: HashMap::new(),
                url: None,
                headers: HashMap::new(),
            }],
        };

        save_mcp_config(tmp.path(), &config).unwrap();
        let loaded = load_mcp_config(tmp.path()).unwrap();

        assert_eq!(loaded.servers.len(), 1);
        assert_eq!(loaded.servers[0].id, "test-server");
        assert_eq!(loaded.servers[0].command, Some("echo".into()));
    }

    #[test]
    fn load_config_validates_servers() {
        let tmp = tempfile::TempDir::new().unwrap();
        // Write a config with invalid server (stdio but no command)
        let yaml = "servers:\n  - id: bad\n    transport: stdio\n    enabled: true\n";
        std::fs::write(tmp.path().join("mcp.yaml"), yaml).unwrap();

        let result = load_mcp_config(tmp.path());
        assert!(result.is_err());
    }
}
