use async_trait::async_trait;
use moxxy_storage::Database;
use moxxy_types::AgentConfig;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

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
                "name": config.name,
                "provider_id": config.provider_id,
                "model_id": config.model_id,
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
    db: Arc<Mutex<Database>>,
    agent_id: String,
    agent_dir: PathBuf,
}

impl AgentSelfUpdatePrimitive {
    pub fn new(db: Arc<Mutex<Database>>, agent_id: String, agent_dir: PathBuf) -> Self {
        Self {
            db,
            agent_id,
            agent_dir,
        }
    }
}

fn is_valid_agent_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && name
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
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
                "name": {"type": "string", "description": "New agent name (1-64 chars, lowercase alphanumeric + hyphens)"},
                "provider_id": {"type": "string", "description": "New provider ID"},
                "model_id": {"type": "string", "description": "New model ID"},
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
        if let Some(name) = params.get("name").and_then(|v| v.as_str()) {
            if !is_valid_agent_name(name) {
                return Err(PrimitiveError::InvalidParams(
                    "name must be 1-64 chars, lowercase alphanumeric + hyphens".into(),
                ));
            }
            config.name = name.to_string();
        }
        if let Some(provider_id) = params.get("provider_id").and_then(|v| v.as_str()) {
            config.provider_id = provider_id.to_string();
        }
        if let Some(model_id) = params.get("model_id").and_then(|v| v.as_str()) {
            config.model_id = model_id.to_string();
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

        // If name changed, sync to DB
        if params.get("name").and_then(|v| v.as_str()).is_some() {
            let db = self
                .db
                .lock()
                .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;
            db.agents()
                .update_name(&self.agent_id, &config.name)
                .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;
        }

        Ok(serde_json::json!({
            "status": "updated",
            "config": {
                "name": config.name,
                "provider_id": config.provider_id,
                "model_id": config.model_id,
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
            name: "test-agent".into(),
            provider_id: "anthropic".into(),
            model_id: "claude-sonnet-4-6".into(),
            temperature: 0.7,
            max_subagent_depth: 2,
            max_subagents_total: 8,
            policy_profile: None,
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

        assert_eq!(result["config"]["name"], "test-agent");
        assert_eq!(result["config"]["provider_id"], "anthropic");
        assert_eq!(result["persona"], "You are a helpful assistant.");
    }

    #[tokio::test]
    async fn self_update_changes_config() {
        let (_tmp, agent_dir) = setup();

        let test_db = moxxy_test_utils::TestDb::new();
        let db = Database::new(test_db.into_conn());
        let db = Arc::new(Mutex::new(db));
        let agent_id = uuid::Uuid::now_v7().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        {
            let db_lock = db.lock().unwrap();
            db_lock
                .agents()
                .insert(&moxxy_storage::AgentRow {
                    id: agent_id.clone(),
                    parent_agent_id: None,
                    name: Some("test-agent".into()),
                    status: "idle".into(),
                    depth: 0,
                    spawned_total: 0,
                    workspace_root: "/tmp/test".into(),
                    created_at: now.clone(),
                    updated_at: now,
                })
                .unwrap();
        }

        let prim = AgentSelfUpdatePrimitive::new(db, agent_id, agent_dir.clone());
        let result = prim
            .invoke(serde_json::json!({"temperature": 1.2, "model_id": "gpt-4"}))
            .await
            .unwrap();
        assert_eq!(result["status"], "updated");

        // Verify the file was updated
        let config = AgentConfig::load(&agent_dir.join("agent.yaml")).unwrap();
        assert!((config.temperature - 1.2).abs() < f64::EPSILON);
        assert_eq!(config.model_id, "gpt-4");
    }

    #[tokio::test]
    async fn self_update_validates_temperature() {
        let (_tmp, agent_dir) = setup();

        let test_db = moxxy_test_utils::TestDb::new();
        let db = Database::new(test_db.into_conn());
        let db = Arc::new(Mutex::new(db));

        let prim = AgentSelfUpdatePrimitive::new(db, "some-id".into(), agent_dir);
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
