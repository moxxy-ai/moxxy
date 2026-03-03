-- Drop old outbound webhook tables and recreate for inbound webhooks
DROP TABLE IF EXISTS webhook_deliveries;
DROP TABLE IF EXISTS webhooks;

CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY NOT NULL,
    agent_id TEXT NOT NULL,
    label TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    secret_ref_id TEXT NOT NULL,
    event_filter TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
    FOREIGN KEY (secret_ref_id) REFERENCES vault_secret_refs(id)
);
CREATE INDEX IF NOT EXISTS idx_webhooks_agent ON webhooks(agent_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhooks_token ON webhooks(token);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id TEXT PRIMARY KEY NOT NULL,
    webhook_id TEXT NOT NULL,
    source_ip TEXT,
    headers_json TEXT,
    body TEXT,
    signature_valid INTEGER NOT NULL DEFAULT 0,
    run_id TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_deliveries_webhook ON webhook_deliveries(webhook_id, created_at);
