use async_trait::async_trait;
use std::path::PathBuf;

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
    allowlist_path: PathBuf,
}

impl AllowlistListPrimitive {
    pub fn new(allowlist_path: PathBuf) -> Self {
        Self { allowlist_path }
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

    fn is_concurrent_safe(&self) -> bool {
        true
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

        let file = moxxy_core::AllowlistFile::load(&self.allowlist_path);
        let custom_entries = file.allows(list_type);
        let denied_entries = file.denials(list_type);

        let defaults = crate::defaults::default_entries(list_type);
        let merged = crate::defaults::merge_with_defaults_and_denials(
            custom_entries.clone(),
            denied_entries.clone(),
            list_type,
        );

        Ok(serde_json::json!({
            "list_type": list_type,
            "entries": merged,
            "count": merged.len(),
            "default_count": defaults.len(),
            "custom_count": custom_entries.len(),
            "denied_entries": denied_entries,
            "denied_count": denied_entries.len(),
        }))
    }
}

pub struct AllowlistAddPrimitive {
    allowlist_path: PathBuf,
}

impl AllowlistAddPrimitive {
    pub fn new(allowlist_path: PathBuf) -> Self {
        Self { allowlist_path }
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

        let mut file = moxxy_core::AllowlistFile::load(&self.allowlist_path);
        file.add_allow(list_type, entry.to_string());
        file.save(&self.allowlist_path)
            .map_err(PrimitiveError::ExecutionFailed)?;

        Ok(serde_json::json!({
            "status": "added",
            "list_type": list_type,
            "entry": entry,
        }))
    }
}

pub struct AllowlistRemovePrimitive {
    allowlist_path: PathBuf,
}

impl AllowlistRemovePrimitive {
    pub fn new(allowlist_path: PathBuf) -> Self {
        Self { allowlist_path }
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

        let mut file = moxxy_core::AllowlistFile::load(&self.allowlist_path);
        file.remove_allow(list_type, entry);
        file.save(&self.allowlist_path)
            .map_err(PrimitiveError::ExecutionFailed)?;

        Ok(serde_json::json!({
            "status": "removed",
            "list_type": list_type,
            "entry": entry,
        }))
    }
}

pub struct AllowlistDenyPrimitive {
    allowlist_path: PathBuf,
}

impl AllowlistDenyPrimitive {
    pub fn new(allowlist_path: PathBuf) -> Self {
        Self { allowlist_path }
    }
}

#[async_trait]
impl Primitive for AllowlistDenyPrimitive {
    fn name(&self) -> &str {
        "allowlist.deny"
    }

    fn description(&self) -> &str {
        "Deny an entry, removing it from the effective allowlist even if it is a default."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "list_type": {
                    "type": "string",
                    "description": "Type of list: shell_command, http_domain, or primitive",
                    "enum": ["shell_command", "http_domain", "primitive"]
                },
                "entry": {
                    "type": "string",
                    "description": "The entry to deny (command name, domain, or primitive name)"
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

        let mut file = moxxy_core::AllowlistFile::load(&self.allowlist_path);
        file.add_deny(list_type, entry.to_string());
        file.save(&self.allowlist_path)
            .map_err(PrimitiveError::ExecutionFailed)?;

        Ok(serde_json::json!({
            "status": "denied",
            "list_type": list_type,
            "entry": entry,
        }))
    }
}

pub struct AllowlistUndenyPrimitive {
    allowlist_path: PathBuf,
}

impl AllowlistUndenyPrimitive {
    pub fn new(allowlist_path: PathBuf) -> Self {
        Self { allowlist_path }
    }
}

#[async_trait]
impl Primitive for AllowlistUndenyPrimitive {
    fn name(&self) -> &str {
        "allowlist.undeny"
    }

