#[derive(Debug, thiserror::Error)]
pub enum TemplateDocError {
    #[error("missing field: {0}")]
    MissingField(String),
    #[error("invalid frontmatter: {0}")]
    InvalidFrontmatter(String),
}
