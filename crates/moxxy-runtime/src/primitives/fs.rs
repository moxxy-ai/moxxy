use async_trait::async_trait;
use moxxy_core::PathPolicy;
use std::path::Path;

use crate::registry::{Primitive, PrimitiveError};

pub struct FsReadPrimitive {
    policy: PathPolicy,
}

impl FsReadPrimitive {
    pub fn new(policy: PathPolicy) -> Self {
        Self { policy }
    }
}

#[async_trait]
impl Primitive for FsReadPrimitive {
    fn name(&self) -> &str {
        "fs.read"
    }

    fn description(&self) -> &str {
        "Read the contents of a file at the given path within the workspace."
    }

    fn is_concurrent_safe(&self) -> bool {
        true
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Path to the file to read. Can be relative (resolved against workspace) or absolute."}
            },
            "required": ["path"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let path_str = params["path"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'path' parameter".into()))?;
        let path = self.policy.resolve_path(Path::new(path_str));

        self.policy
            .ensure_readable(&path)
            .map_err(|e| PrimitiveError::AccessDenied(e.to_string()))?;

        tracing::debug!(path = %path.display(), "Reading file");

        let content = std::fs::read_to_string(&path)
            .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;

        Ok(serde_json::json!({ "content": content }))
    }
}

pub struct FsWritePrimitive {
    policy: PathPolicy,
}

impl FsWritePrimitive {
    pub fn new(policy: PathPolicy) -> Self {
        Self { policy }
    }
}

#[async_trait]
impl Primitive for FsWritePrimitive {
    fn name(&self) -> &str {
        "fs.write"
    }

    fn description(&self) -> &str {
        "Write content to a file at the given path within the workspace. Creates parent directories if needed."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Path to the file to write. Can be relative (resolved against workspace) or absolute."},
                "content": {"type": "string", "description": "Content to write to the file"}
            },
            "required": ["path", "content"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let path_str = params["path"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'path' parameter".into()))?;
        let content = params["content"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'content' parameter".into()))?;
        let path = self.policy.resolve_path(Path::new(path_str));

        self.policy
            .ensure_writable(&path)
            .map_err(|e| PrimitiveError::AccessDenied(e.to_string()))?;

        tracing::info!(path = %path.display(), content_len = content.len(), "Writing file");

        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;
        }

        std::fs::write(&path, content)
            .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;

        Ok(serde_json::json!({ "written": path.display().to_string() }))
    }
}

pub struct FsListPrimitive {
    policy: PathPolicy,
}

impl FsListPrimitive {
    pub fn new(policy: PathPolicy) -> Self {
        Self { policy }
    }
}

#[async_trait]
impl Primitive for FsListPrimitive {
    fn name(&self) -> &str {
        "fs.list"
    }

    fn description(&self) -> &str {
        "List entries in a directory within the workspace."
    }

    fn is_concurrent_safe(&self) -> bool {
        true
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Path to the directory to list. Can be relative (resolved against workspace) or absolute."}
            },
            "required": ["path"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let path_str = params["path"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'path' parameter".into()))?;
        let path = self.policy.resolve_path(Path::new(path_str));

        self.policy
            .ensure_readable(&path)
            .map_err(|e| PrimitiveError::AccessDenied(e.to_string()))?;

        tracing::debug!(path = %path.display(), "Listing directory");

        let entries: Vec<String> = std::fs::read_dir(&path)
            .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?
            .filter_map(|entry| {
                entry
                    .ok()
                    .map(|e| e.file_name().to_string_lossy().to_string())
            })
            .collect();

        Ok(serde_json::json!({ "entries": entries }))
    }
}

pub struct FsRemovePrimitive {
    policy: PathPolicy,
}

impl FsRemovePrimitive {
    pub fn new(policy: PathPolicy) -> Self {
        Self { policy }
    }
}

#[async_trait]
impl Primitive for FsRemovePrimitive {
    fn name(&self) -> &str {
        "fs.remove"
    }

    fn description(&self) -> &str {
        "Remove a file or directory within the workspace."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Path to the file or directory to remove. Can be relative (resolved against workspace) or absolute."},
                "recursive": {"type": "boolean", "description": "If true, remove non-empty directories recursively. Default false."}
            },
            "required": ["path"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let path_str = params["path"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'path' parameter".into()))?;
        let recursive = params["recursive"].as_bool().unwrap_or(false);
        let path = self.policy.resolve_path(Path::new(path_str));

        self.policy
            .ensure_writable(&path)
            .map_err(|e| PrimitiveError::AccessDenied(e.to_string()))?;

        if !path.exists() {
            return Err(PrimitiveError::NotFound(format!(
                "path does not exist: {}",
                path.display()
            )));
        }

        tracing::info!(path = %path.display(), recursive, "Removing path");

        if path.is_dir() {
            if recursive {
                std::fs::remove_dir_all(&path)
            } else {
                std::fs::remove_dir(&path)
            }
        } else {
            std::fs::remove_file(&path)
        }
        .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;

        Ok(serde_json::json!({ "removed": path.display().to_string() }))
    }
}

pub struct FsCdPrimitive {
    policy: PathPolicy,
}

impl FsCdPrimitive {
    pub fn new(policy: PathPolicy) -> Self {
        Self { policy }
    }
}

#[async_trait]
impl Primitive for FsCdPrimitive {
    fn name(&self) -> &str {
        "fs.cd"
    }

