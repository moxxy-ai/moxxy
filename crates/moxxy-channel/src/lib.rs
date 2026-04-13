pub mod bridge;
pub mod commands;
pub mod discord;
pub mod pairing;
pub mod telegram;
pub mod transport;
pub mod whatsapp;

pub use bridge::{ChannelBridge, ChannelSender};
pub use commands::{CommandDefinition, CommandHandler, CommandRegistry, build_default_registry};
pub use discord::DiscordTransport;
pub use pairing::PairingService;
pub use telegram::TelegramTransport;
pub use transport::{ChannelTransport, IncomingAudio, IncomingMessage, OutgoingMessage};
pub use whatsapp::WhatsAppTransport;

// Re-export MessageContent from moxxy-types for convenience
pub use moxxy_types::MessageContent;
