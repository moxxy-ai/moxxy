use moxxy_channel::bridge::{ChannelBridge, ChannelSender};
use moxxy_core::{AgentRegistry, EventBus};
use moxxy_runtime::{
    AnthropicProvider, AskChannels, ChannelMessageSender, OpenAIProvider, Provider,
};
use moxxy_storage::Database;
use moxxy_types::{
    AgentRuntime, AgentStatus, AgentType, ChildInfo, MessageContent, RunStarter, SpawnOpts,
    SpawnResult,
};
use moxxy_vault::SecretBackend;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;

use crate::agent_kind;

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
    pub run_tokens: Arc<Mutex<HashMap<String, CancellationToken>>>,
    channel_sender: Mutex<Option<Arc<dyn ChannelMessageSender>>>,
    run_starter: Mutex<Option<Arc<dyn RunStarter>>>,
    vault_backend: Arc<dyn SecretBackend + Send + Sync>,
    pub ask_channels: AskChannels,
    pub moxxy_home: PathBuf,
    pub base_url: String,
}

impl RunService {
    pub fn new(
        db: Arc<Mutex<Database>>,
        registry: AgentRegistry,
        event_bus: EventBus,
        vault_backend: Arc<dyn SecretBackend + Send + Sync>,
        moxxy_home: PathBuf,
        base_url: String,
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
        }
    }

    /// Dynamically resolve a provider by looking up the provider + model in DB
    /// and retrieving the API key from the vault.
    pub fn resolve_provider(&self, provider_id: &str, model_id: &str) -> Option<Arc<dyn Provider>> {
        tracing::debug!(provider_id, model_id, "Resolving provider");
        let db = self.db.lock().ok()?;

        // Provider must exist and be enabled
        let provider_row = db.providers().find_by_id(provider_id).ok()??;
        if !provider_row.enabled {
            tracing::warn!(provider_id, "Provider is disabled");
            return None;
        }

        // Look up model metadata (api_base + optional provider-specific headers)
        let model_row = db.providers().find_model(provider_id, model_id).ok()??;
        let metadata = model_row
            .metadata_json
            .as_deref()
            .and_then(|json| serde_json::from_str::<serde_json::Value>(json).ok())
            .unwrap_or_else(|| serde_json::json!({}));
        let api_base = metadata
            .get("api_base")
            .and_then(|b| b.as_str().map(String::from))?;
        let chatgpt_account_id = metadata
            .get("chatgpt_account_id")
            .and_then(|v| v.as_str())
            .map(String::from);

        // Get API key from vault
        let vault_key = format!("moxxy_provider_{}", provider_id);
        let api_key = self.vault_backend.get_secret(&vault_key).ok()?;

        if provider_id == "anthropic" || api_base.contains("anthropic.com") {
            Some(Arc::new(AnthropicProvider::new(
                api_base, api_key, model_id,
            )))
        } else {
            Some(Arc::new(OpenAIProvider::new(
                api_base,
                api_key,
                model_id,
                chatgpt_account_id,
            )))
        }
    }

    /// Set the channel message sender. Called after the ChannelBridge is created.
    pub fn set_channel_sender(&self, sender: Arc<dyn ChannelMessageSender>) {
        *self.channel_sender.lock().unwrap() = Some(sender);
    }

    /// Set the RunStarter for sub-agent spawning. Called after AppState construction.
    pub fn set_run_starter(&self, starter: Arc<dyn RunStarter>) {
        *self.run_starter.lock().unwrap() = Some(starter);
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
            // from a previous crash — reset it so a new run can start.
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
                "Agent stuck in running status with no active run — resetting to idle"
            );
            self.registry.update_status(agent_name, AgentStatus::Idle);
        }

        self.registry
            .update_status(agent_name, AgentStatus::Running);

        let run_id = uuid::Uuid::now_v7().to_string();
        let task = task.to_string();

        // Resolve provider from config
        let provider = self
            .resolve_provider(&runtime.config.provider, &runtime.config.model)
            .or_else(|| {
                // Sub-agents may have an invalid model — fall back to parent's model
                if let Some(ref parent_name) = runtime.parent_name {
                    let parent = self.registry.get(parent_name)?;
                    tracing::warn!(
                        agent_name,
                        failed_model = %runtime.config.model,
                        fallback_model = %parent.config.model,
                        "Sub-agent model resolution failed, falling back to parent's model"
                    );
                    self.resolve_provider(&parent.config.provider, &parent.config.model)
                } else {
                    None
                }
            })
            .ok_or_else(|| {
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

        // Use the agent lifecycle trait to resolve paths and init
        let lifecycle = agent_kind::for_type(runtime.agent_type);
        let paths =
            lifecycle.resolve_paths(&self.moxxy_home, agent_name, runtime.parent_name.as_deref());
        lifecycle.init(&paths)?;

        let agents_dir = self.moxxy_home.join("agents");

        // PathPolicy: workspace_root = paths.workspace (not agent_dir), so relative
        // paths in fs.write / fs.read resolve into the workspace subdirectory.
        // core_mount = moxxy_home allows access to the agent_dir (memory, .hive, etc.)
        // deny_prefix = agents_dir prevents access to *other* agents' directories.
        let policy = moxxy_core::PathPolicy::new(
            paths.workspace.clone(),
            Some(self.moxxy_home.clone()),
            Some(agents_dir),
        );

        let journal = moxxy_core::MemoryJournal::new(paths.memory_dir.clone());
        let event_bus = self.event_bus.clone();

        let mut registry = moxxy_runtime::PrimitiveRegistry::new();

        // Filesystem primitives
        registry.register(Box::new(moxxy_runtime::FsReadPrimitive::new(
            policy.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::FsWritePrimitive::new(
            policy.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::FsListPrimitive::new(
            policy.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::FsRemovePrimitive::new(
            policy.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::FsCdPrimitive::new(
            policy.clone(),
        )));

        // Memory primitives
        registry.register(Box::new(moxxy_runtime::MemoryAppendPrimitive::new(journal)));
        registry.register(Box::new(moxxy_runtime::MemorySearchPrimitive::new(
            paths.memory_dir.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::MemorySummarizePrimitive::new(
            paths.memory_dir,
        )));

        // Resolve the "host" agent name for DB lookups (allowlists, etc.)
        // Ephemeral/HiveWorker agents inherit from their parent.
        let host_agent_name = match runtime.agent_type {
            AgentType::Agent => agent_name.to_string(),
            AgentType::Ephemeral | AgentType::HiveWorker => runtime
                .parent_name
                .as_deref()
                .unwrap_or(agent_name)
                .to_string(),
        };

        // Shell primitive (DB-backed allowlist, 300s max timeout, 1MB output cap)
        // Uses the shared cwd from PathPolicy so fs.cd affects shell.exec too.
        registry.register(Box::new(
            moxxy_runtime::ShellExecPrimitive::new(
                self.db.clone(),
                host_agent_name.clone(),
                std::time::Duration::from_secs(300),
                1024 * 1024,
            )
            .with_working_dir(policy.cwd()),
        ));

        // HTTP primitive (DB-backed domain allowlist)
        registry.register(Box::new(moxxy_runtime::HttpRequestPrimitive::new(
            self.db.clone(),
            host_agent_name.clone(),
            std::time::Duration::from_secs(30),
            5 * 1024 * 1024,
        )));

        // Skill primitives
        registry.register(Box::new(moxxy_runtime::SkillImportPrimitive::new()));
        registry.register(Box::new(moxxy_runtime::SkillValidatePrimitive::new()));

        // Notification primitives
        registry.register(Box::new(moxxy_runtime::CliNotifyPrimitive::new(
            event_bus.clone(),
        )));

        // Channel notification primitive (if channel bridge is available)
        if let Some(sender) = self.channel_sender.lock().ok().and_then(|g| g.clone()) {
            registry.register(Box::new(moxxy_runtime::ChannelNotifyPrimitive::new(
                agent_name.to_string(),
                sender,
            )));
        }

        // Browse primitives (DB-backed domain allowlist)
        registry.register(Box::new(moxxy_runtime::BrowseFetchPrimitive::new(
            self.db.clone(),
            host_agent_name.clone(),
            std::time::Duration::from_secs(30),
            10 * 1024 * 1024,
        )));
        registry.register(Box::new(moxxy_runtime::BrowseExtractPrimitive::new()));

        // Git primitives (vault-aware via PrimitiveContext, with ask support for token resolution)
        let ctx = moxxy_runtime::PrimitiveContext::new(
            self.db.clone(),
            host_agent_name.clone(),
            self.vault_backend.clone(),
        )
        .with_ask_support(self.event_bus.clone(), self.ask_channels.clone());
        registry.register(Box::new(moxxy_runtime::GitInitPrimitive::new(
            paths.workspace.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::GitClonePrimitive::new(
            ctx.clone(),
            paths.workspace.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::GitStatusPrimitive::new(
            paths.workspace.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::GitCommitPrimitive::new(
            ctx.clone(),
            paths.workspace.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::GitPushPrimitive::new(
            ctx.clone(),
            paths.workspace.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::GitCheckoutPrimitive::new(
            paths.workspace.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::GitPrCreatePrimitive::new(
            ctx.clone(),
            paths.workspace.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::GitForkPrimitive::new(ctx.clone())));

        // Vault primitives (agents can manage their own secrets)
        registry.register(Box::new(moxxy_runtime::VaultSetPrimitive::new(ctx.clone())));
        registry.register(Box::new(moxxy_runtime::VaultGetPrimitive::new(ctx.clone())));
        registry.register(Box::new(moxxy_runtime::VaultDeletePrimitive::new(
            ctx.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::VaultListPrimitive::new(
            ctx.clone(),
        )));

        // Webhook management primitives
        registry.register(Box::new(moxxy_runtime::WebhookRegisterPrimitive::new(
            self.db.clone(),
            ctx.clone(),
            host_agent_name.clone(),
            self.base_url.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::WebhookListPrimitive::new(
            self.db.clone(),
            host_agent_name.clone(),
            self.base_url.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::WebhookDeletePrimitive::new(
            self.db.clone(),
            ctx,
            host_agent_name.clone(),
        )));

        registry.register(Box::new(moxxy_runtime::GitWorktreeAddPrimitive::new(
            paths.workspace.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::GitWorktreeListPrimitive::new(
            paths.workspace.clone(),
        )));
        let workspace_path_for_prompt = paths.workspace.clone();
        registry.register(Box::new(moxxy_runtime::GitWorktreeRemovePrimitive::new(
            paths.workspace.clone(),
        )));

        // Heartbeat management primitives (agents can self-schedule)
        registry.register(Box::new(moxxy_runtime::HeartbeatCreatePrimitive::new(
            self.db.clone(),
            host_agent_name.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::HeartbeatListPrimitive::new(
            self.db.clone(),
            host_agent_name.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::HeartbeatDisablePrimitive::new(
            self.db.clone(),
            host_agent_name.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::HeartbeatDeletePrimitive::new(
            self.db.clone(),
            host_agent_name.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::HeartbeatUpdatePrimitive::new(
            self.db.clone(),
            host_agent_name.clone(),
        )));

        // Ask primitives (user.ask + agent.respond for interactive input)
        registry.register(Box::new(moxxy_runtime::UserAskPrimitive::new(
            self.event_bus.clone(),
            self.ask_channels.clone(),
            agent_name.to_string(),
        )));
        registry.register(Box::new(moxxy_runtime::AgentRespondPrimitive::new(
            self.ask_channels.clone(),
        )));

        // Track whether the analyzer suggests hive workers (set inside the match block below)
        let mut suggested_workers: Option<u32> = None;

        // Agent management primitives (using RunStarter trait)
        if let Some(starter) = self.run_starter.lock().ok().and_then(|g| g.clone()) {
            registry.register(Box::new(moxxy_runtime::AgentSpawnPrimitive::new(
                agent_name.to_string(),
                starter.clone(),
                self.event_bus.clone(),
            )));
            registry.register(Box::new(moxxy_runtime::AgentListPrimitive::new(
                agent_name.to_string(),
                starter.clone(),
            )));
            registry.register(Box::new(moxxy_runtime::AgentStatusPrimitive::new(
                agent_name.to_string(),
                starter.clone(),
                self.ask_channels.clone(),
            )));
            registry.register(Box::new(moxxy_runtime::AgentStopPrimitive::new(
                agent_name.to_string(),
                starter.clone(),
            )));
            registry.register(Box::new(moxxy_runtime::AgentDismissPrimitive::new(
                agent_name.to_string(),
                starter.clone(),
            )));

            // Allowlist management primitives
            registry.register(Box::new(moxxy_runtime::AllowlistListPrimitive::new(
                self.db.clone(),
                host_agent_name.clone(),
            )));
            registry.register(Box::new(moxxy_runtime::AllowlistAddPrimitive::new(
                self.db.clone(),
                host_agent_name.clone(),
            )));
            registry.register(Box::new(moxxy_runtime::AllowlistRemovePrimitive::new(
                self.db.clone(),
                host_agent_name.clone(),
            )));

            // Hive primitives — register based on agent type / hive state
            let workspace_dir = &paths.workspace;
            let hive_manifest_path = workspace_dir.join(".hive").join("hive.json");

            match runtime.agent_type {
                AgentType::HiveWorker => {
                    // Worker/Scout — register member primitives only
                    register_hive_member_primitives(
                        &mut registry,
                        agent_name,
                        workspace_dir,
                        &event_bus,
                    );
                }
                _ if hive_manifest_path.exists() => {
                    // Queen (resumed run) — register all hive primitives
                    register_hive_queen_primitives(
                        &mut registry,
                        agent_name,
                        workspace_dir,
                        starter,
                        &event_bus,
                    );
                }
                _ if runtime.agent_type == AgentType::Agent => {
                    // Top-level agent: run analyzer to decide hive vs single
                    let analysis =
                        crate::task_analyzer::analyze_task_complexity(&provider, &task).await;

                    event_bus.emit(moxxy_types::EventEnvelope::new(
                        agent_name.to_string(),
                        Some(run_id.clone()),
                        None,
                        0,
                        moxxy_types::EventType::TaskAnalyzed,
                        serde_json::json!({
                            "needs_hive": analysis.needs_hive,
                            "suggested_workers": analysis.suggested_workers,
                            "reasoning": analysis.reasoning,
                        }),
                    ));

                    if analysis.needs_hive {
                        // Auto-create hive manifest
                        let hive_dir = workspace_dir.join(".hive");
                        std::fs::create_dir_all(&hive_dir)
                            .map_err(|e| format!("Failed to create .hive dir: {e}"))?;
                        let store = moxxy_runtime::HiveStore::new(hive_dir);
                        let manifest = moxxy_runtime::HiveManifest {
                            id: uuid::Uuid::now_v7().to_string(),
                            queen_agent_id: agent_name.to_string(),
                            name: "auto-hive".into(),
                            status: "active".into(),
                            strategy: "task-parallel".into(),
                            members: vec![moxxy_runtime::HiveMember {
                                agent_id: agent_name.to_string(),
                                role: "queen".into(),
                                specialty: None,
                                status: "active".into(),
                            }],
                            created_at: chrono::Utc::now().to_rfc3339(),
                        };
                        store
                            .write_manifest(&manifest)
                            .map_err(|e| format!("Failed to write hive manifest: {e}"))?;

                        event_bus.emit(moxxy_types::EventEnvelope::new(
                            agent_name.to_string(),
                            Some(run_id.clone()),
                            None,
                            0,
                            moxxy_types::EventType::HiveCreated,
                            serde_json::json!({ "hive_id": manifest.id }),
                        ));

                        suggested_workers = Some(analysis.suggested_workers);

                        register_hive_queen_primitives(
                            &mut registry,
                            agent_name,
                            workspace_dir,
                            starter,
                            &event_bus,
                        );
                    }
                    // If single: no hive primitives registered at all
                }
                _ => {
                    // Ephemeral sub-agents: no hive primitives
                }
            }
        }

        // Primitive allowlist: read from DB; if empty → all registered (backwards-compatible)
        let allowed_primitives: Vec<String> = {
            let db_entries = self
                .db
                .lock()
                .ok()
                .and_then(|db| {
                    db.allowlists()
                        .list_entries(&host_agent_name, "primitive")
                        .ok()
                })
                .unwrap_or_default();
            if db_entries.is_empty() {
                registry.list().iter().map(|s| s.to_string()).collect()
            } else {
                db_entries
            }
        };

        let agent_name_owned = agent_name.to_string();
        let agent_type = runtime.agent_type;
        let parent_name = runtime.parent_name.clone();
        let run_id_clone = run_id.clone();
        let db = self.db.clone();
        let temperature = runtime.config.temperature;
        let agent_persona = runtime.persona.clone();
        let agent_home = paths.agent_dir.clone();
        let workspace_for_hive = paths.workspace.clone();
        let workspace_for_prompt = workspace_path_for_prompt;
        let agent_registry = self.registry.clone();

        // Create cancellation token for this run
        let cancel_token = CancellationToken::new();
        if let Ok(mut tokens) = self.run_tokens.lock() {
            tokens.insert(agent_name_owned.clone(), cancel_token.clone());
        }
        let run_tokens = self.run_tokens.clone();

        tokio::spawn(async move {
            tracing::info!(
                agent_name = %agent_name_owned,
                run_id = %run_id_clone,
                "Run executor starting"
            );

            // Build system prompt from agent config
            let mut system_prompt = String::new();
            if let Some(ref persona) = agent_persona {
                system_prompt.push_str(persona);
                system_prompt.push_str("\n\n");
            }
            let agent_home_display = agent_home.display();
            let workspace_display = workspace_for_prompt.display().to_string();
            system_prompt.push_str(&format!(
                "You are a Moxxy agent (name: {agent_name_owned}).\n\
                 Your home directory is: {agent_home_display}.\n\
                 Your workspace directory is: {workspace_display}\n\n\
                 IMPORTANT — Path rules:\n\
                 - All project files, repositories, and generated content MUST be created inside {workspace_display}/.\n\
                 - When creating a new project, use {workspace_display}/<project_name>/ as the root.\n\
                 - Memory files are stored in {agent_home_display}/memory/ (managed by memory primitives).\n\
                 - Never create, read, or write files outside of {agent_home_display}.\n\
                 - File primitives (fs.read, fs.write, fs.list, fs.remove) accept both relative and absolute paths. Relative paths are resolved against {workspace_display}/. For example, \"project/src/main.rs\" resolves to \"{workspace_display}/project/src/main.rs\".\n\
                 - Git operations require absolute paths.\n\
                 - Shell commands execute with {workspace_display} as the working directory.\n\n"
            ));

            // Group tools by category with descriptions
            type Category = (
                &'static str,
                &'static str,
                &'static [(&'static str, &'static str)],
            );
            system_prompt.push_str("Your capabilities:\n");
            let categories: &[Category] = &[
                (
                    "browse",
                    "Web browsing",
                    &[
                        ("browse.fetch", "fetch web pages and extract content"),
                        ("browse.extract", "parse HTML with CSS selectors"),
                    ],
                ),
                (
                    "fs",
                    "Files (workspace-scoped)",
                    &[
                        ("fs.read", "read files"),
                        ("fs.write", "write files"),
                        ("fs.list", "list directory contents"),
                        ("fs.remove", "remove files and directories"),
                    ],
                ),
                ("shell", "Shell", &[("shell.exec", "run terminal commands")]),
                (
                    "http",
                    "HTTP",
                    &[("http.request", "call APIs and fetch URLs")],
                ),
                (
                    "memory",
                    "Memory",
                    &[
                        ("memory.append", "store information"),
                        ("memory.search", "recall stored information"),
                        ("memory.summarize", "summarize memory contents"),
                    ],
                ),
                (
                    "git",
                    "Git",
                    &[
                        ("git.init", "init"),
                        ("git.clone", "clone"),
                        ("git.status", "status"),
                        ("git.commit", "commit"),
                        ("git.push", "push"),
                        ("git.checkout", "checkout"),
                        ("git.pr_create", "create PRs"),
                        ("git.fork", "fork repos"),
                        ("git.worktree_add", "add worktree"),
                        ("git.worktree_list", "list worktrees"),
                        ("git.worktree_remove", "remove worktree"),
                    ],
                ),
                (
                    "vault",
                    "Secrets",
                    &[
                        ("vault.set", "store"),
                        ("vault.get", "retrieve"),
                        ("vault.delete", "delete"),
                        ("vault.list", "list"),
                    ],
                ),
                (
                    "heartbeat",
                    "Scheduling",
                    &[
                        ("heartbeat.create", "create"),
                        ("heartbeat.list", "list"),
                        ("heartbeat.update", "update"),
                        ("heartbeat.disable", "disable"),
                        ("heartbeat.delete", "delete"),
                    ],
                ),
                (
                    "agent",
                    "Sub-agents (auto-cleaned up when their run completes)",
                    &[
                        ("agent.spawn", "spawn"),
                        ("agent.status", "check status"),
                        ("agent.list", "list"),
                        ("agent.stop", "stop"),
                        ("agent.dismiss", "manually dismiss a sub-agent"),
                    ],
                ),
                (
                    "ask",
                    "Interactive",
                    &[
                        ("user.ask", "ask user for input"),
                        ("agent.respond", "respond to questions"),
                    ],
                ),
                (
                    "skill",
                    "Skills",
                    &[("skill.import", "import"), ("skill.validate", "validate")],
                ),
                ("notify", "Notifications", &[("notify.cli", "notify CLI")]),
                (
                    "channel",
                    "Channels",
                    &[("channel.notify", "send messages to channels")],
                ),
                (
                    "webhook",
                    "Inbound webhooks",
                    &[
                        ("webhook.register", "register inbound endpoint"),
                        ("webhook.list", "list endpoints"),
                        ("webhook.delete", "delete endpoint"),
                    ],
                ),
                (
                    "allowlist",
                    "Allowlists",
                    &[
                        ("allowlist.list", "list entries"),
                        ("allowlist.add", "add entries"),
                        ("allowlist.remove", "remove entries"),
                    ],
                ),
                (
                    "hive",
                    "Hive Swarm (multi-agent coordination)",
                    &[
                        ("hive.create", "create a hive (you become queen)"),
                        ("hive.recruit", "recruit a worker into the hive"),
                        ("hive.task_create", "create a task"),
                        ("hive.assign", "assign a task to a member"),
                        ("hive.aggregate", "get full hive snapshot"),
                        ("hive.resolve_proposal", "resolve a proposal"),
                        ("hive.disband", "disband the hive"),
                        ("hive.signal", "post a signal to the board"),
                        ("hive.board_read", "read signals from the board"),
                        ("hive.task_list", "list tasks"),
                        ("hive.task_claim", "claim an unassigned task"),
                        ("hive.task_complete", "mark task completed"),
                        ("hive.propose", "create a proposal"),
                        ("hive.vote", "vote on a proposal"),
                    ],
                ),
            ];

            for (_, label, tools) in categories {
                let available: Vec<&str> = tools
                    .iter()
                    .filter(|(name, _)| allowed_primitives.iter().any(|p| p == name))
                    .map(|(name, _)| *name)
                    .collect();
                if available.is_empty() {
                    continue;
                }
                system_prompt.push_str(&format!("- {label}: {}\n", available.join(", ")));
            }

            // Hive workflow instructions (conditional on role)
            let has_recruit = allowed_primitives.iter().any(|p| p == "hive.recruit");
            let has_task_claim = allowed_primitives.iter().any(|p| p == "hive.task_claim");
            if has_recruit {
                system_prompt.push_str(
                    "\n## Hive Queen Workflow (MANDATORY)\n\
                     You are the hive queen. You MUST recruit workers — do NOT do the work yourself. Your role is coordination only.\n\
                     1. hive.task_create to define tasks — use depends_on for ordering (foundation tasks before dependent work)\n\
                     2. hive.recruit to spawn workers — call this for EACH task. Workers are fully functional agents that will execute the work. This tool works reliably.\n\
                     3. Stay active — do NOT produce final text until all workers finish\n\
                     4. You'll receive [Hive task ...] and [Sub-agent ...] notifications automatically\n\
                     5. hive.aggregate for full snapshot when done\n\
                     6. Synthesize results, then hive.disband\n\n\
                     IMPORTANT: Do NOT skip recruiting. Do NOT do the implementation yourself. Do NOT claim workers cannot be spawned — hive.recruit is a working tool available to you. Call it.\n",
                );
                if let Some(workers) = suggested_workers {
                    system_prompt.push_str(&format!(
                        "\nThe task has been analyzed and {} parallel workers are suggested. \
                         Create tasks first with hive.task_create, then recruit workers with hive.recruit. You MUST recruit at least {} workers.\n",
                        workers, workers
                    ));
                }
            } else if has_task_claim {
                system_prompt.push_str(
                    "\n## Hive Worker Workflow\n\
                     1. hive.task_list to see tasks\n\
                     2. hive.task_claim to claim a pending task\n\
                     3. Do the work using available tools\n\
                     4. hive.task_complete with result_summary\n\
                     5. Check hive.task_list for more unclaimed tasks\n\
                     6. hive.signal to share findings\n",
                );
            }

            system_prompt.push_str(
                "\nGuidelines:\n\
                 - You are an autonomous agent. For every task, you MUST use your tools to accomplish it. Do NOT just describe or plan what you would do — actually execute it step by step using tool calls.\n\
                 - For complex or multi-step tasks, break them down and work through each step iteratively. Call tools, read their results, then decide the next action. You can run many iterations.\n\
                 - Proactively use your tools. If asked to look something up, fetch a URL, or find information — use browse.fetch or http.request.\n\
                 - Read files before modifying them.\n\
                 - If a tool fails, analyze the error and try alternatives.\n\
                 - NEVER use paths outside your workspace. For file operations (fs.*), use relative paths like \"output.png\" or \"src/index.html\" — they are automatically resolved against your workspace. Do NOT use ~/Desktop, /tmp, /Users, or any other location.\n\
                 - Git operations that require authentication (push, clone private repos, PR create, fork) will automatically prompt the user for a GitHub token if one is not already stored in the vault. You do NOT need to manually call user.ask for the token — the git primitives handle this automatically.\n\n\
                 CRITICAL — Truthfulness & Verification:\n\
                 - NEVER claim you have done something unless you actually executed it via tool calls and received successful results. Your claims must be backed by actual tool call outputs in the conversation.\n\
                 - Before reporting completion, VERIFY your work: use fs.list or fs.read to confirm files were actually created/modified, use shell.exec to confirm commands succeeded, etc.\n\
                 - If you could not complete a task or part of it, say so explicitly. Never fabricate results or claim success when a tool call failed or was never made.\n\
                 - Do NOT say \"Done\" or \"Implemented\" as a one-word answer. Always provide a factual summary listing the specific files created/modified and actions taken, referencing actual tool results.\n\
                 - If you are unsure whether something worked, check. Do not assume success — verify it.\n\
                 - NEVER hallucinate file contents, command outputs, or results. Every fact you state must come from an actual tool call response in this conversation.\n\
                 - When you have completed ALL the work, provide a concise but specific summary of what you accomplished: list files created/modified, commands run, and key results. Every claim must correspond to a tool call you actually made.",
            );

            // Load STM history for top-level agents (sub-agents are ephemeral)
            let history_messages: Vec<moxxy_runtime::Message> = if parent_name.is_none() {
                db.lock()
                    .ok()
                    .and_then(|db| {
                        db.conversations()
                            .find_recent_by_agent(&agent_name_owned, 20)
                            .ok()
                    })
                    .unwrap_or_default()
                    .into_iter()
                    .map(|row| match row.role.as_str() {
                        "assistant" => moxxy_runtime::Message::assistant(row.content),
                        _ => moxxy_runtime::Message::user(row.content),
                    })
                    .collect()
            } else {
                Vec::new()
            };

            let event_bus_for_completion = event_bus.clone();
            let mut executor =
                moxxy_runtime::RunExecutor::new(event_bus, provider, registry, allowed_primitives)
                    .with_system_prompt(system_prompt)
                    .with_history(history_messages)
                    .with_cancel_token(cancel_token)
                    .with_timeout(std::time::Duration::from_secs(300));

            let model_config = moxxy_runtime::ModelConfig {
                temperature,
                max_tokens: 4096,
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

            // Use the lifecycle trait to determine cleanup actions
            let lifecycle = agent_kind::for_type(agent_type);
            let actions = lifecycle.deinit(result.is_ok());

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

                // Hive membership cleanup: update queen's manifest
                if agent_type == AgentType::HiveWorker {
                    let hive_path = workspace_for_hive.join(".hive");
                    if hive_path.exists() {
                        let store = moxxy_runtime::HiveStore::new(hive_path);
                        if let Ok(mut manifest) = store.read_manifest() {
                            let new_status = if result.is_ok() {
                                "completed"
                            } else {
                                "failed"
                            };
                            for m in &mut manifest.members {
                                if m.agent_id == agent_name_owned {
                                    m.status = new_status.into();
                                }
                            }
                            let _ = store.write_manifest(&manifest);

                            // Abandon any in-progress tasks
                            if let Ok(tasks) = store.list_tasks(Some("in_progress")) {
                                for mut task in tasks {
                                    if task.assigned_agent_id.as_deref() == Some(&agent_name_owned)
                                    {
                                        task.assigned_agent_id = None;
                                        task.status = "pending".into();
                                        task.updated_at = chrono::Utc::now().to_rfc3339();
                                        let _ = store.write_task(&task);
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Apply cleanup actions from the lifecycle trait
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
                let _ = db
                    .conversations()
                    .insert(&moxxy_storage::rows::ConversationLogRow {
                        id: uuid::Uuid::now_v7().to_string(),
                        agent_id: agent_name_owned.clone(),
                        run_id: run_id_clone.clone(),
                        sequence: 0,
                        role: "user".into(),
                        content: task.clone(),
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

            // Clean up cancellation token
            if let Ok(mut tokens) = run_tokens.lock() {
                tokens.remove(&agent_name_owned);
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
            && let Some(token) = tokens.get(agent_name)
        {
            token.cancel();
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
                .map(|(name, token)| (name.clone(), token.clone()))
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
    }

    pub fn do_agent_status(&self, agent_name: &str) -> Result<Option<String>, String> {
        Ok(self
            .registry
            .get(agent_name)
            .map(|rt| rt.status.to_string()))
    }
}

/// Helper: register queen-level hive primitives (recruit, task_create, assign, etc.) plus member primitives.
fn register_hive_queen_primitives(
    registry: &mut moxxy_runtime::PrimitiveRegistry,
    agent_name: &str,
    workspace_dir: &std::path::Path,
    starter: Arc<dyn RunStarter>,
    event_bus: &EventBus,
) {
    registry.register(Box::new(moxxy_runtime::HiveRecruitPrimitive::new(
        agent_name.to_string(),
        workspace_dir.to_path_buf(),
        starter.clone(),
        event_bus.clone(),
    )));
    registry.register(Box::new(moxxy_runtime::HiveTaskCreatePrimitive::new(
        agent_name.to_string(),
        workspace_dir.to_path_buf(),
        event_bus.clone(),
    )));
    registry.register(Box::new(moxxy_runtime::HiveAssignPrimitive::new(
        agent_name.to_string(),
        workspace_dir.to_path_buf(),
    )));
    registry.register(Box::new(moxxy_runtime::HiveAggregatePrimitive::new(
        agent_name.to_string(),
        workspace_dir.to_path_buf(),
    )));
    registry.register(Box::new(moxxy_runtime::HiveResolveProposalPrimitive::new(
        agent_name.to_string(),
        workspace_dir.to_path_buf(),
        event_bus.clone(),
    )));
    registry.register(Box::new(moxxy_runtime::HiveDisbandPrimitive::new(
        agent_name.to_string(),
        workspace_dir.to_path_buf(),
        starter,
        event_bus.clone(),
    )));
    register_hive_member_primitives(registry, agent_name, workspace_dir, event_bus);
}

/// Helper: register hive member primitives (shared by queen and worker roles).
fn register_hive_member_primitives(
    registry: &mut moxxy_runtime::PrimitiveRegistry,
    agent_name: &str,
    workspace_dir: &std::path::Path,
    event_bus: &EventBus,
) {
    registry.register(Box::new(moxxy_runtime::HiveSignalPrimitive::new(
        agent_name.to_string(),
        workspace_dir.to_path_buf(),
        event_bus.clone(),
    )));
    registry.register(Box::new(moxxy_runtime::HiveBoardReadPrimitive::new(
        workspace_dir.to_path_buf(),
    )));
    registry.register(Box::new(moxxy_runtime::HiveTaskListPrimitive::new(
        workspace_dir.to_path_buf(),
    )));
    registry.register(Box::new(moxxy_runtime::HiveTaskClaimPrimitive::new(
        agent_name.to_string(),
        workspace_dir.to_path_buf(),
        event_bus.clone(),
    )));
    registry.register(Box::new(moxxy_runtime::HiveTaskCompletePrimitive::new(
        agent_name.to_string(),
        workspace_dir.to_path_buf(),
        event_bus.clone(),
    )));
    registry.register(Box::new(moxxy_runtime::HiveProposePrimitive::new(
        agent_name.to_string(),
        workspace_dir.to_path_buf(),
        event_bus.clone(),
    )));
    registry.register(Box::new(moxxy_runtime::HiveVotePrimitive::new(
        agent_name.to_string(),
        workspace_dir.to_path_buf(),
        event_bus.clone(),
    )));
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

        // Generate child name — use the random tail of UUID v7
        // (the first 8 chars are the millisecond timestamp, which collides for parallel spawns)
        let uuid_str = uuid::Uuid::now_v7().to_string();
        let suffix = &uuid_str[uuid_str.len() - 8..];
        let type_tag = match opts.agent_type {
            AgentType::HiveWorker => "worker",
            _ => "sub",
        };
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
        };
        self.registry
            .register(child_runtime)
            .map_err(|e| format!("failed to register child agent '{}': {}", child_name, e))?;

        // Increment parent's spawned count
        self.registry.increment_spawned(parent_name);

        // Inherit parent's allowlists in DB
        let _ = self.db.lock().ok().map(|db| {
            let _ = db.allowlists().copy_from_agent(parent_name, &child_name);
        });

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