    fn description(&self) -> &str {
        "Change the current working directory within the workspace. Affects path resolution for all subsequent file and shell operations."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Directory to change to. Can be relative (resolved against current working directory) or absolute. Use '..' to go up one level."}
            },
            "required": ["path"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let path_str = params["path"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'path' parameter".into()))?;
        let path = self.policy.resolve_path(Path::new(path_str));

        self.policy
            .ensure_readable(&path)
            .map_err(|e| PrimitiveError::AccessDenied(e.to_string()))?;

        let canonical = path
            .canonicalize()
            .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;

        if !canonical.is_dir() {
            return Err(PrimitiveError::InvalidParams(format!(
                "not a directory: {}",
                canonical.display()
            )));
        }

        tracing::info!(path = %canonical.display(), "Changing working directory");
        self.policy.set_cwd(canonical.clone());

        Ok(serde_json::json!({ "cwd": canonical.display().to_string() }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup() -> (TempDir, PathPolicy) {
        let tmp = TempDir::new().unwrap();
        let workspace = tmp.path().join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let policy = PathPolicy::new(workspace, None, None);
        (tmp, policy)
    }

    #[tokio::test]
    async fn fs_read_returns_file_content() {
        let (tmp, policy) = setup();
        let workspace = tmp.path().join("workspace");
        let file = workspace.join("test.txt");
        std::fs::write(&file, "hello world").unwrap();

        let prim = FsReadPrimitive::new(policy);
        let result = prim
            .invoke(serde_json::json!({"path": file.to_str().unwrap()}))
            .await
            .unwrap();
        assert_eq!(result["content"].as_str().unwrap(), "hello world");
    }

    #[tokio::test]
    async fn fs_read_blocked_outside_workspace() {
        let (tmp, policy) = setup();
        let outside = tmp.path().join("outside.txt");
        std::fs::write(&outside, "secret").unwrap();

        let prim = FsReadPrimitive::new(policy);
        let result = prim
            .invoke(serde_json::json!({"path": outside.to_str().unwrap()}))
            .await;
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::AccessDenied(_)
        ));
    }

    #[tokio::test]
    async fn fs_write_creates_file() {
        let (tmp, policy) = setup();
        let workspace = tmp.path().join("workspace");
        let file = workspace.join("output.txt");

        let prim = FsWritePrimitive::new(policy);
        prim.invoke(serde_json::json!({"path": file.to_str().unwrap(), "content": "written"}))
            .await
            .unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "written");
    }

    #[tokio::test]
    async fn fs_write_blocked_outside_workspace() {
        let (tmp, policy) = setup();
        let outside = tmp.path().join("outside.txt");

        let prim = FsWritePrimitive::new(policy);
        let result = prim
            .invoke(serde_json::json!({"path": outside.to_str().unwrap(), "content": "bad"}))
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn fs_list_returns_directory_entries() {
        let (tmp, policy) = setup();
        let workspace = tmp.path().join("workspace");
        std::fs::write(workspace.join("a.txt"), "").unwrap();
        std::fs::write(workspace.join("b.txt"), "").unwrap();

        let prim = FsListPrimitive::new(policy);
        let result = prim
            .invoke(serde_json::json!({"path": workspace.to_str().unwrap()}))
            .await
            .unwrap();
        let entries = result["entries"].as_array().unwrap();
        assert_eq!(entries.len(), 2);
    }

    #[tokio::test]
    async fn fs_list_blocks_outside_workspace() {
        let (tmp, policy) = setup();
        let prim = FsListPrimitive::new(policy);
        let result = prim
            .invoke(serde_json::json!({"path": tmp.path().to_str().unwrap()}))
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn fs_remove_deletes_file() {
        let (tmp, policy) = setup();
        let workspace = tmp.path().join("workspace");
        let file = workspace.join("doomed.txt");
        std::fs::write(&file, "bye").unwrap();

        let prim = FsRemovePrimitive::new(policy);
        let result = prim
            .invoke(serde_json::json!({"path": file.to_str().unwrap()}))
            .await
            .unwrap();
        assert_eq!(result["removed"].as_str().unwrap(), file.to_str().unwrap());
        assert!(!file.exists());
    }

    #[tokio::test]
    async fn fs_remove_deletes_empty_directory() {
        let (tmp, policy) = setup();
        let workspace = tmp.path().join("workspace");
        let dir = workspace.join("empty_dir");
        std::fs::create_dir(&dir).unwrap();

        let prim = FsRemovePrimitive::new(policy);
        prim.invoke(serde_json::json!({"path": dir.to_str().unwrap()}))
            .await
            .unwrap();
        assert!(!dir.exists());
    }

    #[tokio::test]
    async fn fs_remove_recursive_deletes_non_empty_directory() {
        let (tmp, policy) = setup();
        let workspace = tmp.path().join("workspace");
        let dir = workspace.join("full_dir");
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("sub").join("file.txt"), "data").unwrap();

        let prim = FsRemovePrimitive::new(policy);
        prim.invoke(serde_json::json!({"path": dir.to_str().unwrap(), "recursive": true}))
            .await
            .unwrap();
        assert!(!dir.exists());
    }

    #[tokio::test]
    async fn fs_remove_non_recursive_fails_on_non_empty_directory() {
        let (tmp, policy) = setup();
        let workspace = tmp.path().join("workspace");
        let dir = workspace.join("full_dir");
        std::fs::create_dir(&dir).unwrap();
        std::fs::write(dir.join("file.txt"), "data").unwrap();

        let prim = FsRemovePrimitive::new(policy);
        let result = prim
            .invoke(serde_json::json!({"path": dir.to_str().unwrap()}))
            .await;
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::ExecutionFailed(_)
        ));
    }

