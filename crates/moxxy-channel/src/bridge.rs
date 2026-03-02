use crate::commands::{self, CommandContext, CommandRegistry};
use crate::pairing::PairingService;
use crate::transport::{ChannelTransport, IncomingMessage, OutgoingMessage};
use moxxy_core::EventBus;
use moxxy_storage::Database;
use moxxy_types::{ChannelError, EventType, MessageContent, RunStarter};
use moxxy_vault::SecretBackend;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};
use tokio_util::sync::CancellationToken;

/// Trait for sending messages through channels. Used by ChannelNotifyPrimitive.
#[async_trait::async_trait]
pub trait ChannelSender: Send + Sync {
    /// Send structured content to all active channel bindings for an agent.
    /// Returns the number of channels notified.
    async fn send_to_agent_channels(
        &self,
        agent_id: &str,
        content: MessageContent,
    ) -> Result<u32, ChannelError>;
    /// Send structured content to a specific channel's bound chat.
    async fn send_to_channel(
        &self,
        channel_id: &str,
        content: MessageContent,
    ) -> Result<(), ChannelError>;
}

pub struct ChannelBridge {
    db: Arc<Mutex<Database>>,
    event_bus: EventBus,
    pairing_service: Arc<PairingService>,
    vault_backend: Arc<dyn SecretBackend + Send + Sync>,
    commands: CommandRegistry,
    transports: RwLock<HashMap<String, Arc<dyn ChannelTransport>>>,
    shutdown: CancellationToken,
    run_starter: Arc<dyn RunStarter>,
}

impl ChannelBridge {
    pub fn new(
        db: Arc<Mutex<Database>>,
        event_bus: EventBus,
        run_starter: Arc<dyn RunStarter>,
        vault_backend: Arc<dyn SecretBackend + Send + Sync>,
    ) -> Self {
        let pairing_service = Arc::new(PairingService::new(db.clone()));
        let commands = commands::build_default_registry();
        Self {
            db,
            event_bus,
            pairing_service,
            vault_backend,
            commands,
            transports: RwLock::new(HashMap::new()),
            shutdown: CancellationToken::new(),
            run_starter,
        }
    }

