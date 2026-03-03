use async_trait::async_trait;
use std::path::PathBuf;

use crate::registry::{Primitive, PrimitiveError};

pub struct ConfigGetPrimitive {
    config_path: PathBuf,
}

impl ConfigGetPrimitive {
    pub fn new(config_path: PathBuf) -> Self {
        Self { config_path }
    }
}

#[async_trait]
impl Primitive for ConfigGetPrimitive {
    fn name(&self) -> &str {
        "config.get"
    }

    fn description(&self) -> &str {
        "Read global moxxy configuration. Returns a single key's value or the entire config."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "key": {"type": "string", "description": "Optional key to read. If omitted, returns the entire config."}
            }
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let config = read_config(&self.config_path)?;
        let key = params.get("key").and_then(|v| v.as_str());

        match key {
            Some(k) => {
                let value = config.get(k).cloned().unwrap_or(serde_json::Value::Null);
                Ok(serde_json::json!({ "key": k, "value": value }))
            }
            None => Ok(serde_json::json!({ "config": config })),
        }
    }
}

pub struct ConfigSetPrimitive {
    config_path: PathBuf,
}

impl ConfigSetPrimitive {
    pub fn new(config_path: PathBuf) -> Self {
        Self { config_path }
    }
}

#[async_trait]
impl Primitive for ConfigSetPrimitive {
    fn name(&self) -> &str {
        "config.set"
    }

    fn description(&self) -> &str {
        "Set a key in the global moxxy configuration."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "key": {"type": "string", "description": "The config key to set"},
                "value": {"description": "The value to set (any JSON type)"}
            },
            "required": ["key", "value"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let key = params["key"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'key' parameter".into()))?;
        let value = params
            .get("value")
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'value' parameter".into()))?;

        let mut config = read_config(&self.config_path)?;
        config
            .as_object_mut()
            .ok_or_else(|| PrimitiveError::ExecutionFailed("config is not a JSON object".into()))?
            .insert(key.to_string(), value.clone());

        write_config(&self.config_path, &config)?;

        Ok(serde_json::json!({
            "status": "updated",
            "key": key,
            "value": value
        }))
    }
}

fn read_config(path: &PathBuf) -> Result<serde_json::Value, PrimitiveError> {
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    let content = std::fs::read_to_string(path)
        .map_err(|e| PrimitiveError::ExecutionFailed(format!("failed to read config: {}", e)))?;
    if content.trim().is_empty() {
        return Ok(serde_json::json!({}));
    }
    serde_json::from_str(&content)
        .map_err(|e| PrimitiveError::ExecutionFailed(format!("failed to parse config: {}", e)))
}

fn write_config(path: &PathBuf, config: &serde_json::Value) -> Result<(), PrimitiveError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("failed to create dir: {}", e)))?;
    }
    let content = serde_json::to_string_pretty(config).map_err(|e| {
        PrimitiveError::ExecutionFailed(format!("failed to serialize config: {}", e))
    })?;
    std::fs::write(path, content)
        .map_err(|e| PrimitiveError::ExecutionFailed(format!("failed to write config: {}", e)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn config_set_and_get() {
        let tmp = TempDir::new().unwrap();
        let config_path = tmp.path().join("config").join("gateway.json");

        let setter = ConfigSetPrimitive::new(config_path.clone());
        let result = setter
            .invoke(serde_json::json!({"key": "log_level", "value": "debug"}))
            .await
            .unwrap();
        assert_eq!(result["status"], "updated");

        let getter = ConfigGetPrimitive::new(config_path);
        let result = getter
            .invoke(serde_json::json!({"key": "log_level"}))
            .await
            .unwrap();
        assert_eq!(result["value"], "debug");
    }

    #[tokio::test]
    async fn config_get_all() {
        let tmp = TempDir::new().unwrap();
        let config_path = tmp.path().join("gateway.json");

        let setter = ConfigSetPrimitive::new(config_path.clone());
        setter
            .invoke(serde_json::json!({"key": "a", "value": 1}))
            .await
            .unwrap();
        setter
            .invoke(serde_json::json!({"key": "b", "value": "hello"}))
            .await
            .unwrap();

        let getter = ConfigGetPrimitive::new(config_path);
        let result = getter.invoke(serde_json::json!({})).await.unwrap();
        let config = result["config"].as_object().unwrap();
        assert_eq!(config["a"], 1);
        assert_eq!(config["b"], "hello");
    }

    #[tokio::test]
    async fn config_get_missing_key() {
        let tmp = TempDir::new().unwrap();
        let config_path = tmp.path().join("gateway.json");

        let getter = ConfigGetPrimitive::new(config_path);
        let result = getter
            .invoke(serde_json::json!({"key": "nonexistent"}))
            .await
            .unwrap();
        assert!(result["value"].is_null());
    }

    #[tokio::test]
    async fn config_get_nonexistent_file() {
        let tmp = TempDir::new().unwrap();
        let config_path = tmp.path().join("does_not_exist.json");

        let getter = ConfigGetPrimitive::new(config_path);
        let result = getter.invoke(serde_json::json!({})).await.unwrap();
        let config = result["config"].as_object().unwrap();
        assert!(config.is_empty());
    }
}
