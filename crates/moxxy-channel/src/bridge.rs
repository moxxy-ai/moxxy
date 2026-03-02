use crate::pairing::PairingService;
use crate::transport::{ChannelTransport, IncomingMessage, OutgoingMessage};
use moxxy_core::EventBus;
use moxxy_storage::Database;
use moxxy_types::{ChannelError, EventType};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};
use tokio_util::sync::CancellationToken;

/// Trait for triggering agent runs. Implemented by the gateway's RunService.
#[async_trait::async_trait]
pub trait RunStarter: Send + Sync {
    async fn start_run(&self, agent_id: &str, task: &str) -> Result<String, String>;
    async fn stop_agent(&self, agent_id: &str) -> Result<(), String>;
    fn agent_status(&self, agent_id: &str) -> Result<Option<String>, String>;
}

/// Trait for sending messages through channels. Used by ChannelNotifyPrimitive.
#[async_trait::async_trait]
pub trait ChannelSender: Send + Sync {
    /// Send a message to all active channel bindings for an agent.
    /// Returns the number of channels notified.
    async fn send_to_agent_channels(
        &self,
        agent_id: &str,
        message: &str,
    ) -> Result<u32, ChannelError>;
    /// Send a message to a specific channel's bound chat.
    async fn send_to_channel(&self, channel_id: &str, message: &str) -> Result<(), ChannelError>;
}

pub struct ChannelBridge {
    db: Arc<Mutex<Database>>,
    event_bus: EventBus,
    pairing_service: PairingService,
    transports: RwLock<HashMap<String, Arc<dyn ChannelTransport>>>,
    shutdown: CancellationToken,
    run_starter: Arc<dyn RunStarter>,
}

impl ChannelBridge {
    pub fn new(
        db: Arc<Mutex<Database>>,
        event_bus: EventBus,
        run_starter: Arc<dyn RunStarter>,
    ) -> Self {
        let pairing_service = PairingService::new(db.clone());
        Self {
            db,
            event_bus,
            pairing_service,
            transports: RwLock::new(HashMap::new()),
            shutdown: CancellationToken::new(),
            run_starter,
        }
    }

    /// Register a transport before start(). Not thread-safe for concurrent writes.
    pub fn register_transport_mut(
        &mut self,
        channel_id: String,
        transport: Arc<dyn ChannelTransport>,
    ) {
        self.transports
            .get_mut()
            .unwrap()
            .insert(channel_id, transport);
    }

    /// Add a transport at runtime (after start). Spawns receiving + processing tasks.
    pub fn add_transport(
        self: &Arc<Self>,
        channel_id: String,
        transport: Arc<dyn ChannelTransport>,
    ) {
        {
            let mut transports = self.transports.write().unwrap();
            transports.insert(channel_id.clone(), transport.clone());
        }
        self.spawn_transport_tasks(channel_id, transport);
    }

    fn spawn_transport_tasks(
        self: &Arc<Self>,
        channel_id: String,
        transport: Arc<dyn ChannelTransport>,
    ) {
        let (tx, mut rx) = tokio::sync::mpsc::channel::<IncomingMessage>(256);
        let shutdown = self.shutdown.clone();
        let transport_clone = transport.clone();
        let channel_id_clone = channel_id.clone();

        // Spawn the transport receiver
        tokio::spawn(async move {
            if let Err(e) = transport_clone.start_receiving(tx, shutdown).await {
                tracing::error!(
                    "Transport {} for channel {} error: {}",
                    transport_clone.transport_name(),
                    channel_id_clone,
                    e
                );
            }
        });

        // Spawn the message processor
        let bridge = self.clone();
        let transport_for_processor = transport;
        tokio::spawn(async move {
            while let Some(msg) = rx.recv().await {
                bridge
                    .handle_incoming(&channel_id, &transport_for_processor, msg)
                    .await;
            }
        });
    }

    /// Start the bridge. Spawns tasks for each registered transport.
    pub fn start(self: Arc<Self>) {
        let channel_ids: Vec<(String, Arc<dyn ChannelTransport>)> = {
            let transports = self.transports.read().unwrap();
            transports
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect()
        };

        for (channel_id, transport) in channel_ids {
            self.spawn_transport_tasks(channel_id, transport);
        }

        // Spawn the EventBus listener to forward outgoing messages
        self.spawn_event_listener();
    }

