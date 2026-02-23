/// A structured STM entry read from SQLite.
#[derive(Debug, Clone)]
pub struct StmEntry {
    pub role: String,
    pub content: String,
}

/// A structured STM entry with row id, used for incremental session sync.
#[derive(Debug, Clone, serde::Serialize)]
pub struct StmEntryRecord {
    pub id: i64,
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ScheduledJobRecord {
    pub name: String,
    pub cron: String,
    pub prompt: String,
    pub source: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct McpServerRecord {
    pub name: String,
    pub command: String,
    pub args: String,
    pub env: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct WebhookRecord {
    pub name: String,
    pub source: String,
    pub secret: String,
    pub prompt_template: String,
    pub active: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ApiTokenRecord {
    pub id: String,
    pub name: String,
    pub created_at: String,
}
