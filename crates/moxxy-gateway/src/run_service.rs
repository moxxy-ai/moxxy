use moxxy_channel::bridge::{ChannelBridge, ChannelSender};
use moxxy_core::EventBus;
use moxxy_runtime::{
    AnthropicProvider, AskChannels, ChannelMessageSender, OpenAIProvider, Provider,
};
use moxxy_storage::Database;
use moxxy_types::{MessageContent, RunStarter};
use moxxy_vault::SecretBackend;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;

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
        event_bus: EventBus,
        vault_backend: Arc<dyn SecretBackend + Send + Sync>,
        moxxy_home: PathBuf,
        base_url: String,
    ) -> Self {
        Self {
            db,
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
    /// This contains the full run-start logic including all primitive registrations.
    pub async fn do_start_run(&self, agent_id: &str, task: &str) -> Result<String, String> {
        let agent = {
            let db = self.db.lock().map_err(|e| e.to_string())?;
            let agent = db
                .agents()
                .find_by_id(agent_id)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "Agent not found".to_string())?;

            if agent.status == "running" {
                // Check if there is an active run. If not, the agent is stuck
                // from a previous crash = reset it so a new run can start.
                let has_active_run = self
                    .run_tokens
                    .lock()
                    .ok()
                    .is_some_and(|t| t.contains_key(agent_id));
                if has_active_run {
                    return Err("Agent is already running".to_string());
                }
                tracing::warn!(
                    agent_id,
                    "Agent stuck in running status with no active run = resetting to idle"
                );
                db.agents()
                    .update_status(&agent.id, "idle")
                    .map_err(|e| e.to_string())?;
            }

            db.agents()
                .update_status(&agent.id, "running")
                .map_err(|e| e.to_string())?;
            agent
        };

        let run_id = uuid::Uuid::now_v7().to_string();
        let task = task.to_string();

        let provider = self
            .resolve_provider(&agent.provider_id, &agent.model_id)
            .or_else(|| {
                // Sub-agents may have an invalid model_id (e.g. LLM hallucinated the name).
                // Fall back to the parent's model if resolution fails.
                if let Some(ref parent_id) = agent.parent_agent_id {
                    let db = self.db.lock().ok()?;
                    let parent = db.providers().find_model(
                        &agent.provider_id,
                        &db.agents().find_by_id(parent_id).ok()??.model_id,
                    ).ok()??;
                    drop(db);
                    tracing::warn!(
                        agent_id,
                        failed_model = %agent.model_id,
                        fallback_model = %parent.model_id,
                        "Sub-agent model resolution failed, falling back to parent's model"
                    );
                    self.resolve_provider(&agent.provider_id, &parent.model_id)
                } else {
                    None
                }
            })
            .ok_or_else(|| {
                format!(
                    "Could not resolve provider '{}' with model '{}'. \
                     Check that the provider is installed, enabled, and has a valid API key/secret in the vault.",
                    agent.provider_id, agent.model_id
                )
            })?;

        tracing::info!(
            agent_id,
            provider_id = %agent.provider_id,
            "Using registered provider"
        );

        let agent_dir = self.moxxy_home.join("agents").join(&agent.id);
        let agents_dir = self.moxxy_home.join("agents");
        let workspace_path = agent_dir.join("workspace");
        // Ensure agent directories exist
        std::fs::create_dir_all(&workspace_path).ok();
        std::fs::create_dir_all(agent_dir.join("memory")).ok();
        let policy = moxxy_core::PathPolicy::new(
            agent_dir.clone(),
            Some(self.moxxy_home.clone()),
            Some(agents_dir),
        );

        // Memory directory: {agent_dir}/memory
        let memory_base = agent_dir.join("memory");
        let journal = moxxy_core::MemoryJournal::new(memory_base.clone());

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
        registry.register(Box::new(moxxy_runtime::FsRemovePrimitive::new(policy)));

        // Memory primitives
        registry.register(Box::new(moxxy_runtime::MemoryAppendPrimitive::new(journal)));
        registry.register(Box::new(moxxy_runtime::MemorySearchPrimitive::new(
            memory_base.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::MemorySummarizePrimitive::new(
            memory_base,
        )));

        // Shell primitive (DB-backed allowlist, 300s max timeout, 1MB output cap)
        registry.register(Box::new(
            moxxy_runtime::ShellExecPrimitive::new(
                self.db.clone(),
                agent.id.clone(),
                std::time::Duration::from_secs(300),
                1024 * 1024,
            )
            .with_working_dir(workspace_path.clone()),
        ));

        // HTTP primitive (DB-backed domain allowlist)
        registry.register(Box::new(moxxy_runtime::HttpRequestPrimitive::new(
            self.db.clone(),
            agent.id.clone(),
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
                agent.id.clone(),
                sender,
            )));
        }

        // Browse primitives (DB-backed domain allowlist)
        registry.register(Box::new(moxxy_runtime::BrowseFetchPrimitive::new(
            self.db.clone(),
            agent.id.clone(),
            std::time::Duration::from_secs(30),
            10 * 1024 * 1024,
        )));
        registry.register(Box::new(moxxy_runtime::BrowseExtractPrimitive::new()));

        // Git primitives (vault-aware via PrimitiveContext, with ask support for token resolution)
        let ctx = moxxy_runtime::PrimitiveContext::new(
            self.db.clone(),
            agent.id.clone(),
            self.vault_backend.clone(),
        )
        .with_ask_support(self.event_bus.clone(), self.ask_channels.clone());
        registry.register(Box::new(moxxy_runtime::GitInitPrimitive::new(
            workspace_path.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::GitClonePrimitive::new(
            ctx.clone(),
            workspace_path.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::GitStatusPrimitive::new(
            workspace_path.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::GitCommitPrimitive::new(
            ctx.clone(),
            workspace_path.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::GitPushPrimitive::new(
            ctx.clone(),
            workspace_path.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::GitCheckoutPrimitive::new(
            workspace_path.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::GitPrCreatePrimitive::new(
            ctx.clone(),
            workspace_path.clone(),
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

        // Webhook management primitives (agents can register/list/delete inbound webhooks)
        registry.register(Box::new(moxxy_runtime::WebhookRegisterPrimitive::new(
            self.db.clone(),
            ctx.clone(),
            agent.id.clone(),
            self.base_url.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::WebhookListPrimitive::new(
            self.db.clone(),
            agent.id.clone(),
            self.base_url.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::WebhookDeletePrimitive::new(
            self.db.clone(),
            ctx,
            agent.id.clone(),
        )));

        registry.register(Box::new(moxxy_runtime::GitWorktreeAddPrimitive::new(
            workspace_path.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::GitWorktreeListPrimitive::new(
            workspace_path.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::GitWorktreeRemovePrimitive::new(
            workspace_path,
        )));

        // Heartbeat management primitives (agents can self-schedule)
        registry.register(Box::new(moxxy_runtime::HeartbeatCreatePrimitive::new(
            self.db.clone(),
            agent.id.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::HeartbeatListPrimitive::new(
            self.db.clone(),
            agent.id.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::HeartbeatDisablePrimitive::new(
            self.db.clone(),
            agent.id.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::HeartbeatDeletePrimitive::new(
            self.db.clone(),
            agent.id.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::HeartbeatUpdatePrimitive::new(
            self.db.clone(),
            agent.id.clone(),
        )));

        // Ask primitives (user.ask + agent.respond for interactive input)
        registry.register(Box::new(moxxy_runtime::UserAskPrimitive::new(
            self.event_bus.clone(),
            self.ask_channels.clone(),
            agent.id.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::AgentRespondPrimitive::new(
            self.ask_channels.clone(),
        )));

        // Agent management primitives (spawn, status, list, stop)
        registry.register(Box::new(moxxy_runtime::AgentListPrimitive::new(
            self.db.clone(),
            agent.id.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::AgentStatusPrimitive::new(
            self.db.clone(),
            agent.id.clone(),
            self.ask_channels.clone(),
        )));
        // Allowlist management primitives (agents can manage their own allowlists)
        registry.register(Box::new(moxxy_runtime::AllowlistListPrimitive::new(
            self.db.clone(),
            agent.id.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::AllowlistAddPrimitive::new(
            self.db.clone(),
            agent.id.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::AllowlistRemovePrimitive::new(
            self.db.clone(),
            agent.id.clone(),
        )));

        registry.register(Box::new(moxxy_runtime::AgentDismissPrimitive::new(
            self.db.clone(),
            agent.id.clone(),
        )));

        if let Some(starter) = self.run_starter.lock().ok().and_then(|g| g.clone()) {
            registry.register(Box::new(moxxy_runtime::AgentSpawnPrimitive::new(
                self.db.clone(),
                agent.id.clone(),
                starter.clone(),
                self.event_bus.clone(),
                self.moxxy_home.clone(),
            )));
            registry.register(Box::new(moxxy_runtime::AgentStopPrimitive::new(
                self.db.clone(),
                agent.id.clone(),
                starter.clone(),
            )));

            // Hive primitives — register based on role detection
            let hive_manifest_path = agent_dir.join(".hive").join("hive.json");
            let membership_path = agent_dir.join(".hive_membership.json");

            if hive_manifest_path.exists() {
                // Queen — register all hive primitives except hive.create
                registry.register(Box::new(moxxy_runtime::HiveRecruitPrimitive::new(
                    self.db.clone(),
                    agent.id.clone(),
                    agent_dir.clone(),
                    starter.clone(),
                    event_bus.clone(),
                    self.moxxy_home.clone(),
                )));
                registry.register(Box::new(moxxy_runtime::HiveTaskCreatePrimitive::new(
                    agent.id.clone(),
                    agent_dir.clone(),
                )));
                registry.register(Box::new(moxxy_runtime::HiveAssignPrimitive::new(
                    agent.id.clone(),
                    agent_dir.clone(),
                )));
                registry.register(Box::new(moxxy_runtime::HiveAggregatePrimitive::new(
                    agent.id.clone(),
                    agent_dir.clone(),
                )));
                registry.register(Box::new(moxxy_runtime::HiveResolveProposalPrimitive::new(
                    agent.id.clone(),
                    agent_dir.clone(),
                    event_bus.clone(),
                )));
                registry.register(Box::new(moxxy_runtime::HiveDisbandPrimitive::new(
                    agent.id.clone(),
                    agent_dir.clone(),
                    starter,
                    event_bus.clone(),
                )));
                // Queen also gets member primitives
                registry.register(Box::new(moxxy_runtime::HiveSignalPrimitive::new(
                    agent.id.clone(),
                    agent_dir.clone(),
                    event_bus.clone(),
                )));
                registry.register(Box::new(moxxy_runtime::HiveBoardReadPrimitive::new(
                    agent_dir.clone(),
                )));
                registry.register(Box::new(moxxy_runtime::HiveTaskListPrimitive::new(
                    agent_dir.clone(),
                )));
                registry.register(Box::new(moxxy_runtime::HiveTaskClaimPrimitive::new(
                    agent.id.clone(),
                    agent_dir.clone(),
                )));
                registry.register(Box::new(moxxy_runtime::HiveTaskCompletePrimitive::new(
                    agent.id.clone(),
                    agent_dir.clone(),
                    event_bus.clone(),
                )));
                registry.register(Box::new(moxxy_runtime::HiveProposePrimitive::new(
                    agent.id.clone(),
                    agent_dir.clone(),
                    event_bus.clone(),
                )));
                registry.register(Box::new(moxxy_runtime::HiveVotePrimitive::new(
                    agent.id.clone(),
                    agent_dir.clone(),
                    event_bus.clone(),
                )));
            } else if membership_path.exists() {
                // Worker/Scout — register member primitives only
                registry.register(Box::new(moxxy_runtime::HiveSignalPrimitive::new(
                    agent.id.clone(),
                    agent_dir.clone(),
                    event_bus.clone(),
                )));
                registry.register(Box::new(moxxy_runtime::HiveBoardReadPrimitive::new(
                    agent_dir.clone(),
                )));
                registry.register(Box::new(moxxy_runtime::HiveTaskListPrimitive::new(
                    agent_dir.clone(),
                )));
                registry.register(Box::new(moxxy_runtime::HiveTaskClaimPrimitive::new(
                    agent.id.clone(),
                    agent_dir.clone(),
                )));
                registry.register(Box::new(moxxy_runtime::HiveTaskCompletePrimitive::new(
                    agent.id.clone(),
                    agent_dir.clone(),
                    event_bus.clone(),
                )));
                registry.register(Box::new(moxxy_runtime::HiveProposePrimitive::new(
                    agent.id.clone(),
                    agent_dir.clone(),
                    event_bus.clone(),
                )));
                registry.register(Box::new(moxxy_runtime::HiveVotePrimitive::new(
                    agent.id.clone(),
                    agent_dir.clone(),
                    event_bus.clone(),
                )));
            } else {
                // Not in a hive — only register hive.create
                registry.register(Box::new(moxxy_runtime::HiveCreatePrimitive::new(
                    agent.id.clone(),
                    agent_dir.clone(),
                    event_bus.clone(),
                )));
            }
        }

        // Primitive allowlist: read from DB; if empty → all registered (backwards-compatible)
        let allowed_primitives: Vec<String> = {
            let db_entries = self
                .db
                .lock()
                .ok()
                .and_then(|db| db.allowlists().list_entries(&agent.id, "primitive").ok())
                .unwrap_or_default();
            if db_entries.is_empty() {
                registry.list().iter().map(|s| s.to_string()).collect()
            } else {
                db_entries
            }
        };

        let agent_id_owned = agent.id.clone();
        let run_id_clone = run_id.clone();
        let db = self.db.clone();
        let temperature = agent.temperature;
        let agent_persona = agent.persona.clone();
        let agent_home = agent_dir;
        let parent_agent_id = agent.parent_agent_id.clone();

        // Create cancellation token for this run
        let cancel_token = CancellationToken::new();
        if let Ok(mut tokens) = self.run_tokens.lock() {
            tokens.insert(agent_id_owned.clone(), cancel_token.clone());
        }
        let run_tokens = self.run_tokens.clone();

        tokio::spawn(async move {
            tracing::info!(
                agent_id = %agent_id_owned,
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
            let workspace_display = agent_home.join("workspace").display().to_string();
            system_prompt.push_str(&format!(
                "You are a Moxxy agent (id: {agent_id_owned}).\n\
                 Your home directory is: {agent_home_display} (based on your agent ID, not your name).\n\
                 Your workspace directory is: {workspace_display}\n\n\
                 IMPORTANT = Path rules:\n\
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
                    "Sub-agents (auto-cleaned up when their run completes). agent.spawn accepts optional repo_path to create a git worktree for isolated branch work",
                    &[
                        ("agent.spawn", "spawn (with optional git worktree)"),
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

            system_prompt.push_str(
                "\nGuidelines:\n\
                 - You are an autonomous agent. For every task, you MUST use your tools to accomplish it. Do NOT just describe or plan what you would do = actually execute it step by step using tool calls.\n\
                 - For complex or multi-step tasks, break them down and work through each step iteratively. Call tools, read their results, then decide the next action. You can run many iterations.\n\
                 - Proactively use your tools. If asked to look something up, fetch a URL, or find information = use browse.fetch or http.request.\n\
                 - Read files before modifying them.\n\
                 - If a tool fails, analyze the error and try alternatives.\n\
                 - NEVER use paths outside your workspace. For file operations (fs.*), use relative paths like \"output.png\" or \"src/index.html\" = they are automatically resolved against your workspace. Do NOT use ~/Desktop, /tmp, /Users, or any other location.\n\
                 - Git operations that require authentication (push, clone private repos, PR create, fork) will automatically prompt the user for a GitHub token if one is not already stored in the vault. You do NOT need to manually call user.ask for the token = the git primitives handle this automatically.\n\
                 - When you have completed ALL the work, provide a concise text summary of what you accomplished and the results.",
            );

            // Load STM history for top-level agents (sub-agents are ephemeral)
            let history_messages: Vec<moxxy_runtime::Message> = if parent_agent_id.is_none() {
                db.lock()
                    .ok()
                    .and_then(|db| {
                        db.conversations()
                            .find_recent_by_agent(&agent_id_owned, 20)
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
            let executor =
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
                .execute(&agent_id_owned, &run_id_clone, &task, &model_config)
                .await;

            match &result {
                Ok(content) => {
                    tracing::info!(
                        agent_id = %agent_id_owned,
                        run_id = %run_id_clone,
                        content_len = content.len(),
                        "Run executor completed successfully"
                    );
                }
                Err(e) => {
                    tracing::error!(
                        agent_id = %agent_id_owned,
                        run_id = %run_id_clone,
                        error = %e,
                        "Run executor failed"
                    );
                }
            }

            // Clean up git worktrees before acquiring the DB lock.
            // Worktrees are identified by a `.git` *file* (not directory)
            // that points back to the main repo's git dir.
            if parent_agent_id.is_some() {
                let ws = agent_home.join("workspace");
                if let Ok(entries) = std::fs::read_dir(&ws) {
                    for entry in entries.flatten() {
                        let git_file = entry.path().join(".git");
                        if git_file.is_file() {
                            let worktree_path = entry.path();
                            tracing::debug!(
                                worktree = %worktree_path.display(),
                                "Removing git worktree for sub-agent"
                            );
                            let _ = tokio::process::Command::new("git")
                                .args(["worktree", "remove", "--force"])
                                .arg(&worktree_path)
                                .output()
                                .await;
                        }
                    }
                }
            }

            if let Ok(db) = db.lock() {
                // Sub-agents are automatically cleaned up after their run completes.
                // The parent's spawned_total is decremented so it can spawn new ones.
                if let Some(ref pid) = parent_agent_id {
                    // Look up agent name before deleting
                    let agent_name = db
                        .agents()
                        .find_by_id(&agent_id_owned)
                        .ok()
                        .flatten()
                        .and_then(|a| a.name)
                        .unwrap_or_else(|| agent_id_owned.clone());

                    // Emit completion/failure event on the parent's agent_id
                    match &result {
                        Ok(content) => {
                            event_bus_for_completion.emit(moxxy_types::EventEnvelope::new(
                                pid.clone(),
                                None,
                                None,
                                0,
                                moxxy_types::EventType::SubagentCompleted,
                                serde_json::json!({
                                    "sub_agent_id": agent_id_owned,
                                    "name": agent_name,
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
                                    "sub_agent_id": agent_id_owned,
                                    "name": agent_name,
                                    "error": e.to_string(),
                                }),
                            ));
                        }
                    }

                    tracing::info!(
                        agent_id = %agent_id_owned,
                        parent_agent_id = %pid,
                        "Sub-agent run finished, cleaning up"
                    );

                    // Hive membership cleanup: update queen's manifest
                    let membership_path = agent_home.join(".hive_membership.json");
                    if let Ok(data) = std::fs::read_to_string(&membership_path)
                        && let Ok(membership) = serde_json::from_str::<
                            moxxy_runtime::primitives::hive::HiveMembership,
                        >(&data)
                    {
                        let hive_path = std::path::PathBuf::from(&membership.hive_path);
                        let store = moxxy_runtime::HiveStore::new(hive_path);
                        if let Ok(mut manifest) = store.read_manifest() {
                            // Mark member as completed/failed
                            let new_status = if result.is_ok() {
                                "completed"
                            } else {
                                "failed"
                            };
                            for m in &mut manifest.members {
                                if m.agent_id == agent_id_owned {
                                    m.status = new_status.into();
                                }
                            }
                            let _ = store.write_manifest(&manifest);

                            // Abandon any in-progress tasks
                            if let Ok(tasks) = store.list_tasks(Some("in_progress")) {
                                for mut task in tasks {
                                    if task.assigned_agent_id.as_deref() == Some(&agent_id_owned) {
                                        task.assigned_agent_id = None;
                                        task.status = "pending".into();
                                        task.updated_at = chrono::Utc::now().to_rfc3339();
                                        let _ = store.write_task(&task);
                                    }
                                }
                            }
                        }
                    }

                    let _ = db.agents().delete(&agent_id_owned);
                    let _ = db.agents().decrement_spawned_total(pid);
                    // Remove the sub-agent's filesystem directory
                    let _ = std::fs::remove_dir_all(&agent_home);
                } else {
                    let new_status = if result.is_ok() { "idle" } else { "error" };
                    let _ = db.agents().update_status(&agent_id_owned, new_status);

                    // Persist STM: store user task + final assistant response
                    if let Ok(ref content) = result {
                        let now = chrono::Utc::now().to_rfc3339();
                        let _ =
                            db.conversations()
                                .insert(&moxxy_storage::rows::ConversationLogRow {
                                    id: uuid::Uuid::now_v7().to_string(),
                                    agent_id: agent_id_owned.clone(),
                                    run_id: run_id_clone.clone(),
                                    sequence: 0,
                                    role: "user".into(),
                                    content: task.clone(),
                                    created_at: now.clone(),
                                });
                        let _ =
                            db.conversations()
                                .insert(&moxxy_storage::rows::ConversationLogRow {
                                    id: uuid::Uuid::now_v7().to_string(),
                                    agent_id: agent_id_owned.clone(),
                                    run_id: run_id_clone.clone(),
                                    sequence: 1,
                                    role: "assistant".into(),
                                    content: content.clone(),
                                    created_at: now,
                                });
                    }
                }
            }

            // Clean up cancellation token
            if let Ok(mut tokens) = run_tokens.lock() {
                tokens.remove(&agent_id_owned);
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

    pub fn do_stop_agent(&self, agent_id: &str) -> Result<(), String> {
        tracing::info!(agent_id, "Stopping agent run");
        // Cancel the running executor if there's an active token
        if let Ok(tokens) = self.run_tokens.lock()
            && let Some(token) = tokens.get(agent_id)
        {
            token.cancel();
        }

        let db = self.db.lock().map_err(|e| e.to_string())?;
        // Sub-agents are cleaned up automatically in the spawned task after
        // cancellation, so only set status for top-level agents here.
        let agent = db
            .agents()
            .find_by_id(agent_id)
            .map_err(|e| e.to_string())?;
        if let Some(a) = agent
            && a.parent_agent_id.is_none()
        {
            db.agents()
                .update_status(agent_id, "idle")
                .map_err(|e| e.to_string())?;
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
                .map(|(id, token)| (id.clone(), token.clone()))
                .collect()
        };

        if tokens.is_empty() {
            return;
        }

        tracing::info!(count = tokens.len(), "Stopping all active agent runs");
        for (agent_id, token) in &tokens {
            token.cancel();
            if let Ok(db) = self.db.lock() {
                let _ = db.agents().update_status(agent_id, "idle");
            }
        }
    }

    pub fn do_agent_status(&self, agent_id: &str) -> Result<Option<String>, String> {
        let db = self.db.lock().map_err(|e| e.to_string())?;
        let agent = db
            .agents()
            .find_by_id(agent_id)
            .map_err(|e| e.to_string())?;
        Ok(agent.map(|a| a.status))
    }
}

#[async_trait::async_trait]
impl RunStarter for RunService {
    async fn start_run(&self, agent_id: &str, task: &str) -> Result<String, String> {
        self.do_start_run(agent_id, task).await
    }

    async fn stop_agent(&self, agent_id: &str) -> Result<(), String> {
        self.do_stop_agent(agent_id)
    }

    fn agent_status(&self, agent_id: &str) -> Result<Option<String>, String> {
        self.do_agent_status(agent_id)
    }
}
