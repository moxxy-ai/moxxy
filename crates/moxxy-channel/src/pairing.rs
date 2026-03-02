use moxxy_storage::{ChannelBindingRow, ChannelPairingCodeRow, Database};
use moxxy_types::ChannelError;
use rand::Rng;
use std::sync::{Arc, Mutex};

pub struct PairingService {
    db: Arc<Mutex<Database>>,
}

impl PairingService {
    pub fn new(db: Arc<Mutex<Database>>) -> Self {
        Self { db }
    }

    /// Generate a 6-digit pairing code for a given channel and external_chat_id.
    /// Called when a Telegram user sends /start to the bot.
    pub fn generate_code(
        &self,
        channel_id: &str,
        external_chat_id: &str,
    ) -> Result<String, ChannelError> {
        let code: String = format!("{:06}", rand::thread_rng().gen_range(100000..999999));
        let now = chrono::Utc::now();
        let expires_at = now + chrono::Duration::minutes(5);

        tracing::info!(
            channel_id,
            external_chat_id,
            "Generating pairing code"
        );

        let row = ChannelPairingCodeRow {
            id: uuid::Uuid::now_v7().to_string(),
            channel_id: channel_id.to_string(),
            external_chat_id: external_chat_id.to_string(),
            code: code.clone(),
            expires_at: expires_at.to_rfc3339(),
            consumed: false,
            created_at: now.to_rfc3339(),
        };

        let db = self
            .db
            .lock()
            .map_err(|e| ChannelError::StorageError(e.to_string()))?;
        db.channel_pairing()
            .insert(&row)
            .map_err(|e| ChannelError::StorageError(e.to_string()))?;

        tracing::info!(channel_id, "Pairing code generated successfully");
        Ok(code)
    }

    /// Validate a pairing code and create a binding.
    /// Called from the CLI or API when user enters the 6-digit code.
    pub fn consume_code(
        &self,
        code: &str,
        agent_id: &str,
    ) -> Result<ChannelBindingRow, ChannelError> {
        tracing::info!(agent_id, "Consuming pairing code");

        let db = self
            .db
            .lock()
            .map_err(|e| ChannelError::StorageError(e.to_string()))?;

        let pairing = db
            .channel_pairing()
            .find_by_code(code)
            .map_err(|e| ChannelError::StorageError(e.to_string()))?
            .ok_or_else(|| {
                tracing::warn!(agent_id, "Pairing code not found");
                ChannelError::PairingCodeInvalid
            })?;

        if pairing.consumed {
            tracing::warn!(agent_id, channel_id = %pairing.channel_id, "Pairing code already consumed");
            return Err(ChannelError::PairingCodeInvalid);
        }

        // Check expiry
        let expires_at = pairing
            .expires_at
            .parse::<chrono::DateTime<chrono::Utc>>()
            .map_err(|e| ChannelError::StorageError(e.to_string()))?;
        if expires_at < chrono::Utc::now() {
            tracing::warn!(agent_id, channel_id = %pairing.channel_id, "Pairing code expired");
            let _ = db.channel_pairing().delete_expired();
            return Err(ChannelError::PairingCodeExpired);
        }

        // Mark consumed
        db.channel_pairing()
            .consume(&pairing.id)
            .map_err(|e| ChannelError::StorageError(e.to_string()))?;

        // Create binding
        let now = chrono::Utc::now().to_rfc3339();
        let binding = ChannelBindingRow {
            id: uuid::Uuid::now_v7().to_string(),
            channel_id: pairing.channel_id.clone(),
            agent_id: agent_id.to_string(),
            external_chat_id: pairing.external_chat_id.clone(),
            status: "active".to_string(),
            created_at: now.clone(),
            updated_at: now,
        };

        db.channel_bindings()
            .insert(&binding)
            .map_err(|e| ChannelError::StorageError(e.to_string()))?;

        tracing::info!(
            agent_id,
            channel_id = %pairing.channel_id,
            binding_id = %binding.id,
            "Pairing code consumed, binding created"
        );
        Ok(binding)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn setup_db() -> Arc<Mutex<Database>> {
        let conn = rusqlite::Connection::open_in_memory().expect("Failed to open in-memory db");
        conn.execute_batch(include_str!("../../../migrations/0001_init.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../../migrations/0002_channels.sql"))
            .unwrap();

        // Seed vault ref
        conn.execute(
            "INSERT INTO vault_secret_refs (id, key_name, backend_key, policy_label, created_at, updated_at)
             VALUES ('secret-1', 'channel:ch1:bot_token', 'keyring://test', 'default', '2025-01-01', '2025-01-01')",
            [],
        )
        .unwrap();

        // Seed channel
        conn.execute(
            "INSERT INTO channels (id, channel_type, display_name, vault_secret_ref_id, status, created_at, updated_at)
             VALUES ('ch1', 'telegram', 'Test Bot', 'secret-1', 'active', '2025-01-01', '2025-01-01')",
            [],
        )
        .unwrap();

        // Seed provider + agent
        conn.execute(
            "INSERT INTO providers (id, display_name, manifest_path, enabled, created_at) VALUES ('p1', 'P1', '/p1', 1, '2025-01-01')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO agents (id, provider_id, model_id, workspace_root, status, depth, spawned_total, created_at, updated_at)
             VALUES ('agent-1', 'p1', 'm1', '/tmp', 'idle', 0, 0, '2025-01-01', '2025-01-01')",
            [],
        )
        .unwrap();

        Arc::new(Mutex::new(Database::new(conn)))
    }

    #[test]
    fn generate_code_returns_6_digits() {
        let db = setup_db();
        let service = PairingService::new(db);
        let code = service.generate_code("ch1", "12345").unwrap();
        assert_eq!(code.len(), 6);
        assert!(code.chars().all(|c| c.is_ascii_digit()));
    }

    #[test]
    fn consume_code_creates_binding() {
        let db = setup_db();
        let service = PairingService::new(db.clone());
        let code = service.generate_code("ch1", "12345").unwrap();
        let binding = service.consume_code(&code, "agent-1").unwrap();
        assert_eq!(binding.channel_id, "ch1");
        assert_eq!(binding.agent_id, "agent-1");
        assert_eq!(binding.external_chat_id, "12345");
        assert_eq!(binding.status, "active");
    }

    #[test]
    fn consumed_code_rejected() {
        let db = setup_db();
        let service = PairingService::new(db.clone());
        let code = service.generate_code("ch1", "12345").unwrap();
        service.consume_code(&code, "agent-1").unwrap();
        let result = service.consume_code(&code, "agent-1");
        assert!(matches!(result, Err(ChannelError::PairingCodeInvalid)));
    }

    #[test]
    fn invalid_code_rejected() {
        let db = setup_db();
        let service = PairingService::new(db);
        let result = service.consume_code("000000", "agent-1");
        assert!(matches!(result, Err(ChannelError::PairingCodeInvalid)));
    }

    #[test]
    fn expired_code_rejected() {
        let db = setup_db();
        let service = PairingService::new(db.clone());
        let code = service.generate_code("ch1", "12345").unwrap();

        // Manually set expires_at to past
        {
            let db = db.lock().unwrap();
            db.conn()
                .execute(
                    "UPDATE channel_pairing_codes SET expires_at = '2020-01-01T00:00:00+00:00' WHERE code = ?1",
                    rusqlite::params![code],
                )
                .unwrap();
        }

        let result = service.consume_code(&code, "agent-1");
        assert!(matches!(result, Err(ChannelError::PairingCodeExpired)));
    }
}
