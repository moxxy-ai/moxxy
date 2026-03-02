use crate::rows::ChannelPairingCodeRow;
use moxxy_types::StorageError;
use rusqlite::{Connection, params};

pub struct ChannelPairingDao<'a> {
    pub conn: &'a Connection,
}

impl<'a> ChannelPairingDao<'a> {
    pub fn insert(&self, row: &ChannelPairingCodeRow) -> Result<(), StorageError> {
        self.conn
            .execute(
                "INSERT INTO channel_pairing_codes (id, channel_id, external_chat_id, code, expires_at, consumed, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    row.id,
                    row.channel_id,
                    row.external_chat_id,
                    row.code,
                    row.expires_at,
                    row.consumed,
                    row.created_at,
                ],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;
        Ok(())
    }

    pub fn find_by_code(&self, code: &str) -> Result<Option<ChannelPairingCodeRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, channel_id, external_chat_id, code, expires_at, consumed, created_at
                 FROM channel_pairing_codes WHERE code = ?1",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let mut rows = stmt
            .query_map(params![code], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        match rows.next() {
            Some(r) => Ok(Some(
                r.map_err(|e| StorageError::QueryFailed(e.to_string()))?,
            )),
            None => Ok(None),
        }
    }

    pub fn consume(&self, id: &str) -> Result<(), StorageError> {
        let affected = self
            .conn
            .execute(
                "UPDATE channel_pairing_codes SET consumed = 1 WHERE id = ?1",
                params![id],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        if affected == 0 {
            return Err(StorageError::NotFound);
        }
        Ok(())
    }

    pub fn delete_expired(&self) -> Result<usize, StorageError> {
        let now = chrono::Utc::now().to_rfc3339();
        let affected = self
            .conn
            .execute(
                "DELETE FROM channel_pairing_codes WHERE expires_at < ?1",
                params![now],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;
        Ok(affected)
    }

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ChannelPairingCodeRow> {
        Ok(ChannelPairingCodeRow {
            id: row.get(0)?,
            channel_id: row.get(1)?,
            external_chat_id: row.get(2)?,
            code: row.get(3)?,
            expires_at: row.get(4)?,
            consumed: row.get(5)?,
            created_at: row.get(6)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dao::channel::ChannelDao;
    use crate::fixtures::*;
    use moxxy_test_utils::TestDb;

    fn seed_channel(db: &TestDb) -> String {
        let secret = fixture_vault_secret_ref_row();
        db.conn()
            .execute(
                "INSERT INTO vault_secret_refs (id, key_name, backend_key, policy_label, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    secret.id, secret.key_name, secret.backend_key,
                    secret.policy_label, secret.created_at, secret.updated_at,
                ],
            )
            .unwrap();

        let mut channel = fixture_channel_row();
        channel.vault_secret_ref_id = secret.id;
        let channel_dao = ChannelDao { conn: db.conn() };
        channel_dao.insert(&channel).unwrap();
        channel.id
    }

    #[test]
    fn insert_and_find_by_code() {
        let db = TestDb::new();
        let channel_id = seed_channel(&db);
        let dao = ChannelPairingDao { conn: db.conn() };
        let mut code = fixture_channel_pairing_code_row();
        code.channel_id = channel_id;
        dao.insert(&code).unwrap();
        let found = dao.find_by_code(&code.code).unwrap().unwrap();
        assert_eq!(found.id, code.id);
        assert!(!found.consumed);
    }

    #[test]
    fn consume_code() {
        let db = TestDb::new();
        let channel_id = seed_channel(&db);
        let dao = ChannelPairingDao { conn: db.conn() };
        let mut code = fixture_channel_pairing_code_row();
        code.channel_id = channel_id;
        dao.insert(&code).unwrap();
        dao.consume(&code.id).unwrap();
        let found = dao.find_by_code(&code.code).unwrap().unwrap();
        assert!(found.consumed);
    }

    #[test]
    fn delete_expired() {
        let db = TestDb::new();
        let channel_id = seed_channel(&db);
        let dao = ChannelPairingDao { conn: db.conn() };
        let mut code = fixture_channel_pairing_code_row();
        code.channel_id = channel_id;
        // Set expires_at to the past
        code.expires_at = "2020-01-01T00:00:00Z".into();
        dao.insert(&code).unwrap();
        let deleted = dao.delete_expired().unwrap();
        assert_eq!(deleted, 1);
        assert!(dao.find_by_code(&code.code).unwrap().is_none());
    }

    #[test]
    fn find_returns_none_for_missing() {
        let db = TestDb::new();
        let dao = ChannelPairingDao { conn: db.conn() };
        assert!(dao.find_by_code("000000").unwrap().is_none());
    }
}
