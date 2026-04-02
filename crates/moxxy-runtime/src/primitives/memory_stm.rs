use async_trait::async_trait;
use std::collections::BTreeMap;
use std::path::PathBuf;

use crate::registry::{Primitive, PrimitiveError};

pub struct MemoryStmReadPrimitive {
    stm_path: PathBuf,
}

impl MemoryStmReadPrimitive {
    pub fn new(stm_path: PathBuf) -> Self {
        Self { stm_path }
    }
}

#[async_trait]
impl Primitive for MemoryStmReadPrimitive {
    fn name(&self) -> &str {
        "memory.stm_read"
    }

    fn description(&self) -> &str {
        "Read short-term memory (STM). Returns a single key's value or the entire STM map."
    }

    fn is_concurrent_safe(&self) -> bool {
        true
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "key": {"type": "string", "description": "Optional key to read. If omitted, returns all STM entries."}
            }
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let map = read_stm(&self.stm_path)?;
        let key = params.get("key").and_then(|v| v.as_str());

        match key {
            Some(k) => {
                let value = map.get(k).cloned();
                Ok(serde_json::json!({ "key": k, "value": value }))
            }
            None => {
                let entries: serde_json::Value = map
                    .into_iter()
                    .map(|(k, v)| (k, serde_json::Value::String(v)))
                    .collect();
                Ok(serde_json::json!({ "entries": entries }))
            }
        }
    }
}

pub struct MemoryStmWritePrimitive {
    stm_path: PathBuf,
}

impl MemoryStmWritePrimitive {
    pub fn new(stm_path: PathBuf) -> Self {
        Self { stm_path }
    }
}

#[async_trait]
impl Primitive for MemoryStmWritePrimitive {
    fn name(&self) -> &str {
        "memory.stm_write"
    }

    fn description(&self) -> &str {
        "Write to short-term memory (STM). Set a key-value pair, or delete a key by setting value to null."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "key": {"type": "string", "description": "The key to set or delete"},
                "value": {"type": ["string", "null"], "description": "The value to store. Use null to delete the key."}
            },
            "required": ["key"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let key = params["key"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'key' parameter".into()))?;

        let mut map = read_stm(&self.stm_path)?;

        if params["value"].is_null() || params.get("value").is_none() {
            map.remove(key);
            write_stm(&self.stm_path, &map)?;
            Ok(serde_json::json!({ "key": key, "deleted": true }))
        } else {
            let value = params["value"].as_str().ok_or_else(|| {
                PrimitiveError::InvalidParams("'value' must be a string or null".into())
            })?;
            map.insert(key.to_string(), value.to_string());
            write_stm(&self.stm_path, &map)?;
            Ok(serde_json::json!({ "key": key, "value": value }))
        }
    }
}

fn read_stm(path: &PathBuf) -> Result<BTreeMap<String, String>, PrimitiveError> {
    if !path.exists() {
        return Ok(BTreeMap::new());
    }
    let content = std::fs::read_to_string(path)
        .map_err(|e| PrimitiveError::ExecutionFailed(format!("failed to read STM: {}", e)))?;
    if content.trim().is_empty() {
        return Ok(BTreeMap::new());
    }
    serde_yaml::from_str(&content)
        .map_err(|e| PrimitiveError::ExecutionFailed(format!("failed to parse STM: {}", e)))
}

fn write_stm(path: &PathBuf, map: &BTreeMap<String, String>) -> Result<(), PrimitiveError> {
    let content = serde_yaml::to_string(map)
        .map_err(|e| PrimitiveError::ExecutionFailed(format!("failed to serialize STM: {}", e)))?;
    std::fs::write(path, content)
        .map_err(|e| PrimitiveError::ExecutionFailed(format!("failed to write STM: {}", e)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn stm_write_and_read_key() {
        let tmp = TempDir::new().unwrap();
        let stm_path = tmp.path().join("memory.yaml");

        let writer = MemoryStmWritePrimitive::new(stm_path.clone());
        let result = writer
            .invoke(serde_json::json!({"key": "current_task", "value": "building auth"}))
            .await
            .unwrap();
        assert_eq!(result["key"], "current_task");
        assert_eq!(result["value"], "building auth");

        let reader = MemoryStmReadPrimitive::new(stm_path);
        let result = reader
            .invoke(serde_json::json!({"key": "current_task"}))
            .await
            .unwrap();
        assert_eq!(result["value"], "building auth");
    }

    #[tokio::test]
    async fn stm_read_all() {
        let tmp = TempDir::new().unwrap();
        let stm_path = tmp.path().join("memory.yaml");

        let writer = MemoryStmWritePrimitive::new(stm_path.clone());
        writer
            .invoke(serde_json::json!({"key": "a", "value": "1"}))
            .await
            .unwrap();
        writer
            .invoke(serde_json::json!({"key": "b", "value": "2"}))
            .await
            .unwrap();

        let reader = MemoryStmReadPrimitive::new(stm_path);
        let result = reader.invoke(serde_json::json!({})).await.unwrap();
        let entries = result["entries"].as_object().unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries["a"], "1");
        assert_eq!(entries["b"], "2");
    }

    #[tokio::test]
    async fn stm_delete_key() {
        let tmp = TempDir::new().unwrap();
        let stm_path = tmp.path().join("memory.yaml");

        let writer = MemoryStmWritePrimitive::new(stm_path.clone());
        writer
            .invoke(serde_json::json!({"key": "temp", "value": "data"}))
            .await
            .unwrap();

        let result = writer
            .invoke(serde_json::json!({"key": "temp", "value": null}))
            .await
            .unwrap();
        assert_eq!(result["deleted"], true);

        let reader = MemoryStmReadPrimitive::new(stm_path);
        let result = reader
            .invoke(serde_json::json!({"key": "temp"}))
            .await
            .unwrap();
        assert!(result["value"].is_null());
    }

    #[tokio::test]
    async fn stm_read_empty_file() {
        let tmp = TempDir::new().unwrap();
        let stm_path = tmp.path().join("memory.yaml");

        let reader = MemoryStmReadPrimitive::new(stm_path);
        let result = reader.invoke(serde_json::json!({})).await.unwrap();
        let entries = result["entries"].as_object().unwrap();
        assert!(entries.is_empty());
    }
}