    fn description(&self) -> &str {
        "Remove a deny entry, restoring the entry to the effective allowlist."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "list_type": {
                    "type": "string",
                    "description": "Type of list: shell_command, http_domain, or primitive",
                    "enum": ["shell_command", "http_domain", "primitive"]
                },
                "entry": {
                    "type": "string",
                    "description": "The entry to un-deny"
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

        let mut file = moxxy_core::AllowlistFile::load(&self.allowlist_path);
        file.remove_deny(list_type, entry);
        file.save(&self.allowlist_path)
            .map_err(PrimitiveError::ExecutionFailed)?;

        Ok(serde_json::json!({
            "status": "undenied",
            "list_type": list_type,
            "entry": entry,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup() -> (TempDir, PathBuf) {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("allowlists.yaml");
        // Start with an empty file
        std::fs::write(&path, "").unwrap();
        (tmp, path)
    }

    #[tokio::test]
    async fn allowlist_list_returns_entries() {
        let (_tmp, path) = setup();
        // Seed a custom entry
        let mut file = moxxy_core::AllowlistFile::default();
        file.add_allow("shell_command", "my-custom-tool".into());
        file.save(&path).unwrap();

        let prim = AllowlistListPrimitive::new(path);
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
        let (_tmp, path) = setup();
        let prim = AllowlistListPrimitive::new(path);
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
        let (_tmp, path) = setup();
        let prim = AllowlistAddPrimitive::new(path.clone());
        let result = prim
            .invoke(serde_json::json!({"list_type": "http_domain", "entry": "example.com"}))
            .await
            .unwrap();
        assert_eq!(result["status"], "added");

        // Verify it's in the file
        let file = moxxy_core::AllowlistFile::load(&path);
        assert!(
            file.allows("http_domain")
                .contains(&"example.com".to_string())
        );
    }

    #[tokio::test]
    async fn allowlist_add_is_idempotent() {
        let (_tmp, path) = setup();
        let prim = AllowlistAddPrimitive::new(path);
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
        let (_tmp, path) = setup();
        let prim = AllowlistAddPrimitive::new(path);
        let result = prim
            .invoke(serde_json::json!({"list_type": "shell_command", "entry": ""}))
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn allowlist_remove_deletes_entry() {
        let (_tmp, path) = setup();
        // Seed an entry
        let mut file = moxxy_core::AllowlistFile::default();
        file.add_allow("shell_command", "ls".into());
        file.save(&path).unwrap();

        let prim = AllowlistRemovePrimitive::new(path.clone());
        let result = prim
            .invoke(serde_json::json!({"list_type": "shell_command", "entry": "ls"}))
            .await
            .unwrap();
        assert_eq!(result["status"], "removed");

        // Verify it's gone
        let file = moxxy_core::AllowlistFile::load(&path);
        assert!(file.allows("shell_command").is_empty());
    }

    #[tokio::test]
    async fn allowlist_remove_nonexistent_succeeds() {
        let (_tmp, path) = setup();
        let prim = AllowlistRemovePrimitive::new(path);
        let result = prim
            .invoke(serde_json::json!({"list_type": "shell_command", "entry": "nonexistent"}))
            .await
            .unwrap();
        assert_eq!(result["status"], "removed");
    }

    #[tokio::test]
    async fn allowlist_deny_inserts_entry() {
        let (_tmp, path) = setup();
        let prim = AllowlistDenyPrimitive::new(path.clone());
        let result = prim
            .invoke(serde_json::json!({"list_type": "shell_command", "entry": "curl"}))
            .await
            .unwrap();
        assert_eq!(result["status"], "denied");

        // Verify it's in the file
        let file = moxxy_core::AllowlistFile::load(&path);
        assert!(file.denials("shell_command").contains(&"curl".to_string()));
    }

    #[tokio::test]
    async fn allowlist_deny_is_idempotent() {
        let (_tmp, path) = setup();
        let prim = AllowlistDenyPrimitive::new(path);
        prim.invoke(serde_json::json!({"list_type": "shell_command", "entry": "curl"}))
            .await
            .unwrap();
        let result = prim
            .invoke(serde_json::json!({"list_type": "shell_command", "entry": "curl"}))
            .await
            .unwrap();
        assert_eq!(result["status"], "denied");
    }

    #[tokio::test]
    async fn allowlist_deny_rejects_empty_entry() {
        let (_tmp, path) = setup();
        let prim = AllowlistDenyPrimitive::new(path);
        let result = prim
            .invoke(serde_json::json!({"list_type": "shell_command", "entry": ""}))
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn allowlist_undeny_removes_entry() {
        let (_tmp, path) = setup();
        // First deny
        let deny_prim = AllowlistDenyPrimitive::new(path.clone());
        deny_prim
            .invoke(serde_json::json!({"list_type": "shell_command", "entry": "curl"}))
            .await
            .unwrap();

        // Then undeny
        let undeny_prim = AllowlistUndenyPrimitive::new(path.clone());
        let result = undeny_prim
            .invoke(serde_json::json!({"list_type": "shell_command", "entry": "curl"}))
            .await
            .unwrap();
        assert_eq!(result["status"], "undenied");

        // Verify it's gone
        let file = moxxy_core::AllowlistFile::load(&path);
        assert!(file.denials("shell_command").is_empty());
    }

    #[tokio::test]
    async fn allowlist_list_includes_denied_entries() {
        let (_tmp, path) = setup();
        // Deny a default command
        let mut file = moxxy_core::AllowlistFile::default();
        file.add_deny("shell_command", "git".into());
        file.save(&path).unwrap();

        let prim = AllowlistListPrimitive::new(path);
        let result = prim
            .invoke(serde_json::json!({"list_type": "shell_command"}))
            .await
            .unwrap();
        // "git" should not appear in entries (denied)
        let entries = result["entries"].as_array().unwrap();
        assert!(!entries.iter().any(|e| e == "git"));
        // But should appear in denied_entries
        let denied = result["denied_entries"].as_array().unwrap();
        assert!(denied.iter().any(|e| e == "git"));
        assert_eq!(result["denied_count"], 1);
    }
}
