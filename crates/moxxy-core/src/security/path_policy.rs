use moxxy_types::PathPolicyError;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct PathPolicy {
    workspace_root: PathBuf,
    core_mount: Option<PathBuf>,
    deny_prefix: Option<PathBuf>,
    cwd: Arc<Mutex<PathBuf>>,
}

impl PathPolicy {
    pub fn new(
        workspace_root: PathBuf,
        core_mount: Option<PathBuf>,
        deny_prefix: Option<PathBuf>,
    ) -> Self {
        let canonical = workspace_root
            .canonicalize()
            .unwrap_or(workspace_root.clone());
        Self {
            cwd: Arc::new(Mutex::new(canonical.clone())),
            workspace_root: canonical,
            core_mount: core_mount.map(|p| p.canonicalize().unwrap_or(p)),
            deny_prefix: deny_prefix.map(|p| p.canonicalize().unwrap_or(p)),
        }
    }

    /// Resolve a path: if relative, join it against the current working directory.
    /// If already absolute, return as-is.
    pub fn resolve_path(&self, path: &Path) -> PathBuf {
        if path.is_absolute() {
            path.to_path_buf()
        } else {
            let cwd = self.cwd.lock().unwrap();
            cwd.join(path)
        }
    }

    /// Returns the shared current working directory handle.
    pub fn cwd(&self) -> Arc<Mutex<PathBuf>> {
        self.cwd.clone()
    }

    /// Update the current working directory.
    pub fn set_cwd(&self, path: PathBuf) {
        *self.cwd.lock().unwrap() = path;
    }

    /// Returns the workspace root.
    pub fn workspace_root(&self) -> &Path {
        &self.workspace_root
    }

    pub fn ensure_readable(&self, path: &Path) -> Result<(), PathPolicyError> {
        let check_path = if path.exists() {
            path.canonicalize()
                .map_err(|e| PathPolicyError::OutsideWorkspace(format!("{}: {}", path.display(), e)))?
        } else {
            // Path doesn't exist yet - walk up to the nearest existing ancestor,
            // canonicalize it, then re-append the missing suffix so we can still
            // check whether the path *would be* inside the workspace.
            let mut current = path.to_path_buf();
            let mut suffix_parts: Vec<std::ffi::OsString> = Vec::new();

            while !current.exists() {
                if let Some(name) = current.file_name() {
                    suffix_parts.push(name.to_os_string());
                } else {
                    break;
                }
                match current.parent() {
                    Some(p) if p != current => current = p.to_path_buf(),
                    _ => break,
                }
            }

            if current.exists() {
                let mut result = current.canonicalize().map_err(|e| {
                    PathPolicyError::OutsideWorkspace(format!("{}: {}", current.display(), e))
                })?;
                for part in suffix_parts.into_iter().rev() {
                    result = result.join(part);
                }
                result
            } else {
                return Err(PathPolicyError::OutsideWorkspace(
                    path.display().to_string(),
                ));
            }
        };

        // 1. workspace_root = always allow (agent's own dir)
        if check_path.starts_with(&self.workspace_root) {
            return Ok(());
        }
        // 2. core_mount = allow unless under deny_prefix
        if let Some(ref core) = self.core_mount
            && check_path.starts_with(core)
        {
            if let Some(ref deny) = self.deny_prefix
                && check_path.starts_with(deny)
            {
                return Err(PathPolicyError::OutsideWorkspace(
                    check_path.display().to_string(),
                ));
            }
            return Ok(());
        }
        // 3. Outside both → block
        Err(PathPolicyError::OutsideWorkspace(
            check_path.display().to_string(),
        ))
    }

