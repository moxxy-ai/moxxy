use std::sync::{Arc, Mutex};

use moxxy_storage::Database;
use moxxy_vault::SecretBackend;

use crate::registry::PrimitiveError;

/// Shared context for primitives that need vault access (e.g. git primitives).
/// Resolves secrets by key_name, checking that the agent has a non-revoked grant.
#[derive(Clone)]
pub struct PrimitiveContext {
    db: Arc<Mutex<Database>>,
    agent_id: String,
    vault_backend: Arc<dyn SecretBackend + Send + Sync>,
}

impl PrimitiveContext {
    pub fn new(
        db: Arc<Mutex<Database>>,
        agent_id: String,
        vault_backend: Arc<dyn SecretBackend + Send + Sync>,
    ) -> Self {
        Self {
            db,
            agent_id,
            vault_backend,
        }
    }

    /// Resolve a secret by key_name. Returns `Ok(Some(value))` if a matching
    /// vault_secret_ref exists AND the agent holds a non-revoked grant for it.
    /// Returns `Ok(None)` if the secret doesn't exist or the agent lacks a grant.
    pub fn resolve_secret(&self, key_name: &str) -> Result<Option<String>, PrimitiveError> {
        let db = self
            .db
            .lock()
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("DB lock failed: {}", e)))?;

        // 1. Look up the secret ref by key_name
        let secret_ref = db
            .vault_refs()
            .find_by_key_name(key_name)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("vault ref lookup: {}", e)))?;

        let secret_ref = match secret_ref {
            Some(r) => r,
            None => return Ok(None),
        };

        // 2. Check agent has a non-revoked grant for this secret
        let grants = db
            .vault_grants()
            .find_by_agent(&self.agent_id)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("vault grant lookup: {}", e)))?;

        let has_grant = grants
            .iter()
            .any(|g| g.secret_ref_id == secret_ref.id && g.revoked_at.is_none());

        if !has_grant {
            return Ok(None);
        }

        // 3. Fetch the actual secret material from the backend
        match self.vault_backend.get_secret(&secret_ref.backend_key) {
            Ok(value) => Ok(Some(value)),
            Err(moxxy_types::VaultError::SecretNotFound) => Ok(None),
            Err(e) => Err(PrimitiveError::ExecutionFailed(format!(
                "vault backend error: {}",
                e
            ))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use moxxy_test_utils::TestDb;
    use moxxy_vault::InMemoryBackend;
    use rusqlite::params;

    fn seed_agent(db: &TestDb, agent_id: &str) {
        let now = chrono::Utc::now().to_rfc3339();
        db.conn()
            .execute(
                "INSERT OR IGNORE INTO providers (id, display_name, manifest_path, enabled, created_at)
                 VALUES ('test-provider', 'Test', '/tmp/p.yaml', 1, ?1)",
                params![now],
            )
            .unwrap();
        db.conn()
            .execute(
                "INSERT OR IGNORE INTO agents (id, provider_id, model_id, workspace_root,
                 temperature, max_subagent_depth, max_subagents_total, status, depth, spawned_total,
                 created_at, updated_at)
                 VALUES (?1, 'test-provider', 'test-model', '/tmp/ws',
                 0.7, 2, 8, 'idle', 0, 0, ?2, ?2)",
                params![agent_id, now],
            )
            .unwrap();
    }

    fn seed_secret_ref(db: &TestDb, id: &str, key_name: &str, backend_key: &str) {
        let now = chrono::Utc::now().to_rfc3339();
        db.conn()
            .execute(
                "INSERT INTO vault_secret_refs (id, key_name, backend_key, policy_label, created_at, updated_at)
                 VALUES (?1, ?2, ?3, 'default', ?4, ?4)",
                params![id, key_name, backend_key, now],
            )
            .unwrap();
    }

    fn seed_grant(db: &TestDb, agent_id: &str, secret_ref_id: &str) {
        let now = chrono::Utc::now().to_rfc3339();
        let id = uuid::Uuid::now_v7().to_string();
        db.conn()
            .execute(
                "INSERT INTO vault_grants (id, agent_id, secret_ref_id, created_at, revoked_at)
                 VALUES (?1, ?2, ?3, ?4, NULL)",
                params![id, agent_id, secret_ref_id, now],
            )
            .unwrap();
    }

    #[test]
    fn resolve_secret_with_grant() {
        let test_db = TestDb::new();
        let agent_id = "agent-1";
        seed_agent(&test_db, agent_id);
        seed_secret_ref(&test_db, "ref-1", "github-token", "bk-github");
        seed_grant(&test_db, agent_id, "ref-1");

        let backend = Arc::new(InMemoryBackend::new());
        backend.set_secret("bk-github", "ghp_abc123").unwrap();

        let db = Arc::new(Mutex::new(Database::new(test_db.into_conn())));
        let ctx = PrimitiveContext::new(db, agent_id.into(), backend);

        let result = ctx.resolve_secret("github-token").unwrap();
        assert_eq!(result, Some("ghp_abc123".into()));
    }

    #[test]
    fn resolve_secret_without_grant_returns_none() {
        let test_db = TestDb::new();
        let agent_id = "agent-1";
        seed_agent(&test_db, agent_id);
        seed_secret_ref(&test_db, "ref-1", "github-token", "bk-github");
        // No grant inserted

        let backend = Arc::new(InMemoryBackend::new());
        backend.set_secret("bk-github", "ghp_abc123").unwrap();

        let db = Arc::new(Mutex::new(Database::new(test_db.into_conn())));
        let ctx = PrimitiveContext::new(db, agent_id.into(), backend);

        let result = ctx.resolve_secret("github-token").unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn resolve_secret_not_found_returns_none() {
        let test_db = TestDb::new();
        let agent_id = "agent-1";
        seed_agent(&test_db, agent_id);

        let backend = Arc::new(InMemoryBackend::new());
        let db = Arc::new(Mutex::new(Database::new(test_db.into_conn())));
        let ctx = PrimitiveContext::new(db, agent_id.into(), backend);

        let result = ctx.resolve_secret("nonexistent-key").unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn resolve_secret_with_revoked_grant_returns_none() {
        let test_db = TestDb::new();
        let agent_id = "agent-1";
        seed_agent(&test_db, agent_id);
        seed_secret_ref(&test_db, "ref-1", "github-token", "bk-github");

        // Insert a revoked grant
        let now = chrono::Utc::now().to_rfc3339();
        let id = uuid::Uuid::now_v7().to_string();
        test_db
            .conn()
            .execute(
                "INSERT INTO vault_grants (id, agent_id, secret_ref_id, created_at, revoked_at)
                 VALUES (?1, ?2, 'ref-1', ?3, ?3)",
                params![id, agent_id, now],
            )
            .unwrap();

        let backend = Arc::new(InMemoryBackend::new());
        backend.set_secret("bk-github", "ghp_abc123").unwrap();

        let db = Arc::new(Mutex::new(Database::new(test_db.into_conn())));
        let ctx = PrimitiveContext::new(db, agent_id.into(), backend);

        let result = ctx.resolve_secret("github-token").unwrap();
        assert_eq!(result, None);
    }
}
