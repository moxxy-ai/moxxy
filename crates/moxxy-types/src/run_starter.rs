use crate::agents::{AgentType, HiveRole};

/// Options for spawning a child agent.
pub struct SpawnOpts {
    pub agent_type: AgentType,
    pub model_id: Option<String>,
    pub hive_role: Option<HiveRole>,
}

/// Result returned after successfully spawning a child agent.
pub struct SpawnResult {
    pub child_name: String,
    pub run_id: String,
}

/// Info about a child agent, returned by `list_children`.
#[derive(Debug, Clone)]
pub struct ChildInfo {
    pub name: String,
    pub status: String,
    pub agent_type: AgentType,
    pub hive_role: Option<HiveRole>,
    pub depth: u32,
}

/// Trait for triggering agent runs. Implemented by the gateway's RunService.
#[async_trait::async_trait]
pub trait RunStarter: Send + Sync {
    async fn start_run(&self, agent_id: &str, task: &str) -> Result<String, String>;
    async fn stop_agent(&self, agent_id: &str) -> Result<(), String>;
    fn agent_status(&self, agent_id: &str) -> Result<Option<String>, String>;

    /// Spawn a child agent (Ephemeral or HiveWorker) under the given parent.
    async fn spawn_child(
        &self,
        parent_name: &str,
        task: &str,
        opts: SpawnOpts,
    ) -> Result<SpawnResult, String>;

    /// List all children of the given parent agent.
    fn list_children(&self, parent_name: &str) -> Result<Vec<ChildInfo>, String>;

    /// Dismiss (unregister) a completed child agent.
    fn dismiss_child(&self, parent_name: &str, child_name: &str) -> Result<(), String>;
}
