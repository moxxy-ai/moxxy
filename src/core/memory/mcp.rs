use anyhow::Result;
use rusqlite::params;

use super::MemorySystem;
use super::types::McpServerRecord;

impl MemorySystem {
    pub async fn get_all_mcp_servers(&self) -> Result<Vec<McpServerRecord>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare("SELECT name, command, args, env FROM mcp_servers")?;

        let rows = stmt.query_map([], |row| {
            Ok(McpServerRecord {
                name: row.get(0)?,
                command: row.get(1)?,
                args: row.get(2)?,
                env: row.get(3)?,
            })
        })?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }
        Ok(results)
    }

    pub async fn add_mcp_server(
        &self,
        name: &str,
        command: &str,
        args: &str,
        env: &str,
    ) -> Result<()> {
        let db = self.db.lock().await;
        db.execute(
            "INSERT OR REPLACE INTO mcp_servers (name, command, args, env) VALUES (?1, ?2, ?3, ?4)",
            params![name, command, args, env],
        )?;
        Ok(())
    }

    pub async fn remove_mcp_server(&self, name: &str) -> Result<bool> {
        let db = self.db.lock().await;
        let rows_deleted = db.execute("DELETE FROM mcp_servers WHERE name = ?1", params![name])?;
        Ok(rows_deleted > 0)
    }
}
