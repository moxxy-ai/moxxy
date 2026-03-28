use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Top-level MCP configuration for an agent, stored as mcp.yaml
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct McpConfig {
    #[serde(default)]
    pub servers: Vec<McpServerConfig>,
}

/// Configuration for a single MCP server
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    /// Unique identifier for this server (e.g. "filesystem", "github")
    pub id: String,
    /// Transport type
    pub transport: McpTransportType,
    /// Whether this server is enabled
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// For stdio transport: the command to run
    pub command: Option<String>,
    /// For stdio transport: command arguments
    #[serde(default)]
    pub args: Vec<String>,
    /// For stdio transport: environment variables (supports ${vault:key} syntax)
    #[serde(default)]
    pub env: HashMap<String, String>,
    /// For SSE transport: the server URL
    pub url: Option<String>,
    /// For SSE transport: HTTP headers (supports ${vault:key} syntax)
    #[serde(default)]
    pub headers: HashMap<String, String>,
}

/// Transport type for MCP server communication
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum McpTransportType {
    Stdio,
    Sse,
    StreamableHttp,
}

fn default_true() -> bool {
    true
}

impl McpServerConfig {
    /// Validate the configuration
    pub fn validate(&self) -> Result<(), String> {
        if self.id.is_empty() {
            return Err("Server ID cannot be empty".to_string());
        }
        if self.id.len() > 64 {
            return Err("Server ID must be 64 characters or less".to_string());
        }
        if !self
            .id
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
        {
            return Err(
                "Server ID must contain only alphanumeric characters, hyphens, and underscores"
                    .to_string(),
            );
        }
        match self.transport {
            McpTransportType::Stdio => {
                if self.command.as_ref().is_none_or(|c| c.is_empty()) {
                    return Err("Stdio transport requires a command".to_string());
                }
            }
            McpTransportType::Sse => {
                if self.url.as_ref().is_none_or(|u| u.is_empty()) {
                    return Err("SSE transport requires a URL".to_string());
                }
            }
            McpTransportType::StreamableHttp => {
                if self.url.as_ref().is_none_or(|u| u.is_empty()) {
                    return Err("Streamable HTTP transport requires a URL".to_string());
                }
            }
        }
        Ok(())
    }
}

/// Tool definition as reported by an MCP server
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolDefinition {
    pub name: String,
    pub description: Option<String>,
    #[serde(rename = "inputSchema")]
    pub input_schema: serde_json::Value,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stdio_config(id: &str, command: Option<&str>) -> McpServerConfig {
        McpServerConfig {
            id: id.to_string(),
            transport: McpTransportType::Stdio,
            enabled: true,
            command: command.map(|s| s.to_string()),
            args: vec![],
            env: HashMap::new(),
            url: None,
            headers: HashMap::new(),
        }
    }

    fn sse_config(id: &str, url: Option<&str>) -> McpServerConfig {
        McpServerConfig {
            id: id.to_string(),
            transport: McpTransportType::Sse,
            enabled: true,
            command: None,
            args: vec![],
            env: HashMap::new(),
            url: url.map(|s| s.to_string()),
            headers: HashMap::new(),
        }
    }

    #[test]
    fn valid_stdio_config_passes_validation() {
        let cfg = stdio_config("my-server", Some("npx"));
        assert!(cfg.validate().is_ok());
    }

    #[test]
    fn valid_sse_config_passes_validation() {
        let cfg = sse_config("remote", Some("http://localhost:3000/sse"));
        assert!(cfg.validate().is_ok());
    }

    #[test]
    fn empty_id_fails_validation() {
        let cfg = stdio_config("", Some("npx"));
        let err = cfg.validate().unwrap_err();
        assert!(err.contains("empty"));
    }

    #[test]
    fn long_id_fails_validation() {
        let long_id = "a".repeat(65);
        let cfg = stdio_config(&long_id, Some("npx"));
        let err = cfg.validate().unwrap_err();
        assert!(err.contains("64 characters"));
    }

    #[test]
    fn invalid_id_chars_fails_validation() {
        let cfg = stdio_config("my server!", Some("npx"));
        let err = cfg.validate().unwrap_err();
        assert!(err.contains("alphanumeric"));
    }

    #[test]
    fn stdio_without_command_fails_validation() {
        let cfg = stdio_config("server", None);
        let err = cfg.validate().unwrap_err();
        assert!(err.contains("command"));
    }

    #[test]
    fn stdio_with_empty_command_fails_validation() {
        let cfg = stdio_config("server", Some(""));
        let err = cfg.validate().unwrap_err();
        assert!(err.contains("command"));
    }

    #[test]
    fn sse_without_url_fails_validation() {
        let cfg = sse_config("server", None);
        let err = cfg.validate().unwrap_err();
        assert!(err.contains("URL"));
    }

    #[test]
    fn sse_with_empty_url_fails_validation() {
        let cfg = sse_config("server", Some(""));
        let err = cfg.validate().unwrap_err();
        assert!(err.contains("URL"));
    }

    #[test]
    fn transport_type_serializes_lowercase() {
        let json = serde_json::to_string(&McpTransportType::Stdio).unwrap();
        assert_eq!(json, "\"stdio\"");
        let json = serde_json::to_string(&McpTransportType::Sse).unwrap();
        assert_eq!(json, "\"sse\"");
        let json = serde_json::to_string(&McpTransportType::StreamableHttp).unwrap();
        assert_eq!(json, "\"streamable_http\"");
    }

    fn streamable_http_config(id: &str, url: Option<&str>) -> McpServerConfig {
        McpServerConfig {
            id: id.to_string(),
            transport: McpTransportType::StreamableHttp,
            enabled: true,
            command: None,
            args: vec![],
            env: HashMap::new(),
            url: url.map(|s| s.to_string()),
            headers: HashMap::new(),
        }
    }

    #[test]
    fn valid_streamable_http_config_passes_validation() {
        let cfg = streamable_http_config("remote", Some("https://mcp.exa.ai/mcp"));
        assert!(cfg.validate().is_ok());
    }

    #[test]
    fn streamable_http_without_url_fails_validation() {
        let cfg = streamable_http_config("server", None);
        let err = cfg.validate().unwrap_err();
        assert!(err.contains("URL"));
    }

    #[test]
    fn streamable_http_with_empty_url_fails_validation() {
        let cfg = streamable_http_config("server", Some(""));
        let err = cfg.validate().unwrap_err();
        assert!(err.contains("URL"));
    }

    #[test]
    fn enabled_defaults_to_true() {
        let yaml = r#"
            id: test
            transport: stdio
            command: npx
        "#;
        let cfg: McpServerConfig = serde_yaml::from_str(yaml).unwrap();
        assert!(cfg.enabled);
    }

    #[test]
    fn mcp_config_default_has_empty_servers() {
        let cfg = McpConfig::default();
        assert!(cfg.servers.is_empty());
    }

    #[test]
    fn mcp_tool_definition_round_trips() {
        let tool = McpToolDefinition {
            name: "read_file".to_string(),
            description: Some("Read a file".to_string()),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" }
                }
            }),
        };
        let json = serde_json::to_string(&tool).unwrap();
        let back: McpToolDefinition = serde_json::from_str(&json).unwrap();
        assert_eq!(back.name, "read_file");
        assert_eq!(back.description, Some("Read a file".to_string()));
    }
}
