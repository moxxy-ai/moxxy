use async_trait::async_trait;
use moxxy_core::EventBus;
use moxxy_types::{EventEnvelope, EventType};

use crate::registry::{Primitive, PrimitiveError};

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
