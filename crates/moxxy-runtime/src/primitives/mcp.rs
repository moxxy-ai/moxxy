use crate::registry::{Primitive, PrimitiveError, PrimitiveRegistry};
use async_trait::async_trait;
use moxxy_mcp::{McpManager, parse_mcp_tool_name};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::Mutex;

/// Bridge primitive: wraps a single MCP tool as a Primitive.
///
/// Each MCP tool discovered on a server becomes one of these, with the name
/// pattern `mcp.{server_id}.{tool_name}`.
pub struct McpToolPrimitive {
    full_name: String,
    tool_description: String,
    input_schema: serde_json::Value,
    manager: Arc<Mutex<McpManager>>,
}

impl McpToolPrimitive {
    pub fn new(
        full_name: String,
        tool_description: String,
        input_schema: serde_json::Value,
        manager: Arc<Mutex<McpManager>>,
    ) -> Self {
        Self {
            full_name,
            tool_description,
            input_schema,
            manager,
        }
    }
}

#[async_trait]
impl Primitive for McpToolPrimitive {
    fn name(&self) -> &str {
        &self.full_name
    }

    fn description(&self) -> &str {
        &self.tool_description
    }

    fn parameters_schema(&self) -> serde_json::Value {
        self.input_schema.clone()
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let manager = self.manager.lock().await;
        manager
            .call_tool(&self.full_name, params)
            .await
            .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))
    }
}

/// `mcp.list` - List all connected MCP servers and their tools.
pub struct McpListPrimitive {
    manager: Arc<Mutex<McpManager>>,
}

impl McpListPrimitive {
    pub fn new(manager: Arc<Mutex<McpManager>>) -> Self {
        Self { manager }
    }
}

#[async_trait]
impl Primitive for McpListPrimitive {
    fn name(&self) -> &str {
        "mcp.list"
    }

    fn description(&self) -> &str {
        "List all connected MCP servers and their available tools"
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {},
            "additionalProperties": false
        })
    }

    async fn invoke(
        &self,
        _params: serde_json::Value,
    ) -> Result<serde_json::Value, PrimitiveError> {
        let manager = self.manager.lock().await;
        let summary = manager.server_summary();
        serde_json::to_value(&summary).map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))
    }
}

/// `mcp.connect` - Connect to a new MCP server mid-run.
pub struct McpConnectPrimitive {
    manager: Arc<Mutex<McpManager>>,
    registry: PrimitiveRegistry,
    allowed_primitives: Arc<std::sync::RwLock<Vec<String>>>,
    tools_dirty: Arc<AtomicBool>,
    agent_dir: std::path::PathBuf,
}

impl McpConnectPrimitive {
    pub fn new(
        manager: Arc<Mutex<McpManager>>,
        registry: PrimitiveRegistry,
        allowed_primitives: Arc<std::sync::RwLock<Vec<String>>>,
        tools_dirty: Arc<AtomicBool>,
        agent_dir: std::path::PathBuf,
    ) -> Self {
        Self {
            manager,
            registry,
            allowed_primitives,
            tools_dirty,
            agent_dir,
        }
    }
}

#[async_trait]
impl Primitive for McpConnectPrimitive {
    fn name(&self) -> &str {
        "mcp.connect"
    }

