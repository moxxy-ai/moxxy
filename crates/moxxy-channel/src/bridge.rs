use crate::commands::{self, CommandContext, CommandRegistry};
use crate::pairing::PairingService;
use crate::transport::{ChannelTransport, IncomingMessage, OutgoingMessage};
use moxxy_core::{ChannelStore, EventBus, SttProvider, SttSettings};
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

/// A step within a skill execution.
#[derive(Debug, Clone)]
struct SkillStep {
    name: String,
    status: ToolStatus,
    result: Option<String>,
}

/// Tracks an active skill within a run's progress.
#[derive(Debug, Clone)]
struct SkillProgress {
    name: String,
    steps: Vec<SkillStep>,
    finished: bool,
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
    active_skill: Option<SkillProgress>,
    completed_skills: Vec<SkillProgress>,
    sub_agents: Vec<SubAgentProgress>,
    last_edit: Instant,
    dirty: bool,
    finished: bool,
}

/// Truncate a result string for display.
fn truncate_result(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}…", &s[..max])
    }
}

impl RunProgress {
    fn render(&self) -> String {
        if self.finished {
            return String::new(); // rendered externally
        }
        let mut lines = Vec::new();

        // Render completed skills
        for skill in &self.completed_skills {
            Self::render_skill(&mut lines, skill, false);
        }

        // Render active skill
        if let Some(ref skill) = self.active_skill {
            Self::render_skill(&mut lines, skill, true);
        }

        // Render standalone tools (not part of a skill)
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

    fn render_skill(lines: &mut Vec<String>, skill: &SkillProgress, active: bool) {
        if active {
            lines.push(format!("⊞ Invoking {}...", skill.name));
        } else {
            lines.push(format!("✅ {}", skill.name));
        }
        for step in &skill.steps {
            let icon = match step.status {
                ToolStatus::Running => "⏳",
                ToolStatus::Completed => "◷",
                ToolStatus::Failed => "❌",
            };
            match &step.result {
                Some(r) => lines.push(format!("{icon} {} → {}", step.name, truncate_result(r, 60))),
                None => lines.push(format!("{icon} {}", step.name)),
            }
        }
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
    /// Pending `user.ask` questions awaiting an answer from a channel user.
    /// Keyed by `(agent_name, external_chat_id)` so the next inbound message
    /// from that chat is routed back to the waiting agent instead of starting
    /// a new run.
    pending_asks: TokioMutex<HashMap<(String, String), String>>,
    /// Cancellation tokens for per-run typing indicator loops.
    /// Keyed by `(agent_id, run_id)`. Cancelled on RunCompleted/RunFailed.
    typing_loops: TokioMutex<HashMap<(String, String), CancellationToken>>,
    moxxy_home: std::path::PathBuf,
    /// Optional speech-to-text backend. When `Some`, incoming voice messages
    /// are transcribed to text before being routed to the agent.
    ///
    /// Wrapped in a `RwLock` so the gateway can swap the provider at runtime
    /// when settings change (via `PUT /v1/settings/stt`) without restarting.
    stt: RwLock<Option<Arc<dyn SttProvider>>>,
    stt_settings: RwLock<Option<SttSettings>>,
}

impl ChannelBridge {
    pub fn new(
        db: Arc<Mutex<Database>>,
        event_bus: EventBus,
        run_starter: Arc<dyn RunStarter>,
        vault_backend: Arc<dyn SecretBackend + Send + Sync>,
        moxxy_home: std::path::PathBuf,
    ) -> Self {
        Self::new_with_stt(
            db,
            event_bus,
            run_starter,
            vault_backend,
            moxxy_home,
            None,
            None,
        )
    }

    pub fn new_with_stt(
        db: Arc<Mutex<Database>>,
        event_bus: EventBus,
        run_starter: Arc<dyn RunStarter>,
        vault_backend: Arc<dyn SecretBackend + Send + Sync>,
        moxxy_home: std::path::PathBuf,
        stt: Option<Arc<dyn SttProvider>>,
        stt_settings: Option<SttSettings>,
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
            pending_asks: TokioMutex::new(HashMap::new()),
            typing_loops: TokioMutex::new(HashMap::new()),
            moxxy_home,
            stt: RwLock::new(stt),
            stt_settings: RwLock::new(stt_settings),
        }
    }

    /// Replace the bridge's speech-to-text backend at runtime. Pass `None`
    /// for both arguments to disable voice transcription on every channel
    /// without restarting the gateway.
    pub fn set_stt(&self, stt: Option<Arc<dyn SttProvider>>, settings: Option<SttSettings>) {
        *self.stt.write().unwrap() = stt;
        *self.stt_settings.write().unwrap() = settings;
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

    /// Transcribe `msg.audio` via the configured STT backend and replace
    /// `msg.text` with the transcript. Returns `true` on success, `false` if
    /// the message was handled (error sent to user) and the caller should
    /// return without further routing.
    async fn transcribe_audio_in_place(
        &self,
        channel_id: &str,
        transport: &Arc<dyn ChannelTransport>,
        msg: &mut IncomingMessage,
    ) -> bool {
        let Some(audio) = msg.audio.take() else {
            return true;
        };

        // Snapshot the current STT backend + settings. We clone the `Arc`
        // and `SttSettings` under the read lock so the lock isn't held across
        // the subsequent `.await`s — a settings update that swaps the
        // provider mid-transcription still lets the in-flight call complete.
        let stt_snapshot = self.stt.read().unwrap().clone();
        let settings_snapshot = self.stt_settings.read().unwrap().clone();

        let Some(stt) = stt_snapshot else {
            tracing::warn!(
                channel_id,
                external_chat_id = %msg.external_chat_id,
                "Voice message received but STT is not configured"
            );
            let _ = transport
                .send_message(OutgoingMessage {
                    external_chat_id: msg.external_chat_id.clone(),
                    content: MessageContent::Text(
                        "Voice messages are not configured on this server. Ask the operator to configure STT.".into(),
                    ),
                })
                .await;
            return false;
        };

        if let Some(settings) = settings_snapshot.as_ref() {
            if audio.data.len() > settings.max_bytes {
                let _ = transport
                    .send_message(OutgoingMessage {
                        external_chat_id: msg.external_chat_id.clone(),
                        content: MessageContent::Text(format!(
                            "Voice message too large ({} bytes, max {}).",
                            audio.data.len(),
                            settings.max_bytes
                        )),
                    })
                    .await;
                return false;
            }
            if let Some(dur) = audio.duration_secs
                && dur > settings.max_seconds
            {
                let _ = transport
                    .send_message(OutgoingMessage {
                        external_chat_id: msg.external_chat_id.clone(),
                        content: MessageContent::Text(format!(
                            "Voice message too long ({}s, max {}s).",
                            dur, settings.max_seconds
                        )),
                    })
                    .await;
                return false;
            }
        }

        let _ = transport.send_typing(&msg.external_chat_id).await;

        match stt
            .transcribe(&audio.data, &audio.mime, &audio.filename)
            .await
        {
            Ok(text) if !text.trim().is_empty() => {
                let chars = text.chars().count();
                tracing::info!(
                    channel_id,
                    external_chat_id = %msg.external_chat_id,
                    chars,
                    "Voice message transcribed"
                );
                // Emit an audit event so transcripts are visible in the event log.
                let envelope = moxxy_types::EventEnvelope::new(
                    String::new(),
                    None,
                    None,
                    0,
                    EventType::ChannelVoiceTranscribed,
                    serde_json::json!({
                        "channel_id": channel_id,
                        "channel_type": transport.transport_name(),
                        "external_chat_id": msg.external_chat_id,
                        "duration_secs": audio.duration_secs,
                        "chars": chars,
                        "stt_provider": stt.name(),
                    }),
                );
                self.event_bus.emit(envelope);
                msg.text = text;
                true
            }
            Ok(_) => {
                let _ = transport
                    .send_message(OutgoingMessage {
                        external_chat_id: msg.external_chat_id.clone(),
                        content: MessageContent::Text(
                            "Couldn't hear anything in that voice message — try again.".into(),
                        ),
                    })
                    .await;
                false
            }
            Err(e) => {
                tracing::error!(
                    channel_id,
                    external_chat_id = %msg.external_chat_id,
                    error = %e,
                    "Voice transcription failed"
                );
                let user_msg = match &e {
                    moxxy_core::SttError::Auth(_) => "Voice service authentication failed.",
                    moxxy_core::SttError::Unsupported(_) => "This audio format is not supported.",
                    moxxy_core::SttError::Empty => "Couldn't hear anything — try again.",
                    moxxy_core::SttError::Http(_) => "Voice service temporarily unavailable.",
                };
                let _ = transport
                    .send_message(OutgoingMessage {
                        external_chat_id: msg.external_chat_id.clone(),
                        content: MessageContent::Text(user_msg.into()),
                    })
                    .await;
                false
            }
        }
    }

    async fn handle_incoming(
        &self,
        channel_id: &str,
        transport: &Arc<dyn ChannelTransport>,
        mut msg: IncomingMessage,
    ) {
        tracing::info!(
            channel_id,
            external_chat_id = %msg.external_chat_id,
            sender_id = %msg.sender_id,
            text_len = msg.text.len(),
            has_audio = msg.audio.is_some(),
            "Inbound channel message"
        );

        // Transcribe voice messages before any further routing. On any error
        // (not configured, auth failure, oversize, empty) respond to the user
        // and stop — do not start a run with an empty task.
        if msg.audio.is_some()
            && !self
                .transcribe_audio_in_place(channel_id, transport, &mut msg)
                .await
        {
            return;
        }

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

        // If the agent is currently waiting on a `user.ask` question from this
        // chat, route this incoming message as the answer instead of starting
        // a new run. Otherwise the user's reply would silently spawn a fresh
        // task and the original ask would time out.
        let pending_question_id = {
            let mut asks = self.pending_asks.lock().await;
            asks.remove(&(agent_name.clone(), external_chat_id.clone()))
        };
        if let Some(question_id) = pending_question_id {
            tracing::info!(
                agent_id = %agent_name,
                question_id,
                "Routing inbound channel message as user.ask answer"
            );
            match self.run_starter.resolve_ask(&question_id, &msg.text) {
                Ok(()) => {
                    let _ = transport.send_typing(&msg.external_chat_id).await;
                }
                Err(e) => {
                    tracing::error!(
                        agent_id = %agent_name,
                        question_id,
                        error = %e,
                        "Failed to resolve user.ask answer"
                    );
                    let _ = transport
                        .send_message(OutgoingMessage {
                            external_chat_id: msg.external_chat_id.clone(),
                            content: MessageContent::Text(format!(
                                "Could not deliver your answer: {e}"
                            )),
                        })
                        .await;
                }
            }
            return;
        }

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

        // Trigger a run via RunStarter (with queueing support)
        match self
            .run_starter
            .start_or_queue(agent_name, &msg.text, "channel")
            .await
        {
            Ok(moxxy_types::RunOutcome::Started(_run_id)) => {}
            Ok(moxxy_types::RunOutcome::Queued(position)) => {
                let _ = transport
                    .send_message(OutgoingMessage {
                        external_chat_id: msg.external_chat_id.clone(),
                        content: MessageContent::Text(format!(
                            "Agent is busy — your message has been queued (position {position})."
                        )),
                    })
                    .await;
            }
            Ok(moxxy_types::RunOutcome::QueueFull) => {
                let _ = transport
                    .send_message(OutgoingMessage {
                        external_chat_id: msg.external_chat_id.clone(),
                        content: MessageContent::Text(
                            "Agent is busy and the queue is full. Please try again later.".into(),
                        ),
                    })
                    .await;
            }
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

    /// Spawn a background loop that continuously sends typing indicators
    /// every 4 seconds for the duration of a run. Telegram's typing status
    /// expires after ~5 seconds, so this keeps it alive until cancelled.
    fn spawn_typing_loop(
        self: &Arc<Self>,
        agent_name: String,
        run_id: String,
        channels: Vec<(Arc<dyn ChannelTransport>, String)>,
    ) -> CancellationToken {
        let token = CancellationToken::new();
        let token_clone = token.clone();
        let bridge_shutdown = self.shutdown.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = token_clone.cancelled() => break,
                    _ = bridge_shutdown.cancelled() => break,
                    _ = tokio::time::sleep(std::time::Duration::from_secs(4)) => {
                        for (transport, chat_id) in &channels {
                            let _ = transport.send_typing(chat_id).await;
                        }
                    }
                }
            }
            tracing::debug!(agent_name, run_id, "Typing loop ended");
        });
        token
    }

