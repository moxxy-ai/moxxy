pub mod client;
pub mod error;
pub mod manager;
pub mod protocol;
pub mod transport;

pub use client::{McpClient, resolve_vault_references};
pub use error::McpError;
pub use manager::{
    McpManager, ServerSummary, ToolSummary, VaultResolverFn, load_mcp_config, parse_mcp_tool_name,
    save_mcp_config,
};
