use moxxy_channel::bridge::{ChannelBridge, ChannelSender};
use moxxy_core::{AgentRegistry, EmbeddingService, EventBus, LoadedWebhook};
use moxxy_runtime::{
    AskChannels, ChannelMessageSender, Provider, ProviderConfig, WebhookListenChannels,
    agent_kind::{AgentKindRegistry, AgentSetup, KindContext},
};
use moxxy_storage::Database;
use moxxy_types::{
    AgentRuntime, AgentStatus, AgentType, ChildInfo, EventEnvelope, EventType, MessageContent,
    RunStarter, SpawnOpts, SpawnResult,
};
use moxxy_vault::SecretBackend;
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

/// Maximum number of pending run requests per agent.
const MAX_QUEUE_PER_AGENT: usize = 50;

/// A running agent's cancellation token paired with its start timestamp.
pub struct RunHandle {
    pub token: CancellationToken,
    pub started_at_ms: i64,
}

/// A run request waiting to be processed when the agent becomes idle.
#[derive(Debug, Clone)]
pub struct QueuedRun {
    pub agent_name: String,
    pub task: String,
    /// Opaque source tag for callers to identify the origin (e.g. "webhook", "api", "heartbeat").
    pub source: String,
    /// Optional caller-provided metadata (e.g. webhook delivery_id).
    pub metadata: serde_json::Value,
}

/// Result of `start_or_queue_run`.
#[derive(Debug, Clone)]
pub enum StartRunOutcome {
    /// Run started immediately.
    Started { run_id: String },
    /// Agent was busy; run was queued at the given position.
    Queued { position: usize },
    /// Queue was full; run was dropped.
    QueueFull,
}

pub type AgentRunQueue = Arc<Mutex<HashMap<String, VecDeque<QueuedRun>>>>;

/// Adapts `ChannelBridge` (which implements `ChannelSender`) to the
/// `ChannelMessageSender` trait required by `ChannelNotifyPrimitive`.
pub struct BridgeChannelAdapter {
    bridge: Arc<ChannelBridge>,
}

impl BridgeChannelAdapter {
    pub fn new(bridge: Arc<ChannelBridge>) -> Self {
        Self { bridge }
    }
}

#[async_trait::async_trait]
impl ChannelMessageSender for BridgeChannelAdapter {
    async fn send_to_agent_channels(
        &self,
        agent_id: &str,
        content: MessageContent,
    ) -> Result<u32, String> {
        self.bridge
            .send_to_agent_channels(agent_id, content)
            .await
            .map_err(|e| e.to_string())
    }

    async fn send_to_channel(
        &self,
        channel_id: &str,
        content: MessageContent,
    ) -> Result<(), String> {
        self.bridge
            .send_to_channel(channel_id, content)
            .await
            .map_err(|e| e.to_string())
    }
}

pub struct RunService {
    pub db: Arc<Mutex<Database>>,
    pub registry: AgentRegistry,
    pub event_bus: EventBus,
    pub run_tokens: Arc<Mutex<HashMap<String, RunHandle>>>,
    channel_sender: Mutex<Option<Arc<dyn ChannelMessageSender>>>,
    run_starter: Mutex<Option<Arc<dyn RunStarter>>>,
    vault_backend: Arc<dyn SecretBackend + Send + Sync>,
    pub ask_channels: AskChannels,
    pub moxxy_home: PathBuf,
    pub base_url: String,
    embedding_svc: Arc<dyn EmbeddingService>,
    kind_registry: Arc<AgentKindRegistry>,
    pub webhook_index: Arc<RwLock<HashMap<String, LoadedWebhook>>>,
    pub webhook_listen_channels: WebhookListenChannels,
    /// Per-agent bounded queue for run requests that arrive while the agent is busy.
    pub run_queue: AgentRunQueue,
    /// Channel for signalling the drain loop when a run completes and the queue should be checked.
    drain_tx: mpsc::UnboundedSender<String>,
}

