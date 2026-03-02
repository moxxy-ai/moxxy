use crate::rows::SkillRow;
use moxxy_types::StorageError;
use rusqlite::{Connection, params};

pub struct SkillDao<'a> {
    pub conn: &'a Connection,
}

impl<'a> SkillDao<'a> {
    pub fn insert(&self, row: &SkillRow) -> Result<(), StorageError> {
        self.conn
            .execute(
                "INSERT INTO skills (id, agent_id, name, version, source, status,
                 raw_content, metadata_json, installed_at, approved_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    row.id,
                    row.agent_id,
                    row.name,
                    row.version,
                    row.source,
                    row.status,
                    row.raw_content,
                    row.metadata_json,
                    row.installed_at,
                    row.approved_at,
                ],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;
        Ok(())
    }

    pub fn find_by_id(&self, id: &str) -> Result<Option<SkillRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, agent_id, name, version, source, status,
                 raw_content, metadata_json, installed_at, approved_at
                 FROM skills WHERE id = ?1",
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

    pub fn find_by_agent(&self, agent_id: &str) -> Result<Vec<SkillRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, agent_id, name, version, source, status,
                 raw_content, metadata_json, installed_at, approved_at
                 FROM skills WHERE agent_id = ?1",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let rows = stmt
            .query_map(params![agent_id], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| StorageError::QueryFailed(e.to_string()))
    }

    pub fn update_status(&self, id: &str, status: &str) -> Result<(), StorageError> {
        let approved_at = if status == "approved" {
            Some(chrono::Utc::now().to_rfc3339())
        } else {
            None
        };

        let affected = self
            .conn
            .execute(
                "UPDATE skills SET status = ?1, approved_at = COALESCE(?2, approved_at) WHERE id = ?3",
                params![status, approved_at, id],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        if affected == 0 {
            return Err(StorageError::NotFound);
        }
        Ok(())
    }

    pub fn list_all(&self) -> Result<Vec<SkillRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, agent_id, name, version, source, status,
                 raw_content, metadata_json, installed_at, approved_at
                 FROM skills",
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
            .execute("DELETE FROM skills WHERE id = ?1", params![id])
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        if affected == 0 {
            return Err(StorageError::NotFound);
        }
        Ok(())
    }

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SkillRow> {
        Ok(SkillRow {
            id: row.get(0)?,
            agent_id: row.get(1)?,
            name: row.get(2)?,
            version: row.get(3)?,
            source: row.get(4)?,
            status: row.get(5)?,
            raw_content: row.get(6)?,
            metadata_json: row.get(7)?,
            installed_at: row.get(8)?,
            approved_at: row.get(9)?,
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
        let dao = SkillDao { conn: db.conn() };
        let mut skill = fixture_skill_row();
        skill.agent_id = agent_id;
        dao.insert(&skill).unwrap();
        let found = dao.find_by_id(&skill.id).unwrap().unwrap();
        assert_eq!(found.id, skill.id);
        assert_eq!(found.name, skill.name);
    }

    #[test]
    fn find_returns_none_for_missing() {
        let db = TestDb::new();
        let dao = SkillDao { conn: db.conn() };
        let found = dao.find_by_id("nonexistent").unwrap();
        assert!(found.is_none());
    }

    #[test]
    fn find_by_agent() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = SkillDao { conn: db.conn() };
        let mut skill = fixture_skill_row();
        skill.agent_id = agent_id.clone();
        dao.insert(&skill).unwrap();
        let found = dao.find_by_agent(&agent_id).unwrap();
        assert_eq!(found.len(), 1);
    }

    #[test]
    fn update_status_to_approved() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = SkillDao { conn: db.conn() };
        let mut skill = fixture_skill_row();
        skill.agent_id = agent_id;
        dao.insert(&skill).unwrap();
        dao.update_status(&skill.id, "approved").unwrap();
        let found = dao.find_by_id(&skill.id).unwrap().unwrap();
        assert_eq!(found.status, "approved");
        assert!(found.approved_at.is_some());
    }

    #[test]
    fn list_all() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = SkillDao { conn: db.conn() };
        let mut skill = fixture_skill_row();
        skill.agent_id = agent_id;
        dao.insert(&skill).unwrap();
        let all = dao.list_all().unwrap();
        assert_eq!(all.len(), 1);
    }

    #[test]
    fn delete_skill() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = SkillDao { conn: db.conn() };
        let mut skill = fixture_skill_row();
        skill.agent_id = agent_id;
        dao.insert(&skill).unwrap();
        dao.delete(&skill.id).unwrap();
        let found = dao.find_by_id(&skill.id).unwrap();
        assert!(found.is_none());
    }

    #[test]
    fn delete_nonexistent_skill_returns_not_found() {
        let db = TestDb::new();
        let dao = SkillDao { conn: db.conn() };
        let result = dao.delete("nonexistent");
        assert!(matches!(result, Err(StorageError::NotFound)));
    }

    #[test]
    fn update_status_nonexistent_returns_not_found() {
        let db = TestDb::new();
        let dao = SkillDao { conn: db.conn() };
        let result = dao.update_status("nonexistent", "approved");
        assert!(matches!(result, Err(StorageError::NotFound)));
    }
}
