use moxxy_channel::bridge::{ChannelBridge, ChannelSender, RunStarter};
use moxxy_core::EventBus;
use moxxy_runtime::{ChannelMessageSender, EchoProvider, Provider};
use moxxy_storage::Database;
use moxxy_vault::SecretBackend;
use std::collections::HashMap;
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
    async fn send_to_agent_channels(&self, agent_id: &str, message: &str) -> Result<u32, String> {
        self.bridge
            .send_to_agent_channels(agent_id, message)
            .await
            .map_err(|e| e.to_string())
    }

    async fn send_to_channel(&self, channel_id: &str, message: &str) -> Result<(), String> {
        self.bridge
            .send_to_channel(channel_id, message)
            .await
            .map_err(|e| e.to_string())
    }
}

pub struct RunService {
    pub db: Arc<Mutex<Database>>,
    pub event_bus: EventBus,
    providers: HashMap<String, Arc<dyn Provider>>,
    pub run_tokens: Arc<Mutex<HashMap<String, CancellationToken>>>,
    channel_sender: Mutex<Option<Arc<dyn ChannelMessageSender>>>,
    vault_backend: Arc<dyn SecretBackend + Send + Sync>,
}

impl RunService {
    pub fn new(
        db: Arc<Mutex<Database>>,
        event_bus: EventBus,
        providers: HashMap<String, Arc<dyn Provider>>,
        vault_backend: Arc<dyn SecretBackend + Send + Sync>,
    ) -> Self {
        Self {
            db,
            event_bus,
            providers,
            run_tokens: Arc::new(Mutex::new(HashMap::new())),
            channel_sender: Mutex::new(None),
            vault_backend,
        }
    }

    pub fn get_provider(&self, id: &str) -> Option<Arc<dyn Provider>> {
        self.providers.get(id).cloned()
    }

    pub fn register_provider(&mut self, id: String, provider: Arc<dyn Provider>) {
        self.providers.insert(id, provider);
    }

    /// Set the channel message sender. Called after the ChannelBridge is created.
    pub fn set_channel_sender(&self, sender: Arc<dyn ChannelMessageSender>) {
        *self.channel_sender.lock().unwrap() = Some(sender);
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

            db.agents()
                .update_status(&agent.id, "running")
                .map_err(|e| e.to_string())?;
            agent
        };

        let run_id = uuid::Uuid::now_v7().to_string();
        let task = task.to_string();

        let provider = self
            .get_provider(&agent.provider_id)
            .unwrap_or_else(|| Arc::new(EchoProvider::new()));

        let workspace_path = std::path::PathBuf::from(&agent.workspace_root);
        let policy = moxxy_core::PathPolicy::new(workspace_path.clone(), None);

        // Memory directory: {workspace_root}/.moxxy/memory
        let memory_base = workspace_path.join(".moxxy").join("memory");
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

        // Shell primitive (restricted allowlist, 30s timeout, 1MB output cap)
        registry.register(Box::new(moxxy_runtime::ShellExecPrimitive::new(
            vec![
                "ls".into(),
                "cat".into(),
                "grep".into(),
                "find".into(),
                "echo".into(),
                "wc".into(),
            ],
            std::time::Duration::from_secs(30),
            1024 * 1024,
        )));

        // HTTP primitive (empty domain allowlist by default)
        registry.register(Box::new(moxxy_runtime::HttpRequestPrimitive::new(
            vec![],
            std::time::Duration::from_secs(30),
            5 * 1024 * 1024,
        )));

        // Skill primitives
        registry.register(Box::new(moxxy_runtime::SkillImportPrimitive::new()));
        registry.register(Box::new(moxxy_runtime::SkillValidatePrimitive::new()));

        // Notification primitives
        registry.register(Box::new(moxxy_runtime::WebhookNotifyPrimitive::new(vec![])));
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

        // Browse primitives
        registry.register(Box::new(moxxy_runtime::BrowseFetchPrimitive::new(
            vec![],
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
        registry.register(Box::new(moxxy_runtime::GitCommitPrimitive::new(ctx.clone())));
        registry.register(Box::new(moxxy_runtime::GitPushPrimitive::new(ctx.clone())));
        registry.register(Box::new(moxxy_runtime::GitCheckoutPrimitive::new()));
        registry.register(Box::new(moxxy_runtime::GitPrCreatePrimitive::new(ctx.clone())));
        registry.register(Box::new(moxxy_runtime::GitForkPrimitive::new(ctx)));
        registry.register(Box::new(moxxy_runtime::GitWorktreeAddPrimitive::new(
            workspace_path,
        )));
        registry.register(Box::new(moxxy_runtime::GitWorktreeListPrimitive::new()));
        registry.register(Box::new(moxxy_runtime::GitWorktreeRemovePrimitive::new()));

        let allowed_primitives: Vec<String> =
            registry.list().iter().map(|s| s.to_string()).collect();

        let agent_id_owned = agent.id.clone();
        let run_id_clone = run_id.clone();
        let db = self.db.clone();
        let temperature = agent.temperature;

        // Create cancellation token for this run
        let cancel_token = CancellationToken::new();
        if let Ok(mut tokens) = self.run_tokens.lock() {
            tokens.insert(agent_id_owned.clone(), cancel_token.clone());
        }
        let run_tokens = self.run_tokens.clone();

        tokio::spawn(async move {
            let executor =
                moxxy_runtime::RunExecutor::new(event_bus, provider, registry, allowed_primitives)
                    .with_cancel_token(cancel_token)
                    .with_timeout(std::time::Duration::from_secs(300));

            let model_config = moxxy_runtime::ModelConfig {
                temperature,
                max_tokens: 4096,
            };

            let result = executor
                .execute(&agent_id_owned, &run_id_clone, &task, &model_config)
                .await;

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

    pub fn do_stop_agent(&self, agent_id: &str) -> Result<(), String> {
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