impl RunService {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        db: Arc<Mutex<Database>>,
        registry: AgentRegistry,
        event_bus: EventBus,
        vault_backend: Arc<dyn SecretBackend + Send + Sync>,
        moxxy_home: PathBuf,
        base_url: String,
        embedding_svc: Arc<dyn EmbeddingService>,
        kind_registry: Arc<AgentKindRegistry>,
        webhook_index: Arc<RwLock<HashMap<String, LoadedWebhook>>>,
    ) -> Self {
        Self {
            db,
            registry,
            event_bus,
            run_tokens: Arc::new(Mutex::new(HashMap::new())),
            channel_sender: Mutex::new(None),
            run_starter: Mutex::new(None),
            vault_backend,
            ask_channels: moxxy_runtime::new_ask_channels(),
            moxxy_home,
            base_url,
            embedding_svc,
            kind_registry,
            webhook_index,
            webhook_listen_channels: moxxy_runtime::new_webhook_listen_channels(),
            run_queue: Arc::new(Mutex::new(HashMap::new())),
            drain_tx: mpsc::unbounded_channel().0,
        }
    }

    /// Create a new RunService with a drain channel. Returns the service and the receiver
    /// half of the drain channel (to be passed to `spawn_drain_loop`).
    #[allow(clippy::too_many_arguments)]
    pub fn new_with_drain(
        db: Arc<Mutex<Database>>,
        registry: AgentRegistry,
        event_bus: EventBus,
        vault_backend: Arc<dyn SecretBackend + Send + Sync>,
        moxxy_home: PathBuf,
        base_url: String,
        embedding_svc: Arc<dyn EmbeddingService>,
        kind_registry: Arc<AgentKindRegistry>,
        webhook_index: Arc<RwLock<HashMap<String, LoadedWebhook>>>,
    ) -> (Self, mpsc::UnboundedReceiver<String>) {
        let (drain_tx, drain_rx) = mpsc::unbounded_channel();
        let svc = Self {
            db,
            registry,
            event_bus,
            run_tokens: Arc::new(Mutex::new(HashMap::new())),
            channel_sender: Mutex::new(None),
            run_starter: Mutex::new(None),
            vault_backend,
            ask_channels: moxxy_runtime::new_ask_channels(),
            moxxy_home,
            base_url,
            embedding_svc,
            kind_registry,
            webhook_index,
            webhook_listen_channels: moxxy_runtime::new_webhook_listen_channels(),
            run_queue: Arc::new(Mutex::new(HashMap::new())),
            drain_tx,
        };
        (svc, drain_rx)
    }

    /// Dynamically resolve a provider by looking up the provider + model from
    /// filesystem YAML and retrieving the API key from the vault.
    pub fn resolve_provider(
        &self,
        provider_id: &str,
        model_id: &str,
        agent_name: Option<&str>,
    ) -> Option<Arc<dyn Provider>> {
        tracing::debug!(provider_id, model_id, "Resolving provider");

        // Load provider YAML from filesystem
        let loaded = moxxy_core::ProviderLoader::load(&self.moxxy_home, provider_id);
        if loaded.is_none() {
            tracing::warn!(provider_id, "Provider YAML not found or failed to parse");
            return None;
        }
        let doc = loaded.unwrap().doc;

        if !doc.enabled {
            tracing::warn!(provider_id, "Provider is disabled");
            return None;
        }

        let model = doc.find_model(model_id).cloned().or_else(|| {
            if provider_id == "ollama" {
                let api_base = doc
                    .api_base
                    .clone()
                    .or_else(|| doc.models.iter().find_map(|model| model.api_base.clone()))
                    .unwrap_or_else(|| "http://127.0.0.1:11434/v1".to_string());
                Some(moxxy_core::ProviderModelEntry {
                    id: model_id.to_string(),
                    display_name: model_id.to_string(),
                    api_base: Some(api_base),
                    chatgpt_account_id: None,
                })
            } else {
                None
            }
        });
        if model.is_none() {
            tracing::warn!(
                provider_id,
                model_id,
                available_models = ?doc.models.iter().map(|m| &m.id).collect::<Vec<_>>(),
                "Model not found in provider doc"
            );
            return None;
        }
        let model = model.unwrap();

        // Get API key from vault (optional — some providers like claude-cli don't need one)
        let vault_key = format!("moxxy_provider_{}", provider_id);
        let api_key = self.vault_backend.get_secret(&vault_key).ok();

        let workspace = agent_name.map(|name| self.moxxy_home.join("agents").join(name));

        let result = moxxy_runtime::create_provider(ProviderConfig {
            provider_id: provider_id.to_string(),
            model_id: model_id.to_string(),
            api_base: model.api_base.clone(),
            api_key,
            chatgpt_account_id: model.chatgpt_account_id.clone(),
            workspace,
        });
        if result.is_none() {
            tracing::warn!(provider_id, model_id, "create_provider returned None");
        }
        result
    }

    /// Set the channel message sender. Called after the ChannelBridge is created.
    pub fn set_channel_sender(&self, sender: Arc<dyn ChannelMessageSender>) {
        *self.channel_sender.lock().unwrap() = Some(sender);
    }

    /// Set the RunStarter for sub-agent spawning. Called after AppState construction.
    pub fn set_run_starter(&self, starter: Arc<dyn RunStarter>) {
        *self.run_starter.lock().unwrap() = Some(starter);
    }

    /// Enqueue a run request for an agent. Returns the queue position, or None if full.
    pub fn enqueue_run(&self, run: QueuedRun) -> Option<usize> {
        let mut queue = self.run_queue.lock().unwrap();
        let agent_queue = queue.entry(run.agent_name.clone()).or_default();
        if agent_queue.len() >= MAX_QUEUE_PER_AGENT {
            return None;
        }
        agent_queue.push_back(run);
        Some(agent_queue.len())
    }

    /// Dequeue the next pending run for an agent, if any.
    pub fn dequeue_run(&self, agent_name: &str) -> Option<QueuedRun> {
        let mut queue = self.run_queue.lock().unwrap();
        let agent_queue = queue.get_mut(agent_name)?;
        let item = agent_queue.pop_front();
        if agent_queue.is_empty() {
            queue.remove(agent_name);
        }
        item
    }

    /// Return the current queue depth for an agent.
    pub fn queue_depth(&self, agent_name: &str) -> usize {
        self.run_queue
            .lock()
            .ok()
            .and_then(|q| q.get(agent_name).map(|v| v.len()))
            .unwrap_or(0)
    }

    /// Try to start a run. If the agent is busy, enqueue it instead.
    /// Returns `Started`, `Queued`, or `QueueFull`.
    pub async fn start_or_queue_run(&self, run: QueuedRun) -> Result<StartRunOutcome, String> {
        match self.do_start_run(&run.agent_name, &run.task).await {
            Ok(run_id) => Ok(StartRunOutcome::Started { run_id }),
            Err(ref e) if e == "Agent is already running" => {
                let agent_name = run.agent_name.clone();
                let source = run.source.clone();
                let metadata = run.metadata.clone();
                match self.enqueue_run(run) {
                    Some(position) => {
                        tracing::info!(
                            agent_name = %agent_name,
                            position,
                            source = %source,
                            "Run queued - agent is busy"
                        );
                        self.event_bus.emit(EventEnvelope::new(
                            agent_name,
                            None,
                            None,
                            0,
                            EventType::RunQueued,
                            serde_json::json!({
                                "position": position,
                                "source": source,
                                "metadata": metadata,
                            }),
                        ));
                        Ok(StartRunOutcome::Queued { position })
                    }
                    None => {
                        tracing::warn!(
                            agent_name = %agent_name,
                            source = %source,
                            "Run queue full - dropping request"
                        );
                        Ok(StartRunOutcome::QueueFull)
                    }
                }
            }
            Err(e) => Err(e),
        }
    }

    /// Start a run for an agent. Returns the run_id on success.
    pub async fn do_start_run(&self, agent_name: &str, task: &str) -> Result<String, String> {
        // Look up agent in registry
        let runtime = self
            .registry
            .get(agent_name)
            .ok_or_else(|| "Agent not found".to_string())?;

        if runtime.status == AgentStatus::Running {
            // Check if there is an active run. If not, the agent is stuck
            // from a previous crash - reset it so a new run can start.
            let has_active_run = self
                .run_tokens
                .lock()
                .ok()
                .is_some_and(|t| t.contains_key(agent_name));
            if has_active_run {
                return Err("Agent is already running".to_string());
            }
            tracing::warn!(
                agent_name,
                "Agent stuck in running status with no active run - resetting to idle"
            );
            self.registry.update_status(agent_name, AgentStatus::Idle);
        }

        self.registry
            .update_status(agent_name, AgentStatus::Running);

        // Create cancellation token early so health checks don't see
        // Running + no token during the setup phase and mark the agent as stuck.
        let cancel_token = CancellationToken::new();
        let agent_name_owned = agent_name.to_string();
        if let Ok(mut tokens) = self.run_tokens.lock() {
            tokens.insert(
                agent_name_owned.clone(),
                RunHandle {
                    token: cancel_token.clone(),
                    started_at_ms: chrono::Utc::now().timestamp_millis(),
                },
            );
        }
        let run_tokens = self.run_tokens.clone();

        // Helper: clean up token and status if setup fails below.
        let cleanup_on_error = |run_tokens: &Arc<Mutex<HashMap<String, RunHandle>>>,
                                registry: &AgentRegistry,
                                name: &str| {
            if let Ok(mut tokens) = run_tokens.lock() {
                tokens.remove(name);
            }
            registry.update_status(name, AgentStatus::Error);
        };

        let run_id = uuid::Uuid::now_v7().to_string();
        let original_task = task.to_string();
        let mut task = task.to_string();

        // Resolve provider from config
        let provider = self
            .resolve_provider(&runtime.config.provider, &runtime.config.model, Some(&agent_name_owned))
            .or_else(|| {
                // Sub-agents may have an invalid model - fall back to parent's model
                if let Some(ref parent_name) = runtime.parent_name {
                    let parent = self.registry.get(parent_name)?;
                    tracing::warn!(
                        agent_name,
                        failed_model = %runtime.config.model,
                        fallback_model = %parent.config.model,
                        "Sub-agent model resolution failed, falling back to parent's model"
                    );
                    self.resolve_provider(&parent.config.provider, &parent.config.model, Some(parent_name))
                } else {
                    None
                }
            })
            .ok_or_else(|| {
                cleanup_on_error(&run_tokens, &self.registry, &agent_name_owned);
                format!(
                    "Could not resolve provider '{}' with model '{}'. \
                     Check that the provider is installed, enabled, and has a valid API key/secret in the vault.",
                    runtime.config.provider, runtime.config.model
                )
            })?;

        tracing::info!(
            agent_name,
            provider_id = %runtime.config.provider,
            "Using registered provider"
        );

        // Auto-detect task complexity for standard agents
        if runtime.agent_type == AgentType::Agent {
            let analysis = crate::task_analyzer::analyze_task_complexity(&provider, &task).await;

            self.event_bus.emit(moxxy_types::EventEnvelope::new(
                agent_name.to_string(),
                Some(run_id.clone()),
                None,
                0,
                EventType::TaskAnalyzed,
                serde_json::json!({
                    "needs_hive": analysis.needs_hive,
                    "suggested_workers": analysis.suggested_workers,
                    "reasoning": analysis.reasoning,
                }),
            ));

            if analysis.needs_hive {
                let bootstrap = moxxy_runtime::agent_kind::build_hive_bootstrap_prompt(
                    analysis.suggested_workers,
                );
                task = format!("{bootstrap}\n{task}");
            }
        }

        // Look up the agent kind
        let kind_name = runtime.agent_type.kind_name().to_string();
        let kind_ref = self.kind_registry.get(&kind_name).ok_or_else(|| {
            cleanup_on_error(&run_tokens, &self.registry, &agent_name_owned);
            format!("agent kind '{}' not found or disabled", kind_name)
        })?;

        // Resolve paths and init via the kind
        let paths =
            kind_ref.resolve_paths(&self.moxxy_home, agent_name, runtime.parent_name.as_deref());
        kind_ref.init(&paths).inspect_err(|_| {
            cleanup_on_error(&run_tokens, &self.registry, &agent_name_owned);
        })?;

        // Resolve the "host" agent name for DB lookups (allowlists, etc.)
        let host_agent_name = match runtime.agent_type {
            AgentType::Agent => agent_name.to_string(),
            _ => runtime
                .parent_name
                .as_deref()
                .unwrap_or(agent_name)
                .to_string(),
        };

        // Build KindContext and AgentSetup
        let kind_ctx = KindContext {
            db: self.db.clone(),
            event_bus: self.event_bus.clone(),
            vault_backend: self.vault_backend.clone(),
            ask_channels: self.ask_channels.clone(),
            channel_sender: self.channel_sender.lock().ok().and_then(|g| g.clone()),
            run_starter: self.run_starter.lock().ok().and_then(|g| g.clone()),
            moxxy_home: self.moxxy_home.clone(),
            embedding_svc: self.embedding_svc.clone(),
            base_url: self.base_url.clone(),
            webhook_index: self.webhook_index.clone(),
            webhook_listen_channels: self.webhook_listen_channels.clone(),
        };
        // Resolve template content if the agent has a template assigned
        let template_content = runtime.config.template.as_ref().and_then(|slug| {
            moxxy_core::TemplateLoader::load_by_slug(&self.moxxy_home, slug).map(|t| t.doc.body)
        });

        let setup = AgentSetup {
            name: agent_name.to_string(),
            parent_name: runtime.parent_name.clone(),
            host_agent_name,
            persona: runtime.persona.clone(),
            template_content,
            temperature: runtime.config.temperature,
            paths,
            policy_profile: runtime.config.policy_profile.clone(),
        };

        // Delegate to the kind's call() method
        let prepared = kind_ref.call(&setup, &kind_ctx).await.inspect_err(|_| {
            cleanup_on_error(&run_tokens, &self.registry, &agent_name_owned);
        })?;

        let parent_name = runtime.parent_name.clone();
        let run_id_clone = run_id.clone();
        let db = self.db.clone();
        let temperature = runtime.config.temperature;
        let event_bus = self.event_bus.clone();
        let agent_registry = self.registry.clone();
        let kind_registry = self.kind_registry.clone();
        let moxxy_home = self.moxxy_home.clone();
        let drain_tx = self.drain_tx.clone();

        tokio::spawn(async move {
            tracing::info!(
                agent_name = %agent_name_owned,
                run_id = %run_id_clone,
                "Run executor starting"
            );

            let event_bus_for_completion = event_bus.clone();
            let stm_path = moxxy_home
                .join("agents")
                .join(&agent_name_owned)
                .join("memory")
                .join("stm.yaml");

            let mut executor = moxxy_runtime::RunExecutor::new(
                event_bus,
                provider,
                prepared.registry,
                prepared.allowed_primitives,
            )
            .with_tools_dirty(prepared.tools_dirty)
            .with_system_prompt(prepared.system_prompt)
            .with_history(prepared.history)
            .with_cancel_token(cancel_token)
            .with_timeout(std::time::Duration::from_secs(300))
            .with_stm_path(stm_path);

            let model_config = moxxy_runtime::ModelConfig {
                temperature,
                max_tokens: 4096,
                tool_choice: moxxy_runtime::ToolChoice::Auto,
            };

            let result = executor
                .execute(&agent_name_owned, &run_id_clone, &task, &model_config)
                .await;

            match &result {
                Ok(content) => {
                    tracing::info!(
                        agent_name = %agent_name_owned,
                        run_id = %run_id_clone,
                        content_len = content.len(),
                        "Run executor completed successfully"
                    );
                }
                Err(e) => {
                    tracing::error!(
                        agent_name = %agent_name_owned,
                        run_id = %run_id_clone,
                        error = %e,
                        "Run executor failed"
                    );
                }
            }

            // Determine cleanup actions via the kind
            let actions = if let Some(kind) = kind_registry.get(&kind_name) {
                kind.deinit(result.is_ok())
            } else {
                // Fallback if kind was unregistered during the run
                moxxy_runtime::agent_kind::CleanupActions {
                    unregister: false,
                    decrement_parent_spawned: false,
                    persist_conversation: true,
                    new_status: Some(if result.is_ok() { "idle" } else { "error" }.into()),
                    remove_directories: false,
                }
            };

            // Emit sub-agent completion/failure events
            if let Some(ref pid) = parent_name {
                match &result {
                    Ok(content) => {
                        event_bus_for_completion.emit(moxxy_types::EventEnvelope::new(
                            pid.clone(),
                            None,
                            None,
                            0,
                            moxxy_types::EventType::SubagentCompleted,
                            serde_json::json!({
                                "child_name": agent_name_owned,
                                "result": content,
                            }),
                        ));
                    }
                    Err(e) => {
                        event_bus_for_completion.emit(moxxy_types::EventEnvelope::new(
                            pid.clone(),
                            None,
                            None,
                            0,
                            moxxy_types::EventType::SubagentFailed,
                            serde_json::json!({
                                "child_name": agent_name_owned,
                                "error": e.to_string(),
                            }),
                        ));
                    }
                }

                tracing::info!(
                    agent_name = %agent_name_owned,
                    parent_name = %pid,
                    "Child agent run finished, cleaning up"
                );

                // Kind-specific post-run hook (e.g. hive manifest updates)
                if let Some(kind) = kind_registry.get(&kind_name) {
                    let post_paths =
                        kind.resolve_paths(&moxxy_home, &agent_name_owned, parent_name.as_deref());
                    let post_setup = AgentSetup {
                        name: agent_name_owned.clone(),
                        parent_name: parent_name.clone(),
                        host_agent_name: String::new(),
                        persona: None,
                        template_content: None,
                        temperature: 0.0,
                        paths: post_paths,
                        policy_profile: None,
                    };
                    // Build a minimal KindContext for post_run
                    let post_ctx = KindContext {
                        db: db.clone(),
                        event_bus: event_bus_for_completion.clone(),
                        vault_backend: Arc::new(moxxy_vault::InMemoryBackend::new()),
                        ask_channels: moxxy_runtime::new_ask_channels(),
                        channel_sender: None,
                        run_starter: None,
                        moxxy_home: moxxy_home.clone(),
                        embedding_svc: Arc::new(moxxy_core::MockEmbeddingService::new()),
                        base_url: String::new(),
                        webhook_index: Arc::new(RwLock::new(HashMap::new())),
                        webhook_listen_channels: moxxy_runtime::new_webhook_listen_channels(),
                    };
                    let _ = kind.post_run(&post_setup, &post_ctx, &result).await;
                }
            }

            // Store the run result so agent.status can include it
            agent_registry.set_last_result(
                &agent_name_owned,
                match &result {
                    Ok(content) => Some(content.clone()),
                    Err(e) => Some(format!("error: {e}")),
                },
            );

            // Apply cleanup actions from the kind
            if let Some(new_status) = &actions.new_status {
                agent_registry.update_status(
                    &agent_name_owned,
                    match new_status.as_str() {
                        "idle" => AgentStatus::Idle,
                        "error" => AgentStatus::Error,
                        _ => AgentStatus::Idle,
                    },
                );
            }

            if actions.persist_conversation
                && let Ok(ref content) = result
                && let Ok(db) = db.lock()
            {
                let now = chrono::Utc::now().to_rfc3339();
                // Persist the original task (without hive bootstrap prefix) so
                // that conversation history doesn't contain auto-injected
                // instructions that would be re-injected on the next run,
                // causing the queen to repeat herself.
                let _ = db
                    .conversations()
                    .insert(&moxxy_storage::rows::ConversationLogRow {
                        id: uuid::Uuid::now_v7().to_string(),
                        agent_id: agent_name_owned.clone(),
                        run_id: run_id_clone.clone(),
                        sequence: 0,
                        role: "user".into(),
                        content: original_task.clone(),
                        created_at: now.clone(),
                    });
                let _ = db
                    .conversations()
                    .insert(&moxxy_storage::rows::ConversationLogRow {
                        id: uuid::Uuid::now_v7().to_string(),
                        agent_id: agent_name_owned.clone(),
                        run_id: run_id_clone.clone(),
                        sequence: 1,
                        role: "assistant".into(),
                        content: content.clone(),
                        created_at: now,
                    });
            }

            if actions.decrement_parent_spawned
                && let Some(ref pid) = parent_name
            {
                agent_registry.decrement_spawned(pid);
            }

            if actions.unregister {
                agent_registry.unregister(&agent_name_owned);
            }

            // Auto-dismiss completed children to prevent registry leaks.
            // Only dismiss children that are no longer running (idle/error).
            let children = agent_registry.find_children(&agent_name_owned);
            for child in &children {
                if child.status != AgentStatus::Running {
                    agent_registry.unregister(&child.name);
                    agent_registry.decrement_spawned(&agent_name_owned);
                }
            }

            // Clean up cancellation token
            if let Ok(mut tokens) = run_tokens.lock() {
                tokens.remove(&agent_name_owned);
            }

            // Signal the drain loop to check the queue for this agent.
            // Only for top-level agents (sub-agents don't receive queued runs).
            if parent_name.is_none() {
                let _ = drain_tx.send(agent_name_owned.clone());
            }
        });

        Ok(run_id)
    }

    /// Resolve a pending ask question by sending the answer to the waiting primitive.
    pub fn resolve_ask(&self, question_id: &str, answer: &str) -> Result<(), String> {
        tracing::info!(
            question_id,
            answer_len = answer.len(),
            "Resolving ask question"
        );
        let sender = {
            let mut channels = self
                .ask_channels
                .lock()
                .map_err(|e| format!("lock poisoned: {e}"))?;
            channels
                .remove(question_id)
                .ok_or_else(|| format!("question_id '{question_id}' not found"))?
        };
        sender
            .send(answer.to_string())
            .map_err(|_| "receiver already dropped".to_string())
    }

    pub fn do_stop_agent(&self, agent_name: &str) -> Result<(), String> {
        tracing::info!(agent_name, "Stopping agent run");
        // Cancel the running executor if there's an active token
        if let Ok(tokens) = self.run_tokens.lock()
            && let Some(handle) = tokens.get(agent_name)
        {
            handle.token.cancel();
        }

        // Only set status for top-level agents (children are cleaned up in spawned task)
        if let Some(rt) = self.registry.get(agent_name)
            && rt.parent_name.is_none()
        {
            self.registry.update_status(agent_name, AgentStatus::Idle);
        }
        Ok(())
    }

    /// Cancel all active agent runs. Called during graceful shutdown.
    pub fn shutdown_all(&self) {
        let tokens: Vec<(String, CancellationToken)> = {
            let Ok(tokens) = self.run_tokens.lock() else {
                return;
            };
            tokens
                .iter()
                .map(|(name, handle)| (name.clone(), handle.token.clone()))
                .collect()
        };

        if tokens.is_empty() {
            return;
        }

        tracing::info!(count = tokens.len(), "Stopping all active agent runs");
        for (agent_name, token) in &tokens {
            token.cancel();
            self.registry.update_status(agent_name, AgentStatus::Idle);
        }

        // Clear all pending run queues
        if let Ok(mut q) = self.run_queue.lock() {
            q.clear();
        }
    }

    pub fn do_agent_status(&self, agent_name: &str) -> Result<Option<String>, String> {
        Ok(self
            .registry
            .get(agent_name)
            .map(|rt| rt.status.to_string()))
    }
}

