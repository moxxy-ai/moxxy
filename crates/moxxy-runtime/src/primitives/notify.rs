use async_trait::async_trait;
use moxxy_core::EventBus;
use moxxy_storage::Database;
use moxxy_types::{EventEnvelope, EventType};
use std::sync::{Arc, Mutex};

use crate::registry::{Primitive, PrimitiveError};

pub struct WebhookNotifyPrimitive {
    db: Arc<Mutex<Database>>,
    agent_id: String,
    timeout: std::time::Duration,
}

impl WebhookNotifyPrimitive {
    pub fn new(db: Arc<Mutex<Database>>, agent_id: String) -> Self {
        Self {
            db,
            agent_id,
            timeout: std::time::Duration::from_secs(10),
        }
    }

    fn is_domain_allowed(&self, domain: &str) -> Result<bool, PrimitiveError> {
        let db = self
            .db
            .lock()
            .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;
        let db_entries = db
            .allowlists()
            .list_entries(&self.agent_id, "http_domain")
            .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;
        let allowed = crate::defaults::merge_with_defaults(db_entries, "http_domain");
        Ok(allowed.iter().any(|d| d == domain))
    }

    fn extract_domain(url: &str) -> &str {
        let without_scheme = url
            .strip_prefix("https://")
            .or_else(|| url.strip_prefix("http://"))
            .unwrap_or(url);
        without_scheme
            .split('/')
            .next()
            .unwrap_or("")
            .split(':')
            .next()
            .unwrap_or("")
    }
}

#[async_trait]
impl Primitive for WebhookNotifyPrimitive {
    fn name(&self) -> &str {
        "notify.webhook"
    }

    fn description(&self) -> &str {
        "Send a notification via webhook POST to an allowed domain."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "Webhook URL to POST to"},
                "payload": {"type": "object", "description": "JSON payload to send"}
            },
            "required": ["url"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let url = params["url"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'url' parameter".into()))?;

        let domain = Self::extract_domain(url);

        if !self.is_domain_allowed(domain)? {
            tracing::warn!(
                url,
                domain,
                "Webhook notify blocked — domain not in allowlist"
            );
            return Err(PrimitiveError::AccessDenied(format!(
                "Domain '{}' not in allowlist",
                domain
            )));
        }

        tracing::info!(url, domain, "Sending webhook notification");

        let payload = params.get("payload").unwrap_or(&params);

        let client = reqwest::Client::builder()
            .timeout(self.timeout)
            .build()
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("HTTP client error: {}", e)))?;

        let resp = client
            .post(url)
            .header("content-type", "application/json")
            .json(payload)
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    PrimitiveError::Timeout
                } else {
                    PrimitiveError::ExecutionFailed(format!("Webhook delivery failed: {}", e))
                }
            })?;

        let status = resp.status().as_u16();

        Ok(serde_json::json!({
            "delivered": true,
            "status": status,
            "url": url,
        }))
    }
}

pub struct CliNotifyPrimitive {
    event_bus: EventBus,
}

impl CliNotifyPrimitive {
    pub fn new(event_bus: EventBus) -> Self {
        Self { event_bus }
    }
}

#[async_trait]
impl Primitive for CliNotifyPrimitive {
    fn name(&self) -> &str {
        "notify.cli"
    }

    fn description(&self) -> &str {
        "Send a notification message to the CLI user via the event bus."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "message": {"type": "string", "description": "Notification message to display"}
            },
            "required": ["message"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let message = params["message"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'message' parameter".into()))?;

        tracing::debug!(message_len = message.len(), "Sending CLI notification");

        let envelope = EventEnvelope::new(
            "system".into(),
            None,
            None,
            0,
            EventType::HeartbeatTriggered,
            serde_json::json!({ "message": message }),
        );

        self.event_bus.emit(envelope);

        Ok(serde_json::json!({ "delivered": true }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use moxxy_storage::{AllowlistRow, Database};
    use moxxy_test_utils::TestDb;

    fn setup_webhook_db(domains: &[&str]) -> (Arc<Mutex<Database>>, String) {
        let test_db = TestDb::new();
        let db = Database::new(test_db.into_conn());
        db.providers()
            .insert(&moxxy_storage::ProviderRow {
                id: "test-provider".into(),
                display_name: "Test".into(),
                manifest_path: "/tmp".into(),
                signature: None,
                enabled: true,
                created_at: chrono::Utc::now().to_rfc3339(),
            })
            .unwrap();
        let agent_id = uuid::Uuid::now_v7().to_string();
        db.agents()
            .insert(&moxxy_storage::AgentRow {
                id: agent_id.clone(),
                parent_agent_id: None,
                provider_id: "test-provider".into(),
                model_id: "test-model".into(),
                workspace_root: "/tmp".into(),
                core_mount: None,
                policy_profile: None,
                temperature: 0.7,
                max_subagent_depth: 2,
                max_subagents_total: 8,
                status: "idle".into(),
                depth: 0,
                spawned_total: 0,
                created_at: chrono::Utc::now().to_rfc3339(),
                updated_at: chrono::Utc::now().to_rfc3339(),
                name: Some("test-agent".into()),
                persona: None,
            })
            .unwrap();
        for domain in domains {
            db.allowlists()
                .insert(&AllowlistRow {
                    id: uuid::Uuid::now_v7().to_string(),
                    agent_id: agent_id.clone(),
                    list_type: "http_domain".into(),
                    entry: domain.to_string(),
                    created_at: chrono::Utc::now().to_rfc3339(),
                })
                .unwrap();
        }
        (Arc::new(Mutex::new(db)), agent_id)
    }

    #[tokio::test]
    async fn webhook_domain_check_works() {
        let (db, agent_id) = setup_webhook_db(&["hooks.example.com"]);
        let prim = WebhookNotifyPrimitive::new(db, agent_id);
        assert!(prim.is_domain_allowed("hooks.example.com").unwrap());
        assert!(!prim.is_domain_allowed("evil.com").unwrap());
    }

    #[tokio::test]
    async fn webhook_blocked_domain_fails() {
        let (db, agent_id) = setup_webhook_db(&["hooks.example.com"]);
        let prim = WebhookNotifyPrimitive::new(db, agent_id);
        let result = prim
            .invoke(serde_json::json!({"url": "https://evil.com/hook", "payload": {}}))
            .await;
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::AccessDenied(_)
        ));
    }

    #[tokio::test]
    async fn cli_notify_emits_event() {
        let bus = EventBus::new(100);
        let mut rx = bus.subscribe();
        let prim = CliNotifyPrimitive::new(bus);
        prim.invoke(serde_json::json!({"message": "Hello CLI"}))
            .await
            .unwrap();
        let event = rx.try_recv().unwrap();
        assert_eq!(event.event_type, EventType::HeartbeatTriggered);
    }
}
