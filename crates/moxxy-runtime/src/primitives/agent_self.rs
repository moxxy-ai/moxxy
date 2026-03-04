use async_trait::async_trait;
use moxxy_types::AgentConfig;
use std::path::PathBuf;

use crate::registry::{Primitive, PrimitiveError};

pub struct AgentSelfGetPrimitive {
    agent_dir: PathBuf,
}

impl AgentSelfGetPrimitive {
    pub fn new(agent_dir: PathBuf) -> Self {
        Self { agent_dir }
    }
}

#[async_trait]
impl Primitive for AgentSelfGetPrimitive {
    fn name(&self) -> &str {
        "agent.self.get"
    }

    fn description(&self) -> &str {
        "Read the agent's own configuration (agent.yaml) and persona (persona.md)."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {}
        })
    }

    async fn invoke(
        &self,
        _params: serde_json::Value,
    ) -> Result<serde_json::Value, PrimitiveError> {
        let config_path = self.agent_dir.join("agent.yaml");
        let persona_path = self.agent_dir.join("persona.md");

        let config = AgentConfig::load(&config_path).map_err(PrimitiveError::ExecutionFailed)?;

        let persona = std::fs::read_to_string(&persona_path).unwrap_or_default();

        Ok(serde_json::json!({
            "config": {
                "provider": config.provider,
                "model": config.model,
                "temperature": config.temperature,
                "max_subagent_depth": config.max_subagent_depth,
                "max_subagents_total": config.max_subagents_total,
                "policy_profile": config.policy_profile,
            },
            "persona": persona,
        }))
    }
}

pub struct AgentSelfUpdatePrimitive {
    agent_dir: PathBuf,
}

impl AgentSelfUpdatePrimitive {
    pub fn new(agent_dir: PathBuf) -> Self {
        Self { agent_dir }
    }
}

#[async_trait]
impl Primitive for AgentSelfUpdatePrimitive {
    fn name(&self) -> &str {
        "agent.self.update"
    }

    fn description(&self) -> &str {
        "Update the agent's own configuration (agent.yaml). Can change name, temperature, provider, model, and limits."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "provider": {"type": "string", "description": "New provider ID"},
                "model": {"type": "string", "description": "New model ID"},
                "temperature": {"type": "number", "description": "New temperature (0.0-2.0)"},
                "max_subagent_depth": {"type": "integer", "description": "Max sub-agent depth"},
                "max_subagents_total": {"type": "integer", "description": "Max total sub-agents"},
                "policy_profile": {"type": ["string", "null"], "description": "Policy profile name"}
            }
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let config_path = self.agent_dir.join("agent.yaml");
        let mut config =
            AgentConfig::load(&config_path).map_err(PrimitiveError::ExecutionFailed)?;

        // Apply updates
        if let Some(provider) = params.get("provider").and_then(|v| v.as_str()) {
            config.provider = provider.to_string();
        }
        if let Some(model) = params.get("model").and_then(|v| v.as_str()) {
            config.model = model.to_string();
        }
        if let Some(temp) = params.get("temperature").and_then(|v| v.as_f64()) {
            if !(0.0..=2.0).contains(&temp) {
                return Err(PrimitiveError::InvalidParams(
                    "temperature must be between 0.0 and 2.0".into(),
                ));
            }
            config.temperature = temp;
        }
        if let Some(depth) = params.get("max_subagent_depth").and_then(|v| v.as_i64()) {
            config.max_subagent_depth = depth as i32;
        }
        if let Some(total) = params.get("max_subagents_total").and_then(|v| v.as_i64()) {
            config.max_subagents_total = total as i32;
        }
        if let Some(profile) = params.get("policy_profile") {
            config.policy_profile = profile.as_str().map(|s| s.to_string());
        }

        config
            .save(&config_path)
            .map_err(PrimitiveError::ExecutionFailed)?;

        Ok(serde_json::json!({
            "status": "updated",
            "config": {
                "provider": config.provider,
                "model": config.model,
                "temperature": config.temperature,
            }
        }))
    }
}

pub struct AgentSelfPersonaReadPrimitive {
    agent_dir: PathBuf,
}

