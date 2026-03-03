-- Add inline content column to memory_index for LTM entries.
-- markdown_path becomes optional (legacy); new entries use content directly.
ALTER TABLE memory_index ADD COLUMN content TEXT;
