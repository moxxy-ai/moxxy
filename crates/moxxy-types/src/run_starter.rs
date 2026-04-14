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

/// Context for triggering a run, including caller identity.
///
/// Extends the simple `(agent_id, task, source)` tuple with optional
/// caller/user identity so per-end-user personalization (profiles, memory
/// scoping) can key off a stable id across runs.
#[derive(Debug, Clone)]
pub struct RunTrigger {
    pub task: String,
    /// Opaque origin tag (`"channel"`, `"api"`, `"webhook"`, ...).
    pub source: String,
    /// Stable, transport-namespaced end-user id (e.g. `tg:12345`, `discord:67`).
    /// `None` for API/system triggers where no human user is identifiable.
    pub user_id: Option<String>,
    /// Optional channel identifier (e.g. the chat_id a message arrived on).
    pub channel_id: Option<String>,
}

impl RunTrigger {
    pub fn new(task: impl Into<String>, source: impl Into<String>) -> Self {
        Self {
            task: task.into(),
            source: source.into(),
            user_id: None,
            channel_id: None,
        }
    }

    pub fn with_user_id(mut self, user_id: impl Into<String>) -> Self {
        self.user_id = Some(user_id.into());
        self
    }

    pub fn with_channel_id(mut self, channel_id: impl Into<String>) -> Self {
        self.channel_id = Some(channel_id.into());
        self
    }
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

    /// Start a run (or queue it) with optional caller identity.
    ///
    /// Default implementation delegates to `start_or_queue`, discarding
    /// `user_id`/`channel_id`. Implementations that care about per-user
    /// context (e.g. the gateway `RunService`) should override.
    async fn start_or_queue_with_context(
        &self,
        agent_id: &str,
        trigger: RunTrigger,
    ) -> Result<RunOutcome, String> {
        self.start_or_queue(agent_id, &trigger.task, &trigger.source)
            .await
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
