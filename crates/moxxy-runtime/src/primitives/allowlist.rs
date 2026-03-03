use async_trait::async_trait;
use moxxy_storage::{AllowlistRow, Database};
use std::sync::{Arc, Mutex};

use crate::registry::{Primitive, PrimitiveError};

const VALID_LIST_TYPES: &[&str] = &["shell_command", "http_domain", "primitive"];

fn validate_list_type(list_type: &str) -> Result<(), PrimitiveError> {
    if !VALID_LIST_TYPES.contains(&list_type) {
        return Err(PrimitiveError::InvalidParams(format!(
            "invalid list_type '{}', must be one of: {}",
            list_type,
            VALID_LIST_TYPES.join(", ")
        )));
    }
    Ok(())
}

pub struct AllowlistListPrimitive {
    db: Arc<Mutex<Database>>,
    agent_id: String,
}

impl AllowlistListPrimitive {
    pub fn new(db: Arc<Mutex<Database>>, agent_id: String) -> Self {
        Self { db, agent_id }
    }
}

#[async_trait]
impl Primitive for AllowlistListPrimitive {
    fn name(&self) -> &str {
        "allowlist.list"
    }

    fn description(&self) -> &str {
        "List entries in an allowlist for the current agent."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "list_type": {
                    "type": "string",
                    "description": "Type of allowlist: shell_command, http_domain, or primitive",
                    "enum": ["shell_command", "http_domain", "primitive"]
                }
            },
            "required": ["list_type"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let list_type = params["list_type"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'list_type'".into()))?;
        validate_list_type(list_type)?;

        let db_entries = {
            let db = self
                .db
                .lock()
                .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;
            db.allowlists()
                .list_entries(&self.agent_id, list_type)
                .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?
        };

        let defaults = crate::defaults::default_entries(list_type);
        let merged = crate::defaults::merge_with_defaults(db_entries.clone(), list_type);

        Ok(serde_json::json!({
            "list_type": list_type,
            "entries": merged,
            "count": merged.len(),
            "default_count": defaults.len(),
            "custom_count": db_entries.len(),
        }))
    }
}

pub struct AllowlistAddPrimitive {
    db: Arc<Mutex<Database>>,
    agent_id: String,
}

impl AllowlistAddPrimitive {
    pub fn new(db: Arc<Mutex<Database>>, agent_id: String) -> Self {
        Self { db, agent_id }
    }
}

#[async_trait]
impl Primitive for AllowlistAddPrimitive {
    fn name(&self) -> &str {
        "allowlist.add"
    }

