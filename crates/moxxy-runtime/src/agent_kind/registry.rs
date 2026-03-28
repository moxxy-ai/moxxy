use super::AgentKindDefinition;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

struct KindEntry {
    kind: Arc<dyn AgentKindDefinition>,
    enabled: bool,
}

/// Registry for agent kind definitions. Thread-safe via RwLock for read-heavy access.
/// Returns `Arc` handles so callers can use kinds across `.await` points.
pub struct AgentKindRegistry {
    kinds: RwLock<HashMap<String, KindEntry>>,
}

impl Default for AgentKindRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentKindRegistry {
    pub fn new() -> Self {
        Self {
            kinds: RwLock::new(HashMap::new()),
        }
    }

    /// Register a new agent kind. Returns error if name already exists.
    pub fn register(&self, kind: Box<dyn AgentKindDefinition>) -> Result<(), String> {
        let name = kind.name().to_string();
        let mut kinds = self.kinds.write().map_err(|e| format!("lock: {e}"))?;
        if kinds.contains_key(&name) {
            return Err(format!("agent kind '{}' already registered", name));
        }
        kinds.insert(
            name,
            KindEntry {
                kind: Arc::from(kind),
                enabled: true,
            },
        );
        Ok(())
    }

    /// Get the kind definition by name. Returns None if not found or disabled.
    /// The returned `Arc` can be held across `.await` points safely.
    pub fn get(&self, name: &str) -> Option<Arc<dyn AgentKindDefinition>> {
        let kinds = self.kinds.read().ok()?;
        kinds
            .get(name)
            .filter(|e| e.enabled)
            .map(|e| e.kind.clone())
    }

    /// Disable a kind (it remains registered but won't be returned by `get`).
    pub fn disable(&self, name: &str) -> Result<(), String> {
        let mut kinds = self.kinds.write().map_err(|e| format!("lock: {e}"))?;
        let entry = kinds
            .get_mut(name)
            .ok_or_else(|| format!("agent kind '{}' not found", name))?;
        entry.enabled = false;
        Ok(())
    }

    /// Re-enable a previously disabled kind.
    pub fn enable(&self, name: &str) -> Result<(), String> {
        let mut kinds = self.kinds.write().map_err(|e| format!("lock: {e}"))?;
        let entry = kinds
            .get_mut(name)
            .ok_or_else(|| format!("agent kind '{}' not found", name))?;
        entry.enabled = true;
        Ok(())
    }

    /// Completely remove a kind from the registry.
    pub fn unregister(&self, name: &str) -> Result<(), String> {
        let mut kinds = self.kinds.write().map_err(|e| format!("lock: {e}"))?;
        kinds
            .remove(name)
            .ok_or_else(|| format!("agent kind '{}' not found", name))?;
        Ok(())
    }

    /// List all registered kinds with their enabled status.
    pub fn list(&self) -> Vec<(String, bool)> {
        let kinds = self.kinds.read().unwrap_or_else(|e| e.into_inner());
        kinds
            .iter()
            .map(|(name, entry)| (name.clone(), entry.enabled))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_kind::{AgentPaths, AgentSetup, CleanupActions, KindContext, PreparedRun};
    use std::path::Path;

    struct DummyKind {
        kind_name: String,
    }

    impl DummyKind {
        fn new(name: &str) -> Self {
            Self {
                kind_name: name.to_string(),
            }
        }
    }

    #[async_trait::async_trait]
    impl AgentKindDefinition for DummyKind {
        fn name(&self) -> &str {
            &self.kind_name
        }

        fn resolve_paths(
            &self,
            moxxy_home: &Path,
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

        fn init(&self, _paths: &AgentPaths) -> Result<(), String> {
            Ok(())
        }

        async fn call(
            &self,
            _setup: &AgentSetup,
            _ctx: &KindContext,
        ) -> Result<PreparedRun, String> {
            unimplemented!("dummy kind")
        }

        fn deinit(&self, _success: bool) -> CleanupActions {
            CleanupActions {
                unregister: false,
                decrement_parent_spawned: false,
                persist_conversation: false,
                new_status: None,
                remove_directories: false,
            }
        }
    }

    #[test]
    fn register_and_get() {
        let registry = AgentKindRegistry::new();
        registry
            .register(Box::new(DummyKind::new("standard")))
            .unwrap();

        let kind = registry.get("standard");
        assert!(kind.is_some());
        assert_eq!(kind.unwrap().name(), "standard");
    }

    #[test]
    fn register_duplicate_fails() {
        let registry = AgentKindRegistry::new();
        registry
            .register(Box::new(DummyKind::new("standard")))
            .unwrap();
        let result = registry.register(Box::new(DummyKind::new("standard")));
        assert!(result.is_err());
    }

    #[test]
    fn get_nonexistent_returns_none() {
        let registry = AgentKindRegistry::new();
        assert!(registry.get("nonexistent").is_none());
    }

    #[test]
    fn disable_hides_kind() {
        let registry = AgentKindRegistry::new();
        registry
            .register(Box::new(DummyKind::new("standard")))
            .unwrap();
        registry.disable("standard").unwrap();
        assert!(registry.get("standard").is_none());
    }

    #[test]
    fn enable_restores_kind() {
        let registry = AgentKindRegistry::new();
        registry
            .register(Box::new(DummyKind::new("standard")))
            .unwrap();
        registry.disable("standard").unwrap();
        registry.enable("standard").unwrap();
        assert!(registry.get("standard").is_some());
    }

    #[test]
    fn unregister_removes_kind() {
        let registry = AgentKindRegistry::new();
        registry
            .register(Box::new(DummyKind::new("standard")))
            .unwrap();
        registry.unregister("standard").unwrap();
        assert!(registry.get("standard").is_none());
        // Can re-register after unregister
        registry
            .register(Box::new(DummyKind::new("standard")))
            .unwrap();
        assert!(registry.get("standard").is_some());
    }

    #[test]
    fn list_returns_all_with_status() {
        let registry = AgentKindRegistry::new();
        registry
            .register(Box::new(DummyKind::new("standard")))
            .unwrap();
        registry
            .register(Box::new(DummyKind::new("ephemeral")))
            .unwrap();
        registry.disable("ephemeral").unwrap();

        let list = registry.list();
        assert_eq!(list.len(), 2);

        let standard = list.iter().find(|(n, _)| n == "standard").unwrap();
        assert!(standard.1); // enabled

        let ephemeral = list.iter().find(|(n, _)| n == "ephemeral").unwrap();
        assert!(!ephemeral.1); // disabled
    }

    #[test]
    fn disable_nonexistent_fails() {
        let registry = AgentKindRegistry::new();
        assert!(registry.disable("nonexistent").is_err());
    }

    #[test]
    fn unregister_nonexistent_fails() {
        let registry = AgentKindRegistry::new();
        assert!(registry.unregister("nonexistent").is_err());
    }
}
