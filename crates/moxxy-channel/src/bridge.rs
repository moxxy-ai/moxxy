use crate::commands::{self, CommandContext, CommandRegistry};
use crate::pairing::PairingService;
use crate::transport::{ChannelTransport, IncomingMessage, OutgoingMessage};
use moxxy_core::{ChannelStore, EventBus};
use moxxy_storage::Database;
use moxxy_types::{ChannelError, EventType, MessageContent, RunStarter};
use moxxy_vault::SecretBackend;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Instant;
use tokio::sync::Mutex as TokioMutex;
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

/// Status of a tool in the progress message.
#[derive(Debug, Clone)]
enum ToolStatus {
    Running,
    Completed,
    Failed,
}

/// Tracks a sub-agent within a run's progress.
#[derive(Debug, Clone)]
struct SubAgentProgress {
    name: String,
    task: Option<String>,
    status: Option<String>, // None = running, Some("completed"), Some("failed: ...")
}

/// Tracks a single progress message for one chat.
/// The message is sent lazily on the first tool invocation (message_id starts as None).
#[derive(Debug)]
struct RunProgress {
    message_id: Option<String>,
    external_chat_id: String,
    tools: Vec<(String, ToolStatus)>,
    sub_agents: Vec<SubAgentProgress>,
    last_edit: Instant,
    dirty: bool,
    finished: bool,
}

impl RunProgress {
    fn render(&self) -> String {
        if self.finished {
            return String::new(); // rendered externally
        }
        let mut lines = Vec::new();
        // Table: one row per tool execution
        if !self.tools.is_empty() {
            for (i, (name, status)) in self.tools.iter().enumerate() {
                let num = i + 1;
                let icon = match status {
                    ToolStatus::Completed => "✅",
                    ToolStatus::Running => "⏳",
                    ToolStatus::Failed => "❌",
                };
                lines.push(format!("{num} {icon} {name}"));
            }
        }
        if !self.sub_agents.is_empty() {
            if !lines.is_empty() {
                lines.push(String::new());
            }
            for sa in &self.sub_agents {
                match &sa.status {
                    None => {
                        lines.push(format!("🤖 {} spawned", sa.name));
                        if let Some(task) = &sa.task {
                            lines.push(format!("   └ {task}"));
                        }
                    }
                    Some(s) if s == "completed" => {
                        lines.push(format!("✅ {} completed", sa.name));
                    }
                    Some(s) => {
                        lines.push(format!("❌ {} {s}", sa.name));
                    }
                }
            }
        }
        lines.join("\n")
    }
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
    progress: TokioMutex<HashMap<(String, String), HashMap<String, RunProgress>>>,
    moxxy_home: std::path::PathBuf,
}

