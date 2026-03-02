#[derive(Debug, thiserror::Error)]
pub enum VaultError {
    #[error("secret not found")]
    SecretNotFound,
    #[error("access denied")]
    AccessDenied,
    #[error("backend error: {0}")]
    BackendError(String),
}
