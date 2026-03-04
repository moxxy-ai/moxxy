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
                "INSERT INTO webhooks (id, agent_id, label, token, secret_ref_id, event_filter,
                 enabled, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    row.id,
                    row.agent_id,
                    row.label,
                    row.token,
                    row.secret_ref_id,
                    row.event_filter,
                    row.enabled,
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
                "SELECT id, agent_id, label, token, secret_ref_id, event_filter,
                 enabled, created_at, updated_at
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

    pub fn find_by_token(&self, token: &str) -> Result<Option<WebhookRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, agent_id, label, token, secret_ref_id, event_filter,
                 enabled, created_at, updated_at
                 FROM webhooks WHERE token = ?1",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let mut rows = stmt
            .query_map(params![token], Self::map_row)
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
                "SELECT id, agent_id, label, token, secret_ref_id, event_filter,
                 enabled, created_at, updated_at
                 FROM webhooks WHERE agent_id = ?1",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let rows = stmt
            .query_map(params![agent_id], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| StorageError::QueryFailed(e.to_string()))
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
            token: row.get(3)?,
            secret_ref_id: row.get(4)?,
            event_filter: row.get(5)?,
            enabled: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dao::AgentDao;
    use crate::fixtures::*;
    use moxxy_test_utils::TestDb;
    use rusqlite::params;

    fn seed_agent(db: &TestDb) -> String {
        let agent = fixture_agent_row();
        let dao = AgentDao { conn: db.conn() };
        dao.insert(&agent).unwrap();
        agent.id
    }

    fn seed_secret_ref(db: &TestDb) -> String {
        let secret_ref = fixture_vault_secret_ref_row();
        db.conn()
            .execute(
                "INSERT INTO vault_secret_refs (id, key_name, backend_key, policy_label, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    secret_ref.id,
                    secret_ref.key_name,
                    secret_ref.backend_key,
                    secret_ref.policy_label,
                    secret_ref.created_at,
                    secret_ref.updated_at,
                ],
            )
            .unwrap();
        secret_ref.id
    }

    #[test]
    fn insert_and_find_by_id() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let secret_ref_id = seed_secret_ref(&db);
        let dao = WebhookDao { conn: db.conn() };
        let mut wh = fixture_webhook_row();
        wh.agent_id = agent_id;
        wh.secret_ref_id = secret_ref_id;
        dao.insert(&wh).unwrap();
        let found = dao.find_by_id(&wh.id).unwrap().unwrap();
        assert_eq!(found.id, wh.id);
        assert_eq!(found.label, wh.label);
        assert_eq!(found.token, wh.token);
    }

    #[test]
    fn find_returns_none_for_missing() {
        let db = TestDb::new();
        let dao = WebhookDao { conn: db.conn() };
        let found = dao.find_by_id("nonexistent").unwrap();
        assert!(found.is_none());
    }

    #[test]
    fn find_by_token() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let secret_ref_id = seed_secret_ref(&db);
        let dao = WebhookDao { conn: db.conn() };
        let mut wh = fixture_webhook_row();
        wh.agent_id = agent_id;
        wh.secret_ref_id = secret_ref_id;
        dao.insert(&wh).unwrap();
        let found = dao.find_by_token(&wh.token).unwrap().unwrap();
        assert_eq!(found.id, wh.id);
        assert_eq!(found.label, wh.label);
    }

    #[test]
    fn find_by_token_returns_none_for_missing() {
        let db = TestDb::new();
        let dao = WebhookDao { conn: db.conn() };
        let found = dao.find_by_token("nonexistent-token").unwrap();
        assert!(found.is_none());
    }

    #[test]
    fn find_by_agent() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let secret_ref_id = seed_secret_ref(&db);
        let dao = WebhookDao { conn: db.conn() };
        let mut wh = fixture_webhook_row();
        wh.agent_id = agent_id.clone();
        wh.secret_ref_id = secret_ref_id;
        dao.insert(&wh).unwrap();
        let found = dao.find_by_agent(&agent_id).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, wh.id);
    }

    #[test]
    fn delete_webhook() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let secret_ref_id = seed_secret_ref(&db);
        let dao = WebhookDao { conn: db.conn() };
        let mut wh = fixture_webhook_row();
        wh.agent_id = agent_id;
        wh.secret_ref_id = secret_ref_id;
        dao.insert(&wh).unwrap();
        dao.delete(&wh.id).unwrap();
        let found = dao.find_by_id(&wh.id).unwrap();
        assert!(found.is_none());
    }
}
