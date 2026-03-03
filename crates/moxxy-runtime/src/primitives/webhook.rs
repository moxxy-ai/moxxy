use async_trait::async_trait;
use moxxy_storage::{Database, WebhookRow};
use std::sync::{Arc, Mutex};

use crate::context::PrimitiveContext;
use crate::registry::{Primitive, PrimitiveError};

pub struct WebhookRegisterPrimitive {
    db: Arc<Mutex<Database>>,
    ctx: PrimitiveContext,
    agent_id: String,
    base_url: String,
}

impl WebhookRegisterPrimitive {
    pub fn new(
        db: Arc<Mutex<Database>>,
        ctx: PrimitiveContext,
        agent_id: String,
        base_url: String,
    ) -> Self {
        Self {
            db,
            ctx,
            agent_id,
            base_url,
        }
    }
}

#[async_trait]
impl Primitive for WebhookRegisterPrimitive {
    fn name(&self) -> &str {
        "webhook.register"
    }

    fn description(&self) -> &str {
        "Register an inbound webhook endpoint. External services POST events to the returned URL."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "label": {"type": "string", "description": "Human-readable label for this webhook"},
                "secret": {"type": "string", "description": "Optional HMAC-SHA256 secret. If omitted, one is auto-generated."},
                "event_filter": {"type": "string", "description": "Optional comma-separated event types to accept (e.g. 'push,pull_request')"}
            },
            "required": ["label"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let label = params["label"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'label' parameter".into()))?;

        // Auto-generate secret if not provided
        let secret = match params["secret"].as_str() {
            Some(s) => s.to_string(),
            None => hex::encode(uuid::Uuid::now_v7().as_bytes()),
        };

        let event_filter = params["event_filter"].as_str().map(|s| s.to_string());

        tracing::info!(agent_id = %self.agent_id, label, "Registering inbound webhook");

        let token = uuid::Uuid::now_v7().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let id = uuid::Uuid::now_v7().to_string();

        // Store the HMAC secret in the vault via PrimitiveContext
        let backend_key = format!("webhook_secret_{}", id);
        self.ctx.set_secret(&backend_key, &secret)?;
        let secret_ref_id = self.ctx.create_secret_ref(
            &format!("webhook_secret_{}", id),
            &backend_key,
            Some("webhook"),
        )?;
        self.ctx.grant_access(&self.agent_id, &secret_ref_id)?;

        let row = WebhookRow {
            id: id.clone(),
            agent_id: self.agent_id.clone(),
            label: label.to_string(),
            token: token.clone(),
            secret_ref_id,
            event_filter,
            enabled: true,
            created_at: now.clone(),
            updated_at: now,
        };

        let db = self
            .db
            .lock()
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("DB lock error: {}", e)))?;

        db.webhooks().insert(&row).map_err(|e| {
            PrimitiveError::ExecutionFailed(format!("Failed to register webhook: {}", e))
        })?;

        let url = format!("{}/v1/hooks/{}", self.base_url.trim_end_matches('/'), token);

        Ok(serde_json::json!({
            "id": id,
            "label": label,
            "url": url,
            "secret": secret,
            "token": token,
            "enabled": true,
            "status": "registered",
        }))
    }
}

pub struct WebhookListPrimitive {
    db: Arc<Mutex<Database>>,
    agent_id: String,
    base_url: String,
}

impl WebhookListPrimitive {
    pub fn new(db: Arc<Mutex<Database>>, agent_id: String, base_url: String) -> Self {
        Self {
            db,
            agent_id,
            base_url,
        }
    }
}

#[async_trait]
impl Primitive for WebhookListPrimitive {
    fn name(&self) -> &str {
        "webhook.list"
    }

    fn description(&self) -> &str {
        "List all inbound webhooks registered for the current agent."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {},
            "required": []
        })
    }

    async fn invoke(
        &self,
        _params: serde_json::Value,
    ) -> Result<serde_json::Value, PrimitiveError> {
        tracing::debug!(agent_id = %self.agent_id, "Listing inbound webhooks");

        let db = self
            .db
            .lock()
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("DB lock error: {}", e)))?;

        let webhooks = db
            .webhooks()
            .find_by_agent(&self.agent_id)
            .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;

        let base = self.base_url.trim_end_matches('/');
        let result: Vec<serde_json::Value> = webhooks
            .iter()
            .map(|w| {
                serde_json::json!({
                    "id": w.id,
                    "label": w.label,
                    "url": format!("{}/v1/hooks/{}", base, w.token),
                    "event_filter": w.event_filter,
                    "enabled": w.enabled,
                })
            })
            .collect();

        Ok(serde_json::json!({ "webhooks": result }))
    }
}

