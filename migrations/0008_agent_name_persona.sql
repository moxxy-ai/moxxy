ALTER TABLE agents ADD COLUMN name TEXT;
ALTER TABLE agents ADD COLUMN persona TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_name ON agents(name);
