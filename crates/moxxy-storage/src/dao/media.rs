use crate::rows::MediaAssetRow;
use moxxy_types::StorageError;
use rusqlite::params;

pub struct MediaDao<'a> {
    pub conn: &'a rusqlite::Connection,
}

impl<'a> MediaDao<'a> {
    pub fn insert_or_ignore(&self, row: &MediaAssetRow) -> Result<(), StorageError> {
        self.conn
            .execute(
                "INSERT OR IGNORE INTO media_assets
                 (id, kind, mime, filename, local_path, size_bytes, sha256, source_json, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    row.id,
                    row.kind,
                    row.mime,
                    row.filename,
                    row.local_path,
                    row.size_bytes,
                    row.sha256,
                    row.source_json,
                    row.created_at,
                ],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;
        Ok(())
    }

    pub fn find_by_id(&self, id: &str) -> Result<Option<MediaAssetRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, kind, mime, filename, local_path, size_bytes, sha256, source_json, created_at
                 FROM media_assets WHERE id = ?1",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let mut rows = stmt
            .query_map(params![id], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        rows.next()
            .transpose()
            .map_err(|e| StorageError::QueryFailed(e.to_string()))
    }

    pub fn find_by_sha256(&self, sha256: &str) -> Result<Option<MediaAssetRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, kind, mime, filename, local_path, size_bytes, sha256, source_json, created_at
                 FROM media_assets WHERE sha256 = ?1",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let mut rows = stmt
            .query_map(params![sha256], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        rows.next()
            .transpose()
            .map_err(|e| StorageError::QueryFailed(e.to_string()))
    }

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MediaAssetRow> {
        Ok(MediaAssetRow {
            id: row.get(0)?,
            kind: row.get(1)?,
            mime: row.get(2)?,
            filename: row.get(3)?,
            local_path: row.get(4)?,
            size_bytes: row.get(5)?,
            sha256: row.get(6)?,
            source_json: row.get(7)?,
            created_at: row.get(8)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_conn() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../../../../migrations/0001_init.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../../../migrations/0003_media_assets.sql"))
            .unwrap();
        conn
    }

    fn row() -> MediaAssetRow {
        MediaAssetRow {
            id: "media_abc".into(),
            kind: "image".into(),
            mime: "image/jpeg".into(),
            filename: "photo.jpg".into(),
            local_path: "/tmp/.moxxy/media/photo.jpg".into(),
            size_bytes: 123,
            sha256: "abc".into(),
            source_json: r#"{"channel":"telegram"}"#.into(),
            created_at: "2026-05-04T00:00:00Z".into(),
        }
    }

    #[test]
    fn insert_or_ignore_and_find_by_id() {
        let conn = setup_conn();
        let dao = MediaDao { conn: &conn };
        dao.insert_or_ignore(&row()).unwrap();

        let found = dao.find_by_id("media_abc").unwrap().unwrap();

        assert_eq!(found.kind, "image");
        assert_eq!(found.mime, "image/jpeg");
        assert_eq!(found.sha256, "abc");
        assert!(!found.source_json.contains("base64"));
    }

    #[test]
    fn find_by_sha256_returns_existing_asset() {
        let conn = setup_conn();
        let dao = MediaDao { conn: &conn };
        dao.insert_or_ignore(&row()).unwrap();
        dao.insert_or_ignore(&row()).unwrap();

        let found = dao.find_by_sha256("abc").unwrap().unwrap();

        assert_eq!(found.id, "media_abc");
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM media_assets", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }
}
