use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentStatus {
    #[default]
    Idle,
    Running,
    Stopped,
    Error,
}

impl std::fmt::Display for AgentStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AgentStatus::Idle => write!(f, "idle"),
            AgentStatus::Running => write!(f, "running"),
            AgentStatus::Stopped => write!(f, "stopped"),
            AgentStatus::Error => write!(f, "error"),
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SpawnError {
    #[error("depth limit exceeded")]
    DepthLimitExceeded,
    #[error("total limit exceeded")]
    TotalLimitExceeded,
    #[error("invalid config: {0}")]
    InvalidConfig(String),
}

// ──────────────── Agent Type System ────────────────

fn default_temperature() -> f64 {
    0.7
}
fn default_max_depth() -> i32 {
    2
}
fn default_max_total() -> i32 {
    8
}
fn default_min_tool_calls_for_skill() -> u32 {
    3
}
fn default_journal_max_bytes() -> u64 {
    5_000_000
}
fn default_reflection_timeout_secs() -> u64 {
    60
}

/// Configuration for the post-run reflection pass and downstream self-improvement features.
///
/// All flags default to `false` so existing agents are unaffected until opted in.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ReflectionConfig {
    /// Master switch: run the reflection pass after a successful run completes.
    #[serde(default)]
    pub enabled: bool,
    /// Allow reflection to draft skills into quarantine. Requires `enabled`.
    #[serde(default)]
    pub skill_synthesis_enabled: bool,
    /// Load/update per-end-user profile markdown files under `users/<user_id>.md`.
    #[serde(default)]
    pub user_profiles_enabled: bool,
    /// Minimum tool calls in a run before skill synthesis is considered.
    #[serde(default = "default_min_tool_calls_for_skill")]
    pub min_tool_calls_for_skill: u32,
    /// Soft cap for `journal.md` size before rotation (rotation not yet implemented).
    #[serde(default = "default_journal_max_bytes")]
    pub journal_max_bytes: u64,
    /// Timeout for the reflection provider call, in seconds.
    #[serde(default = "default_reflection_timeout_secs")]
    pub timeout_secs: u64,
    /// Maximum snapshots retained in `<skill_dir>/.history/` before oldest are pruned.
    #[serde(default = "default_skill_history_max_versions")]
    pub skill_history_max_versions: u32,
}

fn default_skill_history_max_versions() -> u32 {
    10
}

/// YAML-persisted agent configuration (source of truth for user-created agents).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    pub provider: String,
    pub model: String,
    #[serde(default = "default_temperature")]
    pub temperature: f64,
    #[serde(default = "default_max_depth")]
    pub max_subagent_depth: i32,
    #[serde(default = "default_max_total")]
    pub max_subagents_total: i32,
    #[serde(default)]
    pub policy_profile: Option<String>,
    #[serde(default)]
    pub core_mount: Option<String>,
    #[serde(default)]
    pub template: Option<String>,
    #[serde(default)]
    pub reflection: ReflectionConfig,
}

impl AgentConfig {
    pub fn load(path: &std::path::Path) -> Result<Self, String> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| format!("failed to read {:?}: {}", path, e))?;
        serde_yaml::from_str(&content).map_err(|e| format!("failed to parse {:?}: {}", path, e))
    }

    pub fn save(&self, path: &std::path::Path) -> Result<(), String> {
        let content = serde_yaml::to_string(self)
            .map_err(|e| format!("failed to serialize config: {}", e))?;
        std::fs::write(path, content).map_err(|e| format!("failed to write {:?}: {}", path, e))
    }
}

/// Distinguishes how an agent was created and its lifecycle.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentType {
    /// User-created via API/CLI, YAML-persisted, keeps its directory.
    Agent,
    /// Created by `agent.spawn`, in-memory only, auto-removed on completion.
    Ephemeral,
    /// Created by `hive.recruit`, in-memory only, auto-removed + hive manifest update.
    HiveWorker,
    /// A custom agent kind registered at runtime.
    Custom(String),
}

impl AgentType {
    /// Returns the kind name used to look up the `AgentKindDefinition` in the registry.
    pub fn kind_name(&self) -> &str {
        match self {
            AgentType::Agent => "standard",
            AgentType::Ephemeral => "ephemeral",
            AgentType::HiveWorker => "hive_worker",
            AgentType::Custom(name) => name,
        }
    }
}

/// Role within a hive swarm.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HiveRole {
    Queen,
    Worker,
    Scout,
}

/// In-memory representation of a registered agent (runtime state).
#[derive(Debug, Clone)]
pub struct AgentRuntime {
    pub name: String,
    pub agent_type: AgentType,
    pub config: AgentConfig,
    pub status: AgentStatus,
    pub parent_name: Option<String>,
    pub hive_role: Option<HiveRole>,
    pub depth: u32,
    pub spawned_count: u32,
    pub persona: Option<String>,
    /// Final output of the agent's last completed run (set on completion/error).
    pub last_result: Option<String>,
}
