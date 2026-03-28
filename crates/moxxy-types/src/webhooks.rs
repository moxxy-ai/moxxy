#[derive(Debug, thiserror::Error)]
pub enum WebhookDocError {
    #[error("missing field: {0}")]
    MissingField(String),
    #[error("invalid frontmatter: {0}")]
    InvalidFrontmatter(String),
    #[error("io error: {0}")]
    IoError(String),
}
