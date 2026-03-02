use async_trait::async_trait;
use moxxy_types::{ChannelError, MessageContent};
use tokio_util::sync::CancellationToken;

use crate::commands::CommandDefinition;

/// A message received from an external chat platform.
#[derive(Debug, Clone)]
pub struct IncomingMessage {
    pub external_chat_id: String,
    pub sender_id: String,
    pub sender_name: String,
    pub text: String,
    pub timestamp: i64,
}

/// A message to send to an external chat platform.
#[derive(Debug, Clone)]
pub struct OutgoingMessage {
    pub external_chat_id: String,
    pub content: MessageContent,
}

/// Trait abstracting a chat platform transport (Telegram, Discord, etc.).
#[async_trait]
pub trait ChannelTransport: Send + Sync {
    /// Human-readable name for this transport.
    fn transport_name(&self) -> &str;

    /// Start receiving messages. Sends `IncomingMessage` items through the channel.
    /// Runs until the cancellation token is triggered.
    async fn start_receiving(
        &self,
        sender: tokio::sync::mpsc::Sender<IncomingMessage>,
        shutdown: CancellationToken,
    ) -> Result<(), ChannelError>;

    /// Send a message to the platform.
    async fn send_message(&self, msg: OutgoingMessage) -> Result<(), ChannelError>;

    /// Register slash commands with the platform's menu system.
    /// Default: no-op (platforms that don't support menus can skip this).
    async fn register_commands(&self, _commands: &[CommandDefinition]) -> Result<(), ChannelError> {
        Ok(())
    }

    /// Send a typing indicator to the chat. Default: no-op.
    async fn send_typing(&self, _external_chat_id: &str) -> Result<(), ChannelError> {
        Ok(())
    }

    /// Format structured message content for this platform. Default: plain text.
    fn format_content(&self, content: &MessageContent) -> String {
        match content {
            MessageContent::Text(s) => s.clone(),
            MessageContent::ToolInvocation { name, arguments } => match arguments {
                Some(args) => format!("⚙ {name}: {args}"),
                None => format!("⚙ {name}"),
            },
            MessageContent::ToolResult { name, result } => match result {
                Some(r) => format!("✓ {name}: {r}"),
                None => format!("✓ {name}"),
            },
            MessageContent::ToolError { name, error } => format!("✗ {name}: {error}"),
            MessageContent::RunCompleted => "Run completed.".into(),
        }
    }
}
