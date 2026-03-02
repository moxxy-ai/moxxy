use crate::rows::MemoryIndexRow;
use moxxy_types::StorageError;
use rusqlite::{Connection, params};

pub struct MemoryDao<'a> {
    pub conn: &'a Connection,
}

impl<'a> MemoryDao<'a> {
    pub fn insert(&self, row: &MemoryIndexRow) -> Result<(), StorageError> {
        self.conn
            .execute(
                "INSERT INTO memory_index (id, agent_id, markdown_path, tags_json, chunk_hash,
                 embedding_id, status, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    row.id,
                    row.agent_id,
                    row.markdown_path,
                    row.tags_json,
                    row.chunk_hash,
                    row.embedding_id,
                    row.status,
                    row.created_at,
                    row.updated_at,
                ],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;
        Ok(())
    }

    pub fn find_by_id(&self, id: &str) -> Result<Option<MemoryIndexRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, agent_id, markdown_path, tags_json, chunk_hash,
                 embedding_id, status, created_at, updated_at
                 FROM memory_index WHERE id = ?1",
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

    pub fn find_by_agent(&self, agent_id: &str) -> Result<Vec<MemoryIndexRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, agent_id, markdown_path, tags_json, chunk_hash,
                 embedding_id, status, created_at, updated_at
                 FROM memory_index WHERE agent_id = ?1",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let rows = stmt
            .query_map(params![agent_id], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| StorageError::QueryFailed(e.to_string()))
    }

    pub fn list_all(&self) -> Result<Vec<MemoryIndexRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, agent_id, markdown_path, tags_json, chunk_hash,
                 embedding_id, status, created_at, updated_at
                 FROM memory_index",
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
            .execute("DELETE FROM memory_index WHERE id = ?1", params![id])
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        if affected == 0 {
            return Err(StorageError::NotFound);
        }
        Ok(())
    }

    pub fn insert_with_embedding(
        &self,
        row: &MemoryIndexRow,
        embedding: &[u8],
    ) -> Result<(), StorageError> {
        self.insert(row)?;
        self.conn
            .execute(
                "INSERT INTO memory_vec (memory_id, embedding) VALUES (?1, ?2)",
                params![row.id, embedding],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;
        Ok(())
    }

    pub fn search_similar(
        &self,
        agent_id: &str,
        _embedding: &[u8],
        limit: usize,
    ) -> Result<Vec<(MemoryIndexRow, f64)>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT mi.id, mi.agent_id, mi.markdown_path, mi.tags_json, mi.chunk_hash,
                 mi.embedding_id, mi.status, mi.created_at, mi.updated_at, mv.rowid
                 FROM memory_vec mv
                 JOIN memory_index mi ON mi.id = mv.memory_id
                 WHERE mi.agent_id = ?1 AND mi.status = 'active'
                 ORDER BY mv.rowid
                 LIMIT ?2",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let rows = stmt
            .query_map(params![agent_id, limit as i64], |row| {
                let mem = MemoryIndexRow {
                    id: row.get(0)?,
                    agent_id: row.get(1)?,
                    markdown_path: row.get(2)?,
                    tags_json: row.get(3)?,
                    chunk_hash: row.get(4)?,
                    embedding_id: row.get(5)?,
                    status: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                };
                Ok((mem, 0.0_f64))
            })
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| StorageError::QueryFailed(e.to_string()))
    }

    pub fn update_status(&self, id: &str, status: &str) -> Result<(), StorageError> {
        let affected = self
            .conn
            .execute(
                "UPDATE memory_index SET status = ?1, updated_at = ?2 WHERE id = ?3",
                params![status, chrono::Utc::now().to_rfc3339(), id],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        if affected == 0 {
            return Err(StorageError::NotFound);
        }
        Ok(())
    }

    pub fn delete_embedding(&self, memory_id: &str) -> Result<(), StorageError> {
        let affected = self
            .conn
            .execute(
                "DELETE FROM memory_vec WHERE memory_id = ?1",
                params![memory_id],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        if affected == 0 {
            return Err(StorageError::NotFound);
        }
        Ok(())
    }

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MemoryIndexRow> {
        Ok(MemoryIndexRow {
            id: row.get(0)?,
            agent_id: row.get(1)?,
            markdown_path: row.get(2)?,
            tags_json: row.get(3)?,
            chunk_hash: row.get(4)?,
            embedding_id: row.get(5)?,
            status: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fixtures::*;
    use moxxy_test_utils::TestDb;

    fn seed_agent(db: &TestDb) -> String {
        let provider = fixture_provider_row();
        db.conn()
            .execute(
                "INSERT INTO providers (id, display_name, manifest_path, signature, enabled, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    provider.id, provider.display_name, provider.manifest_path,
                    provider.signature, provider.enabled, provider.created_at,
                ],
            )
            .unwrap();

        let agent = fixture_agent_row();
        db.conn()
            .execute(
                "INSERT INTO agents (id, parent_agent_id, provider_id, model_id, workspace_root,
                 core_mount, policy_profile, temperature, max_subagent_depth, max_subagents_total,
                 status, depth, spawned_total, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
                params![
                    agent.id,
                    agent.parent_agent_id,
                    agent.provider_id,
                    agent.model_id,
                    agent.workspace_root,
                    agent.core_mount,
                    agent.policy_profile,
                    agent.temperature,
                    agent.max_subagent_depth,
                    agent.max_subagents_total,
                    agent.status,
                    agent.depth,
                    agent.spawned_total,
                    agent.created_at,
                    agent.updated_at,
                ],
            )
            .unwrap();
        agent.id
    }

    #[test]
    fn insert_and_find_by_id() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = MemoryDao { conn: db.conn() };
        let mut mem = fixture_memory_index_row();
        mem.agent_id = agent_id;
        dao.insert(&mem).unwrap();
        let found = dao.find_by_id(&mem.id).unwrap().unwrap();
        assert_eq!(found.id, mem.id);
        assert_eq!(found.markdown_path, mem.markdown_path);
        assert_eq!(found.status, "active");
    }

    #[test]
    fn find_returns_none_for_missing() {
        let db = TestDb::new();
        let dao = MemoryDao { conn: db.conn() };
        let found = dao.find_by_id("nonexistent").unwrap();
        assert!(found.is_none());
    }

    #[test]
    fn find_by_agent() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = MemoryDao { conn: db.conn() };
        let mut mem = fixture_memory_index_row();
        mem.agent_id = agent_id.clone();
        dao.insert(&mem).unwrap();
        let found = dao.find_by_agent(&agent_id).unwrap();
        assert_eq!(found.len(), 1);
    }

    #[test]
    fn list_all() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = MemoryDao { conn: db.conn() };
        let mut mem = fixture_memory_index_row();
        mem.agent_id = agent_id;
        dao.insert(&mem).unwrap();
        let all = dao.list_all().unwrap();
        assert_eq!(all.len(), 1);
    }

    #[test]
    fn delete_memory() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = MemoryDao { conn: db.conn() };
        let mut mem = fixture_memory_index_row();
        mem.agent_id = agent_id;
        dao.insert(&mem).unwrap();
        dao.delete(&mem.id).unwrap();
        let found = dao.find_by_id(&mem.id).unwrap();
        assert!(found.is_none());
    }

    #[test]
    fn delete_nonexistent_returns_not_found() {
        let db = TestDb::new();
        let dao = MemoryDao { conn: db.conn() };
        let result = dao.delete("nonexistent");
        assert!(matches!(result, Err(StorageError::NotFound)));
    }

    #[test]
    fn insert_with_embedding_and_search_similar() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = MemoryDao { conn: db.conn() };

        let mut mem = fixture_memory_index_row();
        mem.agent_id = agent_id.clone();
        let embedding: Vec<u8> = (0..384u32)
            .flat_map(|i| ((i % 256) as f32).to_le_bytes())
            .collect();
        dao.insert_with_embedding(&mem, &embedding).unwrap();

        let results = dao.search_similar(&agent_id, &embedding, 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].0.id, mem.id);
    }

    #[test]
    fn search_similar_filters_by_agent_id() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = MemoryDao { conn: db.conn() };

        let mut mem = fixture_memory_index_row();
        mem.agent_id = agent_id;
        let embedding: Vec<u8> = vec![0u8; 384 * 4];
        dao.insert_with_embedding(&mem, &embedding).unwrap();

        let results = dao
            .search_similar("nonexistent-agent", &embedding, 10)
            .unwrap();
        assert_eq!(results.len(), 0);
    }

    #[test]
    fn search_similar_respects_limit() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = MemoryDao { conn: db.conn() };

        let embedding: Vec<u8> = vec![0u8; 384 * 4];
        for _ in 0..5 {
            let mut mem = fixture_memory_index_row();
            mem.agent_id = agent_id.clone();
            dao.insert_with_embedding(&mem, &embedding).unwrap();
        }

        let results = dao.search_similar(&agent_id, &embedding, 3).unwrap();
        assert_eq!(results.len(), 3);
    }

    #[test]
    fn search_similar_excludes_archived() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = MemoryDao { conn: db.conn() };

        let embedding: Vec<u8> = vec![0u8; 384 * 4];

        let mut mem1 = fixture_memory_index_row();
        mem1.agent_id = agent_id.clone();
        dao.insert_with_embedding(&mem1, &embedding).unwrap();

        let mut mem2 = fixture_memory_index_row();
        mem2.agent_id = agent_id.clone();
        mem2.status = "archived".into();
        dao.insert_with_embedding(&mem2, &embedding).unwrap();

        let results = dao.search_similar(&agent_id, &embedding, 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].0.id, mem1.id);
    }

    #[test]
    fn update_status_works() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = MemoryDao { conn: db.conn() };

        let mut mem = fixture_memory_index_row();
        mem.agent_id = agent_id;
        dao.insert(&mem).unwrap();

        dao.update_status(&mem.id, "archived").unwrap();
        let found = dao.find_by_id(&mem.id).unwrap().unwrap();
        assert_eq!(found.status, "archived");
    }

    #[test]
    fn delete_embedding_works() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = MemoryDao { conn: db.conn() };

        let mut mem = fixture_memory_index_row();
        mem.agent_id = agent_id.clone();
        let embedding: Vec<u8> = vec![0u8; 384 * 4];
        dao.insert_with_embedding(&mem, &embedding).unwrap();

        dao.delete_embedding(&mem.id).unwrap();

        // After deleting embedding, search should return no results
        let results = dao.search_similar(&agent_id, &embedding, 10).unwrap();
        assert_eq!(results.len(), 0);
    }
}
