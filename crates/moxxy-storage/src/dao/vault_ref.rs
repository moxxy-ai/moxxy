use rusqlite::{Connection, params};
use moxxy_types::StorageError;
use crate::rows::VaultSecretRefRow;

pub struct VaultRefDao<'a> {
    pub conn: &'a Connection,
}

impl<'a> VaultRefDao<'a> {
    pub fn insert(&self, row: &VaultSecretRefRow) -> Result<(), StorageError> {
        self.conn
            .execute(
                "INSERT INTO vault_secret_refs (id, key_name, backend_key, policy_label, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    row.id,
                    row.key_name,
                    row.backend_key,
                    row.policy_label,
                    row.created_at,
                    row.updated_at,
                ],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;
        Ok(())
    }

    pub fn find_by_id(&self, id: &str) -> Result<Option<VaultSecretRefRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, key_name, backend_key, policy_label, created_at, updated_at
                 FROM vault_secret_refs WHERE id = ?1",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let mut rows = stmt
            .query_map(params![id], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        match rows.next() {
            Some(r) => Ok(Some(r.map_err(|e| StorageError::QueryFailed(e.to_string()))?)),
            None => Ok(None),
        }
    }

    pub fn find_by_key_name(&self, key_name: &str) -> Result<Option<VaultSecretRefRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, key_name, backend_key, policy_label, created_at, updated_at
                 FROM vault_secret_refs WHERE key_name = ?1",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let mut rows = stmt
            .query_map(params![key_name], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        match rows.next() {
            Some(r) => Ok(Some(r.map_err(|e| StorageError::QueryFailed(e.to_string()))?)),
            None => Ok(None),
        }
    }

    pub fn list_all(&self) -> Result<Vec<VaultSecretRefRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, key_name, backend_key, policy_label, created_at, updated_at
                 FROM vault_secret_refs",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let rows = stmt
            .query_map([], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| StorageError::QueryFailed(e.to_string()))
    }

    pub fn delete(&self, id: &str) -> Result<(), StorageError> {
        let affected = self
            .conn
            .execute("DELETE FROM vault_secret_refs WHERE id = ?1", params![id])
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        if affected == 0 {
            return Err(StorageError::NotFound);
        }
        Ok(())
    }

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<VaultSecretRefRow> {
        Ok(VaultSecretRefRow {
            id: row.get(0)?,
            key_name: row.get(1)?,
            backend_key: row.get(2)?,
            policy_label: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use moxxy_test_utils::TestDb;
    use crate::fixtures::*;

    #[test]
    fn insert_and_find_by_id() {
        let db = TestDb::new();
        let dao = VaultRefDao { conn: db.conn() };
        let secret = fixture_vault_secret_ref_row();
        dao.insert(&secret).unwrap();
        let found = dao.find_by_id(&secret.id).unwrap().unwrap();
        assert_eq!(found.id, secret.id);
        assert_eq!(found.key_name, secret.key_name);
    }

    #[test]
    fn find_returns_none_for_missing() {
        let db = TestDb::new();
        let dao = VaultRefDao { conn: db.conn() };
        let found = dao.find_by_id("nonexistent").unwrap();
        assert!(found.is_none());
    }

    #[test]
    fn find_by_key_name() {
        let db = TestDb::new();
        let dao = VaultRefDao { conn: db.conn() };
        let secret = fixture_vault_secret_ref_row();
        dao.insert(&secret).unwrap();
        let found = dao.find_by_key_name(&secret.key_name).unwrap().unwrap();
        assert_eq!(found.id, secret.id);
    }

    #[test]
    fn list_all() {
        let db = TestDb::new();
        let dao = VaultRefDao { conn: db.conn() };
        let s1 = fixture_vault_secret_ref_row();
        let mut s2 = fixture_vault_secret_ref_row();
        s2.id = uuid::Uuid::now_v7().to_string();
        s2.key_name = "another-key".into();
        dao.insert(&s1).unwrap();
        dao.insert(&s2).unwrap();
        let all = dao.list_all().unwrap();
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn delete_vault_ref() {
        let db = TestDb::new();
        let dao = VaultRefDao { conn: db.conn() };
        let secret = fixture_vault_secret_ref_row();
        dao.insert(&secret).unwrap();
        dao.delete(&secret.id).unwrap();
        let found = dao.find_by_id(&secret.id).unwrap();
        assert!(found.is_none());
    }

    #[test]
    fn delete_nonexistent_returns_not_found() {
        let db = TestDb::new();
        let dao = VaultRefDao { conn: db.conn() };
        let result = dao.delete("nonexistent");
        assert!(matches!(result, Err(StorageError::NotFound)));
    }
}
