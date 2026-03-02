PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS api_tokens (
    id TEXT PRIMARY KEY NOT NULL,
    created_by TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    scopes_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT,
    status TEXT NOT NULL DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_api_tokens_status ON api_tokens(status);

CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY NOT NULL,
    display_name TEXT NOT NULL,
    manifest_path TEXT NOT NULL,
    signature TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_models (
    provider_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    metadata_json TEXT,
    PRIMARY KEY (provider_id, model_id),
    FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY NOT NULL,
    parent_agent_id TEXT,
    provider_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    workspace_root TEXT NOT NULL,
    core_mount TEXT,
    policy_profile TEXT,
    temperature REAL DEFAULT 0.7,
    max_subagent_depth INTEGER DEFAULT 2,
    max_subagents_total INTEGER DEFAULT 8,
    status TEXT NOT NULL DEFAULT 'idle',
    depth INTEGER NOT NULL DEFAULT 0,
    spawned_total INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (provider_id) REFERENCES providers(id),
    FOREIGN KEY (parent_agent_id) REFERENCES agents(id)
);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_parent ON agents(parent_agent_id);

CREATE TABLE IF NOT EXISTS heartbeats (
    id TEXT PRIMARY KEY NOT NULL,
    agent_id TEXT NOT NULL,
    interval_minutes INTEGER NOT NULL CHECK (interval_minutes >= 1),
    action_type TEXT NOT NULL,
    action_payload TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    next_run_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_heartbeats_agent ON heartbeats(agent_id);
CREATE INDEX IF NOT EXISTS idx_heartbeats_next_run ON heartbeats(next_run_at);

CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY NOT NULL,
    agent_id TEXT NOT NULL,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    source TEXT,
    status TEXT NOT NULL DEFAULT 'quarantined',
    raw_content TEXT,
    metadata_json TEXT,
    installed_at TEXT NOT NULL,
    approved_at TEXT,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_skills_agent ON skills(agent_id);
CREATE INDEX IF NOT EXISTS idx_skills_status ON skills(status);

CREATE TABLE IF NOT EXISTS memory_index (
    id TEXT PRIMARY KEY NOT NULL,
    agent_id TEXT NOT NULL,
    markdown_path TEXT NOT NULL,
    tags_json TEXT,
    chunk_hash TEXT,
    embedding_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_memory_agent ON memory_index(agent_id);

CREATE TABLE IF NOT EXISTS memory_vec (
    rowid INTEGER PRIMARY KEY AUTOINCREMENT,
    memory_id TEXT NOT NULL,
    embedding BLOB,
    FOREIGN KEY (memory_id) REFERENCES memory_index(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS vault_secret_refs (
    id TEXT PRIMARY KEY NOT NULL,
    key_name TEXT NOT NULL UNIQUE,
    backend_key TEXT NOT NULL,
    policy_label TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vault_key_name ON vault_secret_refs(key_name);

CREATE TABLE IF NOT EXISTS vault_grants (
    id TEXT PRIMARY KEY NOT NULL,
    agent_id TEXT NOT NULL,
    secret_ref_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    revoked_at TEXT,
    UNIQUE(agent_id, secret_ref_id),
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
    FOREIGN KEY (secret_ref_id) REFERENCES vault_secret_refs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_vault_grants_agent ON vault_grants(agent_id);

CREATE TABLE IF NOT EXISTS event_audit (
    event_id TEXT PRIMARY KEY NOT NULL,
    ts INTEGER NOT NULL,
    agent_id TEXT,
    run_id TEXT,
    parent_run_id TEXT,
    sequence INTEGER NOT NULL DEFAULT 0,
    event_type TEXT NOT NULL,
    payload_json TEXT,
    redactions_json TEXT,
    sensitive INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_event_audit_agent ON event_audit(agent_id);
CREATE INDEX IF NOT EXISTS idx_event_audit_ts ON event_audit(ts);
CREATE INDEX IF NOT EXISTS idx_event_audit_type ON event_audit(event_type);
