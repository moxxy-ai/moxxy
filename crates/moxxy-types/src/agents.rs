use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentStatus {
    #[default]
    Idle,
    Running,
    Stopped,
    Error,
}

#[derive(Debug, thiserror::Error)]
pub enum SpawnError {
    #[error("depth limit exceeded")]
    DepthLimitExceeded,
    #[error("total limit exceeded")]
    TotalLimitExceeded,
    #[error("invalid config: {0}")]
    InvalidConfig(String),
}
