use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum TokenScope {
    #[serde(rename = "agents:read")]
    AgentsRead,
    #[serde(rename = "agents:write")]
    AgentsWrite,
    #[serde(rename = "runs:write")]
    RunsWrite,
    #[serde(rename = "vault:read")]
    VaultRead,
    #[serde(rename = "vault:write")]
    VaultWrite,
    #[serde(rename = "tokens:admin")]
    TokensAdmin,
    #[serde(rename = "events:read")]
    EventsRead,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TokenStatus {
    Active,
    Revoked,
}

#[derive(Debug, thiserror::Error)]
pub enum TokenError {
    #[error("invalid token")]
    InvalidToken,
    #[error("token expired")]
    Expired,
    #[error("token revoked")]
    Revoked,
    #[error("insufficient scope: {0}")]
    InsufficientScope(String),
}
