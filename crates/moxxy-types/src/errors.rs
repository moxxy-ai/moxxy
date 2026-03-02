#[derive(Debug, thiserror::Error)]
pub enum PathPolicyError {
    #[error("outside workspace: {0}")]
    OutsideWorkspace(String),
    #[error("outside core mount: {0}")]
    OutsideCoreMount(String),
    #[error("write to read-only: {0}")]
    WriteToReadOnly(String),
    #[error("traversal detected: {0}")]
    TraversalDetected(String),
    #[error("symlink escape: {0}")]
    SymlinkEscape(String),
}

#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("not found")]
    NotFound,
    #[error("duplicate key: {0}")]
    DuplicateKey(String),
    #[error("query failed: {0}")]
    QueryFailed(String),
}
