use async_trait::async_trait;
use moxxy_storage::{Database, WebhookRow};
use std::sync::{Arc, Mutex};

use crate::registry::{Primitive, PrimitiveError};

pub struct WebhookCreatePrimitive {
    db: Arc<Mutex<Database>>,
}

impl WebhookCreatePrimitive {
    pub fn new(db: Arc<Mutex<Database>>) -> Self {
        Self { db }
    }
}

#[async_trait]
impl Primitive for WebhookCreatePrimitive {
    fn name(&self) -> &str {
        "webhook.create"
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let agent_id = params["agent_id"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'agent_id' parameter".into()))?;

        let url = params["url"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'url' parameter".into()))?;

        let label = params["label"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'label' parameter".into()))?;

        let event_filter = params["event_filter"].as_str().map(|s| s.to_string());

        let now = chrono::Utc::now().to_rfc3339();
        let id = uuid::Uuid::now_v7().to_string();

        let row = WebhookRow {
            id: id.clone(),
            agent_id: agent_id.to_string(),
            label: label.to_string(),
            url: url.to_string(),
            secret_ref_id: None,
            event_filter,
            enabled: true,
            retry_count: 3,
            timeout_seconds: 10,
            created_at: now.clone(),
            updated_at: now,
        };

        let db = self
            .db
            .lock()
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("DB lock error: {}", e)))?;

        db.webhooks()
            .insert(&row)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("Failed to create webhook: {}", e)))?;

        Ok(serde_json::json!({
            "id": id,
            "agent_id": agent_id,
            "url": url,
            "label": label,
            "enabled": true,
            "status": "created",
        }))
    }
}

pub struct WebhookListPrimitive {
    db: Arc<Mutex<Database>>,
}

impl WebhookListPrimitive {
    pub fn new(db: Arc<Mutex<Database>>) -> Self {
        Self { db }
    }
}

#[async_trait]
impl Primitive for WebhookListPrimitive {
    fn name(&self) -> &str {
        "webhook.list"
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let agent_id = params["agent_id"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'agent_id' parameter".into()))?;

        let db = self
            .db
            .lock()
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("DB lock error: {}", e)))?;

        let webhooks = db
            .webhooks()
            .find_by_agent(agent_id)
            .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;

        let result: Vec<serde_json::Value> = webhooks
            .iter()
            .map(|w| {
                serde_json::json!({
                    "id": w.id,
                    "label": w.label,
                    "url": w.url,
                    "enabled": w.enabled,
                    "event_filter": w.event_filter,
                })
            })
            .collect();

        Ok(serde_json::json!({ "webhooks": result }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use moxxy_test_utils::TestDb;
    use rusqlite::params;

    fn setup_db() -> Arc<Mutex<Database>> {
        let db = TestDb::new();
        // Insert required provider + agent
        db.conn()
            .execute(
                "INSERT INTO providers (id, display_name, manifest_path, enabled, created_at)
                 VALUES ('prov-1', 'P1', '/p1', 1, '2025-01-01')",
                [],
            )
            .unwrap();
        db.conn()
            .execute(
                "INSERT INTO agents (id, provider_id, model_id, workspace_root, status, depth, spawned_total, temperature, max_subagent_depth, max_subagents_total, created_at, updated_at)
                 VALUES ('agent-1', 'prov-1', 'gpt-4', '/tmp', 'idle', 0, 0, 0.7, 2, 8, '2025-01-01', '2025-01-01')",
                [],
            )
            .unwrap();
        // Extract connection from TestDb and wrap in Database
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../../../../migrations/0001_init.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../../../migrations/0002_channels.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../../../migrations/0003_webhooks.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../../../migrations/0004_conversation_log.sql"))
            .unwrap();
        conn.execute(
            "INSERT INTO providers (id, display_name, manifest_path, enabled, created_at)
             VALUES ('prov-1', 'P1', '/p1', 1, '2025-01-01')",
            params![],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO agents (id, provider_id, model_id, workspace_root, status, depth, spawned_total, temperature, max_subagent_depth, max_subagents_total, created_at, updated_at)
             VALUES ('agent-1', 'prov-1', 'gpt-4', '/tmp', 'idle', 0, 0, 0.7, 2, 8, '2025-01-01', '2025-01-01')",
            params![],
        )
        .unwrap();
        Arc::new(Mutex::new(Database::new(conn)))
    }

    #[tokio::test]
    async fn webhook_create_stores_webhook() {
        let db = setup_db();
        let prim = WebhookCreatePrimitive::new(db.clone());
        let result = prim
            .invoke(serde_json::json!({
                "agent_id": "agent-1",
                "url": "https://hooks.example.com/notify",
                "label": "My Webhook",
            }))
            .await
            .unwrap();

        assert_eq!(result["status"], "created");
        assert_eq!(result["label"], "My Webhook");
        assert!(result["id"].as_str().is_some());

        // Verify in DB
        let db = db.lock().unwrap();
        let webhooks = db.webhooks().find_by_agent("agent-1").unwrap();
        assert_eq!(webhooks.len(), 1);
        assert_eq!(webhooks[0].url, "https://hooks.example.com/notify");
    }

    #[tokio::test]
    async fn webhook_create_requires_url() {
        let db = setup_db();
        let prim = WebhookCreatePrimitive::new(db);
        let result = prim
            .invoke(serde_json::json!({
                "agent_id": "agent-1",
                "label": "No URL",
            }))
            .await;
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::InvalidParams(_)
        ));
    }

    #[tokio::test]
    async fn webhook_list_returns_agent_webhooks() {
        let db = setup_db();

        // Create two webhooks
        let create = WebhookCreatePrimitive::new(db.clone());
        create
            .invoke(serde_json::json!({
                "agent_id": "agent-1",
                "url": "https://a.com/hook",
                "label": "Hook A",
            }))
            .await
            .unwrap();
        create
            .invoke(serde_json::json!({
                "agent_id": "agent-1",
                "url": "https://b.com/hook",
                "label": "Hook B",
            }))
            .await
            .unwrap();

        let list = WebhookListPrimitive::new(db);
        let result = list
            .invoke(serde_json::json!({"agent_id": "agent-1"}))
            .await
            .unwrap();
        let webhooks = result["webhooks"].as_array().unwrap();
        assert_eq!(webhooks.len(), 2);
    }
}
