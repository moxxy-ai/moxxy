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

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OrchestratorJobRecord {
    pub job_id: String,
    pub agent_name: String,
    pub status: String,
    pub prompt: String,
    pub worker_mode: String,
    pub summary: Option<String>,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OrchestratorWorkerRunRecord {
    pub worker_run_id: String,
    pub job_id: String,
    pub worker_agent: String,
    pub worker_mode: String,
    pub task_prompt: String,
    pub status: String,
    pub attempt: i64,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub output: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OrchestratorEventRecord {
    pub id: i64,
    pub job_id: String,
    pub event_type: String,
    pub payload_json: String,
    pub created_at: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OrchestratorTaskRecord {
    pub task_id: String,
    pub job_id: String,
    pub role: String,
    pub title: String,
    pub description: String,
    pub context_json: String,
    pub depends_on_json: String,
    pub status: String,
    pub worker_agent: Option<String>,
    pub output: Option<String>,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}
