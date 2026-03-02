use crate::rows::ConversationLogRow;
use moxxy_types::StorageError;
use rusqlite::{Connection, params};

pub struct ConversationDao<'a> {
    pub conn: &'a Connection,
}

impl<'a> ConversationDao<'a> {
    pub fn insert(&self, row: &ConversationLogRow) -> Result<(), StorageError> {
        self.conn
            .execute(
                "INSERT INTO conversation_log (id, agent_id, run_id, sequence, role, content, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    row.id,
                    row.agent_id,
                    row.run_id,
                    row.sequence,
                    row.role,
                    row.content,
                    row.created_at,
                ],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;
        Ok(())
    }

    pub fn find_by_run(
        &self,
        agent_id: &str,
        run_id: &str,
    ) -> Result<Vec<ConversationLogRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, agent_id, run_id, sequence, role, content, created_at
                 FROM conversation_log WHERE agent_id = ?1 AND run_id = ?2
                 ORDER BY sequence ASC",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let rows = stmt
            .query_map(params![agent_id, run_id], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| StorageError::QueryFailed(e.to_string()))
    }

    pub fn delete_by_run(&self, agent_id: &str, run_id: &str) -> Result<(), StorageError> {
        self.conn
            .execute(
                "DELETE FROM conversation_log WHERE agent_id = ?1 AND run_id = ?2",
                params![agent_id, run_id],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;
        Ok(())
    }

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ConversationLogRow> {
        Ok(ConversationLogRow {
            id: row.get(0)?,
            agent_id: row.get(1)?,
            run_id: row.get(2)?,
            sequence: row.get(3)?,
            role: row.get(4)?,
            content: row.get(5)?,
            created_at: row.get(6)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use moxxy_test_utils::TestDb;

    fn seed_agent(db: &TestDb) -> String {
        use crate::fixtures::*;
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
    fn insert_and_find_by_run() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = ConversationDao { conn: db.conn() };

        let row = ConversationLogRow {
            id: uuid::Uuid::now_v7().to_string(),
            agent_id: agent_id.clone(),
            run_id: "run-1".into(),
            sequence: 0,
            role: "user".into(),
            content: "Hello".into(),
            created_at: chrono::Utc::now().to_rfc3339(),
        };
        dao.insert(&row).unwrap();

        let found = dao.find_by_run(&agent_id, "run-1").unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].content, "Hello");
    }

    #[test]
    fn find_by_run_orders_by_sequence() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = ConversationDao { conn: db.conn() };

        for i in (0..3).rev() {
            let row = ConversationLogRow {
                id: uuid::Uuid::now_v7().to_string(),
                agent_id: agent_id.clone(),
                run_id: "run-2".into(),
                sequence: i,
                role: "user".into(),
                content: format!("msg-{}", i),
                created_at: chrono::Utc::now().to_rfc3339(),
            };
            dao.insert(&row).unwrap();
        }

        let found = dao.find_by_run(&agent_id, "run-2").unwrap();
        assert_eq!(found.len(), 3);
        assert_eq!(found[0].sequence, 0);
        assert_eq!(found[1].sequence, 1);
        assert_eq!(found[2].sequence, 2);
    }

    #[test]
    fn delete_by_run_cleans_up() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = ConversationDao { conn: db.conn() };

        let row = ConversationLogRow {
            id: uuid::Uuid::now_v7().to_string(),
            agent_id: agent_id.clone(),
            run_id: "run-del".into(),
            sequence: 0,
            role: "user".into(),
            content: "delete me".into(),
            created_at: chrono::Utc::now().to_rfc3339(),
        };
        dao.insert(&row).unwrap();

        dao.delete_by_run(&agent_id, "run-del").unwrap();
        let found = dao.find_by_run(&agent_id, "run-del").unwrap();
        assert!(found.is_empty());
    }

    #[test]
    fn find_returns_empty_for_nonexistent_run() {
        let db = TestDb::new();
        let dao = ConversationDao { conn: db.conn() };
        let found = dao.find_by_run("no-agent", "no-run").unwrap();
        assert!(found.is_empty());
    }
}
