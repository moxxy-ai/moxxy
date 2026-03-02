use aes_gcm::{Aes256Gcm, KeyInit, Nonce, aead::Aead};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use moxxy_types::VaultError;
use rand::RngCore;
use std::collections::HashMap;
use std::sync::Mutex;

pub trait SecretBackend {
    fn set_secret(&self, key: &str, value: &str) -> Result<(), VaultError>;
    fn get_secret(&self, key: &str) -> Result<String, VaultError>;
    fn delete_secret(&self, key: &str) -> Result<(), VaultError>;
}

pub struct InMemoryBackend {
    secrets: Mutex<HashMap<String, String>>,
}

impl Default for InMemoryBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl InMemoryBackend {
    pub fn new() -> Self {
        Self {
            secrets: Mutex::new(HashMap::new()),
        }
    }
}

impl SecretBackend for InMemoryBackend {
    fn set_secret(&self, key: &str, value: &str) -> Result<(), VaultError> {
        let mut map = self
            .secrets
            .lock()
            .map_err(|e| VaultError::BackendError(e.to_string()))?;
        map.insert(key.to_string(), value.to_string());
        Ok(())
    }

    fn get_secret(&self, key: &str) -> Result<String, VaultError> {
        let map = self
            .secrets
            .lock()
            .map_err(|e| VaultError::BackendError(e.to_string()))?;
        map.get(key).cloned().ok_or(VaultError::SecretNotFound)
    }

    fn delete_secret(&self, key: &str) -> Result<(), VaultError> {
        let mut map = self
            .secrets
            .lock()
            .map_err(|e| VaultError::BackendError(e.to_string()))?;
        map.remove(key).ok_or(VaultError::SecretNotFound)?;
        Ok(())
    }
}

/// SQLite-backed secret storage that persists across restarts.
/// Stores secrets in the `vault_secrets` table, encrypted with AES-256-GCM.
pub struct SqliteBackend {
    db: std::sync::Arc<Mutex<rusqlite::Connection>>,
    cipher: Aes256Gcm,
}

impl SqliteBackend {
    pub fn new(conn: std::sync::Arc<Mutex<rusqlite::Connection>>, master_key: [u8; 32]) -> Self {
        let cipher =
            Aes256Gcm::new_from_slice(&master_key).expect("AES-256-GCM key must be 32 bytes");
        Self { db: conn, cipher }
    }

    fn encrypt(&self, plaintext: &str) -> Result<String, VaultError> {
        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = self
            .cipher
            .encrypt(nonce, plaintext.as_bytes())
            .map_err(|e| VaultError::BackendError(format!("encryption failed: {}", e)))?;

        // Store as base64(nonce || ciphertext)
        let mut combined = Vec::with_capacity(12 + ciphertext.len());
        combined.extend_from_slice(&nonce_bytes);
        combined.extend_from_slice(&ciphertext);
        Ok(BASE64.encode(combined))
    }

    fn decrypt(&self, encoded: &str) -> Result<String, VaultError> {
        let combined = BASE64
            .decode(encoded)
            .map_err(|e| VaultError::BackendError(format!("base64 decode failed: {}", e)))?;

        if combined.len() < 12 {
            return Err(VaultError::BackendError("ciphertext too short".into()));
        }

        let (nonce_bytes, ciphertext) = combined.split_at(12);
        let nonce = Nonce::from_slice(nonce_bytes);

        let plaintext = self
            .cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| VaultError::BackendError(format!("decryption failed: {}", e)))?;

        String::from_utf8(plaintext)
            .map_err(|e| VaultError::BackendError(format!("UTF-8 decode failed: {}", e)))
    }
}

impl SecretBackend for SqliteBackend {
    fn set_secret(&self, key: &str, value: &str) -> Result<(), VaultError> {
        tracing::info!(key, "Vault: storing secret");
        let encrypted = self.encrypt(value)?;
        let conn = self
            .db
            .lock()
            .map_err(|e| VaultError::BackendError(e.to_string()))?;
        conn.execute(
            "INSERT INTO vault_secrets (backend_key, secret_value, updated_at)
             VALUES (?1, ?2, datetime('now'))
             ON CONFLICT(backend_key) DO UPDATE SET secret_value = ?2, updated_at = datetime('now')",
            rusqlite::params![key, encrypted],
        )
        .map_err(|e| {
            tracing::error!(key, error = %e, "Vault: failed to store secret");
            VaultError::BackendError(e.to_string())
        })?;
        tracing::debug!(key, "Vault: secret stored successfully");
        Ok(())
    }

    fn get_secret(&self, key: &str) -> Result<String, VaultError> {
        tracing::debug!(key, "Vault: retrieving secret");
        let conn = self
            .db
            .lock()
            .map_err(|e| VaultError::BackendError(e.to_string()))?;
        let encrypted: String = conn
            .query_row(
                "SELECT secret_value FROM vault_secrets WHERE backend_key = ?1",
                rusqlite::params![key],
                |row| row.get(0),
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => {
                    tracing::warn!(key, "Vault: secret not found");
                    VaultError::SecretNotFound
                }
                _ => {
                    tracing::error!(key, error = %e, "Vault: failed to retrieve secret");
                    VaultError::BackendError(e.to_string())
                }
            })?;
        self.decrypt(&encrypted)
    }

    fn delete_secret(&self, key: &str) -> Result<(), VaultError> {
        tracing::info!(key, "Vault: deleting secret");
        let conn = self
            .db
            .lock()
            .map_err(|e| VaultError::BackendError(e.to_string()))?;
        let affected = conn
            .execute(
                "DELETE FROM vault_secrets WHERE backend_key = ?1",
                rusqlite::params![key],
            )
            .map_err(|e| {
                tracing::error!(key, error = %e, "Vault: failed to delete secret");
                VaultError::BackendError(e.to_string())
            })?;
        if affected == 0 {
            tracing::warn!(key, "Vault: secret not found for deletion");
            return Err(VaultError::SecretNotFound);
        }
        tracing::debug!(key, "Vault: secret deleted successfully");
        Ok(())
    }
}
