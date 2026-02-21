use anyhow::Result;
use rusqlite::params;

use super::MemorySystem;
use super::types::ScheduledJobRecord;

impl MemorySystem {
    pub async fn get_all_scheduled_jobs(&self) -> Result<Vec<ScheduledJobRecord>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare("SELECT name, cron, prompt, source FROM scheduled_jobs")?;

        let rows = stmt.query_map([], |row| {
            Ok(ScheduledJobRecord {
                name: row.get(0)?,
                cron: row.get(1)?,
                prompt: row.get(2)?,
                source: row.get(3)?,
            })
        })?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }
        Ok(results)
    }

    pub async fn add_scheduled_job(
        &self,
        name: &str,
        cron: &str,
        prompt: &str,
        source: &str,
    ) -> Result<()> {
        let db = self.db.lock().await;
        db.execute(
            "INSERT OR REPLACE INTO scheduled_jobs (name, cron, prompt, source) VALUES (?1, ?2, ?3, ?4)",
            params![name, cron, prompt, source],
        )?;
        Ok(())
    }

    pub async fn remove_scheduled_job(&self, name: &str) -> Result<bool> {
        let db = self.db.lock().await;
        let rows_deleted =
            db.execute("DELETE FROM scheduled_jobs WHERE name = ?1", params![name])?;
        Ok(rows_deleted > 0)
    }

    pub async fn remove_all_scheduled_jobs(&self) -> Result<usize> {
        let db = self.db.lock().await;
        let rows_deleted = db.execute("DELETE FROM scheduled_jobs", [])?;
        Ok(rows_deleted)
    }
}
