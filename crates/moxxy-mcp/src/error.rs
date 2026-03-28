use thiserror::Error;

#[derive(Debug, Error)]
pub enum McpError {
    #[error("connection failed: {0}")]
    ConnectionFailed(String),

    #[error("protocol error: {0}")]
    ProtocolError(String),

    #[error("timeout: {0}")]
    Timeout(String),

    #[error("server disconnected")]
    ServerDisconnected,

    #[error("invalid response: {0}")]
    InvalidResponse(String),

    #[error("tool not found: {0}")]
    ToolNotFound(String),

    #[error("initialization failed: {0}")]
    InitializationFailed(String),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}
