use serde::{Deserialize, Serialize};
use std::fmt;

/// Gateway authentication mode.
///
/// Extensible enum = add new variants as new auth strategies are needed.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthMode {
    /// Require a valid API token for every request.
    Token,
    /// Skip authentication for requests originating from localhost.
    #[default]
    Loopback,
}

impl fmt::Display for AuthMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Token => write!(f, "token"),
            Self::Loopback => write!(f, "loopback"),
        }
    }
}

impl AuthMode {
    /// Returns `true` when localhost requests may bypass token checks.
    pub fn is_loopback(&self) -> bool {
        matches!(self, Self::Loopback)
    }

    /// Parse from a config string (e.g. the `auth_mode` field in `gateway.yaml`).
    /// Returns `Loopback` for any unrecognised value.
    pub fn from_config_str(s: &str) -> Self {
        match s {
            "token" => Self::Token,
            _ => Self::Loopback,
        }
    }
}

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
    #[serde(rename = "channels:read")]
    ChannelsRead,
    #[serde(rename = "channels:write")]
    ChannelsWrite,
    #[serde(rename = "settings:read")]
    SettingsRead,
    #[serde(rename = "settings:write")]
    SettingsWrite,
    #[serde(rename = "*")]
    Wildcard,
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
