use moxxy_types::AgentConfig;
use std::path::Path;

/// Filesystem operations for agent YAML config and directories.
pub struct AgentStore;

impl AgentStore {
    /// List all agent directory names under `{moxxy_home}/agents/`.
    pub fn list(moxxy_home: &Path) -> Vec<String> {
        let agents_dir = moxxy_home.join("agents");
        let Ok(entries) = std::fs::read_dir(&agents_dir) else {
            return Vec::new();
        };
        entries
            .flatten()
            .filter(|e| e.path().join("agent.yaml").exists())
            .filter_map(|e| e.file_name().into_string().ok())
            .collect()
    }

    /// Read and parse `agent.yaml` for the given agent name.
    pub fn load(moxxy_home: &Path, name: &str) -> Result<AgentConfig, String> {
        let path = moxxy_home.join("agents").join(name).join("agent.yaml");
        let data =
            std::fs::read_to_string(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
        serde_yaml::from_str(&data).map_err(|e| format!("parse {}: {e}", path.display()))
    }

    /// Write `agent.yaml` for the given agent name (directory must exist).
    pub fn save(moxxy_home: &Path, name: &str, config: &AgentConfig) -> Result<(), String> {
        let path = moxxy_home.join("agents").join(name).join("agent.yaml");
        let data =
            serde_yaml::to_string(config).map_err(|e| format!("serialize agent config: {e}"))?;
        std::fs::write(&path, data).map_err(|e| format!("write {}: {e}", path.display()))
    }

    /// Create the full agent directory structure + write `agent.yaml`.
    pub fn create(moxxy_home: &Path, name: &str, config: &AgentConfig) -> Result<(), String> {
        let agent_dir = moxxy_home.join("agents").join(name);
        if agent_dir.exists() {
            return Err(format!(
                "agent directory already exists: {}",
                agent_dir.display()
            ));
        }
        std::fs::create_dir_all(agent_dir.join("workspace"))
            .map_err(|e| format!("create workspace dir: {e}"))?;
        std::fs::create_dir_all(agent_dir.join("memory"))
            .map_err(|e| format!("create memory dir: {e}"))?;
        Self::save(moxxy_home, name, config)
    }

    /// Remove the entire agent directory.
    pub fn delete(moxxy_home: &Path, name: &str) -> Result<(), String> {
        let agent_dir = moxxy_home.join("agents").join(name);
        if !agent_dir.exists() {
            return Err(format!(
                "agent directory not found: {}",
                agent_dir.display()
            ));
        }
        std::fs::remove_dir_all(&agent_dir)
            .map_err(|e| format!("remove {}: {e}", agent_dir.display()))
    }

    /// Read `persona.md` for the given agent, if it exists.
    pub fn load_persona(moxxy_home: &Path, name: &str) -> Option<String> {
        let path = moxxy_home.join("agents").join(name).join("persona.md");
        std::fs::read_to_string(&path).ok()
    }

    /// Write `persona.md` for the given agent.
    pub fn save_persona(moxxy_home: &Path, name: &str, persona: &str) -> Result<(), String> {
        let path = moxxy_home.join("agents").join(name).join("persona.md");
        std::fs::write(&path, persona).map_err(|e| format!("write persona: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_config() -> AgentConfig {
        AgentConfig {
            provider: "openai".into(),
            model: "gpt-4".into(),
            temperature: 0.7,
            max_subagent_depth: 2,
            max_subagents_total: 8,
            policy_profile: None,
            core_mount: None,
        }
    }

    #[test]
    fn create_and_load_agent() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        std::fs::create_dir_all(home.join("agents")).unwrap();

        let config = sample_config();
        AgentStore::create(home, "my-agent", &config).unwrap();

        // Verify directory structure
        assert!(home.join("agents/my-agent/agent.yaml").exists());
        assert!(home.join("agents/my-agent/workspace").is_dir());
        assert!(home.join("agents/my-agent/memory").is_dir());

        // Load and verify
        let loaded = AgentStore::load(home, "my-agent").unwrap();
        assert_eq!(loaded.provider, "openai");
        assert_eq!(loaded.model, "gpt-4");
        assert!((loaded.temperature - 0.7).abs() < f64::EPSILON);
    }

    #[test]
    fn create_duplicate_fails() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        std::fs::create_dir_all(home.join("agents")).unwrap();

        AgentStore::create(home, "dup", &sample_config()).unwrap();
        assert!(AgentStore::create(home, "dup", &sample_config()).is_err());
    }

    #[test]
    fn save_overwrites_config() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        std::fs::create_dir_all(home.join("agents")).unwrap();

        AgentStore::create(home, "upd", &sample_config()).unwrap();

        let mut updated = sample_config();
        updated.model = "gpt-4-turbo".into();
        updated.temperature = 0.9;
        AgentStore::save(home, "upd", &updated).unwrap();

        let loaded = AgentStore::load(home, "upd").unwrap();
        assert_eq!(loaded.model, "gpt-4-turbo");
        assert!((loaded.temperature - 0.9).abs() < f64::EPSILON);
    }

    #[test]
    fn delete_removes_directory() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        std::fs::create_dir_all(home.join("agents")).unwrap();

        AgentStore::create(home, "del", &sample_config()).unwrap();
        assert!(home.join("agents/del").exists());

        AgentStore::delete(home, "del").unwrap();
        assert!(!home.join("agents/del").exists());
    }

    #[test]
    fn delete_nonexistent_fails() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(AgentStore::delete(tmp.path(), "nope").is_err());
    }

    #[test]
    fn list_agents() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        std::fs::create_dir_all(home.join("agents")).unwrap();

        AgentStore::create(home, "alpha", &sample_config()).unwrap();
        AgentStore::create(home, "beta", &sample_config()).unwrap();

        // Also create a dir without agent.yaml (should be excluded)
        std::fs::create_dir_all(home.join("agents/orphan")).unwrap();

        let mut names = AgentStore::list(home);
        names.sort();
        assert_eq!(names, vec!["alpha", "beta"]);
    }

    #[test]
    fn list_empty() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(AgentStore::list(tmp.path()).is_empty());
    }

    #[test]
    fn persona_round_trip() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        std::fs::create_dir_all(home.join("agents")).unwrap();

        AgentStore::create(home, "persona-test", &sample_config()).unwrap();

        assert!(AgentStore::load_persona(home, "persona-test").is_none());

        AgentStore::save_persona(home, "persona-test", "You are a helpful assistant.").unwrap();
        let loaded = AgentStore::load_persona(home, "persona-test").unwrap();
        assert_eq!(loaded, "You are a helpful assistant.");
    }

    #[test]
    fn load_nonexistent_fails() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(AgentStore::load(tmp.path(), "nope").is_err());
    }

    #[test]
    fn yaml_defaults_applied() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        let agent_dir = home.join("agents/minimal");
        std::fs::create_dir_all(&agent_dir).unwrap();

        // Write minimal YAML (only required fields)
        std::fs::write(
            agent_dir.join("agent.yaml"),
            "provider: anthropic\nmodel: claude-3-opus\n",
        )
        .unwrap();

        let loaded = AgentStore::load(home, "minimal").unwrap();
        assert_eq!(loaded.provider, "anthropic");
        assert_eq!(loaded.model, "claude-3-opus");
        assert!((loaded.temperature - 0.7).abs() < f64::EPSILON);
        assert_eq!(loaded.max_subagent_depth, 2);
        assert_eq!(loaded.max_subagents_total, 8);
        assert!(loaded.policy_profile.is_none());
        assert!(loaded.core_mount.is_none());
    }
}