    /// Return all command definitions (for platform menu registration).
    pub fn command_definitions(&self) -> Vec<commands::CommandDefinition> {
        self.commands.all_definitions()
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

        // Fire-and-forget: register commands with the platform
        let defs = self.commands.all_definitions();
        let transport_for_reg = transport.clone();
        tokio::spawn(async move {
            if let Err(e) = transport_for_reg.register_commands(&defs).await {
                tracing::warn!("Failed to register commands with transport: {}", e);
            }
        });

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
        tracing::info!(
            channel_id,
            external_chat_id = %msg.external_chat_id,
            sender_id = %msg.sender_id,
            text_len = msg.text.len(),
            "Inbound channel message"
        );

        // Handle platform slash commands
        if msg.text.starts_with('/') {
            self.handle_platform_command(channel_id, transport, &msg)
                .await;
            return;
        }

        // Look up binding (one agent per channel).
        // Lock is scoped so it's dropped before any await.
        let binding_lookup = {
            match self.db.lock() {
                Ok(db) => db.channel_bindings().find_by_channel(channel_id),
                Err(e) => {
                    tracing::error!(channel_id, "Failed to acquire db lock: {}", e);
                    Err(moxxy_types::StorageError::QueryFailed(e.to_string()))
                }
            }
        };

        let binding = match binding_lookup {
            Ok(bindings) => {
                tracing::info!(
                    channel_id,
                    binding_count = bindings.len(),
                    "Channel binding lookup result"
                );
                bindings.into_iter().next()
            }
            Err(e) => {
                tracing::error!(channel_id, "Failed to look up channel binding: {}", e);
                let _ = transport
                    .send_message(OutgoingMessage {
                        external_chat_id: msg.external_chat_id.clone(),
                        content: MessageContent::Text(
                            "Internal error, please try again.".into(),
                        ),
                    })
                    .await;
                return;
            }
        };

        let Some(binding) = binding else {
            tracing::warn!(
                channel_id,
                external_chat_id = %msg.external_chat_id,
                "No active binding found for channel — sending 'not paired' response"
            );
            let _ = transport
                .send_message(OutgoingMessage {
                    external_chat_id: msg.external_chat_id.clone(),
                    content: MessageContent::Text(
                        "This chat is not paired to an agent. Send /start to get a pairing code."
                            .into(),
                    ),
                })
                .await;
            return;
        };

        if binding.status != "active" {
            let _ = transport
                .send_message(OutgoingMessage {
                    external_chat_id: msg.external_chat_id.clone(),
                    content: MessageContent::Text("This binding is not active.".into()),
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
                "channel_type": transport.transport_name(),
                "external_chat_id": msg.external_chat_id,
                "sender_name": msg.sender_name,
                "task": msg.text,
            }),
        );
        self.event_bus.emit(envelope);

        // Show typing indicator immediately
        let _ = transport.send_typing(&msg.external_chat_id).await;

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
                        content: MessageContent::Text(format!("Failed to start agent run: {}", e)),
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
        let full_command = msg.text.split_whitespace().next().unwrap_or("");
        // Strip leading '/' and any @bot_name suffix (e.g. "/start@mybot")
        let command_name = full_command
            .trim_start_matches('/')
            .split('@')
            .next()
            .unwrap_or("");
        let args = msg
            .text
            .strip_prefix(full_command)
            .unwrap_or("")
            .trim_start();

        let response_text = match self.commands.get(command_name) {
            Some(handler) => {
                // Resolve binding — lock is scoped so it's dropped before any await
                let binding_result = {
                    match self.db.lock() {
                        Ok(db) => db
                            .channel_bindings()
                            .find_by_channel(channel_id)
                            .ok()
                            .and_then(|v| v.into_iter().find(|b| b.status == "active")),
                        Err(e) => {
                            tracing::error!(
                                channel_id,
                                "Failed to acquire db lock for command: {}",
                                e
                            );
                            None
                        }
                    }
                };
                let agent_id = binding_result.map(|b| b.agent_id);

                // Enforce binding requirement
                if handler.requires_binding() && agent_id.is_none() {
                    let _ = transport
                        .send_message(OutgoingMessage {
                            external_chat_id: msg.external_chat_id.clone(),
                            content: MessageContent::Text(
                                "This chat is not paired to an agent. Send /start to pair.".into(),
                            ),
                        })
                        .await;
                    return;
                }

                let ctx = CommandContext {
                    db: &self.db,
                    vault_backend: &self.vault_backend,
                    run_starter: &self.run_starter,
                    pairing_service: &self.pairing_service,
                    agent_id,
                    channel_id,
                    external_chat_id: &msg.external_chat_id,
                };

                match handler.execute(&ctx, args).await {
                    Ok(text) => text,
                    Err(e) => format!("Command error: {}", e),
                }
            }
            None => "Unknown command. Type /help to see available commands.".into(),
        };

        let _ = transport
            .send_message(OutgoingMessage {
                external_chat_id: msg.external_chat_id.clone(),
                content: MessageContent::Text(response_text),
            })
            .await;
    }

    /// Returns true if this event type should trigger a typing indicator.
    fn should_send_typing(event_type: &EventType) -> bool {
        matches!(
            event_type,
            EventType::RunStarted | EventType::PrimitiveInvoked
        )
    }

    /// Send typing indicator to all channels bound to an agent.
    async fn send_typing_to_agent_channels(&self, agent_id: &str) {
        let bindings = {
            let Ok(db) = self.db.lock() else { return };
            db.channel_bindings()
                .find_by_agent(agent_id)
                .unwrap_or_default()
        };

        let to_send: Vec<(Arc<dyn ChannelTransport>, String)> = {
            let Ok(transports) = self.transports.read() else {
                return;
            };
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
            let _ = transport.send_typing(&chat_id).await;
        }
    }

