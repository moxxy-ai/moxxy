use async_trait::async_trait;
use moxxy_types::{ChannelError, MediaKind, MessageContent};
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
    /// Optional audio payload. When present, the bridge transcribes it via
    /// the configured `SttProvider` and replaces `text` with the transcript
    /// before routing the message to the agent.
    pub audio: Option<IncomingAudio>,
    /// Raw non-audio media payloads downloaded by the transport. The bridge
    /// stores these in MediaStore and passes only stable refs to runtime.
    pub attachments: Vec<IncomingAttachment>,
}

/// Raw audio attached to an incoming message.
#[derive(Debug, Clone)]
pub struct IncomingAudio {
    pub data: Vec<u8>,
    pub mime: String,
    pub filename: String,
    pub duration_secs: Option<u32>,
}

/// Raw media attached to an incoming message.
#[derive(Debug, Clone)]
pub struct IncomingAttachment {
    pub kind: MediaKind,
    pub data: Vec<u8>,
    pub mime: String,
    pub filename: String,
    pub source: serde_json::Value,
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
            MessageContent::RunStarted => "🔄 Working...".into(),
            MessageContent::RunFailed { error } => format!("❌ Run failed: {error}"),
            MessageContent::SubagentSpawned { name, task } => match task {
                Some(t) => format!("🤖 {name} spawned\n   └ {t}"),
                None => format!("🤖 {name} spawned"),
            },
            MessageContent::SubagentCompleted { name } => format!("✅ {name} completed"),
            MessageContent::SubagentFailed { name, error } => format!("❌ {name} failed: {error}"),
        }
    }

    /// Send a message and return the platform's message ID (if supported).
    /// Default: delegates to send_message() and returns None.
    async fn send_message_returning_id(
        &self,
        msg: OutgoingMessage,
    ) -> Result<Option<String>, ChannelError> {
        self.send_message(msg).await?;
        Ok(None)
    }

    /// Edit an existing message by its platform message ID.
    /// Default: no-op (platforms that don't support editing can skip this).
    async fn edit_message(
        &self,
        _external_chat_id: &str,
        _message_id: &str,
        _text: &str,
    ) -> Result<(), ChannelError> {
        Ok(())
    }

    /// Get a sender for pushing webhook-delivered messages into this transport.
    /// Only applicable to webhook-based transports (e.g. WhatsApp). Default: None.
    fn webhook_sender(&self) -> Option<tokio::sync::mpsc::Sender<IncomingMessage>> {
        None
    }
}
