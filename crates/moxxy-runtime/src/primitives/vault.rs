use async_trait::async_trait;

use crate::context::PrimitiveContext;
use crate::registry::{Primitive, PrimitiveError};

// --- vault.set ---

pub struct VaultSetPrimitive {
    ctx: PrimitiveContext,
}

impl VaultSetPrimitive {
    pub fn new(ctx: PrimitiveContext) -> Self {
        Self { ctx }
    }
}

#[async_trait]
impl Primitive for VaultSetPrimitive {
    fn name(&self) -> &str {
        "vault.set"
    }

    fn description(&self) -> &str {
        "Store a secret in the vault. The agent is automatically granted access."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "key_name": {"type": "string", "description": "Name for the secret"},
                "value": {"type": "string", "description": "Secret value to store"},
                "policy_label": {"type": "string", "description": "Optional policy label"}
            },
            "required": ["key_name", "value"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let key_name = params["key_name"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'key_name' parameter".into()))?;

        let value = params["value"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'value' parameter".into()))?;

        let policy_label = params["policy_label"].as_str();

        let agent_id = self.ctx.agent_id();
        tracing::info!(key_name, agent_id = %agent_id, policy_label = ?policy_label, "Storing vault secret");
        let backend_key = format!("agent:{}:{}", agent_id, key_name);

        // Store encrypted value in backend
        self.ctx.set_secret(&backend_key, value)?;

        // Create or update secret ref in DB, and auto-grant to the calling agent
        let secret_ref_id = self
            .ctx
            .create_secret_ref(key_name, &backend_key, policy_label)?;
        self.ctx.grant_access(agent_id, &secret_ref_id)?;

        Ok(serde_json::json!({
            "status": "stored",
            "key_name": key_name,
        }))
    }
}

// --- vault.get ---

pub struct VaultGetPrimitive {
    ctx: PrimitiveContext,
}

impl VaultGetPrimitive {
    pub fn new(ctx: PrimitiveContext) -> Self {
        Self { ctx }
    }
}

#[async_trait]
impl Primitive for VaultGetPrimitive {
    fn name(&self) -> &str {
        "vault.get"
    }

    fn description(&self) -> &str {
        "Retrieve a secret from the vault. Requires an active grant."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "key_name": {"type": "string", "description": "Name of the secret to retrieve"}
            },
            "required": ["key_name"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let key_name = params["key_name"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'key_name' parameter".into()))?;

        tracing::debug!(key_name, agent_id = %self.ctx.agent_id(), "Retrieving vault secret");

        // resolve_secret checks grants and returns None if no grant
        match self.ctx.resolve_secret(key_name)? {
            Some(value) => Ok(serde_json::json!({
                "key_name": key_name,
                "value": value,
            })),
            None => {
                tracing::warn!(key_name, agent_id = %self.ctx.agent_id(), "Vault access denied — no grant");
                Err(PrimitiveError::AccessDenied(format!(
                    "no grant for secret '{}'",
                    key_name
                )))
            }
        }
    }
}

// --- vault.delete ---

pub struct VaultDeletePrimitive {
    ctx: PrimitiveContext,
}

impl VaultDeletePrimitive {
    pub fn new(ctx: PrimitiveContext) -> Self {
        Self { ctx }
    }
}

#[async_trait]
impl Primitive for VaultDeletePrimitive {
    fn name(&self) -> &str {
        "vault.delete"
    }

    fn description(&self) -> &str {
        "Delete a secret from the vault. Requires an active grant."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "key_name": {"type": "string", "description": "Name of the secret to delete"}
            },
            "required": ["key_name"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let key_name = params["key_name"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'key_name' parameter".into()))?;

        tracing::info!(key_name, agent_id = %self.ctx.agent_id(), "Deleting vault secret");

        // Check agent has a grant before allowing delete
        let secret_ref = self
            .ctx
            .find_secret_ref(key_name)?
            .ok_or_else(|| PrimitiveError::NotFound(format!("secret '{}' not found", key_name)))?;

        let agent_id = self.ctx.agent_id();
        if !self.ctx.has_grant(agent_id, &secret_ref.id)? {
            return Err(PrimitiveError::AccessDenied(format!(
                "no grant for secret '{}'",
                key_name
            )));
        }

        // Delete from backend
        self.ctx.delete_secret(&secret_ref.backend_key)?;

        // Delete ref from DB
        self.ctx.delete_secret_ref(&secret_ref.id)?;

        Ok(serde_json::json!({
            "status": "deleted",
            "key_name": key_name,
        }))
    }
}

// --- vault.list ---

pub struct VaultListPrimitive {
    ctx: PrimitiveContext,
}

impl VaultListPrimitive {
    pub fn new(ctx: PrimitiveContext) -> Self {
        Self { ctx }
    }
}

#[async_trait]
impl Primitive for VaultListPrimitive {
    fn name(&self) -> &str {
        "vault.list"
    }

    fn description(&self) -> &str {
        "List all secrets the agent has access to (names only, no values)."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {}
        })
    }

    async fn invoke(
        &self,
        _params: serde_json::Value,
    ) -> Result<serde_json::Value, PrimitiveError> {
        let agent_id = self.ctx.agent_id();
        tracing::debug!(agent_id = %agent_id, "Listing vault secrets");
        let secrets = self.ctx.list_agent_secrets(agent_id)?;

        Ok(serde_json::json!({
            "secrets": secrets,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use moxxy_storage::Database;
    use moxxy_test_utils::TestDb;
    use moxxy_vault::InMemoryBackend;
    use rusqlite::params;
    use std::sync::{Arc, Mutex};

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

    fn setup(agent_id: &str) -> PrimitiveContext {
        let test_db = TestDb::new();
        seed_agent(&test_db, agent_id);
        let backend = Arc::new(InMemoryBackend::new());
        let db = Arc::new(Mutex::new(Database::new(test_db.into_conn())));
        PrimitiveContext::new(db, agent_id.to_string(), backend)
    }

    #[tokio::test]
    async fn vault_set_and_get() {
        let ctx = setup("agent-1");
        let set_prim = VaultSetPrimitive::new(ctx.clone());
        let get_prim = VaultGetPrimitive::new(ctx);

        let result = set_prim
            .invoke(serde_json::json!({
                "key_name": "my-api-key",
                "value": "sk-secret-123",
            }))
            .await
            .unwrap();
        assert_eq!(result["status"], "stored");

        let result = get_prim
            .invoke(serde_json::json!({
                "key_name": "my-api-key",
            }))
            .await
            .unwrap();
        assert_eq!(result["value"], "sk-secret-123");
    }

    #[tokio::test]
    async fn vault_get_without_grant_denied() {
        let test_db = TestDb::new();
        seed_agent(&test_db, "agent-1");
        seed_agent(&test_db, "agent-2");
        let backend = Arc::new(InMemoryBackend::new());
        let db = Arc::new(Mutex::new(Database::new(test_db.into_conn())));

        // Agent-1 sets the secret
        let ctx1 = PrimitiveContext::new(db.clone(), "agent-1".into(), backend.clone());
        let set_prim = VaultSetPrimitive::new(ctx1);
        set_prim
            .invoke(serde_json::json!({
                "key_name": "shared-key",
                "value": "secret-value",
            }))
            .await
            .unwrap();

        // Agent-2 tries to get it — should be denied
        let ctx2 = PrimitiveContext::new(db, "agent-2".into(), backend);
        let get_prim = VaultGetPrimitive::new(ctx2);
        let result = get_prim
            .invoke(serde_json::json!({
                "key_name": "shared-key",
            }))
            .await;
        assert!(matches!(result, Err(PrimitiveError::AccessDenied(_))));
    }

    #[tokio::test]
    async fn vault_delete() {
        let ctx = setup("agent-1");
        let set_prim = VaultSetPrimitive::new(ctx.clone());
        let del_prim = VaultDeletePrimitive::new(ctx.clone());
        let get_prim = VaultGetPrimitive::new(ctx);

        set_prim
            .invoke(serde_json::json!({
                "key_name": "temp-key",
                "value": "temp-val",
            }))
            .await
            .unwrap();

        let result = del_prim
            .invoke(serde_json::json!({
                "key_name": "temp-key",
            }))
            .await
            .unwrap();
        assert_eq!(result["status"], "deleted");

        // Get should now fail
        let result = get_prim
            .invoke(serde_json::json!({
                "key_name": "temp-key",
            }))
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn vault_list() {
        let ctx = setup("agent-1");
        let set_prim = VaultSetPrimitive::new(ctx.clone());
        let list_prim = VaultListPrimitive::new(ctx);

        set_prim
            .invoke(serde_json::json!({
                "key_name": "key-a",
                "value": "val-a",
            }))
            .await
            .unwrap();
        set_prim
            .invoke(serde_json::json!({
                "key_name": "key-b",
                "value": "val-b",
                "policy_label": "production",
            }))
            .await
            .unwrap();

        let result = list_prim.invoke(serde_json::json!({})).await.unwrap();
        let secrets = result["secrets"].as_array().unwrap();
        assert_eq!(secrets.len(), 2);

        // Values should NOT be present in the list
        for s in secrets {
            assert!(s.get("value").is_none());
            assert!(s["key_name"].as_str().is_some());
        }
    }

    #[tokio::test]
    async fn vault_set_with_policy_label() {
        let ctx = setup("agent-1");
        let set_prim = VaultSetPrimitive::new(ctx.clone());
        let list_prim = VaultListPrimitive::new(ctx);

        set_prim
            .invoke(serde_json::json!({
                "key_name": "labeled-key",
                "value": "labeled-val",
                "policy_label": "staging",
            }))
            .await
            .unwrap();

        let result = list_prim.invoke(serde_json::json!({})).await.unwrap();
        let secrets = result["secrets"].as_array().unwrap();
        assert_eq!(secrets.len(), 1);
        assert_eq!(secrets[0]["policy_label"], "staging");
    }

    #[tokio::test]
    async fn vault_delete_without_grant_denied() {
        let test_db = TestDb::new();
        seed_agent(&test_db, "agent-1");
        seed_agent(&test_db, "agent-2");
        let backend = Arc::new(InMemoryBackend::new());
        let db = Arc::new(Mutex::new(Database::new(test_db.into_conn())));

        // Agent-1 sets
        let ctx1 = PrimitiveContext::new(db.clone(), "agent-1".into(), backend.clone());
        VaultSetPrimitive::new(ctx1)
            .invoke(serde_json::json!({
                "key_name": "owned-key",
                "value": "secret",
            }))
            .await
            .unwrap();

        // Agent-2 tries to delete — denied
        let ctx2 = PrimitiveContext::new(db, "agent-2".into(), backend);
        let result = VaultDeletePrimitive::new(ctx2)
            .invoke(serde_json::json!({
                "key_name": "owned-key",
            }))
            .await;
        assert!(matches!(result, Err(PrimitiveError::AccessDenied(_))));
    }

    #[tokio::test]
    async fn vault_set_missing_params() {
        let ctx = setup("agent-1");
        let prim = VaultSetPrimitive::new(ctx);

        // Missing value
        let result = prim.invoke(serde_json::json!({"key_name": "k"})).await;
        assert!(matches!(result, Err(PrimitiveError::InvalidParams(_))));

        // Missing key_name
        let result = prim.invoke(serde_json::json!({"value": "v"})).await;
        assert!(matches!(result, Err(PrimitiveError::InvalidParams(_))));
    }
}
