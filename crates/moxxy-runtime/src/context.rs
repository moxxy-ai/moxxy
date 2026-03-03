use std::sync::{Arc, Mutex};

use moxxy_core::EventBus;
use moxxy_storage::Database;
use moxxy_types::{EventEnvelope, EventType};
use moxxy_vault::SecretBackend;

use crate::primitives::ask::AskChannels;
use crate::registry::PrimitiveError;

/// Shared context for primitives that need vault access (e.g. git primitives).
/// Resolves secrets by key_name, checking that the agent has a non-revoked grant.
/// Optionally supports interactive secret resolution via the user.ask mechanism.
#[derive(Clone)]
pub struct PrimitiveContext {
    db: Arc<Mutex<Database>>,
    agent_id: String,
    vault_backend: Arc<dyn SecretBackend + Send + Sync>,
    event_bus: Option<EventBus>,
    ask_channels: Option<AskChannels>,
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
            event_bus: None,
            ask_channels: None,
        }
    }

    /// Enable interactive secret resolution via user.ask.
    pub fn with_ask_support(mut self, event_bus: EventBus, ask_channels: AskChannels) -> Self {
        self.event_bus = Some(event_bus);
        self.ask_channels = Some(ask_channels);
        self
    }

    /// Returns the agent ID this context belongs to.
    pub fn agent_id(&self) -> &str {
        &self.agent_id
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

    /// Resolve a secret, falling back to user.ask if the secret is missing and
    /// ask support is configured. On receiving an answer the token is persisted
    /// in the vault and a grant is created so subsequent calls resolve directly.
    pub async fn resolve_or_ask_secret(
        &self,
        key_name: &str,
        question: &str,
    ) -> Result<String, PrimitiveError> {
        // 1. Try vault first
        if let Some(value) = self.resolve_secret(key_name)? {
            return Ok(value);
        }

        // 2. Fall back to user.ask if wired up
        let event_bus = self.event_bus.as_ref().ok_or_else(|| {
            PrimitiveError::AccessDenied(format!(
                "{key_name} not found in vault and interactive ask is not available"
            ))
        })?;
        let ask_channels = self.ask_channels.as_ref().ok_or_else(|| {
            PrimitiveError::AccessDenied(format!(
                "{key_name} not found in vault and interactive ask is not available"
            ))
        })?;

        let question_id = uuid::Uuid::now_v7().to_string();

        // Create oneshot channel for the answer
        let (tx, rx) = tokio::sync::oneshot::channel::<String>();
        {
            let mut channels = ask_channels
                .lock()
                .map_err(|_| PrimitiveError::ExecutionFailed("lock poisoned".into()))?;
            channels.insert(question_id.clone(), tx);
        }

        // Emit the ask event so the CLI/SSE can show the question
        event_bus.emit(EventEnvelope::new(
            self.agent_id.clone(),
            None,
            None,
            0,
            EventType::UserAskQuestion,
            serde_json::json!({
                "question_id": question_id,
                "question": question,
            }),
        ));

        // Wait for answer (5 minute timeout)
        let timeout = std::time::Duration::from_secs(300);
        let answer = match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(answer)) => answer,
            Ok(Err(_)) => {
                // Channel closed without answer
                if let Ok(mut ch) = ask_channels.lock() {
                    ch.remove(&question_id);
                }
                return Err(PrimitiveError::ExecutionFailed(
                    "ask channel closed without response".into(),
                ));
            }
            Err(_) => {
                // Timeout
                if let Ok(mut ch) = ask_channels.lock() {
                    ch.remove(&question_id);
                }
                return Err(PrimitiveError::Timeout);
            }
        };

        // Emit answered event
        event_bus.emit(EventEnvelope::new(
            self.agent_id.clone(),
            None,
            None,
            0,
            EventType::UserAskAnswered,
            serde_json::json!({ "question_id": question_id }),
        ));

        // 3. Persist the token in vault so future calls don't re-ask
        let backend_key = format!("agent_{}_{}", self.agent_id, key_name);
        self.set_secret(&backend_key, &answer)?;
        let ref_id = self.create_secret_ref(key_name, &backend_key, Some("user-provided"))?;
        self.grant_access(&self.agent_id, &ref_id)?;

        tracing::info!(
            agent_id = %self.agent_id,
            key_name,
            "Secret obtained via user.ask and stored in vault"
        );

        Ok(answer)
    }

    /// Store a secret value in the vault backend.
    pub fn set_secret(&self, backend_key: &str, value: &str) -> Result<(), PrimitiveError> {
        self.vault_backend
            .set_secret(backend_key, value)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("vault set_secret: {}", e)))
    }

    /// Delete a secret value from the vault backend.
    pub fn delete_secret(&self, backend_key: &str) -> Result<(), PrimitiveError> {
        self.vault_backend
            .delete_secret(backend_key)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("vault delete_secret: {}", e)))
    }

    /// Create or update a secret ref in the DB. Returns the secret_ref_id.
    /// If a ref with the same key_name already exists, updates it.
    pub fn create_secret_ref(
        &self,
        key_name: &str,
        backend_key: &str,
        policy_label: Option<&str>,
    ) -> Result<String, PrimitiveError> {
        let db = self
            .db
            .lock()
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("DB lock failed: {}", e)))?;

        // Check if ref already exists for this key_name
        if let Some(existing) = db
            .vault_refs()
            .find_by_key_name(key_name)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("vault ref lookup: {}", e)))?
        {
            return Ok(existing.id);
        }

        let now = chrono::Utc::now().to_rfc3339();
        let row = moxxy_storage::VaultSecretRefRow {
            id: uuid::Uuid::now_v7().to_string(),
            key_name: key_name.to_string(),
            backend_key: backend_key.to_string(),
            policy_label: policy_label.map(|s| s.to_string()),
            created_at: now.clone(),
            updated_at: now,
        };
        db.vault_refs()
            .insert(&row)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("vault ref insert: {}", e)))?;
        Ok(row.id)
    }

    /// Grant an agent access to a secret ref. Idempotent.
    pub fn grant_access(&self, agent_id: &str, secret_ref_id: &str) -> Result<(), PrimitiveError> {
        let db = self
            .db
            .lock()
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("DB lock failed: {}", e)))?;

        // Check for existing active grant
        let grants = db
            .vault_grants()
            .find_by_agent(agent_id)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("vault grant lookup: {}", e)))?;

        let already_granted = grants
            .iter()
            .any(|g| g.secret_ref_id == secret_ref_id && g.revoked_at.is_none());

        if already_granted {
            return Ok(());
        }

        let now = chrono::Utc::now().to_rfc3339();
        let row = moxxy_storage::VaultGrantRow {
            id: uuid::Uuid::now_v7().to_string(),
            agent_id: agent_id.to_string(),
            secret_ref_id: secret_ref_id.to_string(),
            created_at: now,
            revoked_at: None,
        };
        db.vault_grants()
            .insert(&row)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("vault grant insert: {}", e)))?;
        Ok(())
    }

    /// Find a secret ref by key_name.
    pub fn find_secret_ref(
        &self,
        key_name: &str,
    ) -> Result<Option<moxxy_storage::VaultSecretRefRow>, PrimitiveError> {
        let db = self
            .db
            .lock()
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("DB lock failed: {}", e)))?;
        db.vault_refs()
            .find_by_key_name(key_name)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("vault ref lookup: {}", e)))
    }

    /// Check if an agent has an active grant for a secret ref.
    pub fn has_grant(&self, agent_id: &str, secret_ref_id: &str) -> Result<bool, PrimitiveError> {
        let db = self
            .db
            .lock()
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("DB lock failed: {}", e)))?;
        let grants = db
            .vault_grants()
            .find_by_agent(agent_id)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("vault grant lookup: {}", e)))?;
        Ok(grants
            .iter()
            .any(|g| g.secret_ref_id == secret_ref_id && g.revoked_at.is_none()))
    }

    /// Delete a secret ref from the DB.
    pub fn delete_secret_ref(&self, secret_ref_id: &str) -> Result<(), PrimitiveError> {
        let db = self
            .db
            .lock()
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("DB lock failed: {}", e)))?;
        db.vault_refs()
            .delete(secret_ref_id)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("vault ref delete: {}", e)))
    }

    /// List secrets the agent has active grants for (key_name + policy_label only, no values).
    pub fn list_agent_secrets(
        &self,
        agent_id: &str,
    ) -> Result<Vec<serde_json::Value>, PrimitiveError> {
        let db = self
            .db
            .lock()
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("DB lock failed: {}", e)))?;

        let grants = db
            .vault_grants()
            .find_by_agent(agent_id)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("vault grant lookup: {}", e)))?;

        let active_ref_ids: Vec<&str> = grants
            .iter()
            .filter(|g| g.revoked_at.is_none())
            .map(|g| g.secret_ref_id.as_str())
            .collect();

        let mut secrets = Vec::new();
        for ref_id in active_ref_ids {
            if let Some(secret_ref) = db
                .vault_refs()
                .find_by_id(ref_id)
                .map_err(|e| PrimitiveError::ExecutionFailed(format!("vault ref lookup: {}", e)))?
            {
                secrets.push(serde_json::json!({
                    "key_name": secret_ref.key_name,
                    "policy_label": secret_ref.policy_label,
                }));
            }
        }

        Ok(secrets)
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
                "INSERT OR IGNORE INTO agents (id, name, workspace_root, status, depth, spawned_total,
                 created_at, updated_at)
                 VALUES (?1, ?1, '/tmp/ws', 'idle', 0, 0, ?2, ?2)",
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

    #[tokio::test]
    async fn resolve_or_ask_returns_vault_value_when_available() {
        let test_db = TestDb::new();
        let agent_id = "agent-1";
        seed_agent(&test_db, agent_id);
        seed_secret_ref(&test_db, "ref-1", "github-token", "bk-github");
        seed_grant(&test_db, agent_id, "ref-1");

        let backend = Arc::new(InMemoryBackend::new());
        backend.set_secret("bk-github", "ghp_existing").unwrap();

        let bus = EventBus::new(100);
        let channels = crate::primitives::ask::new_ask_channels();

        let db = Arc::new(Mutex::new(Database::new(test_db.into_conn())));
        let ctx =
            PrimitiveContext::new(db, agent_id.into(), backend).with_ask_support(bus, channels);

        let result = ctx
            .resolve_or_ask_secret("github-token", "Provide token:")
            .await
            .unwrap();
        assert_eq!(result, "ghp_existing");
    }

    #[tokio::test]
    async fn resolve_or_ask_falls_back_to_user_ask() {
        let test_db = TestDb::new();
        let agent_id = "agent-1";
        seed_agent(&test_db, agent_id);
        // No secret in vault

        let backend = Arc::new(InMemoryBackend::new());
        let bus = EventBus::new(100);
        let channels = crate::primitives::ask::new_ask_channels();

        let db = Arc::new(Mutex::new(Database::new(test_db.into_conn())));
        let ctx = PrimitiveContext::new(db, agent_id.into(), backend.clone())
            .with_ask_support(bus, channels.clone());

        // Spawn the resolve_or_ask in background
        let handle = tokio::spawn(async move {
            ctx.resolve_or_ask_secret("github-token", "Provide your GitHub token:")
                .await
        });

        // Wait for the ask channel to be registered
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        // Answer the question
        let question_id = {
            let ch = channels.lock().unwrap();
            assert_eq!(ch.len(), 1);
            ch.keys().next().unwrap().clone()
        };
        {
            let mut ch = channels.lock().unwrap();
            let tx = ch.remove(&question_id).unwrap();
            tx.send("ghp_user_provided".to_string()).unwrap();
        }

        let result = handle.await.unwrap().unwrap();
        assert_eq!(result, "ghp_user_provided");

        // Verify it was persisted in vault backend
        let stored = backend.get_secret("agent_agent-1_github-token").unwrap();
        assert_eq!(stored, "ghp_user_provided");
    }

    #[tokio::test]
    async fn resolve_or_ask_errors_without_ask_support() {
        let test_db = TestDb::new();
        let agent_id = "agent-1";
        seed_agent(&test_db, agent_id);
        // No secret, no ask support

        let backend = Arc::new(InMemoryBackend::new());
        let db = Arc::new(Mutex::new(Database::new(test_db.into_conn())));
        let ctx = PrimitiveContext::new(db, agent_id.into(), backend);

        let result = ctx
            .resolve_or_ask_secret("github-token", "Provide token:")
            .await;
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::AccessDenied(_)
        ));
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
