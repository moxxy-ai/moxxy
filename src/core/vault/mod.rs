use anyhow::Result;
use rusqlite::Connection;
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct SecretsVault {
    db: Arc<Mutex<Connection>>,
}

impl SecretsVault {
    pub fn new(db: Arc<Mutex<Connection>>) -> Self {
        Self { db }
    }

    pub async fn initialize(&self) -> Result<()> {
        let db = self.db.lock().await;
        db.execute(
            "CREATE TABLE IF NOT EXISTS secrets_vault (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )",
            [],
        )?;
        Ok(())
    }

    pub async fn set_secret(&self, key: &str, value: &str) -> Result<()> {
        let db = self.db.lock().await;
        db.execute(
            "INSERT INTO secrets_vault (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, value),
        )?;
        Ok(())
    }

    pub async fn get_secret(&self, key: &str) -> Result<Option<String>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare("SELECT value FROM secrets_vault WHERE key = ?1")?;
        let mut rows = stmt.query([key])?;

        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    pub async fn list_keys(&self) -> Result<Vec<String>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare("SELECT key FROM secrets_vault")?;
        let rows = stmt.query_map([], |row| row.get(0))?;

        let mut keys = Vec::new();
        for key in rows {
            keys.push(key?);
        }
        Ok(keys)
    }

    #[allow(dead_code)]
    pub async fn remove_secret(&self, key: &str) -> Result<()> {
        let db = self.db.lock().await;
        db.execute("DELETE FROM secrets_vault WHERE key = ?1", [key])?;
        Ok(())
    }
}
