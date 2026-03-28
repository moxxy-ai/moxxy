use moxxy_types::{AgentRuntime, AgentStatus};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

/// In-memory registry of all known agents (user-created + ephemeral + hive workers).
/// Wraps a `HashMap<String, AgentRuntime>` behind `Arc<RwLock<>>` for concurrent access.
#[derive(Clone)]
pub struct AgentRegistry {
    inner: Arc<RwLock<HashMap<String, AgentRuntime>>>,
}

impl AgentRegistry {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Register an agent. Returns error if name already exists.
    pub fn register(&self, runtime: AgentRuntime) -> Result<(), String> {
        let mut map = self.inner.write().map_err(|e| e.to_string())?;
        if map.contains_key(&runtime.name) {
            return Err(format!("agent '{}' already registered", runtime.name));
        }
        map.insert(runtime.name.clone(), runtime);
        Ok(())
    }

    /// Remove an agent from the registry. Returns the removed runtime if it existed.
    pub fn unregister(&self, name: &str) -> Option<AgentRuntime> {
        let mut map = self.inner.write().ok()?;
        map.remove(name)
    }

    /// Get a clone of an agent's runtime state.
    pub fn get(&self, name: &str) -> Option<AgentRuntime> {
        let map = self.inner.read().ok()?;
        map.get(name).cloned()
    }

    /// Update an agent's status.
    pub fn update_status(&self, name: &str, status: AgentStatus) {
        if let Ok(mut map) = self.inner.write()
            && let Some(rt) = map.get_mut(name)
        {
            rt.status = status;
        }
    }

    /// Store the result of the agent's last run.
    pub fn set_last_result(&self, name: &str, result: Option<String>) {
        if let Ok(mut map) = self.inner.write()
            && let Some(rt) = map.get_mut(name)
        {
            rt.last_result = result;
        }
    }

    /// Increment an agent's spawned_count.
    pub fn increment_spawned(&self, name: &str) {
        if let Ok(mut map) = self.inner.write()
            && let Some(rt) = map.get_mut(name)
        {
            rt.spawned_count += 1;
        }
    }

    /// Decrement an agent's spawned_count.
    pub fn decrement_spawned(&self, name: &str) {
        if let Ok(mut map) = self.inner.write()
            && let Some(rt) = map.get_mut(name)
        {
            rt.spawned_count = rt.spawned_count.saturating_sub(1);
        }
    }

    /// List all registered agents.
    pub fn list(&self) -> Vec<AgentRuntime> {
        self.inner
            .read()
            .ok()
            .map(|map| map.values().cloned().collect())
            .unwrap_or_default()
    }

    /// Find agents matching a given status.
    pub fn find_by_status(&self, status: AgentStatus) -> Vec<AgentRuntime> {
        self.inner
            .read()
            .ok()
            .map(|map| {
                map.values()
                    .filter(|rt| rt.status == status)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Find all children of a given parent.
    pub fn find_children(&self, parent_name: &str) -> Vec<AgentRuntime> {
        self.inner
            .read()
            .ok()
            .map(|map| {
                map.values()
                    .filter(|rt| rt.parent_name.as_deref() == Some(parent_name))
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }
}

impl Default for AgentRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use moxxy_types::{AgentConfig, AgentType, HiveRole};

    fn make_runtime(name: &str) -> AgentRuntime {
        AgentRuntime {
            name: name.to_string(),
            agent_type: AgentType::Agent,
            config: AgentConfig {
                provider: "openai".into(),
                model: "gpt-4".into(),
                temperature: 0.7,
                max_subagent_depth: 2,
                max_subagents_total: 8,
                policy_profile: None,
                core_mount: None,
                template: None,
            },
            status: AgentStatus::Idle,
            parent_name: None,
            hive_role: None,
            depth: 0,
            spawned_count: 0,
            persona: None,
            last_result: None,
        }
    }

    #[test]
    fn register_and_get() {
        let reg = AgentRegistry::new();
        let rt = make_runtime("test-agent");
        reg.register(rt).unwrap();

        let got = reg.get("test-agent").unwrap();
        assert_eq!(got.name, "test-agent");
        assert_eq!(got.status, AgentStatus::Idle);
    }

    #[test]
    fn register_duplicate_fails() {
        let reg = AgentRegistry::new();
        reg.register(make_runtime("dup")).unwrap();
        assert!(reg.register(make_runtime("dup")).is_err());
    }

    #[test]
    fn unregister_removes_agent() {
        let reg = AgentRegistry::new();
        reg.register(make_runtime("rm-me")).unwrap();
        let removed = reg.unregister("rm-me");
        assert!(removed.is_some());
        assert!(reg.get("rm-me").is_none());
    }

    #[test]
    fn unregister_nonexistent_returns_none() {
        let reg = AgentRegistry::new();
        assert!(reg.unregister("nope").is_none());
    }

    #[test]
    fn update_status() {
        let reg = AgentRegistry::new();
        reg.register(make_runtime("s")).unwrap();
        reg.update_status("s", AgentStatus::Running);
        assert_eq!(reg.get("s").unwrap().status, AgentStatus::Running);
    }

    #[test]
    fn increment_and_decrement_spawned() {
        let reg = AgentRegistry::new();
        reg.register(make_runtime("p")).unwrap();
        reg.increment_spawned("p");
        reg.increment_spawned("p");
        assert_eq!(reg.get("p").unwrap().spawned_count, 2);
        reg.decrement_spawned("p");
        assert_eq!(reg.get("p").unwrap().spawned_count, 1);
        reg.decrement_spawned("p");
        reg.decrement_spawned("p"); // saturating
        assert_eq!(reg.get("p").unwrap().spawned_count, 0);
    }

    #[test]
    fn list_returns_all() {
        let reg = AgentRegistry::new();
        reg.register(make_runtime("a")).unwrap();
        reg.register(make_runtime("b")).unwrap();
        assert_eq!(reg.list().len(), 2);
    }

    #[test]
    fn find_by_status_filters() {
        let reg = AgentRegistry::new();
        reg.register(make_runtime("idle1")).unwrap();
        reg.register(make_runtime("idle2")).unwrap();
        reg.update_status("idle2", AgentStatus::Running);

        assert_eq!(reg.find_by_status(AgentStatus::Idle).len(), 1);
        assert_eq!(reg.find_by_status(AgentStatus::Running).len(), 1);
        assert_eq!(reg.find_by_status(AgentStatus::Error).len(), 0);
    }

    #[test]
    fn find_children_filters_by_parent() {
        let reg = AgentRegistry::new();
        reg.register(make_runtime("parent")).unwrap();

        let mut child = make_runtime("child-1");
        child.parent_name = Some("parent".into());
        child.agent_type = AgentType::Ephemeral;
        reg.register(child).unwrap();

        let mut worker = make_runtime("worker-1");
        worker.parent_name = Some("parent".into());
        worker.agent_type = AgentType::HiveWorker;
        worker.hive_role = Some(HiveRole::Worker);
        reg.register(worker).unwrap();

        let mut other = make_runtime("other-child");
        other.parent_name = Some("other-parent".into());
        reg.register(other).unwrap();

        let children = reg.find_children("parent");
        assert_eq!(children.len(), 2);
        assert!(
            children
                .iter()
                .all(|c| c.parent_name.as_deref() == Some("parent"))
        );
    }

    #[test]
    fn get_nonexistent_returns_none() {
        let reg = AgentRegistry::new();
        assert!(reg.get("nobody").is_none());
    }
}
