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
                "INSERT INTO webhook_deliveries (id, webhook_id, source_ip, headers_json, body,
                 signature_valid, run_id, error, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    row.id,
                    row.webhook_id,
                    row.source_ip,
                    row.headers_json,
                    row.body,
                    row.signature_valid,
                    row.run_id,
                    row.error,
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
                "SELECT id, webhook_id, source_ip, headers_json, body,
                 signature_valid, run_id, error, created_at
                 FROM webhook_deliveries WHERE webhook_id = ?1 ORDER BY created_at ASC",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let rows = stmt
            .query_map(params![webhook_id], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| StorageError::QueryFailed(e.to_string()))
    }

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<WebhookDeliveryRow> {
        Ok(WebhookDeliveryRow {
            id: row.get(0)?,
            webhook_id: row.get(1)?,
            source_ip: row.get(2)?,
            headers_json: row.get(3)?,
            body: row.get(4)?,
            signature_valid: row.get(5)?,
            run_id: row.get(6)?,
            error: row.get(7)?,
            created_at: row.get(8)?,
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

    fn seed_webhook(db: &TestDb) -> String {
        let agent = fixture_agent_row();
        let agent_dao = AgentDao { conn: db.conn() };
        agent_dao.insert(&agent).unwrap();

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

        let mut wh = fixture_webhook_row();
        wh.agent_id = agent.id;
        wh.secret_ref_id = secret_ref.id;
        db.conn()
            .execute(
                "INSERT INTO webhooks (id, agent_id, label, token, secret_ref_id, event_filter,
                 enabled, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    wh.id,
                    wh.agent_id,
                    wh.label,
                    wh.token,
                    wh.secret_ref_id,
                    wh.event_filter,
                    wh.enabled,
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
        assert!(found[0].signature_valid);
    }

    #[test]
    fn insert_delivery_with_error() {
        let db = TestDb::new();
        let webhook_id = seed_webhook(&db);
        let dao = WebhookDeliveryDao { conn: db.conn() };
        let mut delivery = fixture_webhook_delivery_row();
        delivery.webhook_id = webhook_id.clone();
        delivery.signature_valid = false;
        delivery.error = Some("invalid signature".into());
        delivery.run_id = None;
        dao.insert(&delivery).unwrap();

        let found = dao.find_by_webhook(&webhook_id).unwrap();
        assert_eq!(found.len(), 1);
        assert!(!found[0].signature_valid);
        assert_eq!(found[0].error.as_deref(), Some("invalid signature"));
    }
}
