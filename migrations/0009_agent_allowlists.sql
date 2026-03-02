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