    async fn handle_incoming(
        &self,
        channel_id: &str,
        transport: &Arc<dyn ChannelTransport>,
        msg: IncomingMessage,
    ) {
        // Handle platform slash commands
        if msg.text.starts_with('/') {
            self.handle_platform_command(channel_id, transport, &msg)
                .await;
            return;
        }

        // Look up binding (one agent per channel)
        let binding = {
            let db = match self.db.lock() {
                Ok(db) => db,
                Err(_) => return,
            };
            db.channel_bindings()
                .find_by_channel(channel_id)
                .ok()
                .and_then(|v| v.into_iter().next())
        };

        let Some(binding) = binding else {
            let _ = transport
                .send_message(OutgoingMessage {
                    external_chat_id: msg.external_chat_id.clone(),
                    text: "This chat is not paired to an agent. Send /start to get a pairing code."
                        .into(),
                })
                .await;
            return;
        };

        if binding.status != "active" {
            let _ = transport
                .send_message(OutgoingMessage {
                    external_chat_id: msg.external_chat_id.clone(),
                    text: "This binding is not active.".into(),
                })
                .await;
            return;
        }

        // Emit channel.message_received event
        let envelope = moxxy_types::EventEnvelope::new(
            binding.agent_id.clone(),
            None,
            None,
            0,
            EventType::ChannelMessageReceived,
            serde_json::json!({
                "channel_id": channel_id,
                "external_chat_id": msg.external_chat_id,
                "task": msg.text,
            }),
        );
        self.event_bus.emit(envelope);

        // Trigger a run via RunStarter
        match self
            .run_starter
            .start_run(&binding.agent_id, &msg.text)
            .await
        {
            Ok(_run_id) => {}
            Err(e) => {
                tracing::error!("Failed to start run for agent {}: {}", binding.agent_id, e);
                let _ = transport
                    .send_message(OutgoingMessage {
                        external_chat_id: msg.external_chat_id.clone(),
                        text: format!("Failed to start agent run: {}", e),
                    })
                    .await;
            }
        }
    }

    async fn handle_platform_command(
        &self,
        channel_id: &str,
        transport: &Arc<dyn ChannelTransport>,
        msg: &IncomingMessage,
    ) {
        let command = msg.text.split_whitespace().next().unwrap_or("");
        let response_text = match command {
            "/start" => {
                match self
                    .pairing_service
                    .generate_code(channel_id, &msg.external_chat_id)
                {
                    Ok(code) => format!(
                        "Your pairing code is: {}\n\nEnter this code in the Moxxy CLI within 5 minutes:\n  moxxy channel pair --code {} --agent <agent-id>",
                        code, code
                    ),
                    Err(e) => format!("Failed to generate pairing code: {}", e),
                }
            }
            "/status" => self.get_status_text(channel_id, &msg.external_chat_id),
            "/stop" => self.stop_agent_run(channel_id, &msg.external_chat_id).await,
            "/help" => "Available commands:\n/start - Get a pairing code\n/status - Check agent status\n/stop - Stop current run\n/help - Show this help".into(),
            _ => "Unknown command. Type /help to see available commands.".into(),
        };

        let _ = transport
            .send_message(OutgoingMessage {
                external_chat_id: msg.external_chat_id.clone(),
                text: response_text,
            })
            .await;
    }

    fn get_status_text(&self, channel_id: &str, _external_chat_id: &str) -> String {
        let db = match self.db.lock() {
            Ok(db) => db,
            Err(_) => return "Failed to check status.".into(),
        };

        let binding = db
            .channel_bindings()
            .find_by_channel(channel_id)
            .ok()
            .and_then(|v| v.into_iter().next());

        match binding {
            Some(b) => {
                let status = self
                    .run_starter
                    .agent_status(&b.agent_id)
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| "unknown".into());
                format!(
                    "Agent: {}\nStatus: {}\nBinding: active",
                    &b.agent_id[..8.min(b.agent_id.len())],
                    status
                )
            }
            None => "This chat is not paired to an agent. Send /start to pair.".into(),
        }
    }

    async fn stop_agent_run(&self, channel_id: &str, _external_chat_id: &str) -> String {
        let binding = {
            let db = match self.db.lock() {
                Ok(db) => db,
                Err(_) => return "Failed to stop agent.".into(),
            };
            db.channel_bindings()
                .find_by_channel(channel_id)
                .ok()
                .and_then(|v| v.into_iter().next())
        };

        match binding {
            Some(b) => match self.run_starter.stop_agent(&b.agent_id).await {
                Ok(()) => "Agent stopped.".into(),
                Err(e) => format!("Failed to stop agent: {}", e),
            },
            None => "This chat is not paired to an agent.".into(),
        }
    }

    /// Subscribe to EventBus and forward message.final events to bound platform chats.
    fn spawn_event_listener(self: &Arc<Self>) {
        let mut rx = self.event_bus.subscribe();
        let bridge = self.clone();
        let shutdown = self.shutdown.clone();

        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = shutdown.cancelled() => break,
                    result = rx.recv() => {
                        match result {
                            Ok(envelope) => {
                                if envelope.event_type != EventType::MessageFinal {
                                    continue;
                                }

                                let content = envelope
                                    .payload
                                    .get("content")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string();

                                if content.is_empty() {
                                    continue;
                                }

                                // Use ChannelSender to forward to all agent channels
                                let _ = bridge
                                    .send_to_agent_channels(&envelope.agent_id, &content)
                                    .await;
                            }
                            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                        }
                    }
                }
            }
        });
    }

    pub fn shutdown(&self) {
        self.shutdown.cancel();
    }
}