    fn description(&self) -> &str {
        "Add an entry to an allowlist for the current agent."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "list_type": {
                    "type": "string",
                    "description": "Type of allowlist: shell_command, http_domain, or primitive",
                    "enum": ["shell_command", "http_domain", "primitive"]
                },
                "entry": {
                    "type": "string",
                    "description": "The entry to add (command name, domain, or primitive name)"
                }
            },
            "required": ["list_type", "entry"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let list_type = params["list_type"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'list_type'".into()))?;
        let entry = params["entry"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'entry'".into()))?;
        validate_list_type(list_type)?;

        if entry.is_empty() {
            return Err(PrimitiveError::InvalidParams(
                "entry must not be empty".into(),
            ));
        }

        let row = AllowlistRow {
            id: uuid::Uuid::now_v7().to_string(),
            agent_id: self.agent_id.clone(),
            list_type: list_type.into(),
            entry: entry.into(),
            created_at: chrono::Utc::now().to_rfc3339(),
        };

        let db = self
            .db
            .lock()
            .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;

        match db.allowlists().insert(&row) {
            Ok(()) => {}
            Err(moxxy_types::StorageError::DuplicateKey(_)) => {
                // Idempotent = already exists
            }
            Err(e) => return Err(PrimitiveError::ExecutionFailed(e.to_string())),
        }

        Ok(serde_json::json!({
            "status": "added",
            "list_type": list_type,
            "entry": entry,
        }))
    }
}

pub struct AllowlistRemovePrimitive {
    db: Arc<Mutex<Database>>,
    agent_id: String,
}

impl AllowlistRemovePrimitive {
    pub fn new(db: Arc<Mutex<Database>>, agent_id: String) -> Self {
        Self { db, agent_id }
    }
}

#[async_trait]
impl Primitive for AllowlistRemovePrimitive {
    fn name(&self) -> &str {
        "allowlist.remove"
    }

    fn description(&self) -> &str {
        "Remove an entry from an allowlist for the current agent."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "list_type": {
                    "type": "string",
                    "description": "Type of allowlist: shell_command, http_domain, or primitive",
                    "enum": ["shell_command", "http_domain", "primitive"]
                },
                "entry": {
                    "type": "string",
                    "description": "The entry to remove"
                }
            },
            "required": ["list_type", "entry"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let list_type = params["list_type"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'list_type'".into()))?;
        let entry = params["entry"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'entry'".into()))?;
        validate_list_type(list_type)?;

        let db = self
            .db
            .lock()
            .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;
        db.allowlists()
            .delete_entry(&self.agent_id, list_type, entry)
            .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;

        Ok(serde_json::json!({
            "status": "removed",
            "list_type": list_type,
            "entry": entry,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use moxxy_test_utils::TestDb;

    fn setup_db() -> (Arc<Mutex<Database>>, String) {
        let test_db = TestDb::new();
        let db = Database::new(test_db.into_conn());
        db.providers()
            .insert(&moxxy_storage::ProviderRow {
                id: "test-provider".into(),
                display_name: "Test".into(),
                manifest_path: "/tmp".into(),
                signature: None,
                enabled: true,
                created_at: chrono::Utc::now().to_rfc3339(),
            })
            .unwrap();
        let agent_id = uuid::Uuid::now_v7().to_string();
        db.agents()
            .insert(&moxxy_storage::AgentRow {
                id: agent_id.clone(),
                parent_agent_id: None,
                provider_id: "test-provider".into(),
                model_id: "test-model".into(),
                workspace_root: "/tmp".into(),
                core_mount: None,
                policy_profile: None,
                temperature: 0.7,
                max_subagent_depth: 2,
                max_subagents_total: 8,
                status: "idle".into(),
                depth: 0,
                spawned_total: 0,
                created_at: chrono::Utc::now().to_rfc3339(),
                updated_at: chrono::Utc::now().to_rfc3339(),
                name: Some("test-agent".into()),
                persona: None,
            })
            .unwrap();
        (Arc::new(Mutex::new(db)), agent_id)
    }

    #[tokio::test]
    async fn allowlist_list_returns_entries() {
        let (db, agent_id) = setup_db();
        // Seed a custom entry not in defaults
        {
            let d = db.lock().unwrap();
            d.allowlists()
                .insert(&AllowlistRow {
                    id: uuid::Uuid::now_v7().to_string(),
                    agent_id: agent_id.clone(),
                    list_type: "shell_command".into(),
                    entry: "my-custom-tool".into(),
                    created_at: chrono::Utc::now().to_rfc3339(),
                })
                .unwrap();
        }

        let prim = AllowlistListPrimitive::new(db, agent_id);
        let result = prim
            .invoke(serde_json::json!({"list_type": "shell_command"}))
            .await
            .unwrap();
        let defaults_count = crate::defaults::default_entries("shell_command").len();
        // Merged = defaults + 1 custom entry
        assert_eq!(result["count"], defaults_count + 1);
        assert_eq!(result["custom_count"], 1);
        assert_eq!(result["default_count"], defaults_count);
        let entries = result["entries"].as_array().unwrap();
        assert!(entries.iter().any(|e| e == "my-custom-tool"));
        assert!(entries.iter().any(|e| e == "ls"));
    }

    #[tokio::test]
    async fn allowlist_list_rejects_invalid_type() {
        let (db, agent_id) = setup_db();
        let prim = AllowlistListPrimitive::new(db, agent_id);
        let result = prim
            .invoke(serde_json::json!({"list_type": "invalid"}))
            .await;
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::InvalidParams(_)
        ));
    }

    #[tokio::test]
    async fn allowlist_add_inserts_entry() {
        let (db, agent_id) = setup_db();
        let prim = AllowlistAddPrimitive::new(db.clone(), agent_id.clone());
        let result = prim
            .invoke(serde_json::json!({"list_type": "http_domain", "entry": "example.com"}))
            .await
            .unwrap();
        assert_eq!(result["status"], "added");

        // Verify it's in DB
        let d = db.lock().unwrap();
        let entries = d
            .allowlists()
            .list_entries(&agent_id, "http_domain")
            .unwrap();
        assert!(entries.contains(&"example.com".to_string()));
    }

    #[tokio::test]
    async fn allowlist_add_is_idempotent() {
        let (db, agent_id) = setup_db();
        let prim = AllowlistAddPrimitive::new(db, agent_id);
        prim.invoke(serde_json::json!({"list_type": "shell_command", "entry": "ls"}))
            .await
            .unwrap();
        // Adding again should succeed (idempotent)
        let result = prim
            .invoke(serde_json::json!({"list_type": "shell_command", "entry": "ls"}))
            .await
            .unwrap();
        assert_eq!(result["status"], "added");
    }

    #[tokio::test]
    async fn allowlist_add_rejects_empty_entry() {
        let (db, agent_id) = setup_db();
        let prim = AllowlistAddPrimitive::new(db, agent_id);
        let result = prim
            .invoke(serde_json::json!({"list_type": "shell_command", "entry": ""}))
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn allowlist_remove_deletes_entry() {
        let (db, agent_id) = setup_db();
        // Seed an entry
        {
            let d = db.lock().unwrap();
            d.allowlists()
                .insert(&AllowlistRow {
                    id: uuid::Uuid::now_v7().to_string(),
                    agent_id: agent_id.clone(),
                    list_type: "shell_command".into(),
                    entry: "ls".into(),
                    created_at: chrono::Utc::now().to_rfc3339(),
                })
                .unwrap();
        }

        let prim = AllowlistRemovePrimitive::new(db.clone(), agent_id.clone());
        let result = prim
            .invoke(serde_json::json!({"list_type": "shell_command", "entry": "ls"}))
            .await
            .unwrap();
        assert_eq!(result["status"], "removed");

        // Verify it's gone
        let d = db.lock().unwrap();
        let entries = d
            .allowlists()
            .list_entries(&agent_id, "shell_command")
            .unwrap();
        assert!(entries.is_empty());
    }

    #[tokio::test]
    async fn allowlist_remove_nonexistent_succeeds() {
        let (db, agent_id) = setup_db();
        let prim = AllowlistRemovePrimitive::new(db, agent_id);
        let result = prim
            .invoke(serde_json::json!({"list_type": "shell_command", "entry": "nonexistent"}))
            .await
            .unwrap();
        assert_eq!(result["status"], "removed");
    }
}
