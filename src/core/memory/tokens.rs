use anyhow::Result;
use rusqlite::params;
use sha2::{Digest, Sha256};

use super::MemorySystem;
use super::types::ApiTokenRecord;

fn hash_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn generate_raw_token() -> String {
    let bytes: [u8; 16] = rand::random();
    let hex: String = bytes.iter().map(|b| format!("{:02x}", b)).collect();
    format!("mxk_{}", hex)
}

impl MemorySystem {
    pub async fn create_api_token(&self, name: &str) -> Result<(String, ApiTokenRecord)> {
        let raw_token = generate_raw_token();
        let token_hash = hash_token(&raw_token);
        let id = uuid::Uuid::new_v4().to_string();

        let db = self.db.lock().await;
        db.execute(
            "INSERT INTO api_tokens (id, name, token_hash) VALUES (?1, ?2, ?3)",
            params![id, name, token_hash],
        )?;

        let created_at = db.query_row(
            "SELECT created_at FROM api_tokens WHERE id = ?1",
            params![id],
            |row| row.get::<_, String>(0),
        )?;

        Ok((
            raw_token,
            ApiTokenRecord {
                id,
                name: name.to_string(),
                created_at,
            },
        ))
    }

    pub async fn list_api_tokens(&self) -> Result<Vec<ApiTokenRecord>> {
        let db = self.db.lock().await;
        let mut stmt =
            db.prepare("SELECT id, name, created_at FROM api_tokens ORDER BY created_at DESC")?;
        let rows = stmt.query_map([], |row| {
            Ok(ApiTokenRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
            })
        })?;
        let mut tokens = Vec::new();
        for row in rows {
            tokens.push(row?);
        }
        Ok(tokens)
    }

    pub async fn delete_api_token(&self, id: &str) -> Result<bool> {
        let db = self.db.lock().await;
        let rows = db.execute("DELETE FROM api_tokens WHERE id = ?1", params![id])?;
        Ok(rows > 0)
    }

    pub async fn validate_api_token(&self, raw_token: &str) -> Result<bool> {
        let token_hash = hash_token(raw_token);
        let db = self.db.lock().await;
        let count: i64 = db.query_row(
            "SELECT COUNT(*) FROM api_tokens WHERE token_hash = ?1",
            params![token_hash],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    pub async fn has_any_api_tokens(&self) -> Result<bool> {
        let db = self.db.lock().await;
        let count: i64 = db.query_row("SELECT COUNT(*) FROM api_tokens", [], |row| row.get(0))?;
        Ok(count > 0)
    }
}
