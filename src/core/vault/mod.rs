use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use anyhow::Result;
use base64::Engine;
use hmac::Mac;
use rusqlite::Connection;
use sha2::Sha256;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::warn;

type HmacSha256 = hmac::Hmac<Sha256>;

pub struct SecretsVault {
    db: Arc<Mutex<Connection>>,
    cipher: Aes256Gcm,
}

/// Derive a 256-bit encryption key from machine-specific identifiers.
/// Uses HMAC-SHA256(hostname + username, "moxxy-vault-v1") so the key is
/// stable across restarts but tied to the local machine/user.
fn derive_key() -> [u8; 32] {
    let hostname = hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "unknown-host".to_string());
    let username = whoami::username();
    let input = format!("{}{}", hostname, username);

    let mut mac = <HmacSha256 as Mac>::new_from_slice(b"moxxy-vault-v1")
        .expect("HMAC can take key of any size");
    mac.update(input.as_bytes());
    let result = mac.finalize();
    let bytes = result.into_bytes();

    let mut key = [0u8; 32];
    key.copy_from_slice(&bytes);
    key
}

impl SecretsVault {
    pub fn new(db: Arc<Mutex<Connection>>) -> Self {
        let key = derive_key();
        let cipher = Aes256Gcm::new_from_slice(&key).expect("32-byte key is valid for AES-256");
        Self { db, cipher }
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

    /// Encrypt a plaintext value. Returns base64(nonce || ciphertext).
    fn encrypt(&self, plaintext: &str) -> Result<String> {
        let nonce_bytes: [u8; 12] = rand::random();
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = self
            .cipher
            .encrypt(nonce, plaintext.as_bytes())
            .map_err(|e| anyhow::anyhow!("Encryption failed: {}", e))?;

        let mut combined = Vec::with_capacity(12 + ciphertext.len());
        combined.extend_from_slice(&nonce_bytes);
        combined.extend_from_slice(&ciphertext);

        Ok(base64::engine::general_purpose::STANDARD.encode(&combined))
    }

    /// Decrypt a base64(nonce || ciphertext) value. Returns plaintext.
    fn decrypt(&self, encoded: &str) -> Result<String> {
        let combined = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|e| anyhow::anyhow!("Base64 decode failed: {}", e))?;

        if combined.len() < 13 {
            return Err(anyhow::anyhow!("Encrypted value too short"));
        }

        let (nonce_bytes, ciphertext) = combined.split_at(12);
        let nonce = Nonce::from_slice(nonce_bytes);

        let plaintext = self
            .cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| anyhow::anyhow!("Decryption failed: {}", e))?;

        String::from_utf8(plaintext).map_err(|e| anyhow::anyhow!("UTF-8 decode failed: {}", e))
    }

    pub async fn set_secret(&self, key: &str, value: &str) -> Result<()> {
        let encrypted = self.encrypt(value)?;
        let db = self.db.lock().await;
        db.execute(
            "INSERT INTO secrets_vault (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, &encrypted),
        )?;
        Ok(())
    }

    pub async fn get_secret(&self, key: &str) -> Result<Option<String>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare("SELECT value FROM secrets_vault WHERE key = ?1")?;
        let mut rows = stmt.query([key])?;

        if let Some(row) = rows.next()? {
            let stored: String = row.get(0)?;
            drop(rows);
            drop(stmt);

            match self.decrypt(&stored) {
                Ok(plaintext) => Ok(Some(plaintext)),
                Err(_) => {
                    // Legacy plaintext value — migrate to encrypted
                    warn!(
                        "Vault key '{}' appears to be plaintext legacy value, migrating to encrypted",
                        key
                    );
                    let encrypted = self.encrypt(&stored)?;
                    db.execute(
                        "UPDATE secrets_vault SET value = ?1 WHERE key = ?2",
                        (&encrypted, key),
                    )?;
                    Ok(Some(stored))
                }
            }
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
