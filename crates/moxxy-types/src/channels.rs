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
