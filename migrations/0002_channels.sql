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
