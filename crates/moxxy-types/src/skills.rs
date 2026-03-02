use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SkillStatus {
    Quarantined,
    Approved,
    Rejected,
}

#[derive(Debug, thiserror::Error)]
pub enum SkillDocError {
    #[error("missing field: {0}")]
    MissingField(String),
    #[error("invalid frontmatter: {0}")]
    InvalidFrontmatter(String),
    #[error("invalid primitive: {0}")]
    InvalidPrimitive(String),
}
