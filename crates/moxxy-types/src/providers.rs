#[derive(Debug, thiserror::Error)]
pub enum ProviderDocError {
    #[error("missing field: {0}")]
    MissingField(String),
    #[error("invalid yaml: {0}")]
    InvalidYaml(String),
    #[error("io error: {0}")]
    IoError(String),
}
