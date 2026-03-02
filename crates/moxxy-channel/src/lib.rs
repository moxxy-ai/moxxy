pub mod bridge;
pub mod discord;
pub mod pairing;
pub mod telegram;
pub mod transport;

pub use bridge::{ChannelBridge, ChannelSender};
pub use discord::DiscordTransport;
pub use pairing::PairingService;
pub use telegram::TelegramTransport;
pub use transport::{ChannelTransport, IncomingMessage, OutgoingMessage};

// Re-export MessageContent from moxxy-types for convenience
pub use moxxy_types::MessageContent;
