use moxxy_types::PathPolicyError;
use std::path::{Path, PathBuf};

#[derive(Clone)]
pub struct PathPolicy {
    workspace_root: PathBuf,
    core_mount: Option<PathBuf>,
}

impl PathPolicy {
    pub fn new(workspace_root: PathBuf, core_mount: Option<PathBuf>) -> Self {
        Self {
            workspace_root: workspace_root.canonicalize().unwrap_or(workspace_root),
            core_mount: core_mount.map(|p| p.canonicalize().unwrap_or(p)),
        }
    }

    pub fn ensure_readable(&self, path: &Path) -> Result<(), PathPolicyError> {
        let canonical = path
            .canonicalize()
            .map_err(|e| PathPolicyError::OutsideWorkspace(format!("{}: {}", path.display(), e)))?;

        if canonical.starts_with(&self.workspace_root) {
            return Ok(());
        }
        if let Some(ref core) = self.core_mount
            && canonical.starts_with(core)
        {
            return Ok(());
        }
        Err(PathPolicyError::OutsideWorkspace(
            canonical.display().to_string(),
        ))
    }

    pub fn ensure_writable(&self, path: &Path) -> Result<(), PathPolicyError> {
        let check_path = if path.exists() {
            path.canonicalize().map_err(|e| {
                PathPolicyError::OutsideWorkspace(format!("{}: {}", path.display(), e))
            })?
        } else {
            let parent = path
                .parent()
                .ok_or_else(|| PathPolicyError::OutsideWorkspace(path.display().to_string()))?;
            let canonical_parent = parent.canonicalize().map_err(|e| {
                PathPolicyError::OutsideWorkspace(format!("{}: {}", parent.display(), e))
            })?;
            canonical_parent.join(path.file_name().unwrap_or_default())
        };

        if check_path.starts_with(&self.workspace_root) {
            return Ok(());
        }
        if let Some(ref core) = self.core_mount
            && check_path.starts_with(core)
        {
            return Err(PathPolicyError::WriteToReadOnly(
                check_path.display().to_string(),
            ));
        }
        Err(PathPolicyError::OutsideWorkspace(
            check_path.display().to_string(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn allows_read_inside_workspace() {
        let tmp = TempDir::new().unwrap();
        let workspace = tmp.path().join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let policy = PathPolicy::new(workspace.clone(), None);
        let file = workspace.join("test.txt");
        std::fs::write(&file, "hello").unwrap();
        assert!(policy.ensure_readable(&file).is_ok());
    }

    #[test]
    fn allows_read_inside_core_mount() {
        let tmp = TempDir::new().unwrap();
        let workspace = tmp.path().join("workspace");
        let core = tmp.path().join("core");
        std::fs::create_dir_all(&workspace).unwrap();
        std::fs::create_dir_all(&core).unwrap();
        let policy = PathPolicy::new(workspace, Some(core.clone()));
        let file = core.join("builtin.rs");
        std::fs::write(&file, "code").unwrap();
        assert!(policy.ensure_readable(&file).is_ok());
    }

    #[test]
    fn blocks_read_outside_both_roots() {
        let tmp = TempDir::new().unwrap();
        let workspace = tmp.path().join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let policy = PathPolicy::new(workspace, None);
        let outside = tmp.path().join("outside.txt");
        std::fs::write(&outside, "nope").unwrap();
        assert!(policy.ensure_readable(&outside).is_err());
    }

    #[test]
    fn allows_write_inside_workspace() {
        let tmp = TempDir::new().unwrap();
        let workspace = tmp.path().join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let policy = PathPolicy::new(workspace.clone(), None);
        let file = workspace.join("output.txt");
        assert!(policy.ensure_writable(&file).is_ok());
    }

    #[test]
    fn blocks_write_to_core_mount() {
        let tmp = TempDir::new().unwrap();
        let workspace = tmp.path().join("workspace");
        let core = tmp.path().join("core");
        std::fs::create_dir_all(&workspace).unwrap();
        std::fs::create_dir_all(&core).unwrap();
        let policy = PathPolicy::new(workspace, Some(core.clone()));
        let file = core.join("readonly.rs");
        assert!(policy.ensure_writable(&file).is_err());
    }

    #[test]
    fn blocks_parent_traversal() {
        let tmp = TempDir::new().unwrap();
        let workspace = tmp.path().join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let policy = PathPolicy::new(workspace.clone(), None);
        let traversal = workspace.join("..").join("..").join("etc").join("passwd");
        assert!(policy.ensure_readable(&traversal).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn blocks_symlink_escape() {
        let tmp = TempDir::new().unwrap();
        let workspace = tmp.path().join("workspace");
        let outside = tmp.path().join("secret");
        std::fs::create_dir_all(&workspace).unwrap();
        std::fs::write(&outside, "secret data").unwrap();
        let link = workspace.join("escape");
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        let policy = PathPolicy::new(workspace, None);
        assert!(policy.ensure_readable(&link).is_err());
    }

    #[test]
    fn normalizes_paths_before_check() {
        let tmp = TempDir::new().unwrap();
        let workspace = tmp.path().join("workspace");
        std::fs::create_dir_all(workspace.join("subdir")).unwrap();
        let policy = PathPolicy::new(workspace.clone(), None);
        let file = workspace
            .join("subdir")
            .join("..")
            .join("subdir")
            .join("test.txt");
        std::fs::write(workspace.join("subdir").join("test.txt"), "ok").unwrap();
        assert!(policy.ensure_readable(&file).is_ok());
    }
}
