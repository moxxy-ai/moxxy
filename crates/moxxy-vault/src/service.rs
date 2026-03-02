use moxxy_storage::{VaultGrantDao, VaultGrantRow, VaultRefDao, VaultSecretRefRow};
use moxxy_types::VaultError;
use rusqlite::Connection;

use crate::backend::SecretBackend;
use crate::policy::VaultPolicy;

pub struct VaultService<B: SecretBackend> {
    backend: B,
    conn: *const Connection,
}

// SAFETY: VaultService is used single-threaded in practice (each test gets its own).
// The raw pointer is needed because Connection is !Sync and we can't store &Connection
// with a lifetime that would satisfy the borrow checker across method calls.
// We ensure the Connection outlives VaultService in all usage.
unsafe impl<B: SecretBackend + Send> Send for VaultService<B> {}

impl<B: SecretBackend> VaultService<B> {
    pub fn new(backend: B, conn: &Connection) -> Self {
        Self {
            backend,
            conn: conn as *const Connection,
        }
    }

    fn conn(&self) -> &Connection {
        // SAFETY: The caller of `new` guarantees the Connection outlives VaultService.
        unsafe { &*self.conn }
    }

    fn ref_dao(&self) -> VaultRefDao<'_> {
        VaultRefDao { conn: self.conn() }
    }

    fn grant_dao(&self) -> VaultGrantDao<'_> {
        VaultGrantDao { conn: self.conn() }
    }

    pub fn create_secret_ref(
        &self,
        key_name: &str,
        backend_key: &str,
        policy_label: Option<&str>,
    ) -> Result<VaultSecretRefRow, VaultError> {
        let now = chrono::Utc::now().to_rfc3339();
        let row = VaultSecretRefRow {
            id: uuid::Uuid::now_v7().to_string(),
            key_name: key_name.to_string(),
            backend_key: backend_key.to_string(),
            policy_label: policy_label.map(|s| s.to_string()),
            created_at: now.clone(),
            updated_at: now,
        };
        self.ref_dao()
            .insert(&row)
            .map_err(|e| VaultError::BackendError(e.to_string()))?;
        Ok(row)
    }

    pub fn store_secret(&self, backend_key: &str, value: &str) -> Result<(), VaultError> {
        self.backend.set_secret(backend_key, value)
    }

    pub fn get_secret_material(&self, backend_key: &str) -> Result<String, VaultError> {
        self.backend.get_secret(backend_key)
    }

    pub fn grant_access(
        &self,
        agent_id: &str,
        secret_ref_id: &str,
    ) -> Result<VaultGrantRow, VaultError> {
        // Check for existing active grant (idempotent)
        let existing = self
            .grant_dao()
            .find_by_agent(agent_id)
            .map_err(|e| VaultError::BackendError(e.to_string()))?;

        if let Some(grant) = existing
            .iter()
            .find(|g| g.secret_ref_id == secret_ref_id && g.revoked_at.is_none())
        {
            return Ok(grant.clone());
        }

        let now = chrono::Utc::now().to_rfc3339();
        let row = VaultGrantRow {
            id: uuid::Uuid::now_v7().to_string(),
            agent_id: agent_id.to_string(),
            secret_ref_id: secret_ref_id.to_string(),
            created_at: now,
            revoked_at: None,
        };
        self.grant_dao()
            .insert(&row)
            .map_err(|e| VaultError::BackendError(e.to_string()))?;
        Ok(row)
    }

    pub fn revoke_grant(&self, grant_id: &str) -> Result<(), VaultError> {
        self.grant_dao()
            .revoke(grant_id)
            .map_err(|e| VaultError::BackendError(e.to_string()))
    }

    pub fn resolve(&self, agent_id: &str, secret_ref_id: &str) -> Result<String, VaultError> {
        // Look up the secret ref
        let secret_ref = self
            .ref_dao()
            .find_by_id(secret_ref_id)
            .map_err(|e| VaultError::BackendError(e.to_string()))?
            .ok_or(VaultError::SecretNotFound)?;

        // Check grants
        let grants = self
            .grant_dao()
            .find_by_agent(agent_id)
            .map_err(|e| VaultError::BackendError(e.to_string()))?;

        VaultPolicy::check_grant(&grants, agent_id, secret_ref_id)?;

        // Fetch from backend
        self.backend.get_secret(&secret_ref.backend_key)
    }

    pub fn list_refs(&self) -> Result<Vec<VaultSecretRefRow>, VaultError> {
        self.ref_dao()
            .list_all()
            .map_err(|e| VaultError::BackendError(e.to_string()))
    }

    pub fn list_grants_for_agent(&self, agent_id: &str) -> Result<Vec<VaultGrantRow>, VaultError> {
        self.grant_dao()
            .find_by_agent(agent_id)
            .map_err(|e| VaultError::BackendError(e.to_string()))
    }

    pub fn delete_secret(&self, secret_ref_id: &str) -> Result<(), VaultError> {
        // Find the ref to get backend_key
        let secret_ref = self
            .ref_dao()
            .find_by_id(secret_ref_id)
            .map_err(|e| VaultError::BackendError(e.to_string()))?
            .ok_or(VaultError::SecretNotFound)?;

        // Delete from backend
        self.backend.delete_secret(&secret_ref.backend_key)?;

        // Delete from DB
        self.ref_dao()
            .delete(secret_ref_id)
            .map_err(|e| VaultError::BackendError(e.to_string()))
    }
}
