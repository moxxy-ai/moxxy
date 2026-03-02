use crate::rows::StoredTokenRow;
use moxxy_types::StorageError;
use rusqlite::{Connection, params};

pub struct TokenDao<'a> {
    pub conn: &'a Connection,
}

impl<'a> TokenDao<'a> {
    pub fn insert(&self, row: &StoredTokenRow) -> Result<(), StorageError> {
        self.conn
            .execute(
                "INSERT INTO api_tokens (id, created_by, token_hash, scopes_json, created_at, expires_at, status)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    row.id,
                    row.created_by,
                    row.token_hash,
                    row.scopes_json,
                    row.created_at,
                    row.expires_at,
                    row.status,
                ],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;
        Ok(())
    }

    pub fn find_by_id(&self, id: &str) -> Result<Option<StoredTokenRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, created_by, token_hash, scopes_json, created_at, expires_at, status
                 FROM api_tokens WHERE id = ?1",
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

    pub fn find_by_hash(&self, hash: &str) -> Result<Option<StoredTokenRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, created_by, token_hash, scopes_json, created_at, expires_at, status
                 FROM api_tokens WHERE token_hash = ?1",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let mut rows = stmt
            .query_map(params![hash], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        match rows.next() {
            Some(r) => Ok(Some(
                r.map_err(|e| StorageError::QueryFailed(e.to_string()))?,
            )),
            None => Ok(None),
        }
    }

    pub fn list_all(&self) -> Result<Vec<StoredTokenRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, created_by, token_hash, scopes_json, created_at, expires_at, status
                 FROM api_tokens",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let rows = stmt
            .query_map([], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| StorageError::QueryFailed(e.to_string()))
    }

    pub fn revoke(&self, id: &str) -> Result<(), StorageError> {
        let affected = self
            .conn
            .execute(
                "UPDATE api_tokens SET status = 'revoked' WHERE id = ?1",
                params![id],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        if affected == 0 {
            return Err(StorageError::NotFound);
        }
        Ok(())
    }

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredTokenRow> {
        Ok(StoredTokenRow {
            id: row.get(0)?,
            created_by: row.get(1)?,
            token_hash: row.get(2)?,
            scopes_json: row.get(3)?,
            created_at: row.get(4)?,
            expires_at: row.get(5)?,
            status: row.get(6)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fixtures::*;
    use moxxy_test_utils::TestDb;

    #[test]
    fn insert_and_find_by_id() {
        let db = TestDb::new();
        let dao = TokenDao { conn: db.conn() };
        let token = fixture_stored_token();
        dao.insert(&token).unwrap();
        let found = dao.find_by_id(&token.id).unwrap().unwrap();
        assert_eq!(found.id, token.id);
        assert_eq!(found.token_hash, token.token_hash);
    }

    #[test]
    fn find_returns_none_for_missing() {
        let db = TestDb::new();
        let dao = TokenDao { conn: db.conn() };
        let found = dao.find_by_id("nonexistent").unwrap();
        assert!(found.is_none());
    }

    #[test]
    fn list_returns_all() {
        let db = TestDb::new();
        let dao = TokenDao { conn: db.conn() };
        let t1 = fixture_stored_token();
        let mut t2 = fixture_stored_token();
        t2.token_hash = "different_hash".into();
        dao.insert(&t1).unwrap();
        dao.insert(&t2).unwrap();
        let all = dao.list_all().unwrap();
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn find_by_hash() {
        let db = TestDb::new();
        let dao = TokenDao { conn: db.conn() };
        let token = fixture_stored_token();
        dao.insert(&token).unwrap();
        let found = dao.find_by_hash(&token.token_hash).unwrap().unwrap();
        assert_eq!(found.id, token.id);
    }

    #[test]
    fn revoke_sets_status() {
        let db = TestDb::new();
        let dao = TokenDao { conn: db.conn() };
        let token = fixture_stored_token();
        dao.insert(&token).unwrap();
        dao.revoke(&token.id).unwrap();
        let found = dao.find_by_id(&token.id).unwrap().unwrap();
        assert_eq!(found.status, "revoked");
    }

    #[test]
    fn revoke_nonexistent_returns_not_found() {
        let db = TestDb::new();
        let dao = TokenDao { conn: db.conn() };
        let result = dao.revoke("nonexistent");
        assert!(matches!(result, Err(StorageError::NotFound)));
    }
}
