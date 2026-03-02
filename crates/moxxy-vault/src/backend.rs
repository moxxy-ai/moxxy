use moxxy_types::VaultError;
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
