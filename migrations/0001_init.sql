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

CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY NOT NULL,
    parent_agent_id TEXT,
    name TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    depth INTEGER NOT NULL DEFAULT 0,
    spawned_total INTEGER NOT NULL DEFAULT 0,
    workspace_root TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (parent_agent_id) REFERENCES agents(id)
);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_parent ON agents(parent_agent_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_name ON agents(name);

CREATE TABLE IF NOT EXISTS memory_index (
    id TEXT PRIMARY KEY NOT NULL,
    agent_id TEXT NOT NULL,
    markdown_path TEXT NOT NULL,
    tags_json TEXT,
    chunk_hash TEXT,
    embedding_id TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    content TEXT,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_memory_agent ON memory_index(agent_id);
CREATE INDEX IF NOT EXISTS idx_memory_status ON memory_index(status);

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

CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY NOT NULL,
    channel_type TEXT NOT NULL,
    display_name TEXT NOT NULL,
    vault_secret_ref_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    config_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (vault_secret_ref_id) REFERENCES vault_secret_refs(id)
);
CREATE INDEX IF NOT EXISTS idx_channels_type ON channels(channel_type);
CREATE INDEX IF NOT EXISTS idx_channels_status ON channels(status);

CREATE TABLE IF NOT EXISTS channel_bindings (
    id TEXT PRIMARY KEY NOT NULL,
    channel_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    external_chat_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(channel_id),
    FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_bindings_channel ON channel_bindings(channel_id);
CREATE INDEX IF NOT EXISTS idx_bindings_agent ON channel_bindings(agent_id);
CREATE INDEX IF NOT EXISTS idx_bindings_external ON channel_bindings(channel_id, external_chat_id);

CREATE TABLE IF NOT EXISTS channel_pairing_codes (
    id TEXT PRIMARY KEY NOT NULL,
    channel_id TEXT NOT NULL,
    external_chat_id TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    consumed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pairing_code ON channel_pairing_codes(code);
CREATE INDEX IF NOT EXISTS idx_pairing_expires ON channel_pairing_codes(expires_at);

CREATE TABLE IF NOT EXISTS conversation_log (
    id TEXT PRIMARY KEY NOT NULL,
    agent_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_conversation_agent_run ON conversation_log(agent_id, run_id, sequence);

CREATE TABLE IF NOT EXISTS vault_secrets (
    backend_key TEXT PRIMARY KEY,
    secret_value TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agent_allowlists (
    id TEXT PRIMARY KEY NOT NULL,
    agent_id TEXT NOT NULL,
    list_type TEXT NOT NULL,
    entry TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(agent_id, list_type, entry),
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_agent_allowlists_agent_type
    ON agent_allowlists(agent_id, list_type);

CREATE TABLE IF NOT EXISTS agent_denylists (
    id TEXT PRIMARY KEY NOT NULL,
    agent_id TEXT NOT NULL,
    list_type TEXT NOT NULL,
    entry TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(agent_id, list_type, entry),
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_agent_denylists_agent_type
    ON agent_denylists(agent_id, list_type);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id TEXT PRIMARY KEY NOT NULL,
    webhook_id TEXT NOT NULL,
    source_ip TEXT,
    headers_json TEXT,
    body TEXT,
    signature_valid INTEGER NOT NULL DEFAULT 0,
    run_id TEXT,
    error TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deliveries_webhook ON webhook_deliveries(webhook_id, created_at);
