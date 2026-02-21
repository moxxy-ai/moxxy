use anyhow::Result;
use rusqlite::params;
use tokio::fs::OpenOptions;
use tokio::io::AsyncWriteExt;

use super::MemorySystem;
use super::types::{StmEntry, StmEntryRecord};

/// Maximum chars for skill output stored in STM.
const STM_CONTENT_MAX_CHARS: usize = 2000;

impl MemorySystem {
    /// Read STM from the `current.md` flat file (used by the web dashboard viewer only).
    pub async fn read_short_term_memory(&self) -> Result<String> {
        let stm_path = self.workspace_dir.join("current.md");
        let content = tokio::fs::read_to_string(&stm_path).await?;
        Ok(content)
    }

    /// Read structured STM entries from SQLite.
    /// Returns the last `limit` entries ordered by id ascending.
    pub async fn read_stm_structured(
        &self,
        limit: usize,
        only_current_session: bool,
    ) -> Result<Vec<StmEntry>> {
        let db = self.db.lock().await;
        let session_id = self.session_id.clone();

        let mut results = Vec::new();
        if only_current_session {
            let mut stmt = db.prepare(
                "SELECT role, content FROM short_term_memory \
                 WHERE session_id = ?1 ORDER BY id ASC LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![session_id, limit as i64], |row| {
                Ok(StmEntry {
                    role: row.get(0)?,
                    content: row.get(1)?,
                })
            })?;
            for row in rows {
                results.push(row?);
            }
        } else {
            let mut stmt = db.prepare(
                "SELECT role, content FROM short_term_memory \
                 ORDER BY id ASC LIMIT ?1",
            )?;
            let rows = stmt.query_map(params![limit as i64], |row| {
                Ok(StmEntry {
                    role: row.get(0)?,
                    content: row.get(1)?,
                })
            })?;
            for row in rows {
                results.push(row?);
            }
        }

        Ok(results)
    }

    /// Read structured STM entries with id > `after_id`.
    pub async fn read_stm_structured_since(
        &self,
        after_id: i64,
        limit: usize,
        only_current_session: bool,
    ) -> Result<Vec<StmEntryRecord>> {
        let db = self.db.lock().await;
        let session_id = self.session_id.clone();

        let mut results = Vec::new();
        if only_current_session {
            let mut stmt = db.prepare(
                "SELECT id, role, content FROM short_term_memory \
                 WHERE session_id = ?1 AND id > ?2 ORDER BY id ASC LIMIT ?3",
            )?;
            let rows = stmt.query_map(params![session_id, after_id, limit as i64], |row| {
                Ok(StmEntryRecord {
                    id: row.get(0)?,
                    role: row.get(1)?,
                    content: row.get(2)?,
                })
            })?;
            for row in rows {
                results.push(row?);
            }
        } else {
            let mut stmt = db.prepare(
                "SELECT id, role, content FROM short_term_memory \
                 WHERE id > ?1 ORDER BY id ASC LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![after_id, limit as i64], |row| {
                Ok(StmEntryRecord {
                    id: row.get(0)?,
                    role: row.get(1)?,
                    content: row.get(2)?,
                })
            })?;
            for row in rows {
                results.push(row?);
            }
        }

        Ok(results)
    }

    /// Append a message to STM. Writes to both SQLite (authoritative) and
    /// current.md (read-only display for web dashboard).
    pub async fn append_short_term_memory(&self, role: &str, content: &str) -> Result<()> {
        let stored_content = if content.len() > STM_CONTENT_MAX_CHARS {
            format!("{}... [truncated]", &content[..STM_CONTENT_MAX_CHARS])
        } else {
            content.to_string()
        };

        {
            let db = self.db.lock().await;
            db.execute(
                "INSERT INTO short_term_memory (session_id, role, content) VALUES (?1, ?2, ?3)",
                params![self.session_id, role, stored_content],
            )?;
        }

        let stm_path = self.workspace_dir.join("current.md");
        let formatted = format!("**{}**: {}\n\n", role, stored_content);
        let mut file = OpenOptions::new().append(true).open(&stm_path).await?;
        file.write_all(formatted.as_bytes()).await?;
        Ok(())
    }
}