    /// Cancel the typing indicator loop for a run.
    async fn stop_typing_loop(&self, agent_id: &str, run_id: &str) {
        let key = (agent_id.to_string(), run_id.to_string());
        if let Some(token) = self.typing_loops.lock().await.remove(&key) {
            token.cancel();
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

    /// Finalize the current progress message by editing it to show a completed
    /// summary. Called before starting a new skill's progress message.
    async fn finalize_progress_message(&self, agent_id: &str, run_id: &str) {
        let channels = self.resolve_agent_channels(agent_id);
        let mut progress = self.progress.lock().await;
        let key = (agent_id.to_string(), run_id.to_string());
        let Some(chat_map) = progress.get_mut(&key) else {
            return;
        };

        for (transport, _chat_id, channel_id) in &channels {
            if let Some(rp) = chat_map.get_mut(channel_id) {
                // Finalize active skill into completed list for rendering
                if let Some(skill) = rp.active_skill.take() {
                    rp.completed_skills.push(skill);
                }
                rp.finished = false;
                rp.dirty = true;
                let text = rp.render();
                if let Some(msg_id) = &rp.message_id
                    && !text.is_empty()
                {
                    let _ = transport
                        .edit_message(&rp.external_chat_id, msg_id, &text)
                        .await;
                }
            }
        }
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

        // `user.ask_*` events are agent-scoped, not run-scoped — handle them
        // before the run_id guard below.
        match envelope.event_type {
            EventType::UserAskQuestion => {
                self.handle_user_ask_question(agent_id, envelope).await;
                return;
            }
            EventType::UserAskAnswered => {
                self.handle_user_ask_answered(agent_id, envelope).await;
                return;
            }
            _ => {}
        }

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

                // Send typing indicator and start continuous typing loop
                let typing_channels: Vec<_> = channels
                    .iter()
                    .map(|(t, chat_id, _)| (t.clone(), chat_id.clone()))
                    .collect();
                for (transport, chat_id) in &typing_channels {
                    let _ = transport.send_typing(chat_id).await;
                }
                let typing_token =
                    self.spawn_typing_loop(agent_id.to_string(), run_id.clone(), typing_channels);
                self.typing_loops
                    .lock()
                    .await
                    .insert((agent_id.to_string(), run_id.clone()), typing_token);

                // Progress message sent lazily on first tool
                let mut chat_map = HashMap::new();
                for (_transport, chat_id, channel_id) in &channels {
                    chat_map.insert(
                        channel_id.clone(),
                        RunProgress {
                            message_id: None,
                            external_chat_id: chat_id.clone(),
                            tools: Vec::new(),
                            active_skill: None,
                            completed_skills: Vec::new(),
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
                if name == "skill.execute" {
                    // New skill invocation — finalize the current progress
                    // message and start a fresh one so each skill gets its
                    // own separate message in the chat.
                    let skill_name = envelope
                        .payload
                        .get("arguments")
                        .and_then(|a| {
                            if let Some(n) = a.get("name").and_then(|v| v.as_str()) {
                                return Some(n.to_string());
                            }
                            if let Some(s) = a.as_str()
                                && let Ok(parsed) = serde_json::from_str::<serde_json::Value>(s)
                            {
                                return parsed
                                    .get("name")
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_string());
                            }
                            None
                        })
                        .unwrap_or_else(|| "unknown".to_string());

                    // Finalize old progress message (edit to "completed" state)
                    self.finalize_progress_message(agent_id, &run_id).await;

                    // Start a fresh progress entry for the new skill
                    let mut progress = self.progress.lock().await;
                    let key = (agent_id.to_string(), run_id.clone());
                    if let Some(chat_map) = progress.get_mut(&key) {
                        for rp in chat_map.values_mut() {
                            rp.message_id = None;
                            rp.tools.clear();
                            rp.completed_skills.clear();
                            rp.sub_agents.clear();
                            rp.active_skill = Some(SkillProgress {
                                name: skill_name.clone(),
                                steps: Vec::new(),
                                finished: false,
                            });
                            rp.dirty = true;
                            rp.finished = false;
                        }
                    }
                    drop(progress);
                    self.flush_progress(agent_id, &run_id).await;
                } else {
                    let mut progress = self.progress.lock().await;
                    let key = (agent_id.to_string(), run_id.clone());
                    if let Some(chat_map) = progress.get_mut(&key) {
                        for rp in chat_map.values_mut() {
                            if let Some(ref mut skill) = rp.active_skill {
                                skill.steps.push(SkillStep {
                                    name: name.clone(),
                                    status: ToolStatus::Running,
                                    result: None,
                                });
                            } else {
                                rp.tools.push((name.clone(), ToolStatus::Running));
                            }
                            rp.dirty = true;
                        }
                    }
                    drop(progress);
                    self.flush_progress(agent_id, &run_id).await;
                }
            }

            EventType::PrimitiveCompleted => {
                let name = envelope
                    .payload
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                if name == "skill.execute" {
                    // Skill finished — update name if available, then finalize
                    // its progress message so it shows as completed.
                    let result_name = envelope
                        .payload
                        .get("result")
                        .and_then(|r| r.get("name"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    {
                        let mut progress = self.progress.lock().await;
                        let key = (agent_id.to_string(), run_id.clone());
                        if let Some(chat_map) = progress.get_mut(&key) {
                            for rp in chat_map.values_mut() {
                                if let Some(ref mut skill) = rp.active_skill
                                    && let Some(ref rn) = result_name
                                {
                                    skill.name = rn.clone();
                                }
                            }
                        }
                    }
                    self.finalize_progress_message(agent_id, &run_id).await;
                    // Reset progress for any subsequent tools/skills
                    let mut progress = self.progress.lock().await;
                    let key = (agent_id.to_string(), run_id.clone());
                    if let Some(chat_map) = progress.get_mut(&key) {
                        for rp in chat_map.values_mut() {
                            rp.message_id = None;
                            rp.tools.clear();
                            rp.completed_skills.clear();
                            rp.sub_agents.clear();
                            rp.active_skill = None;
                            rp.dirty = false;
                            rp.finished = false;
                        }
                    }
                } else {
                    let result_summary = envelope.payload.get("result").and_then(|r| {
                        if let Some(s) = r.as_str() {
                            Some(s.to_string())
                        } else {
                            r.get("status")
                                .and_then(|v| v.as_str())
                                .map(|status| status.to_string())
                        }
                    });
                    let mut progress = self.progress.lock().await;
                    let key = (agent_id.to_string(), run_id.clone());
                    if let Some(chat_map) = progress.get_mut(&key) {
                        for rp in chat_map.values_mut() {
                            if let Some(ref mut skill) = rp.active_skill {
                                if let Some(step) = skill.steps.iter_mut().rev().find(|s| {
                                    s.name == name && matches!(s.status, ToolStatus::Running)
                                }) {
                                    step.status = ToolStatus::Completed;
                                    step.result = result_summary.clone();
                                }
                            } else if let Some(tool) =
                                rp.tools.iter_mut().rev().find(|(n, _)| *n == name)
                            {
                                tool.1 = ToolStatus::Completed;
                            }
                            rp.dirty = true;
                        }
                    }
                    drop(progress);
                    self.flush_progress(agent_id, &run_id).await;
                }
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
                            if let Some(ref mut skill) = rp.active_skill {
                                if let Some(step) = skill.steps.iter_mut().rev().find(|s| {
                                    s.name == name && matches!(s.status, ToolStatus::Running)
                                }) {
                                    step.status = ToolStatus::Failed;
                                } else {
                                    // skill.execute itself failed
                                    skill.finished = true;
                                }
                            } else if let Some(tool) =
                                rp.tools.iter_mut().rev().find(|(n, _)| *n == name)
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
                // Close any active skill session
                {
                    let mut progress = self.progress.lock().await;
                    let key = (agent_id.to_string(), run_id.clone());
                    if let Some(chat_map) = progress.get_mut(&key) {
                        for rp in chat_map.values_mut() {
                            if let Some(skill) = rp.active_skill.take() {
                                rp.completed_skills.push(skill);
                            }
                            rp.dirty = true;
                        }
                    }
                }
                self.flush_progress(agent_id, &run_id).await;

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
                self.stop_typing_loop(agent_id, &run_id).await;
                let channels = self.resolve_agent_channels(agent_id);
                let mut progress = self.progress.lock().await;
                let key = (agent_id.to_string(), run_id.clone());
                if let Some(mut chat_map) = progress.remove(&key) {
                    // Finalize any active skill before rendering
                    for rp in chat_map.values_mut() {
                        if let Some(skill) = rp.active_skill.take() {
                            rp.completed_skills.push(skill);
                        }
                    }
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
                self.stop_typing_loop(agent_id, &run_id).await;
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
                // Clear any pending asks for this agent — the run is gone, so
                // there is nothing left to answer.
                let mut asks = self.pending_asks.lock().await;
                asks.retain(|(a, _), _| a != agent_id);
            }

            _ => {}
        }
    }

    /// Deliver a `user.ask` question to every channel bound to the agent and
    /// remember which question_id is in flight for each chat so that the
    /// user's next reply can be routed back as the answer.
    async fn handle_user_ask_question(
        &self,
        agent_id: &str,
        envelope: &moxxy_types::EventEnvelope,
    ) {
        let question_id = match envelope.payload.get("question_id").and_then(|v| v.as_str()) {
            Some(qid) => qid.to_string(),
            None => {
                tracing::warn!(
                    agent_id,
                    "UserAskQuestion event missing question_id, dropping"
                );
                return;
            }
        };
        let question = envelope
            .payload
            .get("question")
            .and_then(|v| v.as_str())
            .unwrap_or("The agent is asking for input.")
            .to_string();

        // Flush any in-progress message for active runs of this agent so the
        // question lands as a separate message rather than hidden behind a
        // progress block that might still be edited.
        let active_runs: Vec<String> = {
            let progress = self.progress.lock().await;
            progress
                .keys()
                .filter(|(a, _)| a == agent_id)
                .map(|(_, r)| r.clone())
                .collect()
        };
        for run_id in active_runs {
            self.flush_progress(agent_id, &run_id).await;
        }

        let channels = self.resolve_agent_channels(agent_id);
        if channels.is_empty() {
            tracing::warn!(
                agent_id,
                question_id,
                "UserAskQuestion: no channel bindings found, user cannot answer"
            );
            return;
        }

        let body = format!("❓ {question}");
        let mut asks = self.pending_asks.lock().await;
        for (transport, chat_id, _channel_id) in &channels {
            asks.insert((agent_id.to_string(), chat_id.clone()), question_id.clone());
            if let Err(e) = transport
                .send_message(OutgoingMessage {
                    external_chat_id: chat_id.clone(),
                    content: MessageContent::Text(body.clone()),
                })
                .await
            {
                tracing::error!(
                    agent_id,
                    question_id,
                    error = %e,
                    "Failed to deliver user.ask question to channel"
                );
            }
        }
    }

    /// Drop any cached `pending_asks` entries for a question that was already
    /// answered through another surface (TUI, REST endpoint, etc.).
    async fn handle_user_ask_answered(
        &self,
        agent_id: &str,
        envelope: &moxxy_types::EventEnvelope,
    ) {
        if let Some(answered_id) = envelope.payload.get("question_id").and_then(|v| v.as_str()) {
            let mut asks = self.pending_asks.lock().await;
            asks.retain(|(a, _), qid| !(a == agent_id && qid == answered_id));
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

    /// Push an externally-received message (e.g. from a WhatsApp webhook) into
    /// the appropriate transport's receiving pipeline. The message is routed to
    /// the first WhatsApp transport that has a webhook_sender.
    pub fn inject_incoming(&self, msg: IncomingMessage) {
        let transports = self.transports.read().unwrap();
        for (_channel_id, transport) in transports.iter() {
            if let Some(sender) = transport.webhook_sender() {
                let _ = sender.try_send(msg);
                return;
            }
        }
        tracing::warn!("No webhook-capable transport found to inject message into");
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

    fn new_run_progress() -> RunProgress {
        RunProgress {
            message_id: None,
            external_chat_id: "chat-1".into(),
            tools: Vec::new(),
            active_skill: None,
            completed_skills: Vec::new(),
            sub_agents: Vec::new(),
            last_edit: Instant::now(),
            dirty: false,
            finished: false,
        }
    }

    #[test]
    fn truncate_result_short_string_unchanged() {
        assert_eq!(truncate_result("hello", 10), "hello");
    }

    #[test]
    fn truncate_result_long_string_truncated() {
        let long = "a".repeat(100);
        let result = truncate_result(&long, 10);
        assert!(result.len() < 100);
        assert!(result.ends_with('…'));
    }

    #[test]
    fn render_standalone_tools_unchanged() {
        let mut rp = new_run_progress();
        rp.tools.push(("fs.read".into(), ToolStatus::Running));
        rp.tools.push(("fs.write".into(), ToolStatus::Completed));
        let text = rp.render();
        assert!(text.contains("1 ⏳ fs.read"));
        assert!(text.contains("2 ✅ fs.write"));
    }

    #[test]
    fn render_active_skill_shows_invoking_header() {
        let mut rp = new_run_progress();
        rp.active_skill = Some(SkillProgress {
            name: "git clone".into(),
            steps: vec![],
            finished: false,
        });
        let text = rp.render();
        assert!(text.contains("⊞ Invoking git clone..."), "got: {text}");
    }

    #[test]
    fn render_active_skill_with_steps() {
        let mut rp = new_run_progress();
        rp.active_skill = Some(SkillProgress {
            name: "Deploy".into(),
            steps: vec![
                SkillStep {
                    name: "git.clone".into(),
                    status: ToolStatus::Completed,
                    result: Some("cloned repo".into()),
                },
                SkillStep {
                    name: "fs.write".into(),
                    status: ToolStatus::Running,
                    result: None,
                },
            ],
            finished: false,
        });
        let text = rp.render();
        assert!(text.contains("⊞ Invoking Deploy..."), "got: {text}");
        assert!(text.contains("◷ git.clone → cloned repo"), "got: {text}");
        assert!(text.contains("⏳ fs.write"), "got: {text}");
    }

    #[test]
    fn render_completed_skill_shows_checkmark() {
        let mut rp = new_run_progress();
        rp.completed_skills.push(SkillProgress {
            name: "Deploy".into(),
            steps: vec![
                SkillStep {
                    name: "git.clone".into(),
                    status: ToolStatus::Completed,
                    result: Some("cloned repo".into()),
                },
                SkillStep {
                    name: "git.commit".into(),
                    status: ToolStatus::Completed,
                    result: Some("committed".into()),
                },
            ],
            finished: false,
        });
        let text = rp.render();
        assert!(text.contains("✅ Deploy"), "got: {text}");
        assert!(text.contains("◷ git.clone → cloned repo"), "got: {text}");
        assert!(text.contains("◷ git.commit → committed"), "got: {text}");
    }

    #[test]
    fn render_skill_and_standalone_tools_together() {
        let mut rp = new_run_progress();
        rp.completed_skills.push(SkillProgress {
            name: "Build".into(),
            steps: vec![SkillStep {
                name: "fs.write".into(),
                status: ToolStatus::Completed,
                result: None,
            }],
            finished: false,
        });
        rp.tools.push(("echo".into(), ToolStatus::Completed));
        let text = rp.render();
        assert!(text.contains("✅ Build"), "got: {text}");
        assert!(text.contains("1 ✅ echo"), "got: {text}");
    }

    #[test]
    fn render_failed_step_shows_error_icon() {
        let mut rp = new_run_progress();
        rp.active_skill = Some(SkillProgress {
            name: "Deploy".into(),
            steps: vec![SkillStep {
                name: "git.push".into(),
                status: ToolStatus::Failed,
                result: None,
            }],
            finished: false,
        });
        let text = rp.render();
        assert!(text.contains("❌ git.push"), "got: {text}");
    }

    #[test]
    fn render_step_result_truncated_at_60() {
        let mut rp = new_run_progress();
        let long_result = "x".repeat(100);
        rp.active_skill = Some(SkillProgress {
            name: "Test".into(),
            steps: vec![SkillStep {
                name: "fs.read".into(),
                status: ToolStatus::Completed,
                result: Some(long_result),
            }],
            finished: false,
        });
        let text = rp.render();
        // The result should be truncated
        assert!(text.contains("→"), "got: {text}");
        assert!(
            text.contains('…'),
            "result should be truncated, got: {text}"
        );
    }

    #[test]
    fn render_finished_returns_empty() {
        let mut rp = new_run_progress();
        rp.finished = true;
        rp.active_skill = Some(SkillProgress {
            name: "Test".into(),
            steps: vec![],
            finished: false,
        });
        assert_eq!(rp.render(), "");
    }

    // ---------- STT integration tests for ChannelBridge ----------

    use crate::transport::IncomingAudio;
    use moxxy_core::SttError as CoreSttError;
    use moxxy_core::SttProvider as CoreSttProvider;

    /// Test STT provider with configurable behavior.
    enum FakeSttBehavior {
        Ok(String),
        Auth,
        Http,
    }

    struct FakeStt {
        behavior: FakeSttBehavior,
        calls: Arc<Mutex<u32>>,
    }

    #[async_trait::async_trait]
    impl CoreSttProvider for FakeStt {
        async fn transcribe(
            &self,
            _audio: &[u8],
            _mime: &str,
            _filename: &str,
        ) -> Result<String, CoreSttError> {
            *self.calls.lock().unwrap() += 1;
            match &self.behavior {
                FakeSttBehavior::Ok(s) => Ok(s.clone()),
                FakeSttBehavior::Auth => Err(CoreSttError::Auth("bad".into())),
                FakeSttBehavior::Http => Err(CoreSttError::Http("boom".into())),
            }
        }
        fn name(&self) -> &str {
            "fake"
        }
    }

    /// Transport that captures every outgoing message in-memory so tests
    /// can assert on the user-visible reply.
    struct RecordingTransport {
        sent: Arc<Mutex<Vec<OutgoingMessage>>>,
    }

    #[async_trait::async_trait]
    impl ChannelTransport for RecordingTransport {
        fn transport_name(&self) -> &str {
            "recording"
        }
        async fn start_receiving(
            &self,
            _sender: tokio::sync::mpsc::Sender<IncomingMessage>,
            _shutdown: CancellationToken,
        ) -> Result<(), ChannelError> {
            Ok(())
        }
        async fn send_message(&self, msg: OutgoingMessage) -> Result<(), ChannelError> {
            self.sent.lock().unwrap().push(msg);
            Ok(())
        }
    }

    fn build_bridge(
        stt: Option<Arc<dyn CoreSttProvider>>,
        stt_settings: Option<SttSettings>,
    ) -> Arc<ChannelBridge> {
        let db = setup_db();
        let event_bus = EventBus::new(64);
        let run_starter: Arc<dyn RunStarter> = Arc::new(MockRunStarter);
        let vault: Arc<dyn SecretBackend + Send + Sync> =
            Arc::new(moxxy_vault::InMemoryBackend::new());
        Arc::new(ChannelBridge::new_with_stt(
            db,
            event_bus,
            run_starter,
            vault,
            "/tmp/moxxy-stt-test".into(),
            stt,
            stt_settings,
        ))
    }

    fn build_transport() -> (Arc<dyn ChannelTransport>, Arc<Mutex<Vec<OutgoingMessage>>>) {
        let sent = Arc::new(Mutex::new(Vec::new()));
        let transport: Arc<dyn ChannelTransport> =
            Arc::new(RecordingTransport { sent: sent.clone() });
        (transport, sent)
    }

    fn default_stt_settings() -> SttSettings {
        SttSettings {
            provider: "fake".into(),
            model: "whisper-1".into(),
            api_base: None,
            secret_ref: "OPENAI_API_KEY".into(),
            max_seconds: 600,
            max_bytes: 25 * 1024 * 1024,
        }
    }

    fn audio_msg(audio: IncomingAudio) -> IncomingMessage {
        IncomingMessage {
            external_chat_id: "chat-1".into(),
            sender_id: "user-1".into(),
            sender_name: "Alice".into(),
            text: String::new(),
            timestamp: 0,
            audio: Some(audio),
        }
    }

    #[tokio::test]
    async fn transcribe_replaces_text_on_success() {
        let calls = Arc::new(Mutex::new(0));
        let stt: Arc<dyn CoreSttProvider> = Arc::new(FakeStt {
            behavior: FakeSttBehavior::Ok("hello from voice".into()),
            calls: calls.clone(),
        });
        let bridge = build_bridge(Some(stt), Some(default_stt_settings()));
        let (transport, sent) = build_transport();

        let mut msg = audio_msg(IncomingAudio {
            data: vec![0u8; 128],
            mime: "audio/ogg".into(),
            filename: "voice.ogg".into(),
            duration_secs: Some(4),
        });

        let ok = bridge
            .transcribe_audio_in_place("ch1", &transport, &mut msg)
            .await;
        assert!(ok);
        assert_eq!(msg.text, "hello from voice");
        assert!(msg.audio.is_none(), "audio should be consumed");
        assert_eq!(*calls.lock().unwrap(), 1);
        // Only a typing indicator (no-op in recording transport) is expected;
        // no user-facing error message should have been sent.
        assert_eq!(sent.lock().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn transcribe_fails_cleanly_when_stt_not_configured() {
        let bridge = build_bridge(None, None);
        let (transport, sent) = build_transport();

        let mut msg = audio_msg(IncomingAudio {
            data: vec![0u8; 64],
            mime: "audio/ogg".into(),
            filename: "voice.ogg".into(),
            duration_secs: Some(2),
        });

        let ok = bridge
            .transcribe_audio_in_place("ch1", &transport, &mut msg)
            .await;
        assert!(!ok);
        // User must see a clear message explaining the feature is off.
        let sent_msgs = sent.lock().unwrap();
        assert_eq!(sent_msgs.len(), 1);
        match &sent_msgs[0].content {
            MessageContent::Text(s) => assert!(
                s.contains("not configured"),
                "expected 'not configured' message, got: {s}"
            ),
            other => panic!("expected Text, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn transcribe_rejects_oversize_audio() {
        let calls = Arc::new(Mutex::new(0));
        let stt: Arc<dyn CoreSttProvider> = Arc::new(FakeStt {
            behavior: FakeSttBehavior::Ok("should never run".into()),
            calls: calls.clone(),
        });
        let mut settings = default_stt_settings();
        settings.max_bytes = 10;
        let bridge = build_bridge(Some(stt), Some(settings));
        let (transport, sent) = build_transport();

        let mut msg = audio_msg(IncomingAudio {
            data: vec![0u8; 64], // 64 > max_bytes=10
            mime: "audio/ogg".into(),
            filename: "voice.ogg".into(),
            duration_secs: Some(1),
        });

        let ok = bridge
            .transcribe_audio_in_place("ch1", &transport, &mut msg)
            .await;
        assert!(!ok);
        assert_eq!(
            *calls.lock().unwrap(),
            0,
            "STT must not be called for oversize audio"
        );
        let sent_msgs = sent.lock().unwrap();
        assert_eq!(sent_msgs.len(), 1);
        match &sent_msgs[0].content {
            MessageContent::Text(s) => {
                assert!(s.contains("too large"), "got: {s}")
            }
            other => panic!("expected Text, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn transcribe_rejects_overlong_duration() {
        let calls = Arc::new(Mutex::new(0));
        let stt: Arc<dyn CoreSttProvider> = Arc::new(FakeStt {
            behavior: FakeSttBehavior::Ok("should never run".into()),
            calls: calls.clone(),
        });
        let mut settings = default_stt_settings();
        settings.max_seconds = 5;
        let bridge = build_bridge(Some(stt), Some(settings));
        let (transport, sent) = build_transport();

        let mut msg = audio_msg(IncomingAudio {
            data: vec![0u8; 64],
            mime: "audio/ogg".into(),
            filename: "voice.ogg".into(),
            duration_secs: Some(10),
        });

        let ok = bridge
            .transcribe_audio_in_place("ch1", &transport, &mut msg)
            .await;
        assert!(!ok);
        assert_eq!(*calls.lock().unwrap(), 0);
        let sent_msgs = sent.lock().unwrap();
        assert_eq!(sent_msgs.len(), 1);
        match &sent_msgs[0].content {
            MessageContent::Text(s) => assert!(s.contains("too long"), "got: {s}"),
            other => panic!("expected Text, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn transcribe_handles_empty_transcript() {
        let calls = Arc::new(Mutex::new(0));
        let stt: Arc<dyn CoreSttProvider> = Arc::new(FakeStt {
            behavior: FakeSttBehavior::Ok("   ".into()),
            calls: calls.clone(),
        });
        let bridge = build_bridge(Some(stt), Some(default_stt_settings()));
        let (transport, sent) = build_transport();

        let mut msg = audio_msg(IncomingAudio {
            data: vec![0u8; 64],
            mime: "audio/ogg".into(),
            filename: "voice.ogg".into(),
            duration_secs: Some(3),
        });

        let ok = bridge
            .transcribe_audio_in_place("ch1", &transport, &mut msg)
            .await;
        assert!(!ok);
        assert_eq!(*calls.lock().unwrap(), 1);
        let sent_msgs = sent.lock().unwrap();
        assert_eq!(sent_msgs.len(), 1);
        match &sent_msgs[0].content {
            MessageContent::Text(s) => {
                assert!(s.to_lowercase().contains("couldn't hear"), "got: {s}")
            }
            other => panic!("expected Text, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn transcribe_surfaces_auth_error() {
        let calls = Arc::new(Mutex::new(0));
        let stt: Arc<dyn CoreSttProvider> = Arc::new(FakeStt {
            behavior: FakeSttBehavior::Auth,
            calls: calls.clone(),
        });
        let bridge = build_bridge(Some(stt), Some(default_stt_settings()));
        let (transport, sent) = build_transport();

        let mut msg = audio_msg(IncomingAudio {
            data: vec![0u8; 64],
            mime: "audio/ogg".into(),
            filename: "voice.ogg".into(),
            duration_secs: Some(3),
        });

        let ok = bridge
            .transcribe_audio_in_place("ch1", &transport, &mut msg)
            .await;
        assert!(!ok);
        assert_eq!(*calls.lock().unwrap(), 1);
        let sent_msgs = sent.lock().unwrap();
        assert_eq!(sent_msgs.len(), 1);
        match &sent_msgs[0].content {
            MessageContent::Text(s) => {
                assert!(s.contains("authentication"), "got: {s}")
            }
            other => panic!("expected Text, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn transcribe_surfaces_http_error_as_unavailable() {
        let stt: Arc<dyn CoreSttProvider> = Arc::new(FakeStt {
            behavior: FakeSttBehavior::Http,
            calls: Arc::new(Mutex::new(0)),
        });
        let bridge = build_bridge(Some(stt), Some(default_stt_settings()));
        let (transport, sent) = build_transport();

        let mut msg = audio_msg(IncomingAudio {
            data: vec![0u8; 64],
            mime: "audio/ogg".into(),
            filename: "voice.ogg".into(),
            duration_secs: Some(3),
        });

        let ok = bridge
            .transcribe_audio_in_place("ch1", &transport, &mut msg)
            .await;
        assert!(!ok);
        let sent_msgs = sent.lock().unwrap();
        assert_eq!(sent_msgs.len(), 1);
        match &sent_msgs[0].content {
            MessageContent::Text(s) => assert!(s.contains("unavailable"), "got: {s}"),
            other => panic!("expected Text, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn transcribe_no_op_without_audio() {
        let calls = Arc::new(Mutex::new(0));
        let stt: Arc<dyn CoreSttProvider> = Arc::new(FakeStt {
            behavior: FakeSttBehavior::Ok("nope".into()),
            calls: calls.clone(),
        });
        let bridge = build_bridge(Some(stt), Some(default_stt_settings()));
        let (transport, _sent) = build_transport();

        let mut msg = IncomingMessage {
            external_chat_id: "chat-1".into(),
            sender_id: "user-1".into(),
            sender_name: "Alice".into(),
            text: "plain text".into(),
            timestamp: 0,
            audio: None,
        };
        let ok = bridge
            .transcribe_audio_in_place("ch1", &transport, &mut msg)
            .await;
        assert!(ok, "no-audio path should be a success no-op");
        assert_eq!(msg.text, "plain text");
        assert_eq!(*calls.lock().unwrap(), 0);
    }
}
