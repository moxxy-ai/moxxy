use crate::rows::HeartbeatRow;
use moxxy_types::StorageError;
use rusqlite::{Connection, params};

pub struct HeartbeatDao<'a> {
    pub conn: &'a Connection,
}

impl<'a> HeartbeatDao<'a> {
    pub fn insert(&self, row: &HeartbeatRow) -> Result<(), StorageError> {
        self.conn
            .execute(
                "INSERT INTO heartbeats (id, agent_id, interval_minutes, action_type, action_payload,
                 enabled, next_run_at, cron_expr, timezone, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    row.id,
                    row.agent_id,
                    row.interval_minutes,
                    row.action_type,
                    row.action_payload,
                    row.enabled,
                    row.next_run_at,
                    row.cron_expr,
                    row.timezone,
                    row.created_at,
                    row.updated_at,
                ],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;
        Ok(())
    }

    pub fn find_by_id(&self, id: &str) -> Result<Option<HeartbeatRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, agent_id, interval_minutes, action_type, action_payload,
                 enabled, next_run_at, cron_expr, timezone, created_at, updated_at
                 FROM heartbeats WHERE id = ?1",
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

    pub fn find_by_agent(&self, agent_id: &str) -> Result<Vec<HeartbeatRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, agent_id, interval_minutes, action_type, action_payload,
                 enabled, next_run_at, cron_expr, timezone, created_at, updated_at
                 FROM heartbeats WHERE agent_id = ?1",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let rows = stmt
            .query_map(params![agent_id], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| StorageError::QueryFailed(e.to_string()))
    }

    pub fn find_due_rules(&self, now: &str) -> Result<Vec<HeartbeatRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, agent_id, interval_minutes, action_type, action_payload,
                 enabled, next_run_at, cron_expr, timezone, created_at, updated_at
                 FROM heartbeats WHERE enabled = 1 AND next_run_at <= ?1",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let rows = stmt
            .query_map(params![now], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| StorageError::QueryFailed(e.to_string()))
    }

    pub fn list_all(&self) -> Result<Vec<HeartbeatRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, agent_id, interval_minutes, action_type, action_payload,
                 enabled, next_run_at, cron_expr, timezone, created_at, updated_at
                 FROM heartbeats",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let rows = stmt
            .query_map([], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| StorageError::QueryFailed(e.to_string()))
    }

    pub fn update(&self, row: &HeartbeatRow) -> Result<(), StorageError> {
        let affected = self
            .conn
            .execute(
                "UPDATE heartbeats SET interval_minutes = ?1, action_type = ?2, action_payload = ?3,
                 enabled = ?4, next_run_at = ?5, cron_expr = ?6, timezone = ?7, updated_at = ?8 WHERE id = ?9",
                params![
                    row.interval_minutes,
                    row.action_type,
                    row.action_payload,
                    row.enabled,
                    row.next_run_at,
                    row.cron_expr,
                    row.timezone,
                    row.updated_at,
                    row.id,
                ],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        if affected == 0 {
            return Err(StorageError::NotFound);
        }
        Ok(())
    }

    pub fn disable(&self, id: &str) -> Result<(), StorageError> {
        let now = chrono::Utc::now().to_rfc3339();
        let affected = self
            .conn
            .execute(
                "UPDATE heartbeats SET enabled = 0, updated_at = ?1 WHERE id = ?2",
                params![now, id],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        if affected == 0 {
            return Err(StorageError::NotFound);
        }
        Ok(())
    }

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<HeartbeatRow> {
        Ok(HeartbeatRow {
            id: row.get(0)?,
            agent_id: row.get(1)?,
            interval_minutes: row.get(2)?,
            action_type: row.get(3)?,
            action_payload: row.get(4)?,
            enabled: row.get(5)?,
            next_run_at: row.get(6)?,
            cron_expr: row.get(7)?,
            timezone: row.get(8)?,
            created_at: row.get(9)?,
            updated_at: row.get(10)?,
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
        let dao = HeartbeatDao { conn: db.conn() };
        let mut hb = fixture_heartbeat_row();
        hb.agent_id = agent_id;
        dao.insert(&hb).unwrap();
        let found = dao.find_by_id(&hb.id).unwrap().unwrap();
        assert_eq!(found.id, hb.id);
        assert_eq!(found.interval_minutes, hb.interval_minutes);
    }

    #[test]
    fn find_returns_none_for_missing() {
        let db = TestDb::new();
        let dao = HeartbeatDao { conn: db.conn() };
        let found = dao.find_by_id("nonexistent").unwrap();
        assert!(found.is_none());
    }

    #[test]
    fn find_by_agent() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = HeartbeatDao { conn: db.conn() };
        let mut hb = fixture_heartbeat_row();
        hb.agent_id = agent_id.clone();
        dao.insert(&hb).unwrap();
        let found = dao.find_by_agent(&agent_id).unwrap();
        assert_eq!(found.len(), 1);
    }

    #[test]
    fn find_due_rules() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = HeartbeatDao { conn: db.conn() };

        let mut hb1 = fixture_heartbeat_row();
        hb1.agent_id = agent_id.clone();
        hb1.next_run_at = "2020-01-01T00:00:00Z".into();
        dao.insert(&hb1).unwrap();

        let mut hb2 = fixture_heartbeat_row();
        hb2.agent_id = agent_id;
        hb2.next_run_at = "2099-01-01T00:00:00Z".into();
        dao.insert(&hb2).unwrap();

        let due = dao.find_due_rules("2025-01-01T00:00:00Z").unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].id, hb1.id);
    }

    #[test]
    fn list_all() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = HeartbeatDao { conn: db.conn() };
        let mut hb = fixture_heartbeat_row();
        hb.agent_id = agent_id;
        dao.insert(&hb).unwrap();
        let all = dao.list_all().unwrap();
        assert_eq!(all.len(), 1);
    }

    #[test]
    fn disable_heartbeat() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = HeartbeatDao { conn: db.conn() };
        let mut hb = fixture_heartbeat_row();
        hb.agent_id = agent_id;
        dao.insert(&hb).unwrap();
        dao.disable(&hb.id).unwrap();
        let found = dao.find_by_id(&hb.id).unwrap().unwrap();
        assert!(!found.enabled);
    }

    #[test]
    fn update_heartbeat() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = HeartbeatDao { conn: db.conn() };
        let mut hb = fixture_heartbeat_row();
        hb.agent_id = agent_id;
        dao.insert(&hb).unwrap();

        hb.interval_minutes = 30;
        hb.updated_at = chrono::Utc::now().to_rfc3339();
        dao.update(&hb).unwrap();

        let found = dao.find_by_id(&hb.id).unwrap().unwrap();
        assert_eq!(found.interval_minutes, 30);
    }

    #[test]
    fn insert_and_find_with_cron_expr() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = HeartbeatDao { conn: db.conn() };
        let mut hb = fixture_heartbeat_row();
        hb.agent_id = agent_id;
        hb.cron_expr = Some("0 0 9 * * *".into());
        hb.timezone = "Europe/Warsaw".into();
        hb.interval_minutes = 1;
        dao.insert(&hb).unwrap();
        let found = dao.find_by_id(&hb.id).unwrap().unwrap();
        assert_eq!(found.cron_expr, Some("0 0 9 * * *".into()));
        assert_eq!(found.timezone, "Europe/Warsaw");
    }
}