    fn description(&self) -> &str {
        "Connect (or reconnect) an MCP server. Use the same server_id to update args/config of an existing server."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "server_id": {
                    "type": "string",
                    "description": "Unique identifier for this MCP server"
                },
                "transport": {
                    "type": "string",
                    "enum": ["stdio", "sse", "streamable_http"],
                    "description": "Transport type"
                },
                "command": {
                    "type": "string",
                    "description": "For stdio: command to run (e.g. 'npx')"
                },
                "args": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "For stdio: command arguments"
                },
                "url": {
                    "type": "string",
                    "description": "For SSE/streamable_http: server URL"
                },
                "headers": {
                    "type": "object",
                    "additionalProperties": { "type": "string" },
                    "description": "HTTP headers for SSE/streamable_http transport (e.g. Authorization, API keys). Supports ${vault:key} syntax for secrets."
                },
                "env": {
                    "type": "object",
                    "additionalProperties": { "type": "string" },
                    "description": "Environment variables for stdio transport. Supports ${vault:key} syntax for secrets."
                }
            },
            "required": ["server_id", "transport"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let server_id = params["server_id"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("server_id required".into()))?
            .to_string();

        let transport_str = params["transport"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("transport required".into()))?;

        let transport = match transport_str {
            "stdio" => moxxy_types::mcp::McpTransportType::Stdio,
            "sse" => moxxy_types::mcp::McpTransportType::Sse,
            "streamable_http" => moxxy_types::mcp::McpTransportType::StreamableHttp,
            other => {
                return Err(PrimitiveError::InvalidParams(format!(
                    "Invalid transport: {other}"
                )));
            }
        };

        let config = moxxy_types::mcp::McpServerConfig {
            id: server_id.clone(),
            transport,
            enabled: true,
            command: params["command"].as_str().map(|s| s.to_string()),
            args: params["args"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default(),
            env: parse_string_map(&params["env"]),
            url: params["url"].as_str().map(|s| s.to_string()),
            headers: parse_string_map(&params["headers"]),
        };

        config.validate().map_err(PrimitiveError::InvalidParams)?;

        // If server already exists, deregister its old tools first
        let mut manager = self.manager.lock().await;
        let old_tool_names = manager.tool_names_for_server(&server_id);
        if !old_tool_names.is_empty() {
            for name in &old_tool_names {
                self.registry.deregister(name);
            }
            let mut allowed = self.allowed_primitives.write().unwrap();
            allowed.retain(|n| !old_tool_names.contains(n));
        }

        // Connect (shuts down old connection if same ID)
        manager
            .connect_server(&config)
            .await
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("Connection failed: {e}")))?;

        // Register new tools as primitives
        let tool_names = register_mcp_tools(&manager, &server_id, &self.registry, &self.manager);

        // Extend allowed primitives
        {
            let mut allowed = self.allowed_primitives.write().unwrap();
            allowed.extend(tool_names.clone());
        }

        // Signal tool definitions need refresh
        self.tools_dirty.store(true, Ordering::Relaxed);

        // Persist to mcp.yaml
        drop(manager);
        if let Ok(mut mcp_config) = moxxy_mcp::load_mcp_config(&self.agent_dir) {
            // Remove existing entry with same ID if any
            mcp_config.servers.retain(|s| s.id != server_id);
            mcp_config.servers.push(config);
            let _ = moxxy_mcp::save_mcp_config(&self.agent_dir, &mcp_config);
        }

        Ok(serde_json::json!({
            "server_id": server_id,
            "tools": tool_names,
            "status": "connected"
        }))
    }
}

/// `mcp.disconnect` - Disconnect an MCP server.
pub struct McpDisconnectPrimitive {
    manager: Arc<Mutex<McpManager>>,
    registry: PrimitiveRegistry,
    allowed_primitives: Arc<std::sync::RwLock<Vec<String>>>,
    tools_dirty: Arc<AtomicBool>,
    agent_dir: std::path::PathBuf,
}

impl McpDisconnectPrimitive {
    pub fn new(
        manager: Arc<Mutex<McpManager>>,
        registry: PrimitiveRegistry,
        allowed_primitives: Arc<std::sync::RwLock<Vec<String>>>,
        tools_dirty: Arc<AtomicBool>,
        agent_dir: std::path::PathBuf,
    ) -> Self {
        Self {
            manager,
            registry,
            allowed_primitives,
            tools_dirty,
            agent_dir,
        }
    }
}

#[async_trait]
impl Primitive for McpDisconnectPrimitive {
    fn name(&self) -> &str {
        "mcp.disconnect"
    }

    fn description(&self) -> &str {
        "Disconnect an MCP server and remove its tools"
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "server_id": {
                    "type": "string",
                    "description": "ID of the MCP server to disconnect"
                },
                "remove": {
                    "type": "boolean",
                    "description": "If true, remove from mcp.yaml entirely. If false (default), set enabled: false."
                }
            },
            "required": ["server_id"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let server_id = params["server_id"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("server_id required".into()))?
            .to_string();
        let remove = params["remove"].as_bool().unwrap_or(false);

        let mut manager = self.manager.lock().await;

        // Get tool names before disconnecting so we can deregister them
        let tool_names: Vec<String> = manager
            .all_tool_names()
            .into_iter()
            .filter(|name| {
                parse_mcp_tool_name(name)
                    .map(|(sid, _)| sid == server_id)
                    .unwrap_or(false)
            })
            .collect();

        // Disconnect
        manager
            .disconnect_server(&server_id)
            .await
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("Disconnect failed: {e}")))?;

        // Deregister tools from primitive registry
        for name in &tool_names {
            self.registry.deregister(name);
        }

        // Remove from allowed primitives
        {
            let mut allowed = self.allowed_primitives.write().unwrap();
            allowed.retain(|n| !tool_names.contains(n));
        }

        // Signal tool definitions need refresh
        self.tools_dirty.store(true, Ordering::Relaxed);

        // Update mcp.yaml
        drop(manager);
        if let Ok(mut mcp_config) = moxxy_mcp::load_mcp_config(&self.agent_dir) {
            if remove {
                mcp_config.servers.retain(|s| s.id != server_id);
            } else {
                for server in &mut mcp_config.servers {
                    if server.id == server_id {
                        server.enabled = false;
                    }
                }
            }
            let _ = moxxy_mcp::save_mcp_config(&self.agent_dir, &mcp_config);
        }

        Ok(serde_json::json!({
            "server_id": server_id,
            "removed_tools": tool_names,
            "status": "disconnected"
        }))
    }
}

