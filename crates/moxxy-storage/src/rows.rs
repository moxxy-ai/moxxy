#[derive(Debug, Clone)]
pub struct SessionSummaryRow {
    pub run_id: String,
    pub agent_id: String,
    pub user_id: Option<String>,
    pub ts: i64,
    pub tool_call_count: i64,
    pub task: String,
    pub summary: String,
}

#[derive(Debug, Clone)]
pub struct SessionSummaryHit {
    pub run_id: String,
    pub agent_id: String,
    pub user_id: Option<String>,
    pub ts: i64,
    pub tool_call_count: i64,
    pub task: String,
    pub summary: String,
    pub bm25_rank: f64,
}

#[derive(Debug, Clone)]
pub struct StoredTokenRow {
    pub id: String,
    pub created_by: String,
    pub token_hash: String,
    pub scopes_json: String,
    pub created_at: String,
    pub expires_at: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone)]
pub struct AgentRow {
    pub id: String,
    pub parent_agent_id: Option<String>,
    pub name: Option<String>,
    pub status: String,
    pub depth: i32,
    pub spawned_total: i32,
    pub workspace_root: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct MemoryIndexRow {
    pub id: String,
    pub agent_id: String,
    pub markdown_path: String,
    pub tags_json: Option<String>,
    pub chunk_hash: Option<String>,
    pub embedding_id: Option<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    pub content: Option<String>,
}

#[derive(Debug, Clone)]
pub struct VaultSecretRefRow {
    pub id: String,
    pub key_name: String,
    pub backend_key: String,
    pub policy_label: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct VaultGrantRow {
    pub id: String,
    pub agent_id: String,
    pub secret_ref_id: String,
    pub created_at: String,
    pub revoked_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ChannelRow {
    pub id: String,
    pub channel_type: String,
    pub display_name: String,
    pub vault_secret_ref_id: String,
    pub status: String,
    pub config_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct ChannelBindingRow {
    pub id: String,
    pub channel_id: String,
    pub agent_id: String,
    pub external_chat_id: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct ChannelPairingCodeRow {
    pub id: String,
    pub channel_id: String,
    pub external_chat_id: String,
    pub code: String,
    pub expires_at: String,
    pub consumed: bool,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct EventAuditRow {
    pub event_id: String,
    pub ts: i64,
    pub agent_id: Option<String>,
    pub run_id: Option<String>,
    pub parent_run_id: Option<String>,
    pub sequence: i64,
    pub event_type: String,
    pub payload_json: Option<String>,
    pub redactions_json: Option<String>,
    pub sensitive: bool,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct WebhookDeliveryRow {
    pub id: String,
    pub webhook_id: String,
    pub source_ip: Option<String>,
    pub headers_json: Option<String>,
    pub body: Option<String>,
    pub signature_valid: bool,
    pub run_id: Option<String>,
    pub error: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct AllowlistRow {
    pub id: String,
    pub agent_id: String,
    pub list_type: String,
    pub entry: String,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct ConversationLogRow {
    pub id: String,
    pub agent_id: String,
    pub run_id: String,
    pub sequence: i64,
    pub role: String,
    pub content: String,
    pub created_at: String,
}
