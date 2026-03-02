use crate::rows::AgentRow;
use moxxy_types::StorageError;
use rusqlite::{Connection, params};

pub struct AgentDao<'a> {
    pub conn: &'a Connection,
}

impl<'a> AgentDao<'a> {
    pub fn insert(&self, row: &AgentRow) -> Result<(), StorageError> {
        self.conn
            .execute(
                "INSERT INTO agents (id, parent_agent_id, provider_id, model_id, workspace_root,
                 core_mount, policy_profile, temperature, max_subagent_depth, max_subagents_total,
                 status, depth, spawned_total, created_at, updated_at, name, persona)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
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
                    row.name,
                    row.persona,
                ],
            )
            .map_err(|e| {
                if e.to_string().contains("UNIQUE constraint failed") {
                    StorageError::DuplicateKey(e.to_string())
                } else {
                    StorageError::QueryFailed(e.to_string())
                }
            })?;
        Ok(())
    }

    pub fn find_by_id(&self, id: &str) -> Result<Option<AgentRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, parent_agent_id, provider_id, model_id, workspace_root,
                 core_mount, policy_profile, temperature, max_subagent_depth, max_subagents_total,
                 status, depth, spawned_total, created_at, updated_at, name, persona
                 FROM agents WHERE id = ?1",
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

    pub fn find_by_name(&self, name: &str) -> Result<Option<AgentRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, parent_agent_id, provider_id, model_id, workspace_root,
                 core_mount, policy_profile, temperature, max_subagent_depth, max_subagents_total,
                 status, depth, spawned_total, created_at, updated_at, name, persona
                 FROM agents WHERE name = ?1",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let mut rows = stmt
            .query_map(params![name], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        match rows.next() {
            Some(r) => Ok(Some(
                r.map_err(|e| StorageError::QueryFailed(e.to_string()))?,
            )),
            None => Ok(None),
        }
    }

    pub fn list_all(&self) -> Result<Vec<AgentRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, parent_agent_id, provider_id, model_id, workspace_root,
                 core_mount, policy_profile, temperature, max_subagent_depth, max_subagents_total,
                 status, depth, spawned_total, created_at, updated_at, name, persona
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

    pub fn increment_spawned_total(&self, id: &str) -> Result<(), StorageError> {
        let now = chrono::Utc::now().to_rfc3339();
        let affected = self
            .conn
            .execute(
                "UPDATE agents SET spawned_total = spawned_total + 1, updated_at = ?1 WHERE id = ?2",
                params![now, id],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        if affected == 0 {
            return Err(StorageError::NotFound);
        }
        Ok(())
    }

    pub fn update_config(
        &self,
        id: &str,
        provider_id: &str,
        model_id: &str,
        temperature: f64,
    ) -> Result<(), StorageError> {
        let now = chrono::Utc::now().to_rfc3339();
        let affected = self
            .conn
            .execute(
                "UPDATE agents SET provider_id = ?1, model_id = ?2, temperature = ?3, updated_at = ?4 WHERE id = ?5",
                params![provider_id, model_id, temperature, now, id],
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

    pub fn find_by_status(&self, status: &str) -> Result<Vec<AgentRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, parent_agent_id, provider_id, model_id, workspace_root,
                 core_mount, policy_profile, temperature, max_subagent_depth, max_subagents_total,
                 status, depth, spawned_total, created_at, updated_at, name, persona
                 FROM agents WHERE status = ?1",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let rows = stmt
            .query_map(params![status], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| StorageError::QueryFailed(e.to_string()))
    }

    pub fn find_by_parent(&self, parent_id: &str) -> Result<Vec<AgentRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, parent_agent_id, provider_id, model_id, workspace_root,
                 core_mount, policy_profile, temperature, max_subagent_depth, max_subagents_total,
                 status, depth, spawned_total, created_at, updated_at, name, persona
                 FROM agents WHERE parent_agent_id = ?1",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let rows = stmt
            .query_map(params![parent_id], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| StorageError::QueryFailed(e.to_string()))
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
            name: row.get(15)?,
            persona: row.get(16)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fixtures::*;
    use moxxy_test_utils::TestDb;

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
        a2.name = Some("test-agent-2".into());
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

    #[test]
    fn increment_spawned_total() {
        let db = TestDb::new();
        insert_provider_for_agent(&db);
        let dao = AgentDao { conn: db.conn() };
        let agent = fixture_agent_row();
        dao.insert(&agent).unwrap();
        assert_eq!(dao.find_by_id(&agent.id).unwrap().unwrap().spawned_total, 0);

        dao.increment_spawned_total(&agent.id).unwrap();
        assert_eq!(dao.find_by_id(&agent.id).unwrap().unwrap().spawned_total, 1);

        dao.increment_spawned_total(&agent.id).unwrap();
        assert_eq!(dao.find_by_id(&agent.id).unwrap().unwrap().spawned_total, 2);
    }

    #[test]
    fn find_by_status() {
        let db = TestDb::new();
        insert_provider_for_agent(&db);
        let dao = AgentDao { conn: db.conn() };
        let agent = fixture_agent_row();
        dao.insert(&agent).unwrap();
        dao.update_status(&agent.id, "running").unwrap();

        let running = dao.find_by_status("running").unwrap();
        assert_eq!(running.len(), 1);
        assert_eq!(running[0].id, agent.id);

        let idle = dao.find_by_status("idle").unwrap();
        assert!(idle.is_empty());
    }

    #[test]
    fn find_by_parent() {
        let db = TestDb::new();
        insert_provider_for_agent(&db);
        let dao = AgentDao { conn: db.conn() };
        let parent = fixture_agent_row();
        dao.insert(&parent).unwrap();

        let mut child = fixture_agent_row();
        child.id = uuid::Uuid::now_v7().to_string();
        child.name = Some("test-agent-child".into());
        child.parent_agent_id = Some(parent.id.clone());
        child.depth = 1;
        dao.insert(&child).unwrap();

        let children = dao.find_by_parent(&parent.id).unwrap();
        assert_eq!(children.len(), 1);
        assert_eq!(children[0].id, child.id);
    }

    #[test]
    fn update_config_changes_provider_and_model() {
        let db = TestDb::new();
        insert_provider_for_agent(&db);
        // Insert a second provider for the update target
        db.conn()
            .execute(
                "INSERT INTO providers (id, display_name, manifest_path, signature, enabled, created_at)
                 VALUES ('new-provider', 'New Provider', '/tmp/new.yaml', NULL, 1, '2024-01-01T00:00:00Z')",
                [],
            )
            .unwrap();
        let dao = AgentDao { conn: db.conn() };
        let agent = fixture_agent_row();
        dao.insert(&agent).unwrap();

        dao.update_config(&agent.id, "new-provider", "new-model", 1.0)
            .unwrap();
        let found = dao.find_by_id(&agent.id).unwrap().unwrap();
        assert_eq!(found.provider_id, "new-provider");
        assert_eq!(found.model_id, "new-model");
        assert!((found.temperature - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn update_config_nonexistent_returns_not_found() {
        let db = TestDb::new();
        let dao = AgentDao { conn: db.conn() };
        let result = dao.update_config("nonexistent", "p", "m", 0.5);
        assert!(matches!(result, Err(StorageError::NotFound)));
    }

    #[test]
    fn increment_spawned_total_nonexistent_returns_not_found() {
        let db = TestDb::new();
        let dao = AgentDao { conn: db.conn() };
        let result = dao.increment_spawned_total("nonexistent");
        assert!(matches!(result, Err(StorageError::NotFound)));
    }

    #[test]
    fn find_by_name_works() {
        let db = TestDb::new();
        insert_provider_for_agent(&db);
        let dao = AgentDao { conn: db.conn() };
        let agent = fixture_agent_row();
        dao.insert(&agent).unwrap();
        let found = dao.find_by_name("test-agent").unwrap().unwrap();
        assert_eq!(found.id, agent.id);
        assert_eq!(found.name.as_deref(), Some("test-agent"));
    }

    #[test]
    fn find_by_name_returns_none_for_missing() {
        let db = TestDb::new();
        let dao = AgentDao { conn: db.conn() };
        let found = dao.find_by_name("nonexistent").unwrap();
        assert!(found.is_none());
    }

    #[test]
    fn duplicate_name_insert_fails() {
        let db = TestDb::new();
        insert_provider_for_agent(&db);
        let dao = AgentDao { conn: db.conn() };
        let a1 = fixture_agent_row();
        dao.insert(&a1).unwrap();

        let mut a2 = fixture_agent_row();
        a2.id = uuid::Uuid::now_v7().to_string();
        // Same name as a1 → should fail
        let result = dao.insert(&a2);
        assert!(matches!(result, Err(StorageError::DuplicateKey(_))));
    }
}
