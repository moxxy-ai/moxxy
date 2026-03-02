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
    pub provider_id: String,
    pub model_id: String,
    pub workspace_root: String,
    pub core_mount: Option<String>,
    pub policy_profile: Option<String>,
    pub temperature: f64,
    pub max_subagent_depth: i32,
    pub max_subagents_total: i32,
    pub status: String,
    pub depth: i32,
    pub spawned_total: i32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct ProviderRow {
    pub id: String,
    pub display_name: String,
    pub manifest_path: String,
    pub signature: Option<String>,
    pub enabled: bool,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct ProviderModelRow {
    pub provider_id: String,
    pub model_id: String,
    pub display_name: String,
    pub metadata_json: Option<String>,
}

#[derive(Debug, Clone)]
pub struct HeartbeatRow {
    pub id: String,
    pub agent_id: String,
    pub interval_minutes: i32,
    pub action_type: String,
    pub action_payload: Option<String>,
    pub enabled: bool,
    pub next_run_at: String,
    pub cron_expr: Option<String>,
    pub timezone: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct SkillRow {
    pub id: String,
    pub agent_id: String,
    pub name: String,
    pub version: String,
    pub source: Option<String>,
    pub status: String,
    pub raw_content: Option<String>,
    pub metadata_json: Option<String>,
    pub installed_at: String,
    pub approved_at: Option<String>,
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
pub struct WebhookRow {
    pub id: String,
    pub agent_id: String,
    pub label: String,
    pub url: String,
    pub secret_ref_id: Option<String>,
    pub event_filter: Option<String>,
    pub enabled: bool,
    pub retry_count: i32,
    pub timeout_seconds: i32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct WebhookDeliveryRow {
    pub id: String,
    pub webhook_id: String,
    pub event_id: Option<String>,
    pub status: String,
    pub attempt: i32,
    pub response_status: Option<i32>,
    pub response_body: Option<String>,
    pub error: Option<String>,
    pub delivered_at: Option<String>,
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