#[async_trait::async_trait]
impl ChannelSender for ChannelBridge {
    async fn send_to_agent_channels(
        &self,
        agent_id: &str,
        message: &str,
    ) -> Result<u32, ChannelError> {
        let bindings = {
            let db = self
                .db
                .lock()
                .map_err(|e| ChannelError::StorageError(e.to_string()))?;
            db.channel_bindings()
                .find_by_agent(agent_id)
                .map_err(|e| ChannelError::StorageError(e.to_string()))?
        };

        let mut sent = 0u32;
        // Collect transports to send to (clone Arcs to avoid holding RwLock across await)
        let to_send: Vec<(Arc<dyn ChannelTransport>, String)> = {
            let transports = self
                .transports
                .read()
                .map_err(|e| ChannelError::StorageError(e.to_string()))?;
            bindings
                .iter()
                .filter(|b| b.status == "active")
                .filter_map(|b| {
                    transports
                        .get(&b.channel_id)
                        .map(|t| (t.clone(), b.external_chat_id.clone()))
                })
                .collect()
        };
        for (transport, chat_id) in to_send {
            let msg = OutgoingMessage {
                external_chat_id: chat_id,
                text: message.to_string(),
            };
            if transport.send_message(msg).await.is_ok() {
                sent += 1;
            }
        }
        Ok(sent)
    }

    async fn send_to_channel(&self, channel_id: &str, message: &str) -> Result<(), ChannelError> {
        let (transport, chat_id) = {
            let db = self
                .db
                .lock()
                .map_err(|e| ChannelError::StorageError(e.to_string()))?;
            let binding = db
                .channel_bindings()
                .find_by_channel(channel_id)
                .map_err(|e| ChannelError::StorageError(e.to_string()))?
                .into_iter()
                .next()
                .ok_or(ChannelError::BindingNotFound)?;

            let transports = self
                .transports
                .read()
                .map_err(|e| ChannelError::StorageError(e.to_string()))?;
            let transport = transports
                .get(channel_id)
                .ok_or(ChannelError::NotFound)?
                .clone();
            (transport, binding.external_chat_id)
        };

        transport
            .send_message(OutgoingMessage {
                external_chat_id: chat_id,
                text: message.to_string(),
            })
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct MockRunStarter;

    #[async_trait::async_trait]
    impl RunStarter for MockRunStarter {
        async fn start_run(&self, _agent_id: &str, _task: &str) -> Result<String, String> {
            Ok("run-123".into())
        }
        async fn stop_agent(&self, _agent_id: &str) -> Result<(), String> {
            Ok(())
        }
        fn agent_status(&self, _agent_id: &str) -> Result<Option<String>, String> {
            Ok(Some("idle".into()))
        }
    }

    fn setup_db() -> Arc<Mutex<Database>> {
        let conn = rusqlite::Connection::open_in_memory().expect("Failed to open in-memory db");
        conn.execute_batch(include_str!("../../../migrations/0001_init.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../../migrations/0002_channels.sql"))
            .unwrap();
        Arc::new(Mutex::new(Database::new(conn)))
    }

    #[test]
    fn bridge_creates_without_transports() {
        let db = setup_db();
        let event_bus = EventBus::new(64);
        let run_starter = Arc::new(MockRunStarter);
        let bridge = ChannelBridge::new(db, event_bus, run_starter);
        assert!(bridge.transports.read().unwrap().is_empty());
    }

    #[test]
    fn bridge_registers_transport() {
        let db = setup_db();
        let event_bus = EventBus::new(64);
        let run_starter = Arc::new(MockRunStarter);
        let mut bridge = ChannelBridge::new(db, event_bus, run_starter);
        bridge.register_transport_mut(
            "ch1".into(),
            Arc::new(crate::discord::DiscordTransport::new("token".into())),
        );
        assert_eq!(bridge.transports.read().unwrap().len(), 1);
    }
}
