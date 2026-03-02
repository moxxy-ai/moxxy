use async_trait::async_trait;
use moxxy_core::EventBus;
use moxxy_types::{EventEnvelope, EventType};

use crate::registry::{Primitive, PrimitiveError};

pub struct WebhookNotifyPrimitive {
    allowed_domains: Vec<String>,
    timeout: std::time::Duration,
}

impl WebhookNotifyPrimitive {
    pub fn new(allowed_domains: Vec<String>) -> Self {
        Self {
            allowed_domains,
            timeout: std::time::Duration::from_secs(10),
        }
    }

    pub fn is_domain_allowed(&self, domain: &str) -> bool {
        self.allowed_domains.iter().any(|d| d == domain)
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

    async fn invoke(
        &self,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, PrimitiveError> {
        let url = params["url"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'url' parameter".into()))?;

        let domain = Self::extract_domain(url);

        if !self.is_domain_allowed(domain) {
            return Err(PrimitiveError::AccessDenied(format!(
                "Domain '{}' not in allowlist",
                domain
            )));
        }

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

    async fn invoke(
        &self,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, PrimitiveError> {
        let message = params["message"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'message' parameter".into()))?;

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

    #[tokio::test]
    async fn webhook_domain_check_works() {
        let prim = WebhookNotifyPrimitive::new(vec!["hooks.example.com".into()]);
        assert!(prim.is_domain_allowed("hooks.example.com"));
        assert!(!prim.is_domain_allowed("evil.com"));
    }

    #[tokio::test]
    async fn webhook_blocked_domain_fails() {
        let prim = WebhookNotifyPrimitive::new(vec!["hooks.example.com".into()]);
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
