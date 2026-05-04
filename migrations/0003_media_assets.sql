CREATE TABLE IF NOT EXISTS media_assets (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL,
    mime TEXT NOT NULL,
    filename TEXT NOT NULL,
    local_path TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL UNIQUE,
    source_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_media_assets_kind_created
    ON media_assets(kind, created_at);

CREATE INDEX IF NOT EXISTS idx_media_assets_sha256
    ON media_assets(sha256);