pub struct WebhookDeletePrimitive {
    db: Arc<Mutex<Database>>,
    ctx: PrimitiveContext,
    agent_id: String,
}

impl WebhookDeletePrimitive {
    pub fn new(db: Arc<Mutex<Database>>, ctx: PrimitiveContext, agent_id: String) -> Self {
        Self { db, ctx, agent_id }
    }
}

#[async_trait]
impl Primitive for WebhookDeletePrimitive {
    fn name(&self) -> &str {
        "webhook.delete"
    }

    fn description(&self) -> &str {
        "Delete an inbound webhook by ID. Cleans up the associated HMAC secret."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "webhook_id": {"type": "string", "description": "ID of the webhook to delete"}
            },
            "required": ["webhook_id"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let webhook_id = params["webhook_id"].as_str().ok_or_else(|| {
            PrimitiveError::InvalidParams("missing 'webhook_id' parameter".into())
        })?;

        tracing::info!(agent_id = %self.agent_id, webhook_id, "Deleting inbound webhook");

        // Look up webhook and verify ownership
        let webhook = {
            let db = self
                .db
                .lock()
                .map_err(|e| PrimitiveError::ExecutionFailed(format!("DB lock error: {}", e)))?;

            db.webhooks()
                .find_by_id(webhook_id)
                .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?
                .ok_or_else(|| {
                    PrimitiveError::InvalidParams(format!("Webhook '{}' not found", webhook_id))
                })?
        };

        if webhook.agent_id != self.agent_id {
            return Err(PrimitiveError::AccessDenied(
                "Cannot delete webhooks belonging to another agent".into(),
            ));
        }

        // Clean up vault secret
        let secret_ref_id = webhook.secret_ref_id.clone();
        if let Ok(Some(secret_ref)) = self
            .ctx
            .find_secret_ref(&format!("webhook_secret_{}", webhook_id))
        {
            let _ = self.ctx.delete_secret(&secret_ref.backend_key);
            let _ = self.ctx.delete_secret_ref(&secret_ref_id);
        }

        // Delete the webhook row
        let db = self
            .db
            .lock()
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("DB lock error: {}", e)))?;

        db.webhooks().delete(webhook_id).map_err(|e| {
            PrimitiveError::ExecutionFailed(format!("Failed to delete webhook: {}", e))
        })?;

        Ok(serde_json::json!({
            "status": "deleted",
            "id": webhook_id,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use moxxy_test_utils::TestDb;
    use moxxy_vault::InMemoryBackend;

    fn setup_db() -> (Arc<Mutex<Database>>, PrimitiveContext, String) {
        let test_db = TestDb::new();
        let db = Database::new(test_db.into_conn());
        let now = chrono::Utc::now().to_rfc3339();

        let agent_id = uuid::Uuid::now_v7().to_string();
        db.agents()
            .insert(&moxxy_storage::AgentRow {
                id: agent_id.clone(),
                parent_agent_id: None,
                name: Some("test-agent".into()),
                status: "idle".into(),
                depth: 0,
                spawned_total: 0,
                workspace_root: "/tmp".into(),
                created_at: now.clone(),
                updated_at: now,
            })
            .unwrap();

        let db = Arc::new(Mutex::new(db));
        let backend = Arc::new(InMemoryBackend::new());
        let ctx = PrimitiveContext::new(db.clone(), agent_id.clone(), backend);
        (db, ctx, agent_id)
    }

    #[tokio::test]
    async fn webhook_register_stores_webhook() {
        let (db, ctx, agent_id) = setup_db();
        let prim = WebhookRegisterPrimitive::new(
            db.clone(),
            ctx,
            agent_id.clone(),
            "https://moxxy.example.com".into(),
        );
        let result = prim
            .invoke(serde_json::json!({
                "label": "GitHub Events",
                "secret": "my-hmac-secret",
            }))
            .await
            .unwrap();

        assert_eq!(result["status"], "registered");
        assert_eq!(result["label"], "GitHub Events");
        assert!(result["url"].as_str().unwrap().contains("/v1/hooks/"));
        assert!(result["token"].as_str().is_some());

        // Verify in DB
        let db = db.lock().unwrap();
        let webhooks = db.webhooks().find_by_agent(&agent_id).unwrap();
        assert_eq!(webhooks.len(), 1);
        assert_eq!(webhooks[0].label, "GitHub Events");
    }

    #[tokio::test]
    async fn webhook_register_requires_label() {
        let (db, ctx, agent_id) = setup_db();
        let prim =
            WebhookRegisterPrimitive::new(db, ctx, agent_id, "https://moxxy.example.com".into());
        let result = prim
            .invoke(serde_json::json!({
                "secret": "my-secret",
            }))
            .await;
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::InvalidParams(_)
        ));
    }

    #[tokio::test]
    async fn webhook_register_auto_generates_secret() {
        let (db, ctx, agent_id) = setup_db();
        let prim =
            WebhookRegisterPrimitive::new(db, ctx, agent_id, "https://moxxy.example.com".into());
        let result = prim
            .invoke(serde_json::json!({
                "label": "Auto Secret",
            }))
            .await
            .unwrap();
        // Secret should be auto-generated and returned
        assert!(result["secret"].as_str().is_some());
        assert!(!result["secret"].as_str().unwrap().is_empty());
        assert_eq!(result["status"], "registered");
    }

    #[tokio::test]
    async fn webhook_list_returns_agent_webhooks() {
        let (db, ctx, agent_id) = setup_db();

        // Register two webhooks
        let register = WebhookRegisterPrimitive::new(
            db.clone(),
            ctx.clone(),
            agent_id.clone(),
            "https://moxxy.example.com".into(),
        );
        register
            .invoke(serde_json::json!({
                "label": "Hook A",
                "secret": "secret-a",
            }))
            .await
            .unwrap();
        let register2 = WebhookRegisterPrimitive::new(
            db.clone(),
            ctx,
            agent_id.clone(),
            "https://moxxy.example.com".into(),
        );
        register2
            .invoke(serde_json::json!({
                "label": "Hook B",
                "secret": "secret-b",
            }))
            .await
            .unwrap();

        let list = WebhookListPrimitive::new(db, agent_id, "https://moxxy.example.com".into());
        let result = list.invoke(serde_json::json!({})).await.unwrap();
        let webhooks = result["webhooks"].as_array().unwrap();
        assert_eq!(webhooks.len(), 2);
    }

    #[tokio::test]
    async fn webhook_delete_removes_webhook() {
        let (db, ctx, agent_id) = setup_db();

        // Register a webhook
        let register = WebhookRegisterPrimitive::new(
            db.clone(),
            ctx.clone(),
            agent_id.clone(),
            "https://moxxy.example.com".into(),
        );
        let result = register
            .invoke(serde_json::json!({
                "label": "To Delete",
                "secret": "secret-del",
            }))
            .await
            .unwrap();
        let webhook_id = result["id"].as_str().unwrap().to_string();

        // Delete it
        let delete = WebhookDeletePrimitive::new(db.clone(), ctx, agent_id.clone());
        let del_result = delete
            .invoke(serde_json::json!({"webhook_id": webhook_id}))
            .await
            .unwrap();
        assert_eq!(del_result["status"], "deleted");

        // Verify gone
        let db = db.lock().unwrap();
        let webhooks = db.webhooks().find_by_agent(&agent_id).unwrap();
        assert_eq!(webhooks.len(), 0);
    }

    #[tokio::test]
    async fn webhook_delete_checks_ownership() {
        let (db, ctx, agent_id) = setup_db();

        // Register a webhook
        let register = WebhookRegisterPrimitive::new(
            db.clone(),
            ctx,
            agent_id.clone(),
            "https://moxxy.example.com".into(),
        );
        let result = register
            .invoke(serde_json::json!({
                "label": "Owned",
                "secret": "secret-own",
            }))
            .await
            .unwrap();
        let webhook_id = result["id"].as_str().unwrap().to_string();

        // Try deleting with a different agent
        let other_backend = Arc::new(InMemoryBackend::new());
        let other_ctx = PrimitiveContext::new(db.clone(), "other-agent".into(), other_backend);
        let delete = WebhookDeletePrimitive::new(db, other_ctx, "other-agent".into());
        let del_result = delete
            .invoke(serde_json::json!({"webhook_id": webhook_id}))
            .await;
        assert!(del_result.is_err());
        assert!(matches!(
            del_result.unwrap_err(),
            PrimitiveError::AccessDenied(_)
        ));
    }
}
