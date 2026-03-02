use rusqlite::{Connection, params};
use moxxy_types::StorageError;
use crate::rows::{ProviderRow, ProviderModelRow};

pub struct ProviderDao<'a> {
    pub conn: &'a Connection,
}

impl<'a> ProviderDao<'a> {
    pub fn insert(&self, row: &ProviderRow) -> Result<(), StorageError> {
        self.conn
            .execute(
                "INSERT INTO providers (id, display_name, manifest_path, signature, enabled, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    row.id,
                    row.display_name,
                    row.manifest_path,
                    row.signature,
                    row.enabled,
                    row.created_at,
                ],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;
        Ok(())
    }

    pub fn find_by_id(&self, id: &str) -> Result<Option<ProviderRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, display_name, manifest_path, signature, enabled, created_at
                 FROM providers WHERE id = ?1",
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

    pub fn list_all(&self) -> Result<Vec<ProviderRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, display_name, manifest_path, signature, enabled, created_at
                 FROM providers",
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
            .execute("DELETE FROM providers WHERE id = ?1", params![id])
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        if affected == 0 {
            return Err(StorageError::NotFound);
        }
        Ok(())
    }

    pub fn insert_model(&self, row: &ProviderModelRow) -> Result<(), StorageError> {
        self.conn
            .execute(
                "INSERT INTO provider_models (provider_id, model_id, display_name, metadata_json)
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    row.provider_id,
                    row.model_id,
                    row.display_name,
                    row.metadata_json,
                ],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;
        Ok(())
    }

    pub fn list_models(&self, provider_id: &str) -> Result<Vec<ProviderModelRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT provider_id, model_id, display_name, metadata_json
                 FROM provider_models WHERE provider_id = ?1",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let rows = stmt
            .query_map(params![provider_id], |row| {
                Ok(ProviderModelRow {
                    provider_id: row.get(0)?,
                    model_id: row.get(1)?,
                    display_name: row.get(2)?,
                    metadata_json: row.get(3)?,
                })
            })
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| StorageError::QueryFailed(e.to_string()))
    }

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProviderRow> {
        Ok(ProviderRow {
            id: row.get(0)?,
            display_name: row.get(1)?,
            manifest_path: row.get(2)?,
            signature: row.get(3)?,
            enabled: row.get(4)?,
            created_at: row.get(5)?,
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
        let dao = ProviderDao { conn: db.conn() };
        let provider = fixture_provider_row();
        dao.insert(&provider).unwrap();
        let found = dao.find_by_id(&provider.id).unwrap().unwrap();
        assert_eq!(found.id, provider.id);
        assert_eq!(found.display_name, provider.display_name);
    }

    #[test]
    fn find_returns_none_for_missing() {
        let db = TestDb::new();
        let dao = ProviderDao { conn: db.conn() };
        let found = dao.find_by_id("nonexistent").unwrap();
        assert!(found.is_none());
    }

    #[test]
    fn list_returns_all() {
        let db = TestDb::new();
        let dao = ProviderDao { conn: db.conn() };
        let p1 = fixture_provider_row();
        let mut p2 = fixture_provider_row();
        p2.id = uuid::Uuid::now_v7().to_string();
        dao.insert(&p1).unwrap();
        dao.insert(&p2).unwrap();
        let all = dao.list_all().unwrap();
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn delete_provider() {
        let db = TestDb::new();
        let dao = ProviderDao { conn: db.conn() };
        let provider = fixture_provider_row();
        dao.insert(&provider).unwrap();
        dao.delete(&provider.id).unwrap();
        let found = dao.find_by_id(&provider.id).unwrap();
        assert!(found.is_none());
    }

    #[test]
    fn delete_nonexistent_returns_not_found() {
        let db = TestDb::new();
        let dao = ProviderDao { conn: db.conn() };
        let result = dao.delete("nonexistent");
        assert!(matches!(result, Err(StorageError::NotFound)));
    }

    #[test]
    fn insert_and_list_models() {
        let db = TestDb::new();
        let dao = ProviderDao { conn: db.conn() };
        let provider = fixture_provider_row();
        dao.insert(&provider).unwrap();

        let model = ProviderModelRow {
            provider_id: provider.id.clone(),
            model_id: "gpt-4".into(),
            display_name: "GPT-4".into(),
            metadata_json: Some(r#"{"context_window": 8192}"#.into()),
        };
        dao.insert_model(&model).unwrap();

        let models = dao.list_models(&provider.id).unwrap();
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].model_id, "gpt-4");
    }
}
