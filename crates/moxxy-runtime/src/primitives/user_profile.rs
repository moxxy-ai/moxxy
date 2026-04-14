use async_trait::async_trait;
use std::path::{Path, PathBuf};

use crate::registry::{Primitive, PrimitiveError};

/// Sanitize a user_id for safe use as a filename.
///
/// User IDs arrive transport-namespaced (e.g. `tg:12345`, `discord:6789`). We
/// replace any character that isn't alphanumeric, `-`, `_`, `.`, or `:` with
/// `_` and forbid path-escaping sequences. The resulting slug is the stem of
/// `<agent_dir>/users/<slug>.md`.
fn sanitize_user_id(user_id: &str) -> Result<String, PrimitiveError> {
    if user_id.is_empty() {
        return Err(PrimitiveError::InvalidParams(
            "user_id must not be empty".into(),
        ));
    }
    if user_id.contains("..") || user_id.contains('/') || user_id.contains('\\') {
        return Err(PrimitiveError::InvalidParams(
            "user_id must not contain path separators".into(),
        ));
    }
    let cleaned: String = user_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':') {
                c
            } else {
                '_'
            }
        })
        .collect();
    Ok(cleaned)
}

fn users_dir(agent_dir: &Path) -> PathBuf {
    agent_dir.join("users")
}

fn profile_path(agent_dir: &Path, user_id: &str) -> Result<PathBuf, PrimitiveError> {
    let slug = sanitize_user_id(user_id)?;
    Ok(users_dir(agent_dir).join(format!("{slug}.md")))
}

pub struct UserProfileReadPrimitive {
    agent_dir: PathBuf,
}

impl UserProfileReadPrimitive {
    pub fn new(agent_dir: PathBuf) -> Self {
        Self { agent_dir }
    }
}

#[async_trait]
impl Primitive for UserProfileReadPrimitive {
    fn name(&self) -> &str {
        "user.profile_read"
    }

    fn description(&self) -> &str {
        "Read a per-end-user profile markdown file (users/<user_id>.md). Returns empty string if none exists."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "user_id": {"type": "string", "description": "Transport-namespaced user id, e.g. tg:12345"}
            },
            "required": ["user_id"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let user_id = params["user_id"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'user_id' parameter".into()))?;

        let path = profile_path(&self.agent_dir, user_id)?;
        let content = std::fs::read_to_string(&path).unwrap_or_default();
        Ok(serde_json::json!({
            "user_id": user_id,
            "profile": content,
            "exists": path.is_file(),
        }))
    }
}

pub struct UserProfileWritePrimitive {
    agent_dir: PathBuf,
}

impl UserProfileWritePrimitive {
    pub fn new(agent_dir: PathBuf) -> Self {
        Self { agent_dir }
    }
}

#[async_trait]
impl Primitive for UserProfileWritePrimitive {
    fn name(&self) -> &str {
        "user.profile_write"
    }

    fn description(&self) -> &str {
        "Replace the per-end-user profile markdown file (users/<user_id>.md) with new content."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "user_id": {"type": "string", "description": "Transport-namespaced user id"},
                "content": {"type": "string", "description": "Full markdown content of the profile"}
            },
            "required": ["user_id", "content"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let user_id = params["user_id"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'user_id' parameter".into()))?;
        let content = params["content"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'content' parameter".into()))?;

        let path = profile_path(&self.agent_dir, user_id)?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                PrimitiveError::ExecutionFailed(format!("failed to create users dir: {}", e))
            })?;
        }
        std::fs::write(&path, content).map_err(|e| {
            PrimitiveError::ExecutionFailed(format!("failed to write profile: {}", e))
        })?;

        Ok(serde_json::json!({
            "status": "written",
            "user_id": user_id,
            "bytes": content.len(),
        }))
    }
}

pub struct UserProfileListPrimitive {
    agent_dir: PathBuf,
}

impl UserProfileListPrimitive {
    pub fn new(agent_dir: PathBuf) -> Self {
        Self { agent_dir }
    }
}