/// Spawn a background loop that drains the run queue when agents become idle.
/// The loop receives agent names via `drain_rx` and starts the next queued run.
pub fn spawn_drain_loop(
    run_service: Arc<RunService>,
    mut drain_rx: mpsc::UnboundedReceiver<String>,
) {
    tokio::spawn(async move {
        while let Some(agent_name) = drain_rx.recv().await {
            let queued = run_service.dequeue_run(&agent_name);
            let Some(queued) = queued else {
                continue;
            };
            tracing::info!(
                agent_name = %agent_name,
                source = %queued.source,
                "Dequeuing pending run"
            );
            run_service.event_bus.emit(EventEnvelope::new(
                agent_name.clone(),
                None,
                None,
                0,
                EventType::RunDequeued,
                serde_json::json!({
                    "source": queued.source,
                    "metadata": queued.metadata,
                }),
            ));
            match run_service.do_start_run(&agent_name, &queued.task).await {
                Ok(run_id) => {
                    tracing::info!(
                        agent_name = %agent_name,
                        run_id = %run_id,
                        source = %queued.source,
                        "Dequeued run started"
                    );
                }
                Err(e) => {
                    tracing::warn!(
                        agent_name = %agent_name,
                        source = %queued.source,
                        error = %e,
                        "Failed to start dequeued run"
                    );
                }
            }
        }
    });
}

