use async_trait::async_trait;
use moxxy_types::MessageContent;
use std::sync::Arc;

use crate::registry::{Primitive, PrimitiveError};

/// Trait for sending messages through channels, injected from moxxy-channel.
/// This avoids a circular dependency between moxxy-runtime and moxxy-channel.
#[async_trait]
pub trait ChannelMessageSender: Send + Sync {
    async fn send_to_agent_channels(
        &self,
        agent_id: &str,
        content: MessageContent,
    ) -> Result<u32, String>;
    async fn send_to_channel(
        &self,
        channel_id: &str,
        content: MessageContent,
    ) -> Result<(), String>;
}

pub struct ChannelNotifyPrimitive {
    agent_id: String,
    sender: Arc<dyn ChannelMessageSender>,
}

impl ChannelNotifyPrimitive {
    pub fn new(agent_id: String, sender: Arc<dyn ChannelMessageSender>) -> Self {
        Self { agent_id, sender }
    }
}

#[async_trait]
impl Primitive for ChannelNotifyPrimitive {
    fn name(&self) -> &str {
        "notify.channel"
    }

    fn description(&self) -> &str {
        "Send a message through bound channels (Telegram, Discord, etc.)."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "message": {"type": "string", "description": "Message to send"},
                "channel_id": {"type": "string", "description": "Specific channel ID (sends to all bound channels if omitted)"}
            },
            "required": ["message"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let message = params["message"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'message' parameter".into()))?;

        let content = MessageContent::Text(message.to_string());
        let channel_id = params.get("channel_id").and_then(|v| v.as_str());

        tracing::info!(
            agent_id = %self.agent_id,
            channel_id = ?channel_id,
            message_len = message.len(),
            "Sending channel notification"
        );

        if let Some(channel_id) = channel_id {
            // Send to specific channel
            self.sender
                .send_to_channel(channel_id, content)
                .await
                .map_err(|e| {
                    PrimitiveError::ExecutionFailed(format!("Channel send failed: {}", e))
                })?;

            Ok(serde_json::json!({
                "delivered": true,
                "channel_id": channel_id,
                "channels_notified": 1,
            }))
        } else {
            // Send to all bound channels for this agent
            let count = self
                .sender
                .send_to_agent_channels(&self.agent_id, content)
                .await
                .map_err(|e| {
                    PrimitiveError::ExecutionFailed(format!("Channel send failed: {}", e))
                })?;

            Ok(serde_json::json!({
                "delivered": count > 0,
                "channels_notified": count,
            }))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    struct MockChannelSender {
        send_count: AtomicU32,
    }

    impl MockChannelSender {
        fn new() -> Self {
            Self {
                send_count: AtomicU32::new(0),
            }
        }
    }

    #[async_trait]
    impl ChannelMessageSender for MockChannelSender {
        async fn send_to_agent_channels(
            &self,
            _agent_id: &str,
            _content: MessageContent,
        ) -> Result<u32, String> {
            let count = self.send_count.fetch_add(1, Ordering::SeqCst) + 1;
            Ok(count)
        }
        async fn send_to_channel(
            &self,
            _channel_id: &str,
            _content: MessageContent,
        ) -> Result<(), String> {
            self.send_count.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    }

    #[tokio::test]
    async fn notify_channel_sends_to_all_agent_channels() {
        let sender = Arc::new(MockChannelSender::new());
        let prim = ChannelNotifyPrimitive::new("agent-1".into(), sender.clone());
        let result = prim
            .invoke(serde_json::json!({"message": "Hello!"}))
            .await
            .unwrap();
        assert_eq!(result["delivered"], true);
        assert_eq!(result["channels_notified"], 1);
    }

    #[tokio::test]
    async fn notify_channel_sends_to_specific_channel() {
        let sender = Arc::new(MockChannelSender::new());
        let prim = ChannelNotifyPrimitive::new("agent-1".into(), sender);
        let result = prim
            .invoke(serde_json::json!({"message": "Hello!", "channel_id": "ch-1"}))
            .await
            .unwrap();
        assert_eq!(result["delivered"], true);
        assert_eq!(result["channel_id"], "ch-1");
    }

    #[tokio::test]
    async fn notify_channel_requires_message() {
        let sender = Arc::new(MockChannelSender::new());
        let prim = ChannelNotifyPrimitive::new("agent-1".into(), sender);
        let result = prim.invoke(serde_json::json!({})).await;
        assert!(result.is_err());
    }
}
