use anyhow::Result;

use super::MemorySystem;

impl MemorySystem {
    pub async fn add_long_term_memory(&self, content: &str) -> Result<()> {
        let db = self.db.lock().await;
        db.execute(
            "INSERT INTO long_term_docs (content) VALUES (?1)",
            [content],
        )?;
        Ok(())
    }
}
