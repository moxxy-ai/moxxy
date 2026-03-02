use crate::rows::WebhookRow;
use moxxy_types::StorageError;
use rusqlite::{Connection, params};

pub struct WebhookDao<'a> {
    pub conn: &'a Connection,
}

impl<'a> WebhookDao<'a> {
    pub fn insert(&self, row: &WebhookRow) -> Result<(), StorageError> {
        self.conn
            .execute(
                "INSERT INTO webhooks (id, agent_id, label, url, secret_ref_id, event_filter,
                 enabled, retry_count, timeout_seconds, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    row.id,
                    row.agent_id,
                    row.label,
                    row.url,
                    row.secret_ref_id,
                    row.event_filter,
                    row.enabled,
                    row.retry_count,
                    row.timeout_seconds,
                    row.created_at,
                    row.updated_at,
                ],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;
        Ok(())
    }

    pub fn find_by_id(&self, id: &str) -> Result<Option<WebhookRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, agent_id, label, url, secret_ref_id, event_filter,
                 enabled, retry_count, timeout_seconds, created_at, updated_at
                 FROM webhooks WHERE id = ?1",
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

    pub fn find_by_agent(&self, agent_id: &str) -> Result<Vec<WebhookRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, agent_id, label, url, secret_ref_id, event_filter,
                 enabled, retry_count, timeout_seconds, created_at, updated_at
                 FROM webhooks WHERE agent_id = ?1",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let rows = stmt
            .query_map(params![agent_id], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| StorageError::QueryFailed(e.to_string()))
    }

    pub fn list_enabled(&self) -> Result<Vec<WebhookRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, agent_id, label, url, secret_ref_id, event_filter,
                 enabled, retry_count, timeout_seconds, created_at, updated_at
                 FROM webhooks WHERE enabled = 1",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let rows = stmt
            .query_map([], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| StorageError::QueryFailed(e.to_string()))
    }

    pub fn update(&self, row: &WebhookRow) -> Result<(), StorageError> {
        let affected = self
            .conn
            .execute(
                "UPDATE webhooks SET label = ?1, url = ?2, secret_ref_id = ?3, event_filter = ?4,
                 enabled = ?5, retry_count = ?6, timeout_seconds = ?7, updated_at = ?8
                 WHERE id = ?9",
                params![
                    row.label,
                    row.url,
                    row.secret_ref_id,
                    row.event_filter,
                    row.enabled,
                    row.retry_count,
                    row.timeout_seconds,
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

    pub fn delete(&self, id: &str) -> Result<(), StorageError> {
        let affected = self
            .conn
            .execute("DELETE FROM webhooks WHERE id = ?1", params![id])
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        if affected == 0 {
            return Err(StorageError::NotFound);
        }
        Ok(())
    }

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<WebhookRow> {
        Ok(WebhookRow {
            id: row.get(0)?,
            agent_id: row.get(1)?,
            label: row.get(2)?,
            url: row.get(3)?,
            secret_ref_id: row.get(4)?,
            event_filter: row.get(5)?,
            enabled: row.get(6)?,
            retry_count: row.get(7)?,
            timeout_seconds: row.get(8)?,
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
        let dao = WebhookDao { conn: db.conn() };
        let mut wh = fixture_webhook_row();
        wh.agent_id = agent_id;
        dao.insert(&wh).unwrap();
        let found = dao.find_by_id(&wh.id).unwrap().unwrap();
        assert_eq!(found.id, wh.id);
        assert_eq!(found.label, wh.label);
        assert_eq!(found.url, wh.url);
    }

    #[test]
    fn find_returns_none_for_missing() {
        let db = TestDb::new();
        let dao = WebhookDao { conn: db.conn() };
        let found = dao.find_by_id("nonexistent").unwrap();
        assert!(found.is_none());
    }

    #[test]
    fn find_by_agent() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = WebhookDao { conn: db.conn() };
        let mut wh = fixture_webhook_row();
        wh.agent_id = agent_id.clone();
        dao.insert(&wh).unwrap();
        let found = dao.find_by_agent(&agent_id).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, wh.id);
    }

    #[test]
    fn list_enabled() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = WebhookDao { conn: db.conn() };

        let mut wh1 = fixture_webhook_row();
        wh1.agent_id = agent_id.clone();
        wh1.enabled = true;
        dao.insert(&wh1).unwrap();

        let mut wh2 = fixture_webhook_row();
        wh2.agent_id = agent_id;
        wh2.enabled = false;
        dao.insert(&wh2).unwrap();

        let enabled = dao.list_enabled().unwrap();
        assert_eq!(enabled.len(), 1);
        assert_eq!(enabled[0].id, wh1.id);
    }

    #[test]
    fn update_webhook() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = WebhookDao { conn: db.conn() };
        let mut wh = fixture_webhook_row();
        wh.agent_id = agent_id;
        dao.insert(&wh).unwrap();

        wh.label = "updated-label".into();
        wh.url = "https://updated.example.com/hook".into();
        wh.retry_count = 5;
        wh.updated_at = chrono::Utc::now().to_rfc3339();
        dao.update(&wh).unwrap();

        let found = dao.find_by_id(&wh.id).unwrap().unwrap();
        assert_eq!(found.label, "updated-label");
        assert_eq!(found.url, "https://updated.example.com/hook");
        assert_eq!(found.retry_count, 5);
    }

    #[test]
    fn delete_webhook() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = WebhookDao { conn: db.conn() };
        let mut wh = fixture_webhook_row();
        wh.agent_id = agent_id;
        dao.insert(&wh).unwrap();
        dao.delete(&wh.id).unwrap();
        let found = dao.find_by_id(&wh.id).unwrap();
        assert!(found.is_none());
    }
}