    pub fn ensure_writable(&self, path: &Path) -> Result<(), PathPolicyError> {
        let check_path = if path.exists() {
            path.canonicalize().map_err(|e| {
                PathPolicyError::OutsideWorkspace(format!("{}: {}", path.display(), e))
            })?
        } else {
            // Walk up ancestors to find the first existing directory, then
            // append the remaining relative suffix. This handles writes into
            // directories that will be created (e.g. workspace/project/src/).
            let mut existing_ancestor = None;
            let mut current = path.to_path_buf();
            let mut suffix_parts: Vec<std::ffi::OsString> = Vec::new();

            // Collect the trailing components that don't exist yet
            while !current.exists() {
                if let Some(name) = current.file_name() {
                    suffix_parts.push(name.to_os_string());
                } else {
                    break;
                }
                match current.parent() {
                    Some(p) if p != current => current = p.to_path_buf(),
                    _ => break,
                }
            }
            if current.exists() {
                existing_ancestor = Some(current);
            }

            match existing_ancestor {
                Some(ancestor) => {
                    let canonical = ancestor.canonicalize().map_err(|e| {
                        PathPolicyError::OutsideWorkspace(format!("{}: {}", ancestor.display(), e))
                    })?;
                    // Re-append the non-existent suffix in correct order
                    let mut result = canonical;
                    for part in suffix_parts.into_iter().rev() {
                        result = result.join(part);
                    }
                    result
                }
                None => {
                    return Err(PathPolicyError::OutsideWorkspace(
                        path.display().to_string(),
                    ));
                }
            }
        };

        // 1. workspace_root = always allow (agent's own dir)
        if check_path.starts_with(&self.workspace_root) {
            return Ok(());
        }
        // 2. core_mount = allow writes unless under deny_prefix
        if let Some(ref core) = self.core_mount
            && check_path.starts_with(core)
        {
            if let Some(ref deny) = self.deny_prefix
                && check_path.starts_with(deny)
            {
                return Err(PathPolicyError::OutsideWorkspace(
                    check_path.display().to_string(),
                ));
            }
            return Ok(());
        }
        // 3. Outside both → block
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
        let policy = PathPolicy::new(workspace.clone(), None, None);
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
        let policy = PathPolicy::new(workspace, Some(core.clone()), None);
        let file = core.join("builtin.rs");
        std::fs::write(&file, "code").unwrap();
        assert!(policy.ensure_readable(&file).is_ok());
    }

    #[test]
    fn blocks_read_outside_both_roots() {
        let tmp = TempDir::new().unwrap();
        let workspace = tmp.path().join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let policy = PathPolicy::new(workspace, None, None);
        let outside = tmp.path().join("outside.txt");
        std::fs::write(&outside, "nope").unwrap();
        assert!(policy.ensure_readable(&outside).is_err());
    }

    #[test]
    fn allows_write_inside_workspace() {
        let tmp = TempDir::new().unwrap();
        let workspace = tmp.path().join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let policy = PathPolicy::new(workspace.clone(), None, None);
        let file = workspace.join("output.txt");
        assert!(policy.ensure_writable(&file).is_ok());
    }

    #[test]
    fn core_mount_now_writable() {
        let tmp = TempDir::new().unwrap();
        let workspace = tmp.path().join("workspace");
        let core = tmp.path().join("core");
        std::fs::create_dir_all(&workspace).unwrap();
        std::fs::create_dir_all(&core).unwrap();
        let policy = PathPolicy::new(workspace, Some(core.clone()), None);
        let file = core.join("config.json");
        assert!(policy.ensure_writable(&file).is_ok());
    }

    #[test]
    fn blocks_parent_traversal() {
        let tmp = TempDir::new().unwrap();
        let workspace = tmp.path().join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let policy = PathPolicy::new(workspace.clone(), None, None);
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
        let policy = PathPolicy::new(workspace, None, None);
        assert!(policy.ensure_readable(&link).is_err());
    }

    #[test]
    fn normalizes_paths_before_check() {
        let tmp = TempDir::new().unwrap();
        let workspace = tmp.path().join("workspace");
        std::fs::create_dir_all(workspace.join("subdir")).unwrap();
        let policy = PathPolicy::new(workspace.clone(), None, None);
        let file = workspace
            .join("subdir")
            .join("..")
            .join("subdir")
            .join("test.txt");
        std::fs::write(workspace.join("subdir").join("test.txt"), "ok").unwrap();
        assert!(policy.ensure_readable(&file).is_ok());
    }

    #[test]
    fn allows_read_write_in_own_agent_dir() {
        let tmp = TempDir::new().unwrap();
        let moxxy_home = tmp.path().join("moxxy");
        let agents_dir = moxxy_home.join("agents");
        let agent_dir = agents_dir.join("my-agent");
        std::fs::create_dir_all(&agent_dir).unwrap();
        std::fs::create_dir_all(moxxy_home.join("config")).unwrap();

        let policy = PathPolicy::new(
            agent_dir.clone(),
            Some(moxxy_home.clone()),
            Some(agents_dir),
        );

        let file = agent_dir.join("workspace.txt");
        std::fs::write(&file, "ok").unwrap();
        assert!(policy.ensure_readable(&file).is_ok());
        assert!(policy.ensure_writable(&file).is_ok());
    }

