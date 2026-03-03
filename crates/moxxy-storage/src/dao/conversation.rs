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

    pub fn find_recent_by_agent(
        &self,
        agent_id: &str,
        limit: u32,
    ) -> Result<Vec<ConversationLogRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, agent_id, run_id, sequence, role, content, created_at
                 FROM conversation_log WHERE agent_id = ?1
                 ORDER BY created_at DESC, sequence DESC LIMIT ?2",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let rows = stmt
            .query_map(params![agent_id, limit], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let mut result: Vec<_> = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        // Reverse to chronological order (query returns newest-first)
        result.reverse();
        Ok(result)
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

    #[test]
    fn find_recent_by_agent_chronological_across_runs() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = ConversationDao { conn: db.conn() };

        // Insert messages across two runs with distinct timestamps
        for (run, ts) in [
            ("run-a", "2025-01-01T00:00:00Z"),
            ("run-b", "2025-01-02T00:00:00Z"),
        ] {
            for seq in 0..2 {
                let role = if seq == 0 { "user" } else { "assistant" };
                dao.insert(&ConversationLogRow {
                    id: uuid::Uuid::now_v7().to_string(),
                    agent_id: agent_id.clone(),
                    run_id: run.into(),
                    sequence: seq,
                    role: role.into(),
                    content: format!("{run}-{role}"),
                    created_at: ts.into(),
                })
                .unwrap();
            }
        }

        let rows = dao.find_recent_by_agent(&agent_id, 10).unwrap();
        assert_eq!(rows.len(), 4);
        // Chronological: run-a messages first, then run-b
        assert_eq!(rows[0].content, "run-a-user");
        assert_eq!(rows[1].content, "run-a-assistant");
        assert_eq!(rows[2].content, "run-b-user");
        assert_eq!(rows[3].content, "run-b-assistant");
    }

    #[test]
    fn find_recent_by_agent_respects_limit() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = ConversationDao { conn: db.conn() };

        for i in 0..6 {
            dao.insert(&ConversationLogRow {
                id: uuid::Uuid::now_v7().to_string(),
                agent_id: agent_id.clone(),
                run_id: "run-1".into(),
                sequence: i,
                role: "user".into(),
                content: format!("msg-{i}"),
                created_at: format!("2025-01-01T00:00:0{i}Z"),
            })
            .unwrap();
        }

        let rows = dao.find_recent_by_agent(&agent_id, 4).unwrap();
        assert_eq!(rows.len(), 4);
        // Should get the newest 4 in chronological order
        assert_eq!(rows[0].content, "msg-2");
        assert_eq!(rows[3].content, "msg-5");
    }

    #[test]
    fn find_recent_by_agent_unknown_agent_returns_empty() {
        let db = TestDb::new();
        let dao = ConversationDao { conn: db.conn() };
        let rows = dao.find_recent_by_agent("nonexistent", 10).unwrap();
        assert!(rows.is_empty());
    }

    fn seed_second_agent(db: &TestDb) -> String {
        use crate::fixtures::*;
        let mut agent = fixture_agent_row();
        agent.id = uuid::Uuid::now_v7().to_string();
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
    fn find_recent_by_agent_isolates_agents() {
        let db = TestDb::new();
        let agent_a = seed_agent(&db);
        let agent_b = seed_second_agent(&db);
        let dao = ConversationDao { conn: db.conn() };

        dao.insert(&ConversationLogRow {
            id: uuid::Uuid::now_v7().to_string(),
            agent_id: agent_a.clone(),
            run_id: "run-1".into(),
            sequence: 0,
            role: "user".into(),
            content: "agent-a-msg".into(),
            created_at: "2025-01-01T00:00:00Z".into(),
        })
        .unwrap();

        dao.insert(&ConversationLogRow {
            id: uuid::Uuid::now_v7().to_string(),
            agent_id: agent_b.clone(),
            run_id: "run-2".into(),
            sequence: 0,
            role: "user".into(),
            content: "agent-b-msg".into(),
            created_at: "2025-01-01T00:00:00Z".into(),
        })
        .unwrap();

        let rows_a = dao.find_recent_by_agent(&agent_a, 10).unwrap();
        assert_eq!(rows_a.len(), 1);
        assert_eq!(rows_a[0].content, "agent-a-msg");

        let rows_b = dao.find_recent_by_agent(&agent_b, 10).unwrap();
        assert_eq!(rows_b.len(), 1);
        assert_eq!(rows_b[0].content, "agent-b-msg");
    }
}
