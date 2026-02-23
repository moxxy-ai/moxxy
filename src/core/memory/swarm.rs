use anyhow::Result;
use rusqlite::params;

use super::MemorySystem;

impl MemorySystem {
    pub async fn add_swarm_memory(&self, agent_name: &str, content: &str) -> Result<()> {
        if content.len() > 2000 {
            return Err(anyhow::anyhow!(
                "Swarm memory content exceeds 2000 character limit ({} chars)",
                content.len()
            ));
        }
        let db = self.global_db.lock().await;
        db.execute(
            "INSERT INTO global_docs (agent_source, content) VALUES (?1, ?2)",
            params![agent_name, content],
        )?;
        Ok(())
    }

    pub async fn read_swarm_memory(&self, limit: usize) -> Result<Vec<String>> {
        let db = self.global_db.lock().await;
        let mut stmt = db.prepare(
            "SELECT agent_source, content, timestamp FROM global_docs ORDER BY timestamp DESC LIMIT ?1",
        )?;

        let rows = stmt.query_map([limit as i64], |row| {
            let source: String = row.get(0)?;
            let content: String = row.get(1)?;
            let time: String = row.get(2)?;
            Ok(format!("[{}] {}: {}", time, source, content))
        })?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }
        Ok(results)
    }
}
