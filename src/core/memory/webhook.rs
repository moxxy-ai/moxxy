use anyhow::Result;
use rusqlite::params;

use super::MemorySystem;
use super::types::WebhookRecord;

impl MemorySystem {
    pub async fn get_all_webhooks(&self) -> Result<Vec<WebhookRecord>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT name, source, secret, prompt_template, active, created_at FROM webhooks",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok(WebhookRecord {
                name: row.get(0)?,
                source: row.get(1)?,
                secret: row.get(2)?,
                prompt_template: row.get(3)?,
                active: row.get::<_, i32>(4)? != 0,
                created_at: row.get(5)?,
            })
        })?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }
        Ok(results)
    }

    pub async fn get_webhook_by_source(&self, source: &str) -> Result<Option<WebhookRecord>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT name, source, secret, prompt_template, active, created_at FROM webhooks WHERE source = ?1",
        )?;

        let mut rows = stmt.query_map(params![source], |row| {
            Ok(WebhookRecord {
                name: row.get(0)?,
                source: row.get(1)?,
                secret: row.get(2)?,
                prompt_template: row.get(3)?,
                active: row.get::<_, i32>(4)? != 0,
                created_at: row.get(5)?,
            })
        })?;

        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    pub async fn add_webhook(&self, name: &str, source: &str, prompt_template: &str) -> Result<()> {
        let db = self.db.lock().await;
        db.execute(
            "INSERT OR REPLACE INTO webhooks (name, source, secret, prompt_template, active) VALUES (?1, ?2, '', ?3, 1)",
            params![name, source, prompt_template],
        )?;
        Ok(())
    }

    pub async fn remove_webhook(&self, name: &str) -> Result<bool> {
        let db = self.db.lock().await;
        let rows_deleted = db.execute("DELETE FROM webhooks WHERE name = ?1", params![name])?;
        Ok(rows_deleted > 0)
    }

    pub async fn update_webhook_active(&self, name: &str, active: bool) -> Result<bool> {
        let db = self.db.lock().await;
        let rows_updated = db.execute(
            "UPDATE webhooks SET active = ?1 WHERE name = ?2",
            params![active as i32, name],
        )?;
        Ok(rows_updated > 0)
    }
}
