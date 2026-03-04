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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentType {
    /// User-created via API/CLI, YAML-persisted, keeps its directory.
    Agent,
    /// Created by `agent.spawn`, in-memory only, auto-removed on completion.
    Ephemeral,
    /// Created by `hive.recruit`, in-memory only, auto-removed + hive manifest update.
    HiveWorker,
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
}
