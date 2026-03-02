ALTER TABLE memory_index ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
CREATE INDEX IF NOT EXISTS idx_memory_status ON memory_index(status);