#[async_trait::async_trait]
impl RunStarter for RunService {
    async fn start_run(&self, agent_name: &str, task: &str) -> Result<String, String> {
        self.do_start_run(agent_name, task).await
    }

    async fn stop_agent(&self, agent_name: &str) -> Result<(), String> {
        self.do_stop_agent(agent_name)
    }

    fn agent_status(&self, agent_name: &str) -> Result<Option<String>, String> {
        self.do_agent_status(agent_name)
    }

    async fn spawn_child(
        &self,
        parent_name: &str,
        task: &str,
        opts: SpawnOpts,
    ) -> Result<SpawnResult, String> {
        // Get parent from registry
        let parent = self
            .registry
            .get(parent_name)
            .ok_or_else(|| format!("parent agent '{}' not found", parent_name))?;

        // Enforce lineage limits
        let max_depth = parent.config.max_subagent_depth as u32;
        let max_total = parent.config.max_subagents_total as u32;
        if parent.depth + 1 > max_depth {
            return Err(format!(
                "depth limit exceeded: {}/{}",
                parent.depth + 1,
                max_depth
            ));
        }
        if parent.spawned_count + 1 > max_total {
            return Err(format!(
                "total limit exceeded: {}/{}",
                parent.spawned_count + 1,
                max_total
            ));
        }

        // Generate child name - use the random tail of UUID v7
        // (the first 8 chars are the millisecond timestamp, which collides for parallel spawns)
        let uuid_str = uuid::Uuid::now_v7().to_string();
        let suffix = &uuid_str[uuid_str.len() - 8..];
        let type_tag = self
            .kind_registry
            .get(opts.agent_type.kind_name())
            .map(|k| k.child_name_tag().to_string())
            .unwrap_or_else(|| "sub".to_string());
        let child_name = format!("{}-{}-{}", parent_name, type_tag, suffix);

        // Build child config (inherit from parent, with optional model override)
        let mut child_config = parent.config.clone();
        if let Some(ref model) = opts.model_id {
            child_config.model = model.clone();
        }

        // Register child in the in-memory registry
        let child_runtime = AgentRuntime {
            name: child_name.clone(),
            agent_type: opts.agent_type,
            config: child_config,
            status: AgentStatus::Idle,
            parent_name: Some(parent_name.to_string()),
            hive_role: opts.hive_role,
            depth: parent.depth + 1,
            spawned_count: 0,
            persona: None,
            last_result: None,
        };
        self.registry
            .register(child_runtime)
            .map_err(|e| format!("failed to register child agent '{}': {}", child_name, e))?;

        // Increment parent's spawned count
        self.registry.increment_spawned(parent_name);

        // Inherit parent's allowlists file (YAML-backed)
        {
            let parent_al =
                moxxy_core::allowlist_path(&self.moxxy_home.join("agents").join(parent_name));
            let child_al =
                moxxy_core::allowlist_path(&self.moxxy_home.join("agents").join(&child_name));
            if parent_al.exists() {
                let _ = std::fs::copy(&parent_al, &child_al);
            }
        }

        // Start the child's run
        let run_id = self.do_start_run(&child_name, task).await.map_err(|e| {
            // Roll back: unregister child + decrement parent
            self.registry.unregister(&child_name);
            self.registry.decrement_spawned(parent_name);
            format!("failed to start child run: {}", e)
        })?;

        Ok(SpawnResult { child_name, run_id })
    }

    fn list_children(&self, parent_name: &str) -> Result<Vec<ChildInfo>, String> {
        let children = self.registry.find_children(parent_name);
        Ok(children
            .into_iter()
            .map(|rt| ChildInfo {
                name: rt.name,
                status: rt.status.to_string(),
                agent_type: rt.agent_type,
                hive_role: rt.hive_role,
                depth: rt.depth,
                last_result: rt.last_result,
            })
            .collect())
    }

    fn dismiss_child(&self, parent_name: &str, child_name: &str) -> Result<(), String> {
        // Verify the child belongs to this parent
        let child = self
            .registry
            .get(child_name)
            .ok_or_else(|| format!("child agent '{}' not found", child_name))?;

        if child.parent_name.as_deref() != Some(parent_name) {
            return Err(format!(
                "'{}' is not a child of '{}'",
                child_name, parent_name
            ));
        }

        if child.status == AgentStatus::Running {
            return Err(format!("cannot dismiss '{}': still running", child_name));
        }

        self.registry.unregister(child_name);
        self.registry.decrement_spawned(parent_name);
        Ok(())
    }
}
