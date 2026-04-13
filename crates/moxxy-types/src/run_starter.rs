use crate::agents::{AgentType, HiveRole};

/// Options for spawning a child agent.
pub struct SpawnOpts {
    pub agent_type: AgentType,
    pub model_id: Option<String>,
    pub hive_role: Option<HiveRole>,
    /// When true, the child must submit a plan before executing write operations.
    pub plan_mode: bool,
    /// Workspace isolation mode for the child agent.
    pub isolation: WorkspaceIsolation,
}

/// Controls how a child agent's workspace is isolated from the parent.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum WorkspaceIsolation {
    /// Shared workspace with parent (default — current behavior).
    #[default]
    Shared,
    /// Create a git worktree for the child. Changes don't affect parent until merged.
    Worktree,
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
    /// The child's final output (populated when status is idle/error).
    pub last_result: Option<String>,
}

/// Outcome of a `start_or_queue` call.
#[derive(Debug, Clone)]
pub enum RunOutcome {
    /// Run started immediately. Contains the run_id.
    Started(String),
    /// Agent was busy; run was queued at the given position.
    Queued(usize),
    /// Queue was full; run was dropped.
    QueueFull,
}

/// Trait for triggering agent runs. Implemented by the gateway's RunService.
#[async_trait::async_trait]
pub trait RunStarter: Send + Sync {
    async fn start_run(&self, agent_id: &str, task: &str) -> Result<String, String>;
    async fn stop_agent(&self, agent_id: &str) -> Result<(), String>;
    fn agent_status(&self, agent_id: &str) -> Result<Option<String>, String>;

    /// Start a run, or queue it if the agent is busy.
    /// Default implementation falls back to `start_run` (no queueing).
    async fn start_or_queue(
        &self,
        agent_id: &str,
        task: &str,
        source: &str,
    ) -> Result<RunOutcome, String> {
        let _ = source;
        self.start_run(agent_id, task)
            .await
            .map(RunOutcome::Started)
    }

    async fn reset_session(&self, agent_id: &str) -> Result<(), String> {
        let _ = agent_id;
        Err("reset_session not supported".into())
    }

    /// Resolve a pending `user.ask` question by delivering an answer to the
    /// waiting agent primitive. Returns an error if `question_id` is unknown.
    fn resolve_ask(&self, question_id: &str, answer: &str) -> Result<(), String> {
        let _ = (question_id, answer);
        Err("resolve_ask not supported".into())
    }

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
