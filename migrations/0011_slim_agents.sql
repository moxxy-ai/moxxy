-- Slim down agents table: move config fields to agent.yaml files on disk.
-- Keep only: id, parent_agent_id, name, status, depth, spawned_total, workspace_root, created_at, updated_at.

CREATE TABLE IF NOT EXISTS agents_new (
    id TEXT PRIMARY KEY NOT NULL,
    parent_agent_id TEXT,
    name TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    depth INTEGER NOT NULL DEFAULT 0,
    spawned_total INTEGER NOT NULL DEFAULT 0,
    workspace_root TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (parent_agent_id) REFERENCES agents_new(id)
);

INSERT INTO agents_new (id, parent_agent_id, name, status, depth, spawned_total, workspace_root, created_at, updated_at)
SELECT id, parent_agent_id, name, status, depth, spawned_total, workspace_root, created_at, updated_at
FROM agents;

DROP TABLE agents;
ALTER TABLE agents_new RENAME TO agents;

CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_parent ON agents(parent_agent_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_name ON agents(name);
