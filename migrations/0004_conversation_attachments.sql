CREATE TABLE IF NOT EXISTS conversation_attachments (
    id TEXT PRIMARY KEY NOT NULL,
    conversation_id TEXT NOT NULL,
    media_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE(conversation_id, media_id),
    FOREIGN KEY (conversation_id) REFERENCES conversation_log(id) ON DELETE CASCADE,
    FOREIGN KEY (media_id) REFERENCES media_assets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_conversation_attachments_conversation
    ON conversation_attachments(conversation_id, ordinal);

CREATE INDEX IF NOT EXISTS idx_conversation_attachments_media
    ON conversation_attachments(media_id);
