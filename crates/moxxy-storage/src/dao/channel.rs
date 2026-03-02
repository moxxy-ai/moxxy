use crate::rows::ChannelRow;
use moxxy_types::StorageError;
use rusqlite::{Connection, params};

pub struct ChannelDao<'a> {
    pub conn: &'a Connection,
}

impl<'a> ChannelDao<'a> {
    pub fn insert(&self, row: &ChannelRow) -> Result<(), StorageError> {
        self.conn
            .execute(
                "INSERT INTO channels (id, channel_type, display_name, vault_secret_ref_id, status, config_json, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    row.id,
                    row.channel_type,
                    row.display_name,
                    row.vault_secret_ref_id,
                    row.status,
                    row.config_json,
                    row.created_at,
                    row.updated_at,
                ],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;
        Ok(())
    }

    pub fn find_by_id(&self, id: &str) -> Result<Option<ChannelRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, channel_type, display_name, vault_secret_ref_id, status, config_json, created_at, updated_at
                 FROM channels WHERE id = ?1",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let mut rows = stmt
            .query_map(params![id], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        match rows.next() {
            Some(r) => Ok(Some(
                r.map_err(|e| StorageError::QueryFailed(e.to_string()))?,
            )),
            None => Ok(None),
        }
    }

    pub fn find_by_type(&self, channel_type: &str) -> Result<Vec<ChannelRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, channel_type, display_name, vault_secret_ref_id, status, config_json, created_at, updated_at
                 FROM channels WHERE channel_type = ?1",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let rows = stmt
            .query_map(params![channel_type], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| StorageError::QueryFailed(e.to_string()))
    }

    pub fn list_active(&self) -> Result<Vec<ChannelRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, channel_type, display_name, vault_secret_ref_id, status, config_json, created_at, updated_at
                 FROM channels WHERE status = 'active'",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let rows = stmt
            .query_map([], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| StorageError::QueryFailed(e.to_string()))
    }

    pub fn list_all(&self) -> Result<Vec<ChannelRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, channel_type, display_name, vault_secret_ref_id, status, config_json, created_at, updated_at
                 FROM channels",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let rows = stmt
            .query_map([], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| StorageError::QueryFailed(e.to_string()))
    }

    pub fn update_status(&self, id: &str, status: &str) -> Result<(), StorageError> {
        let now = chrono::Utc::now().to_rfc3339();
        let affected = self
            .conn
            .execute(
                "UPDATE channels SET status = ?1, updated_at = ?2 WHERE id = ?3",
                params![status, now, id],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        if affected == 0 {
            return Err(StorageError::NotFound);
        }
        Ok(())
    }

    pub fn delete(&self, id: &str) -> Result<(), StorageError> {
        let affected = self
            .conn
            .execute("DELETE FROM channels WHERE id = ?1", params![id])
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        if affected == 0 {
            return Err(StorageError::NotFound);
        }
        Ok(())
    }

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ChannelRow> {
        Ok(ChannelRow {
            id: row.get(0)?,
            channel_type: row.get(1)?,
            display_name: row.get(2)?,
            vault_secret_ref_id: row.get(3)?,
            status: row.get(4)?,
            config_json: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fixtures::*;
    use moxxy_test_utils::TestDb;

    fn seed_vault_ref(db: &TestDb) -> String {
        let secret = fixture_vault_secret_ref_row();
        db.conn()
            .execute(
                "INSERT INTO vault_secret_refs (id, key_name, backend_key, policy_label, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    secret.id, secret.key_name, secret.backend_key,
                    secret.policy_label, secret.created_at, secret.updated_at,
                ],
            )
            .unwrap();
        secret.id
    }

    #[test]
    fn insert_and_find_by_id() {
        let db = TestDb::new();
        let secret_id = seed_vault_ref(&db);
        let dao = ChannelDao { conn: db.conn() };
        let mut channel = fixture_channel_row();
        channel.vault_secret_ref_id = secret_id;
        dao.insert(&channel).unwrap();
        let found = dao.find_by_id(&channel.id).unwrap().unwrap();
        assert_eq!(found.id, channel.id);
        assert_eq!(found.channel_type, "telegram");
    }

    #[test]
    fn find_returns_none_for_missing() {
        let db = TestDb::new();
        let dao = ChannelDao { conn: db.conn() };
        let found = dao.find_by_id("nonexistent").unwrap();
        assert!(found.is_none());
    }

    #[test]
    fn find_by_type() {
        let db = TestDb::new();
        let secret_id = seed_vault_ref(&db);
        let dao = ChannelDao { conn: db.conn() };
        let mut channel = fixture_channel_row();
        channel.vault_secret_ref_id = secret_id;
        dao.insert(&channel).unwrap();
        let found = dao.find_by_type("telegram").unwrap();
        assert_eq!(found.len(), 1);
        let found_discord = dao.find_by_type("discord").unwrap();
        assert_eq!(found_discord.len(), 0);
    }

    #[test]
    fn list_active() {
        let db = TestDb::new();
        let secret_id = seed_vault_ref(&db);
        let dao = ChannelDao { conn: db.conn() };
        let mut channel = fixture_channel_row();
        channel.vault_secret_ref_id = secret_id;
        dao.insert(&channel).unwrap();
        // Status is 'pending' by default
        assert_eq!(dao.list_active().unwrap().len(), 0);
        dao.update_status(&channel.id, "active").unwrap();
        assert_eq!(dao.list_active().unwrap().len(), 1);
    }

    #[test]
    fn list_all() {
        let db = TestDb::new();
        let secret_id = seed_vault_ref(&db);
        let dao = ChannelDao { conn: db.conn() };
        let mut channel = fixture_channel_row();
        channel.vault_secret_ref_id = secret_id;
        dao.insert(&channel).unwrap();
        assert_eq!(dao.list_all().unwrap().len(), 1);
    }

    #[test]
    fn update_status() {
        let db = TestDb::new();
        let secret_id = seed_vault_ref(&db);
        let dao = ChannelDao { conn: db.conn() };
        let mut channel = fixture_channel_row();
        channel.vault_secret_ref_id = secret_id;
        dao.insert(&channel).unwrap();
        dao.update_status(&channel.id, "active").unwrap();
        let found = dao.find_by_id(&channel.id).unwrap().unwrap();
        assert_eq!(found.status, "active");
    }

    #[test]
    fn delete_channel() {
        let db = TestDb::new();
        let secret_id = seed_vault_ref(&db);
        let dao = ChannelDao { conn: db.conn() };
        let mut channel = fixture_channel_row();
        channel.vault_secret_ref_id = secret_id;
        dao.insert(&channel).unwrap();
        dao.delete(&channel.id).unwrap();
        assert!(dao.find_by_id(&channel.id).unwrap().is_none());
    }

    #[test]
    fn delete_nonexistent_returns_not_found() {
        let db = TestDb::new();
        let dao = ChannelDao { conn: db.conn() };
        let result = dao.delete("nonexistent");
        assert!(matches!(result, Err(StorageError::NotFound)));
    }
}
