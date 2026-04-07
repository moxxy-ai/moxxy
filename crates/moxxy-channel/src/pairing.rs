use moxxy_core::{BindingEntry, ChannelStore};
use moxxy_types::ChannelError;
use rand::Rng;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// In-memory pairing code entry.
struct PairingCode {
    channel_id: String,
    external_chat_id: String,
    expires_at: chrono::DateTime<chrono::Utc>,
    consumed: bool,
}

pub struct PairingService {
    codes: Mutex<HashMap<String, PairingCode>>,
    moxxy_home: PathBuf,
}

impl PairingService {
    pub fn new(moxxy_home: &Path) -> Self {
        Self {
            codes: Mutex::new(HashMap::new()),
            moxxy_home: moxxy_home.to_path_buf(),
        }
    }

    /// Generate a 6-digit pairing code for a given channel and external_chat_id.
    /// Called when a Telegram user sends /start to the bot.
    pub fn generate_code(
        &self,
        channel_id: &str,
        external_chat_id: &str,
    ) -> Result<String, ChannelError> {
        let code: String = format!("{:06}", rand::thread_rng().gen_range(100000..999999));
        let expires_at = chrono::Utc::now() + chrono::Duration::minutes(5);

        tracing::info!(channel_id, external_chat_id, "Generating pairing code");

        let entry = PairingCode {
            channel_id: channel_id.to_string(),
            external_chat_id: external_chat_id.to_string(),
            expires_at,
            consumed: false,
        };

        let mut codes = self
            .codes
            .lock()
            .map_err(|e| ChannelError::StorageError(e.to_string()))?;

        // Purge expired codes while we have the lock
        let now = chrono::Utc::now();
        codes.retain(|_, v| v.expires_at > now && !v.consumed);

        codes.insert(code.clone(), entry);

        tracing::info!(channel_id, "Pairing code generated successfully");
        Ok(code)
    }

    /// Validate a pairing code and create a binding on disk.
    /// Called from the CLI or API when user enters the 6-digit code.
    pub fn consume_code(
        &self,
        code: &str,
        agent_name: &str,
    ) -> Result<ConsumedBinding, ChannelError> {
        tracing::info!(agent_name, "Consuming pairing code");

        let (channel_id, external_chat_id) = {
            let mut codes = self
                .codes
                .lock()
                .map_err(|e| ChannelError::StorageError(e.to_string()))?;

            let pairing = codes.get(code).ok_or_else(|| {
                tracing::warn!(agent_name, "Pairing code not found");
                ChannelError::PairingCodeInvalid
            })?;

            if pairing.consumed {
                tracing::warn!(agent_name, channel_id = %pairing.channel_id, "Pairing code already consumed");
                return Err(ChannelError::PairingCodeInvalid);
            }

            if pairing.expires_at < chrono::Utc::now() {
                tracing::warn!(agent_name, channel_id = %pairing.channel_id, "Pairing code expired");
                return Err(ChannelError::PairingCodeExpired);
            }

            let channel_id = pairing.channel_id.clone();
            let external_chat_id = pairing.external_chat_id.clone();

            // Mark consumed
            codes.get_mut(code).unwrap().consumed = true;

            (channel_id, external_chat_id)
        };

        // Create binding on disk
        let mut bindings = ChannelStore::load_bindings(&self.moxxy_home, &channel_id);

        // Remove any existing binding for this chat (one agent per chat)
        bindings.0.retain(|_, entry| entry.status != "active");

        let now = chrono::Utc::now().to_rfc3339();
        bindings.0.insert(
            external_chat_id.clone(),
            BindingEntry {
                agent_name: agent_name.to_string(),
                status: "active".into(),
                created_at: now,
            },
        );
        ChannelStore::save_bindings(&self.moxxy_home, &channel_id, &bindings)
            .map_err(|e| ChannelError::StorageError(e.to_string()))?;

        tracing::info!(
            agent_name,
            channel_id = %channel_id,
            external_chat_id = %external_chat_id,
            "Pairing code consumed, binding created"
        );

        Ok(ConsumedBinding {
            channel_id,
            agent_name: agent_name.to_string(),
            external_chat_id,
        })
    }
}