impl AgentSelfPersonaReadPrimitive {
    pub fn new(agent_dir: PathBuf) -> Self {
        Self { agent_dir }
    }
}

#[async_trait]
impl Primitive for AgentSelfPersonaReadPrimitive {
    fn name(&self) -> &str {
        "agent.self.persona_read"
    }

    fn description(&self) -> &str {
        "Read the agent's persona (system prompt) from persona.md."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {}
        })
    }

    async fn invoke(
        &self,
        _params: serde_json::Value,
    ) -> Result<serde_json::Value, PrimitiveError> {
        let persona_path = self.agent_dir.join("persona.md");
        let content = std::fs::read_to_string(&persona_path).unwrap_or_default();
        Ok(serde_json::json!({ "persona": content }))
    }
}

pub struct AgentSelfPersonaWritePrimitive {
    agent_dir: PathBuf,
}

impl AgentSelfPersonaWritePrimitive {
    pub fn new(agent_dir: PathBuf) -> Self {
        Self { agent_dir }
    }
}

#[async_trait]
impl Primitive for AgentSelfPersonaWritePrimitive {
    fn name(&self) -> &str {
        "agent.self.persona_write"
    }

    fn description(&self) -> &str {
        "Write the agent's persona (system prompt) to persona.md."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "content": {"type": "string", "description": "The persona content (markdown)"}
            },
            "required": ["content"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let content = params["content"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'content' parameter".into()))?;

        let persona_path = self.agent_dir.join("persona.md");
        std::fs::write(&persona_path, content).map_err(|e| {
            PrimitiveError::ExecutionFailed(format!("failed to write persona: {}", e))
        })?;

        Ok(serde_json::json!({
            "status": "updated",
            "length": content.len()
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup() -> (TempDir, PathBuf) {
        let tmp = TempDir::new().unwrap();
        let agent_dir = tmp.path().to_path_buf();

        let config = AgentConfig {
            provider: "anthropic".into(),
            model: "claude-sonnet-4-6".into(),
            temperature: 0.7,
            max_subagent_depth: 2,
            max_subagents_total: 8,
            policy_profile: None,
            core_mount: None,
        };
        config.save(&agent_dir.join("agent.yaml")).unwrap();
        std::fs::write(agent_dir.join("persona.md"), "You are a helpful assistant.").unwrap();

        (tmp, agent_dir)
    }

    #[tokio::test]
    async fn self_get_reads_config_and_persona() {
        let (_tmp, agent_dir) = setup();

        let prim = AgentSelfGetPrimitive::new(agent_dir);
        let result = prim.invoke(serde_json::json!({})).await.unwrap();

        assert_eq!(result["config"]["provider"], "anthropic");
        assert_eq!(result["persona"], "You are a helpful assistant.");
    }

    #[tokio::test]
    async fn self_update_changes_config() {
        let (_tmp, agent_dir) = setup();

        let prim = AgentSelfUpdatePrimitive::new(agent_dir.clone());
        let result = prim
            .invoke(serde_json::json!({"temperature": 1.2, "model": "gpt-4"}))
            .await
            .unwrap();
        assert_eq!(result["status"], "updated");

        // Verify the file was updated
        let config = AgentConfig::load(&agent_dir.join("agent.yaml")).unwrap();
        assert!((config.temperature - 1.2).abs() < f64::EPSILON);
        assert_eq!(config.model, "gpt-4");
    }

    #[tokio::test]
    async fn self_update_validates_temperature() {
        let (_tmp, agent_dir) = setup();

        let prim = AgentSelfUpdatePrimitive::new(agent_dir);
        let result = prim.invoke(serde_json::json!({"temperature": 3.0})).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn persona_read_and_write() {
        let (_tmp, agent_dir) = setup();

        let writer = AgentSelfPersonaWritePrimitive::new(agent_dir.clone());
        let result = writer
            .invoke(serde_json::json!({"content": "# New Persona\nYou are an expert coder."}))
            .await
            .unwrap();
        assert_eq!(result["status"], "updated");

        let reader = AgentSelfPersonaReadPrimitive::new(agent_dir);
        let result = reader.invoke(serde_json::json!({})).await.unwrap();
        assert_eq!(result["persona"], "# New Persona\nYou are an expert coder.");
    }
}