    #[test]
    fn blocks_access_to_other_agent_dir() {
        let tmp = TempDir::new().unwrap();
        let moxxy_home = tmp.path().join("moxxy");
        let agents_dir = moxxy_home.join("agents");
        let my_agent = agents_dir.join("my-agent");
        let other_agent = agents_dir.join("other-agent");
        std::fs::create_dir_all(&my_agent).unwrap();
        std::fs::create_dir_all(&other_agent).unwrap();
        std::fs::create_dir_all(moxxy_home.join("config")).unwrap();

        let policy = PathPolicy::new(my_agent, Some(moxxy_home.clone()), Some(agents_dir));

        let file = other_agent.join("secret.txt");
        std::fs::write(&file, "nope").unwrap();
        assert!(policy.ensure_readable(&file).is_err());
        assert!(policy.ensure_writable(&file).is_err());
    }

    #[test]
    fn allows_read_write_to_moxxy_config() {
        let tmp = TempDir::new().unwrap();
        let moxxy_home = tmp.path().join("moxxy");
        let agents_dir = moxxy_home.join("agents");
        let agent_dir = agents_dir.join("my-agent");
        let config_dir = moxxy_home.join("config");
        std::fs::create_dir_all(&agent_dir).unwrap();
        std::fs::create_dir_all(&config_dir).unwrap();

        let policy = PathPolicy::new(agent_dir, Some(moxxy_home.clone()), Some(agents_dir));

        let file = config_dir.join("gateway.yaml");
        std::fs::write(&file, "{}").unwrap();
        assert!(policy.ensure_readable(&file).is_ok());
        assert!(policy.ensure_writable(&file).is_ok());
    }

    #[test]
    fn allows_write_to_nested_nonexistent_dirs_in_workspace() {
        let tmp = TempDir::new().unwrap();
        let workspace = tmp.path().join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let policy = PathPolicy::new(workspace.clone(), None, None);

        // workspace/project/src/main.rs = neither "project" nor "src" exist yet
        let deep_file = workspace.join("project").join("src").join("main.rs");
        assert!(policy.ensure_writable(&deep_file).is_ok());
    }

    #[test]
    fn resolve_path_joins_relative_to_workspace() {
        let tmp = TempDir::new().unwrap();
        let workspace = tmp.path().join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let policy = PathPolicy::new(workspace.clone(), None, None);

        let resolved = policy.resolve_path(Path::new("project/src/main.rs"));
        // Should be workspace-rooted (compare using canonicalized workspace)
        let canonical_ws = workspace.canonicalize().unwrap();
        assert!(resolved.starts_with(&canonical_ws));
        assert!(resolved.ends_with("project/src/main.rs"));
    }

    #[test]
    fn resolve_path_preserves_absolute() {
        let tmp = TempDir::new().unwrap();
        let workspace = tmp.path().join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let policy = PathPolicy::new(workspace, None, None);

        let abs = Path::new("/some/absolute/path");
        let resolved = policy.resolve_path(abs);
        assert_eq!(resolved, abs.to_path_buf());
    }

    #[test]
    fn allows_read_check_for_nonexistent_subdir_in_workspace() {
        let tmp = TempDir::new().unwrap();
        let workspace = tmp.path().join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let policy = PathPolicy::new(workspace.clone(), None, None);

        // workspace/my-project doesn't exist yet, but is inside workspace
        let subdir = workspace.join("my-project");
        assert!(policy.ensure_readable(&subdir).is_ok());
    }

    #[test]
    fn blocks_read_check_for_nonexistent_dir_outside_workspace() {
        let tmp = TempDir::new().unwrap();
        let workspace = tmp.path().join("workspace");
        let outside = tmp.path().join("outside");
        std::fs::create_dir_all(&workspace).unwrap();
        let policy = PathPolicy::new(workspace, None, None);

        let deep_file = outside.join("hack").join("file.txt");
        assert!(policy.ensure_readable(&deep_file).is_err());
    }

    #[test]
    fn blocks_write_to_nested_nonexistent_dirs_outside_workspace() {
        let tmp = TempDir::new().unwrap();
        let workspace = tmp.path().join("workspace");
        let outside = tmp.path().join("outside");
        std::fs::create_dir_all(&workspace).unwrap();
        // Don't create "outside" = the ancestor walk should resolve to tmp
        let policy = PathPolicy::new(workspace, None, None);

        let deep_file = outside.join("hack").join("file.txt");
        assert!(policy.ensure_writable(&deep_file).is_err());
    }
}
