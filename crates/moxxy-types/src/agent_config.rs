use serde::{Deserialize, Serialize};
use std::path::Path;

fn default_temperature() -> f64 {
    0.7
}
fn default_depth() -> i32 {
    2
}
fn default_total() -> i32 {
    8
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AgentConfig {
    pub name: String,
    pub provider_id: String,
    pub model_id: String,
    #[serde(default = "default_temperature")]
    pub temperature: f64,
    #[serde(default = "default_depth")]
    pub max_subagent_depth: i32,
    #[serde(default = "default_total")]
    pub max_subagents_total: i32,
    pub policy_profile: Option<String>,
}

impl AgentConfig {
    pub fn load(path: &Path) -> Result<Self, String> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| format!("failed to read {:?}: {}", path, e))?;
        serde_yaml::from_str(&content).map_err(|e| format!("failed to parse {:?}: {}", path, e))
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        let content = serde_yaml::to_string(self)
            .map_err(|e| format!("failed to serialize config: {}", e))?;
        std::fs::write(path, content).map_err(|e| format!("failed to write {:?}: {}", path, e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_yaml() {
        let config = AgentConfig {
            name: "my-agent".into(),
            provider_id: "anthropic".into(),
            model_id: "claude-sonnet-4-6".into(),
            temperature: 0.7,
            max_subagent_depth: 2,
            max_subagents_total: 8,
            policy_profile: Some("standard".into()),
        };
        let yaml = serde_yaml::to_string(&config).unwrap();
        let parsed: AgentConfig = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(config, parsed);
    }

    #[test]
    fn load_and_save() {
        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join("agent.yaml");
        let config = AgentConfig {
            name: "test-agent".into(),
            provider_id: "openai".into(),
            model_id: "gpt-4".into(),
            temperature: 1.0,
            max_subagent_depth: 3,
            max_subagents_total: 10,
            policy_profile: None,
        };
        config.save(&path).unwrap();
        let loaded = AgentConfig::load(&path).unwrap();
        assert_eq!(config, loaded);
    }

    #[test]
    fn defaults_applied() {
        let yaml = "name: minimal\nprovider_id: test\nmodel_id: test-model\n";
        let config: AgentConfig = serde_yaml::from_str(yaml).unwrap();
        assert!((config.temperature - 0.7).abs() < f64::EPSILON);
        assert_eq!(config.max_subagent_depth, 2);
        assert_eq!(config.max_subagents_total, 8);
        assert!(config.policy_profile.is_none());
    }
}