#[async_trait]
impl Primitive for UserProfileListPrimitive {
    fn name(&self) -> &str {
        "user.profile_list"
    }

    fn description(&self) -> &str {
        "List all per-end-user profiles stored under users/. Returns id + short preview."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({"type": "object", "properties": {}})
    }

    async fn invoke(
        &self,
        _params: serde_json::Value,
    ) -> Result<serde_json::Value, PrimitiveError> {
        let dir = users_dir(&self.agent_dir);
        if !dir.is_dir() {
            return Ok(serde_json::json!({ "profiles": [] }));
        }
        let mut profiles = Vec::new();
        let entries = std::fs::read_dir(&dir).map_err(|e| {
            PrimitiveError::ExecutionFailed(format!("failed to read users dir: {}", e))
        })?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            let user_id = match path.file_stem().and_then(|s| s.to_str()) {
                Some(s) => s.to_string(),
                None => continue,
            };
            let body = std::fs::read_to_string(&path).unwrap_or_default();
            let preview: String = body.chars().take(80).collect();
            profiles.push(serde_json::json!({
                "user_id": user_id,
                "preview": preview,
                "bytes": body.len(),
            }));
        }
        Ok(serde_json::json!({ "profiles": profiles }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup() -> (TempDir, PathBuf) {
        let tmp = TempDir::new().unwrap();
        let agent_dir = tmp.path().join("agents").join("test");
        std::fs::create_dir_all(&agent_dir).unwrap();
        (tmp, agent_dir)
    }

    #[tokio::test]
    async fn write_then_read_round_trip() {
        let (_tmp, agent_dir) = setup();

        let writer = UserProfileWritePrimitive::new(agent_dir.clone());
        writer
            .invoke(serde_json::json!({
                "user_id": "tg:12345",
                "content": "# User\nPrefers terse answers."
            }))
            .await
            .unwrap();

        let reader = UserProfileReadPrimitive::new(agent_dir);
        let result = reader
            .invoke(serde_json::json!({"user_id": "tg:12345"}))
            .await
            .unwrap();
        assert_eq!(result["profile"], "# User\nPrefers terse answers.");
        assert_eq!(result["exists"], true);
    }

    #[tokio::test]
    async fn read_missing_profile_returns_empty() {
        let (_tmp, agent_dir) = setup();
        let reader = UserProfileReadPrimitive::new(agent_dir);
        let result = reader
            .invoke(serde_json::json!({"user_id": "discord:999"}))
            .await
            .unwrap();
        assert_eq!(result["profile"], "");
        assert_eq!(result["exists"], false);
    }

    #[tokio::test]
    async fn list_returns_written_profiles() {
        let (_tmp, agent_dir) = setup();
        let writer = UserProfileWritePrimitive::new(agent_dir.clone());
        writer
            .invoke(serde_json::json!({"user_id": "tg:1", "content": "alice"}))
            .await
            .unwrap();
        writer
            .invoke(serde_json::json!({"user_id": "tg:2", "content": "bob"}))
            .await
            .unwrap();

        let lister = UserProfileListPrimitive::new(agent_dir);
        let result = lister.invoke(serde_json::json!({})).await.unwrap();
        let profiles = result["profiles"].as_array().unwrap();
        assert_eq!(profiles.len(), 2);
    }

    #[tokio::test]
    async fn rejects_path_traversal() {
        let (_tmp, agent_dir) = setup();
        let writer = UserProfileWritePrimitive::new(agent_dir);
        let result = writer
            .invoke(serde_json::json!({
                "user_id": "../evil",
                "content": "x"
            }))
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn sanitizes_unsafe_chars() {
        let (_tmp, agent_dir) = setup();
        let writer = UserProfileWritePrimitive::new(agent_dir.clone());
        // spaces/special chars become underscores but write succeeds
        writer
            .invoke(serde_json::json!({
                "user_id": "tg:a b*c",
                "content": "hello"
            }))
            .await
            .unwrap();
        assert!(agent_dir.join("users").join("tg:a_b_c.md").is_file());
    }
}