    /// Convert an event envelope into structured `MessageContent`, if applicable.
    fn event_to_content(envelope: &moxxy_types::EventEnvelope) -> Option<MessageContent> {
        match envelope.event_type {
            EventType::MessageFinal => {
                let text = envelope
                    .payload
                    .get("content")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if text.is_empty() {
                    None
                } else {
                    Some(MessageContent::Text(text))
                }
            }
            EventType::PrimitiveInvoked => {
                let name = envelope
                    .payload
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                let arguments = envelope
                    .payload
                    .get("arguments")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                Some(MessageContent::ToolInvocation { name, arguments })
            }
            EventType::PrimitiveCompleted => {
                let name = envelope
                    .payload
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                let result = envelope
                    .payload
                    .get("result")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                Some(MessageContent::ToolResult { name, result })
            }
            EventType::PrimitiveFailed => {
                let name = envelope
                    .payload
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                let error = envelope
                    .payload
                    .get("error")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown error")
                    .to_string();
                Some(MessageContent::ToolError { name, error })
            }
            _ => None,
        }
    }

    /// Subscribe to EventBus and forward relevant events to bound platform chats.
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
                                // Send typing indicator for relevant events
                                if Self::should_send_typing(&envelope.event_type) {
                                    bridge
                                        .send_typing_to_agent_channels(&envelope.agent_id)
                                        .await;
                                }

                                let Some(content) = Self::event_to_content(&envelope) else {
                                    continue;
                                };

                                tracing::info!(
                                    agent_id = %envelope.agent_id,
                                    event_type = ?envelope.event_type,
                                    "Bridge event listener forwarding to channels"
                                );

                                match bridge
                                    .send_to_agent_channels(&envelope.agent_id, content)
                                    .await
                                {
                                    Ok(sent) => {
                                        tracing::info!(
                                            agent_id = %envelope.agent_id,
                                            channels_notified = sent,
                                            "Bridge forwarded event to channels"
                                        );
                                    }
                                    Err(e) => {
                                        tracing::error!(
                                            agent_id = %envelope.agent_id,
                                            error = %e,
                                            "Bridge failed to forward event"
                                        );
                                    }
                                }
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
        content: MessageContent,
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
            tracing::info!(
                agent_id,
                external_chat_id = %chat_id,
                "Outbound channel message"
            );
            let msg = OutgoingMessage {
                external_chat_id: chat_id,
                content: content.clone(),
            };
            if transport.send_message(msg).await.is_ok() {
                sent += 1;
            }
        }
        Ok(sent)
    }

    async fn send_to_channel(
        &self,
        channel_id: &str,
        content: MessageContent,
    ) -> Result<(), ChannelError> {
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

        tracing::info!(
            channel_id,
            external_chat_id = %chat_id,
            "Outbound channel message (direct)"
        );
        transport
            .send_message(OutgoingMessage {
                external_chat_id: chat_id,
                content,
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
        let vault: Arc<dyn SecretBackend + Send + Sync> =
            Arc::new(moxxy_vault::InMemoryBackend::new());
        let bridge = ChannelBridge::new(db, event_bus, run_starter, vault);
        assert!(bridge.transports.read().unwrap().is_empty());
    }

    #[test]
    fn bridge_registers_transport() {
        let db = setup_db();
        let event_bus = EventBus::new(64);
        let run_starter = Arc::new(MockRunStarter);
        let vault: Arc<dyn SecretBackend + Send + Sync> =
            Arc::new(moxxy_vault::InMemoryBackend::new());
        let mut bridge = ChannelBridge::new(db, event_bus, run_starter, vault);
        bridge.register_transport_mut(
            "ch1".into(),
            Arc::new(crate::discord::DiscordTransport::new("token".into())),
        );
        assert_eq!(bridge.transports.read().unwrap().len(), 1);
    }

    #[test]
    fn bridge_has_all_command_definitions() {
        let db = setup_db();
        let event_bus = EventBus::new(64);
        let run_starter = Arc::new(MockRunStarter);
        let vault: Arc<dyn SecretBackend + Send + Sync> =
            Arc::new(moxxy_vault::InMemoryBackend::new());
        let bridge = ChannelBridge::new(db, event_bus, run_starter, vault);
        let defs = bridge.command_definitions();
        let commands: Vec<&str> = defs.iter().map(|d| d.command.as_str()).collect();
        assert!(commands.contains(&"start"));
        assert!(commands.contains(&"status"));
        assert!(commands.contains(&"stop"));
        assert!(commands.contains(&"help"));
        assert!(commands.contains(&"model"));
        assert!(commands.contains(&"vault"));
    }
}
