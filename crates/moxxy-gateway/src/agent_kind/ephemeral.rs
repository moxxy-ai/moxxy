use super::{AgentLifecycle, AgentPaths, CleanupActions};

/// Spawned via `agent.spawn` — in-memory only, shares parent's workspace.
pub struct EphemeralAgent;

impl AgentLifecycle for EphemeralAgent {
    fn init(&self, _paths: &AgentPaths) -> Result<(), String> {
        // Ephemeral agents use the parent's workspace; nothing to create.
        Ok(())
    }

    fn resolve_paths(
        &self,
        moxxy_home: &std::path::Path,
        _agent_name: &str,
        parent_name: Option<&str>,
    ) -> AgentPaths {
        let parent = parent_name.expect("ephemeral agent must have a parent");
        let parent_dir = moxxy_home.join("agents").join(parent);
        AgentPaths {
            workspace: parent_dir.join("workspace"),
            memory_dir: parent_dir.join("memory"),
            agent_dir: parent_dir.clone(),
        }
    }

    fn deinit(&self, _success: bool) -> CleanupActions {
        CleanupActions {
            unregister: true,
            decrement_parent_spawned: true,
            persist_conversation: false,
            new_status: None,
            remove_directories: false,
        }
    }
}
