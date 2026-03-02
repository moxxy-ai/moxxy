use moxxy_channel::bridge::{ChannelBridge, ChannelSender};
use moxxy_core::EventBus;
use moxxy_runtime::{AskChannels, ChannelMessageSender, EchoProvider, OpenAIProvider, Provider};
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
}

impl RunService {
    pub fn new(
        db: Arc<Mutex<Database>>,
        event_bus: EventBus,
        vault_backend: Arc<dyn SecretBackend + Send + Sync>,
        moxxy_home: PathBuf,
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

        // Look up model to get api_base from metadata_json
        let model_row = db.providers().find_model(provider_id, model_id).ok()??;
        let api_base = model_row
            .metadata_json
            .as_deref()
            .and_then(|json| serde_json::from_str::<serde_json::Value>(json).ok())
            .and_then(|v| v.get("api_base").and_then(|b| b.as_str().map(String::from)))?;

        // Get API key from vault
        let vault_key = format!("moxxy_provider_{}", provider_id);
        let api_key = self.vault_backend.get_secret(&vault_key).ok()?;

        Some(Arc::new(OpenAIProvider::new(api_base, api_key, model_id)))
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
                // from a previous crash — reset it so a new run can start.
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
                    "Agent stuck in running status with no active run — resetting to idle"
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

        let provider = self.resolve_provider(&agent.provider_id, &agent.model_id);
        let using_echo = provider.is_none();
        let provider = provider.unwrap_or_else(|| Arc::new(EchoProvider::new()));

        if using_echo {
            tracing::warn!(
                agent_id,
                provider_id = %agent.provider_id,
                "Provider not found, falling back to EchoProvider"
            );
        } else {
            tracing::info!(
                agent_id,
                provider_id = %agent.provider_id,
                "Using registered provider"
            );
        }

        let agent_name = agent.name.as_deref().unwrap_or(&agent.id);
        let agent_dir = self.moxxy_home.join("agents").join(agent_name);
        let agents_dir = self.moxxy_home.join("agents");
        let workspace_path = agent_dir.clone();
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
        registry.register(Box::new(moxxy_runtime::FsListPrimitive::new(policy)));

        // Memory primitives
        registry.register(Box::new(moxxy_runtime::MemoryAppendPrimitive::new(journal)));
        registry.register(Box::new(moxxy_runtime::MemorySearchPrimitive::new(
            memory_base.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::MemorySummarizePrimitive::new(
            memory_base,
        )));

        // Shell primitive (DB-backed allowlist, 30s timeout, 1MB output cap)
        registry.register(Box::new(
            moxxy_runtime::ShellExecPrimitive::new(
                self.db.clone(),
                agent.id.clone(),
                std::time::Duration::from_secs(30),
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
        registry.register(Box::new(moxxy_runtime::WebhookNotifyPrimitive::new(
            self.db.clone(),
            agent.id.clone(),
        )));
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

        // Webhook management primitives (agents can create/list webhooks)
        registry.register(Box::new(moxxy_runtime::WebhookCreatePrimitive::new(
            self.db.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::WebhookListPrimitive::new(
            self.db.clone(),
        )));

        // Browse primitives (DB-backed domain allowlist)
        registry.register(Box::new(moxxy_runtime::BrowseFetchPrimitive::new(
            self.db.clone(),
            agent.id.clone(),
            std::time::Duration::from_secs(30),
            10 * 1024 * 1024,
        )));
        registry.register(Box::new(moxxy_runtime::BrowseExtractPrimitive::new()));

        // Git primitives (vault-aware via PrimitiveContext)
        let ctx = moxxy_runtime::PrimitiveContext::new(
            self.db.clone(),
            agent.id.clone(),
            self.vault_backend.clone(),
        );
        registry.register(Box::new(moxxy_runtime::GitInitPrimitive::new(
            workspace_path.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::GitClonePrimitive::new(
            ctx.clone(),
            workspace_path.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::GitStatusPrimitive::new()));
        registry.register(Box::new(moxxy_runtime::GitCommitPrimitive::new(
            ctx.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::GitPushPrimitive::new(ctx.clone())));
        registry.register(Box::new(moxxy_runtime::GitCheckoutPrimitive::new()));
        registry.register(Box::new(moxxy_runtime::GitPrCreatePrimitive::new(
            ctx.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::GitForkPrimitive::new(ctx.clone())));

        // Vault primitives (agents can manage their own secrets)
        registry.register(Box::new(moxxy_runtime::VaultSetPrimitive::new(ctx.clone())));
        registry.register(Box::new(moxxy_runtime::VaultGetPrimitive::new(ctx.clone())));
        registry.register(Box::new(moxxy_runtime::VaultDeletePrimitive::new(
            ctx.clone(),
        )));
        registry.register(Box::new(moxxy_runtime::VaultListPrimitive::new(ctx)));

        registry.register(Box::new(moxxy_runtime::GitWorktreeAddPrimitive::new(
            workspace_path,
        )));
        registry.register(Box::new(moxxy_runtime::GitWorktreeListPrimitive::new()));
        registry.register(Box::new(moxxy_runtime::GitWorktreeRemovePrimitive::new()));

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
            )));
            registry.register(Box::new(moxxy_runtime::AgentStopPrimitive::new(
                self.db.clone(),
                agent.id.clone(),
                starter,
            )));
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
            system_prompt.push_str(&format!(
                "You are a Moxxy agent (id: {agent_id_owned}).\n\
                 Your workspace directory is: {agent_home_display}\n\
                 IMPORTANT: All file operations (reads, writes, screenshots, shell output files, \
                 git operations, etc.) MUST use paths within your workspace directory. \
                 Never create, read, or write files outside of {agent_home_display}. \
                 Use relative paths or paths prefixed with {agent_home_display}/ for every file operation. \
                 Shell commands also execute with your workspace as the working directory.\n\n"
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
                    "Sub-agents",
                    &[
                        ("agent.spawn", "spawn"),
                        ("agent.status", "check status"),
                        ("agent.list", "list"),
                        ("agent.stop", "stop"),
                        ("agent.dismiss", "dismiss completed sub-agent"),
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
                (
                    "notify",
                    "Notifications",
                    &[
                        ("notify.webhook", "send webhooks"),
                        ("notify.cli", "notify CLI"),
                    ],
                ),
                (
                    "channel",
                    "Channels",
                    &[("channel.notify", "send messages to channels")],
                ),
                (
                    "webhook",
                    "Webhook management",
                    &[
                        ("webhook.create", "create endpoints"),
                        ("webhook.list", "list endpoints"),
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
                 - Proactively use your tools. If asked to look something up, fetch a URL, or find information — use browse.fetch or http.request.\n\
                 - Read files before modifying them.\n\
                 - If a tool fails, analyze the error and try alternatives.\n\
                 - NEVER use paths outside your workspace. Use relative paths (e.g., \"output.png\", \"src/index.html\") or full paths starting with your workspace directory. Do NOT use ~/Desktop, /tmp, /Users, or any other location.\n\
                 - Always provide a final text summary of what you did and what you found.",
            );

            let executor =
                moxxy_runtime::RunExecutor::new(event_bus, provider, registry, allowed_primitives)
                    .with_system_prompt(system_prompt)
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

            if let Ok(db) = db.lock() {
                let new_status = if result.is_ok() { "idle" } else { "error" };
                let _ = db.agents().update_status(&agent_id_owned, new_status);
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
        db.agents()
            .update_status(agent_id, "idle")
            .map_err(|e| e.to_string())
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
