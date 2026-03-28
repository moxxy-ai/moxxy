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
    use crate::fixtures::*;
    use moxxy_test_utils::TestDb;

    #[test]
    fn insert_and_find_by_webhook() {
        let db = TestDb::new();
        let dao = WebhookDeliveryDao { conn: db.conn() };
        let mut delivery = fixture_webhook_delivery_row();
        delivery.webhook_id = "wh-token-123".into();
        dao.insert(&delivery).unwrap();
        let found = dao.find_by_webhook("wh-token-123").unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, delivery.id);
        assert!(found[0].signature_valid);
    }

    #[test]
    fn insert_delivery_with_error() {
        let db = TestDb::new();
        let dao = WebhookDeliveryDao { conn: db.conn() };
        let mut delivery = fixture_webhook_delivery_row();
        delivery.webhook_id = "wh-token-456".into();
        delivery.signature_valid = false;
        delivery.error = Some("invalid signature".into());
        delivery.run_id = None;
        dao.insert(&delivery).unwrap();

        let found = dao.find_by_webhook("wh-token-456").unwrap();
        assert_eq!(found.len(), 1);
        assert!(!found[0].signature_valid);
        assert_eq!(found[0].error.as_deref(), Some("invalid signature"));
    }
}
