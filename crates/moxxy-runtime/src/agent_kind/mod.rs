mod core_primitives;
mod ephemeral;
mod hive_worker;
mod prompt;
mod registry;
mod standard;

pub use core_primitives::register_core_primitives;
pub use ephemeral::EphemeralAgentKind;
pub use hive_worker::HiveWorkerAgentKind;
pub use prompt::{
    build_base_prompt, build_capabilities_prompt, build_guidelines_prompt,
    build_hive_bootstrap_prompt, build_stm_prompt,
};
pub use registry::AgentKindRegistry;
pub use standard::StandardAgentKind;

use crate::{
    AgentAwaitChannels, AgentInbox, AskChannels, ChannelMessageSender, Message,
    PlanApprovalChannels, PrimitiveRegistry, WebhookListenChannels,
};
use moxxy_core::{EmbeddingService, EventBus, LoadedWebhook};
use moxxy_mcp::McpManager;
use moxxy_storage::Database;
use moxxy_types::RunStarter;
use moxxy_vault::SecretBackend;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, RwLock};

/// Resolved paths for an agent's working environment.
pub struct AgentPaths {
    /// The agent's home directory (e.g. `~/.moxxy/agents/{name}/`).
    pub agent_dir: PathBuf,
    /// Directory where the agent reads/writes project files.
    pub workspace: PathBuf,
    /// Directory where memory journal files are stored.
    pub memory_dir: PathBuf,
}

/// Instructions returned by [`AgentKindDefinition::deinit`] telling the caller
/// what cleanup to perform.
pub struct CleanupActions {
    /// Remove from the in-memory registry.
    pub unregister: bool,
    /// Decrement the parent's `spawned_count`.
    pub decrement_parent_spawned: bool,
    /// Store the conversation (task + result) in the DB.
    pub persist_conversation: bool,
    /// New status to set in the registry (`None` = don't update).
    pub new_status: Option<String>,
    /// Remove the agent's filesystem directory.
    pub remove_directories: bool,
}

/// Shared resources available to all agent kinds during execution.
pub struct KindContext {
    pub db: Arc<Mutex<Database>>,
    pub event_bus: EventBus,
    pub vault_backend: Arc<dyn SecretBackend + Send + Sync>,
    pub ask_channels: AskChannels,
    pub channel_sender: Option<Arc<dyn ChannelMessageSender>>,
    pub run_starter: Option<Arc<dyn RunStarter>>,
    pub moxxy_home: PathBuf,
    pub embedding_svc: Arc<dyn EmbeddingService>,
    pub base_url: String,
    pub webhook_index: Arc<RwLock<HashMap<String, LoadedWebhook>>>,
    pub webhook_listen_channels: WebhookListenChannels,
    /// Shared inbox for inter-agent messaging.
    pub agent_inbox: AgentInbox,
    /// Channels for `agent.await` — notified when a child completes.
    pub agent_await_channels: AgentAwaitChannels,
    /// Channels for plan approval flow between parent and child agents.
    pub plan_approval_channels: PlanApprovalChannels,
}

/// Per-run agent information passed to [`AgentKindDefinition::call`].
pub struct AgentSetup {
    pub name: String,
    pub parent_name: Option<String>,
    pub host_agent_name: String,
    pub persona: Option<String>,
    pub template_content: Option<String>,
    pub temperature: f64,
    pub paths: AgentPaths,
    pub policy_profile: Option<String>,
}

/// Output of [`AgentKindDefinition::call`] - everything needed to build a RunExecutor.
pub struct PreparedRun {
    pub registry: PrimitiveRegistry,
    pub allowed_primitives: Arc<RwLock<Vec<String>>>,
    pub system_prompt: String,
    pub history: Vec<Message>,
    /// MCP server manager for mid-run connect/disconnect. Shut down in post-run cleanup.
    pub mcp_manager: Option<Arc<tokio::sync::Mutex<McpManager>>>,
    /// Shared flag: set by McpConnect/McpDisconnect when tool definitions change mid-run.
    pub tools_dirty: Arc<AtomicBool>,
}

/// Trait that each agent kind implements. The key method is `call()` - invoked
/// when the agent is prompted.
#[async_trait::async_trait]
pub trait AgentKindDefinition: Send + Sync {
    /// Unique identifier (e.g. "standard", "ephemeral", "hive_worker").
    fn name(&self) -> &str;

    /// Optional description of this kind.
    fn description(&self) -> &str {
        ""
    }

    /// Resolve workspace/memory/agent directory paths.
    fn resolve_paths(
        &self,
        moxxy_home: &Path,
        agent_name: &str,
        parent_name: Option<&str>,
    ) -> AgentPaths;

    /// Prepare filesystem (create dirs, etc.).
    fn init(&self, paths: &AgentPaths) -> Result<(), String>;

    /// THE EXECUTION ENTRY POINT - called when agent is prompted.
    /// Builds PrimitiveRegistry, system prompt, history.
    async fn call(&self, setup: &AgentSetup, ctx: &KindContext) -> Result<PreparedRun, String>;

    /// Cleanup instructions after run completes.
    fn deinit(&self, success: bool) -> CleanupActions;

    /// Kind-specific post-run hook (e.g. hive manifest updates). Default: no-op.
    async fn post_run(
        &self,
        _setup: &AgentSetup,
        _ctx: &KindContext,
        _result: &Result<String, String>,
    ) -> Result<(), String> {
        Ok(())
    }

    /// Child name tag for spawn (e.g. "sub", "worker").
    fn child_name_tag(&self) -> &str {
        "sub"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_paths_fields_accessible() {
        let paths = AgentPaths {
            agent_dir: PathBuf::from("/home/agents/test"),
            workspace: PathBuf::from("/home/agents/test/workspace"),
            memory_dir: PathBuf::from("/home/agents/test/memory"),
        };
        assert_eq!(paths.agent_dir, PathBuf::from("/home/agents/test"));
        assert_eq!(
            paths.workspace,
            PathBuf::from("/home/agents/test/workspace")
        );
        assert_eq!(paths.memory_dir, PathBuf::from("/home/agents/test/memory"));
    }

    #[test]
    fn cleanup_actions_defaults() {
        let actions = CleanupActions {
            unregister: false,
            decrement_parent_spawned: false,
            persist_conversation: true,
            new_status: Some("idle".into()),
            remove_directories: false,
        };
        assert!(!actions.unregister);
        assert!(actions.persist_conversation);
        assert_eq!(actions.new_status.as_deref(), Some("idle"));
    }
}
