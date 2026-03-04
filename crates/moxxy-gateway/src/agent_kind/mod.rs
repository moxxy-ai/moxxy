mod ephemeral;
mod hive_worker;
mod standard;

pub use ephemeral::EphemeralAgent;
pub use hive_worker::HiveWorkerAgent;
pub use standard::StandardAgent;

use moxxy_types::AgentType;
use std::path::PathBuf;

/// Resolved paths for an agent's working environment.
pub struct AgentPaths {
    /// The agent's home directory (e.g. `~/.moxxy/agents/{name}/`).
    pub agent_dir: PathBuf,
    /// Directory where the agent reads/writes project files.
    pub workspace: PathBuf,
    /// Directory where memory journal files are stored.
    pub memory_dir: PathBuf,
}

/// Instructions returned by [`AgentLifecycle::deinit`] telling the caller
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

/// Lifecycle trait for agent types.
///
/// Each agent kind (standard, ephemeral, hive worker) lives in its own file
/// and implements this trait.  The [`RunService`] dispatches through the trait
/// instead of matching on `AgentType` everywhere.
pub trait AgentLifecycle: Send + Sync {
    /// Prepare the agent's working environment (create dirs, etc.).
    fn init(&self, paths: &AgentPaths) -> Result<(), String>;

    /// Resolve workspace and directory paths for this agent kind.
    fn resolve_paths(
        &self,
        moxxy_home: &std::path::Path,
        agent_name: &str,
        parent_name: Option<&str>,
    ) -> AgentPaths;

    /// Determine what cleanup to perform after a run finishes.
    fn deinit(&self, success: bool) -> CleanupActions;
}

/// Return the appropriate lifecycle implementation for the given type.
pub fn for_type(agent_type: AgentType) -> Box<dyn AgentLifecycle> {
    match agent_type {
        AgentType::Agent => Box::new(StandardAgent),
        AgentType::Ephemeral => Box::new(EphemeralAgent),
        AgentType::HiveWorker => Box::new(HiveWorkerAgent),
    }
}
