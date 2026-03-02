use rusqlite::{Connection, params};
use moxxy_types::StorageError;
use crate::rows::AgentRow;

pub struct AgentDao<'a> {
    pub conn: &'a Connection,
}

impl<'a> AgentDao<'a> {
    pub fn insert(&self, row: &AgentRow) -> Result<(), StorageError> {
        self.conn
            .execute(
                "INSERT INTO agents (id, parent_agent_id, provider_id, model_id, workspace_root,
                 core_mount, policy_profile, temperature, max_subagent_depth, max_subagents_total,
                 status, depth, spawned_total, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
                params![
                    row.id,
                    row.parent_agent_id,
                    row.provider_id,
                    row.model_id,
                    row.workspace_root,
                    row.core_mount,
                    row.policy_profile,
                    row.temperature,
                    row.max_subagent_depth,
                    row.max_subagents_total,
                    row.status,
                    row.depth,
                    row.spawned_total,
                    row.created_at,
                    row.updated_at,
                ],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;
        Ok(())
    }

    pub fn find_by_id(&self, id: &str) -> Result<Option<AgentRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, parent_agent_id, provider_id, model_id, workspace_root,
                 core_mount, policy_profile, temperature, max_subagent_depth, max_subagents_total,
                 status, depth, spawned_total, created_at, updated_at
                 FROM agents WHERE id = ?1",
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

    pub fn list_all(&self) -> Result<Vec<AgentRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, parent_agent_id, provider_id, model_id, workspace_root,
                 core_mount, policy_profile, temperature, max_subagent_depth, max_subagents_total,
                 status, depth, spawned_total, created_at, updated_at
                 FROM agents",
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
                "UPDATE agents SET status = ?1, updated_at = ?2 WHERE id = ?3",
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
            .execute("DELETE FROM agents WHERE id = ?1", params![id])
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        if affected == 0 {
            return Err(StorageError::NotFound);
        }
        Ok(())
    }

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentRow> {
        Ok(AgentRow {
            id: row.get(0)?,
            parent_agent_id: row.get(1)?,
            provider_id: row.get(2)?,
            model_id: row.get(3)?,
            workspace_root: row.get(4)?,
            core_mount: row.get(5)?,
            policy_profile: row.get(6)?,
            temperature: row.get(7)?,
            max_subagent_depth: row.get(8)?,
            max_subagents_total: row.get(9)?,
            status: row.get(10)?,
            depth: row.get(11)?,
            spawned_total: row.get(12)?,
            created_at: row.get(13)?,
            updated_at: row.get(14)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use moxxy_test_utils::TestDb;
    use crate::fixtures::*;

    fn insert_provider_for_agent(db: &TestDb) {
        let provider = fixture_provider_row();
        db.conn()
            .execute(
                "INSERT INTO providers (id, display_name, manifest_path, signature, enabled, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    provider.id,
                    provider.display_name,
                    provider.manifest_path,
                    provider.signature,
                    provider.enabled,
                    provider.created_at,
                ],
            )
            .unwrap();
    }

    #[test]
    fn insert_and_find_by_id() {
        let db = TestDb::new();
        insert_provider_for_agent(&db);
        let dao = AgentDao { conn: db.conn() };
        let agent = fixture_agent_row();
        dao.insert(&agent).unwrap();
        let found = dao.find_by_id(&agent.id).unwrap().unwrap();
        assert_eq!(found.id, agent.id);
        assert_eq!(found.provider_id, agent.provider_id);
        assert_eq!(found.status, "idle");
    }

    #[test]
    fn find_returns_none_for_missing() {
        let db = TestDb::new();
        let dao = AgentDao { conn: db.conn() };
        let found = dao.find_by_id("nonexistent").unwrap();
        assert!(found.is_none());
    }

    #[test]
    fn list_returns_all() {
        let db = TestDb::new();
        insert_provider_for_agent(&db);
        let dao = AgentDao { conn: db.conn() };
        let a1 = fixture_agent_row();
        let mut a2 = fixture_agent_row();
        a2.id = uuid::Uuid::now_v7().to_string();
        dao.insert(&a1).unwrap();
        dao.insert(&a2).unwrap();
        let all = dao.list_all().unwrap();
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn update_status() {
        let db = TestDb::new();
        insert_provider_for_agent(&db);
        let dao = AgentDao { conn: db.conn() };
        let agent = fixture_agent_row();
        dao.insert(&agent).unwrap();
        dao.update_status(&agent.id, "running").unwrap();
        let found = dao.find_by_id(&agent.id).unwrap().unwrap();
        assert_eq!(found.status, "running");
    }

    #[test]
    fn delete_agent() {
        let db = TestDb::new();
        insert_provider_for_agent(&db);
        let dao = AgentDao { conn: db.conn() };
        let agent = fixture_agent_row();
        dao.insert(&agent).unwrap();
        dao.delete(&agent.id).unwrap();
        let found = dao.find_by_id(&agent.id).unwrap();
        assert!(found.is_none());
    }

    #[test]
    fn delete_nonexistent_returns_not_found() {
        let db = TestDb::new();
        let dao = AgentDao { conn: db.conn() };
        let result = dao.delete("nonexistent");
        assert!(matches!(result, Err(StorageError::NotFound)));
    }
}