impl ChannelBridge {
    pub fn new(
        db: Arc<Mutex<Database>>,
        event_bus: EventBus,
        run_starter: Arc<dyn RunStarter>,
        vault_backend: Arc<dyn SecretBackend + Send + Sync>,
        moxxy_home: std::path::PathBuf,
    ) -> Self {
        let pairing_service = Arc::new(PairingService::new(&moxxy_home));
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
            progress: TokioMutex::new(HashMap::new()),
            moxxy_home,
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

        // Look up binding from YAML file
        let bindings = ChannelStore::find_bindings_by_channel(&self.moxxy_home, channel_id);

        let binding = match bindings.into_iter().next() {
            Some(b) => b,
            None => {
                tracing::warn!(
                    channel_id,
                    external_chat_id = %msg.external_chat_id,
                    "No active binding found for channel = sending 'not paired' response"
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
            }
        };

        let (external_chat_id, entry) = binding;
        let agent_name = &entry.agent_name;

        // Emit channel.message_received event
        let envelope = moxxy_types::EventEnvelope::new(
            agent_name.clone(),
            None,
            None,
            0,
            EventType::ChannelMessageReceived,
            serde_json::json!({
                "channel_id": channel_id,
                "channel_type": transport.transport_name(),
                "external_chat_id": external_chat_id,
                "sender_name": msg.sender_name,
                "task": msg.text,
            }),
        );
        self.event_bus.emit(envelope);

        // Show typing indicator immediately
        let _ = transport.send_typing(&msg.external_chat_id).await;

        // Trigger a run via RunStarter
        match self.run_starter.start_run(agent_name, &msg.text).await {
            Ok(_run_id) => {}
            Err(e) => {
                tracing::error!("Failed to start run for agent {}: {}", agent_name, e);
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
                // Resolve binding from YAML
                let bindings = ChannelStore::find_bindings_by_channel(&self.moxxy_home, channel_id);
                let agent_name = bindings
                    .into_iter()
                    .next()
                    .map(|(_, entry)| entry.agent_name);

                // Enforce binding requirement
                if handler.requires_binding() && agent_name.is_none() {
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
                    agent_id: agent_name,
                    channel_id,
                    external_chat_id: &msg.external_chat_id,
                    moxxy_home: &self.moxxy_home,
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
    async fn send_typing_to_agent_channels(&self, agent_name: &str) {
        let to_send = self.resolve_agent_transports(agent_name);
        for (transport, chat_id) in to_send {
            let _ = transport.send_typing(&chat_id).await;
        }
    }

    /// Resolve transports and chat IDs for an agent's active bindings.
    fn resolve_agent_transports(
        &self,
        agent_name: &str,
    ) -> Vec<(Arc<dyn ChannelTransport>, String)> {
        let bindings = ChannelStore::find_bindings_by_agent(&self.moxxy_home, agent_name);
        if bindings.is_empty() {
            tracing::debug!(agent_name, "No active bindings found on disk for agent");
            return vec![];
        }
        let Ok(transports) = self.transports.read() else {
            tracing::error!(agent_name, "Failed to acquire transports read lock");
            return vec![];
        };
        let result: Vec<_> = bindings
            .iter()
            .filter_map(
                |(channel_id, chat_id, _)| match transports.get(channel_id) {
                    Some(t) => Some((t.clone(), chat_id.clone())),
                    None => {
                        tracing::warn!(
                            agent_name,
                            channel_id,
                            "Binding exists but no transport registered for channel"
                        );
                        None
                    }
                },
            )
            .collect();
        result
    }

    /// Resolve bindings and transports for an agent (includes channel_id).
    fn resolve_agent_channels(
        &self,
        agent_name: &str,
    ) -> Vec<(Arc<dyn ChannelTransport>, String, String)> {
        let bindings = ChannelStore::find_bindings_by_agent(&self.moxxy_home, agent_name);
        let Ok(transports) = self.transports.read() else {
            return vec![];
        };
        bindings
            .iter()
            .filter_map(|(channel_id, chat_id, _)| {
                transports
                    .get(channel_id)
                    .map(|t| (t.clone(), chat_id.clone(), channel_id.clone()))
            })
            .collect()
    }

    /// Edit all progress messages for a (agent_id, run_id) key, respecting debounce.
    /// On the first call with content, sends the initial message (lazy creation).
    async fn flush_progress(&self, agent_id: &str, run_id: &str) {
        let channels = self.resolve_agent_channels(agent_id);
        let mut progress = self.progress.lock().await;
        let key = (agent_id.to_string(), run_id.to_string());
        let Some(chat_map) = progress.get_mut(&key) else {
            return;
        };

        for (transport, _chat_id, channel_id) in &channels {
            if let Some(rp) = chat_map.get_mut(channel_id) {
                if !rp.dirty || rp.finished {
                    continue;
                }
                let text = rp.render();
                if text.is_empty() {
                    continue;
                }
                // Lazy: send the initial progress message on first flush
                if rp.message_id.is_none() {
                    let msg = OutgoingMessage {
                        external_chat_id: rp.external_chat_id.clone(),
                        content: MessageContent::Text(text),
                    };
                    if let Ok(Some(msg_id)) = transport.send_message_returning_id(msg).await {
                        rp.message_id = Some(msg_id);
                    }
                    rp.last_edit = Instant::now();
                    rp.dirty = false;
                    continue;
                }
                let now = Instant::now();
                let elapsed = now.duration_since(rp.last_edit);
                if elapsed < std::time::Duration::from_secs(1) {
                    // Will be flushed on next event or at run completion
                    continue;
                }
                let _ = transport
                    .edit_message(&rp.external_chat_id, rp.message_id.as_ref().unwrap(), &text)
                    .await;
                rp.last_edit = now;
                rp.dirty = false;
            }
        }
    }

    async fn handle_bridge_event(self: &Arc<Self>, envelope: &moxxy_types::EventEnvelope) {
        let agent_id = &envelope.agent_id;
        let run_id = match &envelope.run_id {
            Some(r) => r.clone(),
            None => return,
        };

        match envelope.event_type {
            EventType::RunStarted => {
                let channels = self.resolve_agent_channels(agent_id);
                if channels.is_empty() {
                    return;
                }

                // Send typing indicator only (progress message sent lazily on first tool)
                let mut chat_map = HashMap::new();
                for (transport, chat_id, channel_id) in &channels {
                    let _ = transport.send_typing(chat_id).await;
                    chat_map.insert(
                        channel_id.clone(),
                        RunProgress {
                            message_id: None,
                            external_chat_id: chat_id.clone(),
                            tools: Vec::new(),
                            sub_agents: Vec::new(),
                            last_edit: Instant::now(),
                            dirty: false,
                            finished: false,
                        },
                    );
                }
                if !chat_map.is_empty() {
                    let mut progress = self.progress.lock().await;
                    progress.insert((agent_id.to_string(), run_id), chat_map);
                }
            }

            EventType::PrimitiveInvoked => {
                let name = envelope
                    .payload
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                {
                    let mut progress = self.progress.lock().await;
                    let key = (agent_id.to_string(), run_id.clone());
                    if let Some(chat_map) = progress.get_mut(&key) {
                        for rp in chat_map.values_mut() {
                            rp.tools.push((name.clone(), ToolStatus::Running));
                            rp.dirty = true;
                        }
                    }
                }
                self.flush_progress(agent_id, &run_id).await;
            }

            EventType::PrimitiveCompleted => {
                let name = envelope
                    .payload
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                {
                    let mut progress = self.progress.lock().await;
                    let key = (agent_id.to_string(), run_id.clone());
                    if let Some(chat_map) = progress.get_mut(&key) {
                        for rp in chat_map.values_mut() {
                            if let Some(tool) = rp.tools.iter_mut().rev().find(|(n, _)| *n == name)
                            {
                                tool.1 = ToolStatus::Completed;
                            }
                            rp.dirty = true;
                        }
                    }
                }
                self.flush_progress(agent_id, &run_id).await;
            }

            EventType::PrimitiveFailed => {
                let name = envelope
                    .payload
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                {
                    let mut progress = self.progress.lock().await;
                    let key = (agent_id.to_string(), run_id.clone());
                    if let Some(chat_map) = progress.get_mut(&key) {
                        for rp in chat_map.values_mut() {
                            if let Some(tool) = rp.tools.iter_mut().rev().find(|(n, _)| *n == name)
                            {
                                tool.1 = ToolStatus::Failed;
                            }
                            rp.dirty = true;
                        }
                    }
                }
                self.flush_progress(agent_id, &run_id).await;
            }

            EventType::SubagentSpawned => {
                let name = envelope
                    .payload
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                let task = envelope
                    .payload
                    .get("task")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                {
                    let mut progress = self.progress.lock().await;
                    let key = (agent_id.to_string(), run_id.clone());
                    if let Some(chat_map) = progress.get_mut(&key) {
                        for rp in chat_map.values_mut() {
                            rp.sub_agents.push(SubAgentProgress {
                                name: name.clone(),
                                task: task.clone(),
                                status: None,
                            });
                            rp.dirty = true;
                        }
                    }
                }
                self.flush_progress(agent_id, &run_id).await;
            }

            EventType::SubagentCompleted => {
                let name = envelope
                    .payload
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                {
                    let mut progress = self.progress.lock().await;
                    let key = (agent_id.to_string(), run_id.clone());
                    if let Some(chat_map) = progress.get_mut(&key) {
                        for rp in chat_map.values_mut() {
                            if let Some(sa) =
                                rp.sub_agents.iter_mut().rev().find(|s| s.name == name)
                            {
                                sa.status = Some("completed".to_string());
                            }
                            rp.dirty = true;
                        }
                    }
                }
                self.flush_progress(agent_id, &run_id).await;
            }

            EventType::SubagentFailed => {
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
                {
                    let mut progress = self.progress.lock().await;
                    let key = (agent_id.to_string(), run_id.clone());
                    if let Some(chat_map) = progress.get_mut(&key) {
                        for rp in chat_map.values_mut() {
                            if let Some(sa) =
                                rp.sub_agents.iter_mut().rev().find(|s| s.name == name)
                            {
                                sa.status = Some(format!("failed: {error}"));
                            }
                            rp.dirty = true;
                        }
                    }
                }
                self.flush_progress(agent_id, &run_id).await;
            }

            EventType::MessageFinal => {
                // Send the actual answer as a NEW separate message
                let text = envelope
                    .payload
                    .get("content")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if text.is_empty() {
                    tracing::warn!(
                        agent_id,
                        run_id,
                        "MessageFinal had empty content, skipping channel send"
                    );
                    return;
                }
                match self
                    .send_to_agent_channels(agent_id, MessageContent::Text(text))
                    .await
                {
                    Ok(0) => {
                        tracing::warn!(
                            agent_id,
                            run_id,
                            "MessageFinal: no channels were notified (no bindings or transports found)"
                        );
                    }
                    Ok(n) => {
                        tracing::info!(agent_id, run_id, channels = n, "MessageFinal delivered");
                    }
                    Err(e) => {
                        tracing::error!(agent_id, run_id, error = %e, "MessageFinal: failed to send to channels");
                    }
                }
            }

            EventType::RunCompleted => {
                let channels = self.resolve_agent_channels(agent_id);
                let mut progress = self.progress.lock().await;
                let key = (agent_id.to_string(), run_id.clone());
                if let Some(chat_map) = progress.remove(&key) {
                    for (transport, _chat_id, channel_id) in &channels {
                        if let Some(rp) = chat_map.get(channel_id)
                            && let Some(msg_id) = &rp.message_id
                        {
                            let _ = transport
                                .edit_message(&rp.external_chat_id, msg_id, "✅ Completed")
                                .await;
                        }
                    }
                }
            }

            EventType::RunFailed => {
                let error = envelope
                    .payload
                    .get("error")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown error")
                    .to_string();
                let channels = self.resolve_agent_channels(agent_id);
                let mut progress = self.progress.lock().await;
                let key = (agent_id.to_string(), run_id.clone());
                if let Some(chat_map) = progress.remove(&key) {
                    for (transport, _chat_id, channel_id) in &channels {
                        if let Some(rp) = chat_map.get(channel_id)
                            && let Some(msg_id) = &rp.message_id
                        {
                            let _ = transport
                                .edit_message(
                                    &rp.external_chat_id,
                                    msg_id,
                                    &format!("❌ Failed: {error}"),
                                )
                                .await;
                        }
                    }
                }
            }

            _ => {
                // Typing indicators for other events
                if Self::should_send_typing(&envelope.event_type) {
                    self.send_typing_to_agent_channels(agent_id).await;
                }
            }
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
                                bridge.handle_bridge_event(&envelope).await;
                            }
                            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                        }
                    }
                }
            }
        });
    }

    /// Consume a pairing code and create a binding on disk.
    /// Delegates to the internal PairingService which maps the code to the real external_chat_id.
    pub fn consume_pairing_code(
        &self,
        code: &str,
        agent_name: &str,
    ) -> Result<crate::pairing::ConsumedBinding, ChannelError> {
        self.pairing_service.consume_code(code, agent_name)
    }

    pub fn shutdown(&self) {
        self.shutdown.cancel();
    }
}