    #[tokio::test]
    async fn fs_remove_blocked_outside_workspace() {
        let (tmp, policy) = setup();
        let outside = tmp.path().join("outside.txt");
        std::fs::write(&outside, "secret").unwrap();

        let prim = FsRemovePrimitive::new(policy);
        let result = prim
            .invoke(serde_json::json!({"path": outside.to_str().unwrap()}))
            .await;
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::AccessDenied(_)
        ));
    }

    #[tokio::test]
    async fn fs_remove_fails_on_missing_path() {
        let (tmp, policy) = setup();
        let workspace = tmp.path().join("workspace");
        let missing = workspace.join("ghost.txt");

        let prim = FsRemovePrimitive::new(policy);
        let result = prim
            .invoke(serde_json::json!({"path": missing.to_str().unwrap()}))
            .await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), PrimitiveError::NotFound(_)));
    }

    // --- Relative path resolution tests ---

    #[tokio::test]
    async fn fs_read_resolves_relative_path() {
        let (tmp, policy) = setup();
        let workspace = tmp.path().join("workspace");
        std::fs::write(workspace.join("hello.txt"), "world").unwrap();

        let prim = FsReadPrimitive::new(policy);
        let result = prim
            .invoke(serde_json::json!({"path": "hello.txt"}))
            .await
            .unwrap();
        assert_eq!(result["content"].as_str().unwrap(), "world");
    }

    #[tokio::test]
    async fn fs_write_resolves_relative_path() {
        let (tmp, policy) = setup();
        let workspace = tmp.path().join("workspace");

        let prim = FsWritePrimitive::new(policy);
        prim.invoke(serde_json::json!({"path": "new_file.txt", "content": "data"}))
            .await
            .unwrap();
        assert_eq!(
            std::fs::read_to_string(workspace.join("new_file.txt")).unwrap(),
            "data"
        );
    }

    #[tokio::test]
    async fn fs_list_resolves_relative_path() {
        let (tmp, policy) = setup();
        let workspace = tmp.path().join("workspace");
        let sub = workspace.join("mydir");
        std::fs::create_dir(&sub).unwrap();
        std::fs::write(sub.join("a.txt"), "").unwrap();

        let prim = FsListPrimitive::new(policy);
        let result = prim
            .invoke(serde_json::json!({"path": "mydir"}))
            .await
            .unwrap();
        let entries = result["entries"].as_array().unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].as_str().unwrap(), "a.txt");
    }

    #[tokio::test]
    async fn fs_remove_resolves_relative_path() {
        let (tmp, policy) = setup();
        let workspace = tmp.path().join("workspace");
        let dir = workspace.join("project_folder");
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::write(dir.join("src").join("main.rs"), "fn main() {}").unwrap();

        let prim = FsRemovePrimitive::new(policy);
        prim.invoke(serde_json::json!({"path": "project_folder", "recursive": true}))
            .await
            .unwrap();
        assert!(!dir.exists());
    }

    #[tokio::test]
    async fn fs_write_resolves_nested_relative_path() {
        let (tmp, policy) = setup();
        let workspace = tmp.path().join("workspace");

        let prim = FsWritePrimitive::new(policy);
        prim.invoke(serde_json::json!({"path": "project/src/main.rs", "content": "fn main() {}"}))
            .await
            .unwrap();
        assert_eq!(
            std::fs::read_to_string(workspace.join("project/src/main.rs")).unwrap(),
            "fn main() {}"
        );
    }

    // --- fs.cd tests ---

    #[tokio::test]
    async fn fs_cd_changes_working_directory() {
        let (tmp, policy) = setup();
        let workspace = tmp.path().join("workspace");
        let sub = workspace.join("subdir");
        std::fs::create_dir(&sub).unwrap();

        let prim = FsCdPrimitive::new(policy.clone());
        let result = prim
            .invoke(serde_json::json!({"path": "subdir"}))
            .await
            .unwrap();
        let cwd = result["cwd"].as_str().unwrap();
        assert!(cwd.ends_with("subdir"));

        // Verify resolve_path now resolves relative to subdir
        let resolved = policy.resolve_path(Path::new("file.txt"));
        assert!(resolved.ends_with("subdir/file.txt"));
    }

    #[tokio::test]
    async fn fs_cd_with_absolute_path() {
        let (tmp, policy) = setup();
        let workspace = tmp.path().join("workspace");
        let sub = workspace.join("abs_dir");
        std::fs::create_dir(&sub).unwrap();

        let prim = FsCdPrimitive::new(policy.clone());
        prim.invoke(serde_json::json!({"path": sub.to_str().unwrap()}))
            .await
            .unwrap();

        let resolved = policy.resolve_path(Path::new("test.txt"));
        assert!(resolved.ends_with("abs_dir/test.txt"));
    }

    #[tokio::test]
    async fn fs_cd_blocked_outside_workspace() {
        let (tmp, policy) = setup();
        let outside = tmp.path().join("outside");
        std::fs::create_dir(&outside).unwrap();

        let prim = FsCdPrimitive::new(policy);
        let result = prim
            .invoke(serde_json::json!({"path": outside.to_str().unwrap()}))
            .await;
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::AccessDenied(_)
        ));
    }

    #[tokio::test]
    async fn fs_cd_fails_on_file() {
        let (tmp, policy) = setup();
        let workspace = tmp.path().join("workspace");
        let file = workspace.join("not_a_dir.txt");
        std::fs::write(&file, "content").unwrap();

        let prim = FsCdPrimitive::new(policy);
        let result = prim
            .invoke(serde_json::json!({"path": "not_a_dir.txt"}))
            .await;
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::InvalidParams(_)
        ));
    }

    #[tokio::test]
    async fn fs_cd_fails_on_nonexistent() {
        let (_tmp, policy) = setup();

        let prim = FsCdPrimitive::new(policy);
        let result = prim.invoke(serde_json::json!({"path": "ghost_dir"})).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn fs_cd_parent_navigation() {
        let (tmp, policy) = setup();
        let workspace = tmp.path().join("workspace");
        let sub = workspace.join("a").join("b");
        std::fs::create_dir_all(&sub).unwrap();

        let prim = FsCdPrimitive::new(policy.clone());

        // cd into a/b
        prim.invoke(serde_json::json!({"path": "a/b"}))
            .await
            .unwrap();

        // cd .. (back to a)
        let result = prim
            .invoke(serde_json::json!({"path": ".."}))
            .await
            .unwrap();
        let cwd = result["cwd"].as_str().unwrap();
        assert!(cwd.ends_with("/a"));
    }

    #[tokio::test]
    async fn fs_cd_affects_other_primitives() {
        let (tmp, policy) = setup();
        let workspace = tmp.path().join("workspace");
        let sub = workspace.join("project");
        std::fs::create_dir(&sub).unwrap();
        std::fs::write(sub.join("readme.txt"), "hello from project").unwrap();

        // cd into project
        let cd = FsCdPrimitive::new(policy.clone());
        cd.invoke(serde_json::json!({"path": "project"}))
            .await
            .unwrap();

        // Now fs.read with a relative path should resolve inside project/
        let read = FsReadPrimitive::new(policy);
        let result = read
            .invoke(serde_json::json!({"path": "readme.txt"}))
            .await
            .unwrap();
        assert_eq!(result["content"].as_str().unwrap(), "hello from project");
    }

    #[tokio::test]
    async fn fs_cd_blocks_traversal_outside_workspace() {
        let (tmp, policy) = setup();
        let workspace = tmp.path().join("workspace");
        let sub = workspace.join("nested");
        std::fs::create_dir(&sub).unwrap();

        let prim = FsCdPrimitive::new(policy);

        // cd into nested, then try ../.. to escape workspace
        prim.invoke(serde_json::json!({"path": "nested"}))
            .await
            .unwrap();
        let result = prim.invoke(serde_json::json!({"path": "../.."})).await;
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::AccessDenied(_)
        ));
    }
}
