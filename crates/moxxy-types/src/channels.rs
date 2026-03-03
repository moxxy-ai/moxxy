use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChannelType {
    Telegram,
    Discord,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChannelStatus {
    Pending,
    Active,
    Paused,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BindingStatus {
    Active,
    Unbound,
}

/// Structured message content for channel transports.
/// Each variant allows platform-specific formatting (Markdown for Telegram, embeds for Discord, etc.).
#[derive(Debug, Clone)]
pub enum MessageContent {
    /// Plain text (backwards-compatible).
    Text(String),
    /// Tool was invoked.
    ToolInvocation {
        name: String,
        arguments: Option<String>,
    },
    /// Tool completed successfully.
    ToolResult {
        name: String,
        result: Option<String>,
    },
    /// Tool failed.
    ToolError { name: String, error: String },
    /// Run completed.
    RunCompleted,
    /// Run started.
    RunStarted,
    /// Run failed.
    RunFailed { error: String },
    /// Sub-agent was spawned.
    SubagentSpawned { name: String, task: Option<String> },
    /// Sub-agent completed.
    SubagentCompleted { name: String },
    /// Sub-agent failed.
    SubagentFailed { name: String, error: String },
}

#[derive(Debug, thiserror::Error)]
pub enum ChannelError {
    #[error("channel not found")]
    NotFound,
    #[error("channel already exists for this type")]
    AlreadyExists,
    #[error("pairing code expired")]
    PairingCodeExpired,
    #[error("pairing code invalid")]
    PairingCodeInvalid,
    #[error("binding not found")]
    BindingNotFound,
    #[error("transport error: {0}")]
    TransportError(String),
    #[error("vault error: {0}")]
    VaultError(String),
    #[error("storage error: {0}")]
    StorageError(String),
}