#[async_trait::async_trait]
impl ChannelSender for ChannelBridge {
    async fn send_to_agent_channels(
        &self,
        agent_name: &str,
        content: MessageContent,
    ) -> Result<u32, ChannelError> {
        let to_send = self.resolve_agent_transports(agent_name);
        if to_send.is_empty() {
            tracing::warn!(
                agent_name,
                "No channel transports resolved for agent (no bindings or no matching transports)"
            );
            return Ok(0);
        }
        let mut sent = 0u32;
        for (transport, chat_id) in to_send {
            tracing::info!(
                agent_name,
                external_chat_id = %chat_id,
                transport = transport.transport_name(),
                "Outbound channel message"
            );
            let msg = OutgoingMessage {
                external_chat_id: chat_id.clone(),
                content: content.clone(),
            };
            match transport.send_message(msg).await {
                Ok(()) => {
                    sent += 1;
                }
                Err(e) => {
                    tracing::error!(
                        agent_name,
                        external_chat_id = %chat_id,
                        transport = transport.transport_name(),
                        error = %e,
                        "Failed to send message via channel transport"
                    );
                }
            }
        }
        Ok(sent)
    }

    async fn send_to_channel(
        &self,
        channel_id: &str,
        content: MessageContent,
    ) -> Result<(), ChannelError> {
        let bindings = ChannelStore::find_bindings_by_channel(&self.moxxy_home, channel_id);
        let (chat_id, _) = bindings
            .into_iter()
            .next()
            .ok_or(ChannelError::BindingNotFound)?;

        let transport = {
            let transports = self
                .transports
                .read()
                .map_err(|e| ChannelError::StorageError(e.to_string()))?;
            transports
                .get(channel_id)
                .ok_or(ChannelError::NotFound)?
                .clone()
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
        async fn spawn_child(
            &self,
            _: &str,
            _: &str,
            _: moxxy_types::SpawnOpts,
        ) -> Result<moxxy_types::SpawnResult, String> {
            unimplemented!()
        }
        fn list_children(&self, _: &str) -> Result<Vec<moxxy_types::ChildInfo>, String> {
            Ok(vec![])
        }
        fn dismiss_child(&self, _: &str, _: &str) -> Result<(), String> {
            Ok(())
        }
    }

    fn setup_db() -> Arc<Mutex<Database>> {
        let conn = rusqlite::Connection::open_in_memory().expect("Failed to open in-memory db");
        conn.execute_batch(include_str!("../../../migrations/0001_init.sql"))
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
        let bridge =
            ChannelBridge::new(db, event_bus, run_starter, vault, "/tmp/moxxy-test".into());
        assert!(bridge.transports.read().unwrap().is_empty());
    }

    #[test]
    fn bridge_registers_transport() {
        let db = setup_db();
        let event_bus = EventBus::new(64);
        let run_starter = Arc::new(MockRunStarter);
        let vault: Arc<dyn SecretBackend + Send + Sync> =
            Arc::new(moxxy_vault::InMemoryBackend::new());
        let mut bridge =
            ChannelBridge::new(db, event_bus, run_starter, vault, "/tmp/moxxy-test".into());
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
        let bridge =
            ChannelBridge::new(db, event_bus, run_starter, vault, "/tmp/moxxy-test".into());
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
