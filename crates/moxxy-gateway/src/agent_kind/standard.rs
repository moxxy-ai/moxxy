use super::{AgentLifecycle, AgentPaths, CleanupActions};

/// User-created agent — persisted via YAML, keeps its own directory.
pub struct StandardAgent;

impl AgentLifecycle for StandardAgent {
    fn init(&self, paths: &AgentPaths) -> Result<(), String> {
        std::fs::create_dir_all(&paths.workspace).map_err(|e| format!("create workspace: {e}"))?;
        std::fs::create_dir_all(&paths.memory_dir)
            .map_err(|e| format!("create memory dir: {e}"))?;
        Ok(())
    }

    fn resolve_paths(
        &self,
        moxxy_home: &std::path::Path,
        agent_name: &str,
        _parent_name: Option<&str>,
    ) -> AgentPaths {
        let agent_dir = moxxy_home.join("agents").join(agent_name);
        AgentPaths {
            workspace: agent_dir.join("workspace"),
            memory_dir: agent_dir.join("memory"),
            agent_dir,
        }
    }

    fn deinit(&self, success: bool) -> CleanupActions {
        CleanupActions {
            unregister: false,
            decrement_parent_spawned: false,
            persist_conversation: true,
            new_status: Some(if success { "idle" } else { "error" }.into()),
            remove_directories: false,
        }
    }
}
