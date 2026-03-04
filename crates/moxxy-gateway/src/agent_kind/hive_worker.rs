use super::{AgentLifecycle, AgentPaths, CleanupActions};

/// Recruited via `hive.recruit` — in-memory only, shares queen's workspace + hive dir.
pub struct HiveWorkerAgent;

impl AgentLifecycle for HiveWorkerAgent {
    fn init(&self, _paths: &AgentPaths) -> Result<(), String> {
        // Hive workers use the queen's workspace; nothing to create.
        Ok(())
    }

    fn resolve_paths(
        &self,
        moxxy_home: &std::path::Path,
        _agent_name: &str,
        parent_name: Option<&str>,
    ) -> AgentPaths {
        let queen = parent_name.expect("hive worker must have a parent (queen)");
        let queen_dir = moxxy_home.join("agents").join(queen);
        AgentPaths {
            workspace: queen_dir.join("workspace"),
            memory_dir: queen_dir.join("memory"),
            agent_dir: queen_dir.clone(),
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
