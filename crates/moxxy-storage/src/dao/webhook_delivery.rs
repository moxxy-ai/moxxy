use crate::rows::WebhookDeliveryRow;
use moxxy_types::StorageError;
use rusqlite::{Connection, params};

pub struct WebhookDeliveryDao<'a> {
    pub conn: &'a Connection,
}

impl<'a> WebhookDeliveryDao<'a> {
    pub fn insert(&self, row: &WebhookDeliveryRow) -> Result<(), StorageError> {
        self.conn
            .execute(
                "INSERT INTO webhook_deliveries (id, webhook_id, event_id, status, attempt,
                 response_status, response_body, error, delivered_at, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    row.id,
                    row.webhook_id,
                    row.event_id,
                    row.status,
                    row.attempt,
                    row.response_status,
                    row.response_body,
                    row.error,
                    row.delivered_at,
                    row.created_at,
                ],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;
        Ok(())
    }

    pub fn find_by_webhook(
        &self,
        webhook_id: &str,
    ) -> Result<Vec<WebhookDeliveryRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, webhook_id, event_id, status, attempt,
                 response_status, response_body, error, delivered_at, created_at
                 FROM webhook_deliveries WHERE webhook_id = ?1 ORDER BY created_at ASC",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let rows = stmt
            .query_map(params![webhook_id], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| StorageError::QueryFailed(e.to_string()))
    }

    #[allow(clippy::too_many_arguments)]
    pub fn update_status(
        &self,
        id: &str,
        status: &str,
        attempt: i32,
        response_status: Option<i32>,
        response_body: Option<&str>,
        error: Option<&str>,
        delivered_at: Option<&str>,
    ) -> Result<(), StorageError> {
        let affected = self
            .conn
            .execute(
                "UPDATE webhook_deliveries SET status = ?1, attempt = ?2, response_status = ?3,
                 response_body = ?4, error = ?5, delivered_at = ?6
                 WHERE id = ?7",
                params![
                    status,
                    attempt,
                    response_status,
                    response_body,
                    error,
                    delivered_at,
                    id,
                ],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        if affected == 0 {
            return Err(StorageError::NotFound);
        }
        Ok(())
    }

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<WebhookDeliveryRow> {
        Ok(WebhookDeliveryRow {
            id: row.get(0)?,
            webhook_id: row.get(1)?,
            event_id: row.get(2)?,
            status: row.get(3)?,
            attempt: row.get(4)?,
            response_status: row.get(5)?,
            response_body: row.get(6)?,
            error: row.get(7)?,
            delivered_at: row.get(8)?,
            created_at: row.get(9)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fixtures::*;
    use moxxy_test_utils::TestDb;

    fn seed_webhook(db: &TestDb) -> String {
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

        let mut wh = fixture_webhook_row();
        wh.agent_id = agent.id;
        db.conn()
            .execute(
                "INSERT INTO webhooks (id, agent_id, label, url, secret_ref_id, event_filter,
                 enabled, retry_count, timeout_seconds, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    wh.id,
                    wh.agent_id,
                    wh.label,
                    wh.url,
                    wh.secret_ref_id,
                    wh.event_filter,
                    wh.enabled,
                    wh.retry_count,
                    wh.timeout_seconds,
                    wh.created_at,
                    wh.updated_at,
                ],
            )
            .unwrap();
        wh.id
    }

    #[test]
    fn insert_and_find_by_webhook() {
        let db = TestDb::new();
        let webhook_id = seed_webhook(&db);
        let dao = WebhookDeliveryDao { conn: db.conn() };
        let mut delivery = fixture_webhook_delivery_row();
        delivery.webhook_id = webhook_id.clone();
        dao.insert(&delivery).unwrap();
        let found = dao.find_by_webhook(&webhook_id).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, delivery.id);
        assert_eq!(found[0].status, "pending");
    }

    #[test]
    fn update_status_delivery() {
        let db = TestDb::new();
        let webhook_id = seed_webhook(&db);
        let dao = WebhookDeliveryDao { conn: db.conn() };
        let mut delivery = fixture_webhook_delivery_row();
        delivery.webhook_id = webhook_id.clone();
        dao.insert(&delivery).unwrap();

        let now = chrono::Utc::now().to_rfc3339();
        dao.update_status(
            &delivery.id,
            "delivered",
            1,
            Some(200),
            Some("OK"),
            None,
            Some(&now),
        )
        .unwrap();

        let found = dao.find_by_webhook(&webhook_id).unwrap();
        assert_eq!(found[0].status, "delivered");
        assert_eq!(found[0].attempt, 1);
        assert_eq!(found[0].response_status, Some(200));
        assert_eq!(found[0].response_body.as_deref(), Some("OK"));
    }

    #[test]
    fn update_status_with_error() {
        let db = TestDb::new();
        let webhook_id = seed_webhook(&db);
        let dao = WebhookDeliveryDao { conn: db.conn() };
        let mut delivery = fixture_webhook_delivery_row();
        delivery.webhook_id = webhook_id.clone();
        dao.insert(&delivery).unwrap();

        dao.update_status(
            &delivery.id,
            "failed",
            3,
            None,
            None,
            Some("connection timeout"),
            None,
        )
        .unwrap();

        let found = dao.find_by_webhook(&webhook_id).unwrap();
        assert_eq!(found[0].status, "failed");
        assert_eq!(found[0].attempt, 3);
        assert_eq!(found[0].error.as_deref(), Some("connection timeout"));
    }
}