/// Parse a JSON object into a `HashMap<String, String>`, ignoring non-string values.
fn parse_string_map(value: &serde_json::Value) -> std::collections::HashMap<String, String> {
    value
        .as_object()
        .map(|obj| {
            obj.iter()
                .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                .collect()
        })
        .unwrap_or_default()
}

/// Register all tools from a connected MCP server as primitives.
///
/// Returns the list of registered tool names (e.g. `["mcp.filesystem.read_file", ...]`).
pub fn register_mcp_tools(
    manager: &McpManager,
    server_id: &str,
    registry: &PrimitiveRegistry,
    manager_arc: &Arc<Mutex<McpManager>>,
) -> Vec<String> {
    let mut tool_names = Vec::new();

    let client = match manager.get_client(server_id) {
        Some(c) => c,
        None => return tool_names,
    };

    for tool in client.tools() {
        let full_name = format!("mcp.{server_id}.{}", tool.name);
        let description = tool.description.clone().unwrap_or_default();

        registry.register(Box::new(McpToolPrimitive::new(
            full_name.clone(),
            description,
            tool.input_schema.clone(),
            manager_arc.clone(),
        )));

        tool_names.push(full_name);
    }

    tool_names
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mcp_list_primitive_name() {
        let manager = Arc::new(Mutex::new(McpManager::new()));
        let prim = McpListPrimitive::new(manager);
        assert_eq!(prim.name(), "mcp.list");
    }

    #[test]
    fn mcp_connect_primitive_name() {
        let manager = Arc::new(Mutex::new(McpManager::new()));
        let registry = PrimitiveRegistry::new();
        let allowed = Arc::new(std::sync::RwLock::new(Vec::new()));
        let dirty = Arc::new(AtomicBool::new(false));
        let prim = McpConnectPrimitive::new(
            manager,
            registry,
            allowed,
            dirty,
            std::path::PathBuf::from("/tmp"),
        );
        assert_eq!(prim.name(), "mcp.connect");
    }

    #[test]
    fn mcp_disconnect_primitive_name() {
        let manager = Arc::new(Mutex::new(McpManager::new()));
        let registry = PrimitiveRegistry::new();
        let allowed = Arc::new(std::sync::RwLock::new(Vec::new()));
        let dirty = Arc::new(AtomicBool::new(false));
        let prim = McpDisconnectPrimitive::new(
            manager,
            registry,
            allowed,
            dirty,
            std::path::PathBuf::from("/tmp"),
        );
        assert_eq!(prim.name(), "mcp.disconnect");
    }

    #[tokio::test]
    async fn mcp_list_returns_empty_when_no_servers() {
        let manager = Arc::new(Mutex::new(McpManager::new()));
        let prim = McpListPrimitive::new(manager);
        let result = prim.invoke(serde_json::json!({})).await.unwrap();
        let arr = result.as_array().unwrap();
        assert!(arr.is_empty());
    }

    #[test]
    fn mcp_tool_primitive_has_correct_schema() {
        let manager = Arc::new(Mutex::new(McpManager::new()));
        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" }
            }
        });
        let prim = McpToolPrimitive::new(
            "mcp.test.read_file".into(),
            "Read a file".into(),
            schema.clone(),
            manager,
        );
        assert_eq!(prim.name(), "mcp.test.read_file");
        assert_eq!(prim.description(), "Read a file");
        assert_eq!(prim.parameters_schema(), schema);
    }
}
