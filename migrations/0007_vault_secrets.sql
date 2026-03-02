CREATE TABLE IF NOT EXISTS vault_secrets (
    backend_key TEXT PRIMARY KEY,
    secret_value TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
