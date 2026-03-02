use async_trait::async_trait;
use moxxy_core::EventBus;
use moxxy_types::{EventEnvelope, EventType};

use crate::registry::{Primitive, PrimitiveError};

pub struct WebhookNotifyPrimitive {
    allowed_domains: Vec<String>,
}

impl WebhookNotifyPrimitive {
    pub fn new(allowed_domains: Vec<String>) -> Self {
        Self { allowed_domains }
    }

    pub fn is_domain_allowed(&self, domain: &str) -> bool {
        self.allowed_domains.iter().any(|d| d == domain)
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

        // Extract domain from URL
        let domain = url
            .strip_prefix("https://")
            .or_else(|| url.strip_prefix("http://"))
            .unwrap_or(url)
            .split('/')
            .next()
            .unwrap_or("")
            .split(':')
            .next()
            .unwrap_or("");

        if !self.is_domain_allowed(domain) {
            return Err(PrimitiveError::AccessDenied(format!(
                "Domain '{}' not in allowlist",
                domain
            )));
        }

        // Stub: actual webhook delivery not implemented
        Ok(serde_json::json!({
            "status": "not_implemented",
            "message": "Webhook delivery not yet wired",
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
    async fn webhook_sends_post_request() {
        let prim = WebhookNotifyPrimitive::new(vec!["hooks.example.com".into()]);
        assert!(prim.is_domain_allowed("hooks.example.com"));
        assert!(!prim.is_domain_allowed("evil.com"));
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
