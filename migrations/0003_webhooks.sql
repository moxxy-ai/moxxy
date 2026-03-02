CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY NOT NULL,
    agent_id TEXT NOT NULL,
    label TEXT NOT NULL,
    url TEXT NOT NULL,
    secret_ref_id TEXT,
    event_filter TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    retry_count INTEGER NOT NULL DEFAULT 3,
    timeout_seconds INTEGER NOT NULL DEFAULT 10,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
    FOREIGN KEY (secret_ref_id) REFERENCES vault_secret_refs(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_webhooks_agent ON webhooks(agent_id);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id TEXT PRIMARY KEY NOT NULL,
    webhook_id TEXT NOT NULL,
    event_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    attempt INTEGER NOT NULL DEFAULT 0,
    response_status INTEGER,
    response_body TEXT,
    error TEXT,
    delivered_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_deliveries_webhook ON webhook_deliveries(webhook_id, created_at);
