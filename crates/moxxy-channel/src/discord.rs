use async_trait::async_trait;
use moxxy_types::ChannelError;
use tokio_util::sync::CancellationToken;

use crate::transport::{ChannelTransport, IncomingMessage, OutgoingMessage};

pub struct DiscordTransport;

impl DiscordTransport {
    pub fn new(_bot_token: String) -> Self {
        Self
    }
}

#[async_trait]
impl ChannelTransport for DiscordTransport {
    fn transport_name(&self) -> &str {
        "discord"
    }

    async fn start_receiving(
        &self,
        _sender: tokio::sync::mpsc::Sender<IncomingMessage>,
        _shutdown: CancellationToken,
    ) -> Result<(), ChannelError> {
        Err(ChannelError::TransportError(
            "Discord transport not yet implemented".into(),
        ))
    }

    async fn send_message(&self, _msg: OutgoingMessage) -> Result<(), ChannelError> {
        Err(ChannelError::TransportError(
            "Discord transport not yet implemented".into(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use moxxy_types::MessageContent;

    #[test]
    fn discord_transport_name() {
        let transport = DiscordTransport::new("token".into());
        assert_eq!(transport.transport_name(), "discord");
    }

    #[tokio::test]
    async fn discord_send_returns_not_implemented() {
        let transport = DiscordTransport::new("token".into());
        let msg = OutgoingMessage {
            external_chat_id: "123".into(),
            content: MessageContent::Text("hello".into()),
        };
        let result = transport.send_message(msg).await;
        assert!(result.is_err());
    }
}