/// Result of successfully consuming a pairing code.
#[derive(Debug, Clone)]
pub struct ConsumedBinding {
    pub channel_id: String,
    pub agent_name: String,
    pub external_chat_id: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_code_returns_6_digits() {
        let tmp = tempfile::tempdir().unwrap();
        // Create channel dir
        let doc = moxxy_core::ChannelDoc {
            channel_type: "telegram".into(),
            display_name: "Test".into(),
            vault_secret_ref_id: "ref-1".into(),
            status: "active".into(),
            config: None,
            created_at: "2025-01-01".into(),
            updated_at: "2025-01-01".into(),
        };
        ChannelStore::create(tmp.path(), "ch1", &doc).unwrap();

        let service = PairingService::new(tmp.path());
        let code = service.generate_code("ch1", "12345").unwrap();
        assert_eq!(code.len(), 6);
        assert!(code.chars().all(|c| c.is_ascii_digit()));
    }

    #[test]
    fn consume_code_creates_binding() {
        let tmp = tempfile::tempdir().unwrap();
        let doc = moxxy_core::ChannelDoc {
            channel_type: "telegram".into(),
            display_name: "Test".into(),
            vault_secret_ref_id: "ref-1".into(),
            status: "active".into(),
            config: None,
            created_at: "2025-01-01".into(),
            updated_at: "2025-01-01".into(),
        };
        ChannelStore::create(tmp.path(), "ch1", &doc).unwrap();

        let service = PairingService::new(tmp.path());
        let code = service.generate_code("ch1", "12345").unwrap();
        let binding = service.consume_code(&code, "agent-1").unwrap();
        assert_eq!(binding.channel_id, "ch1");
        assert_eq!(binding.agent_name, "agent-1");
        assert_eq!(binding.external_chat_id, "12345");

        // Verify on disk
        let bindings = ChannelStore::load_bindings(tmp.path(), "ch1");
        assert_eq!(bindings.0.len(), 1);
        assert_eq!(bindings.0["12345"].agent_name, "agent-1");
    }

    #[test]
    fn consumed_code_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let doc = moxxy_core::ChannelDoc {
            channel_type: "telegram".into(),
            display_name: "Test".into(),
            vault_secret_ref_id: "ref-1".into(),
            status: "active".into(),
            config: None,
            created_at: "2025-01-01".into(),
            updated_at: "2025-01-01".into(),
        };
        ChannelStore::create(tmp.path(), "ch1", &doc).unwrap();

        let service = PairingService::new(tmp.path());
        let code = service.generate_code("ch1", "12345").unwrap();
        service.consume_code(&code, "agent-1").unwrap();
        let result = service.consume_code(&code, "agent-1");
        assert!(matches!(result, Err(ChannelError::PairingCodeInvalid)));
    }

    #[test]
    fn invalid_code_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let service = PairingService::new(tmp.path());
        let result = service.consume_code("000000", "agent-1");
        assert!(matches!(result, Err(ChannelError::PairingCodeInvalid)));
    }

    #[test]
    fn expired_code_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let doc = moxxy_core::ChannelDoc {
            channel_type: "telegram".into(),
            display_name: "Test".into(),
            vault_secret_ref_id: "ref-1".into(),
            status: "active".into(),
            config: None,
            created_at: "2025-01-01".into(),
            updated_at: "2025-01-01".into(),
        };
        ChannelStore::create(tmp.path(), "ch1", &doc).unwrap();

        let service = PairingService::new(tmp.path());
        let code = service.generate_code("ch1", "12345").unwrap();

        // Manually expire the code
        {
            let mut codes = service.codes.lock().unwrap();
            codes.get_mut(&code).unwrap().expires_at =
                chrono::Utc::now() - chrono::Duration::minutes(1);
        }

        let result = service.consume_code(&code, "agent-1");
        assert!(matches!(result, Err(ChannelError::PairingCodeExpired)));
    }
}
