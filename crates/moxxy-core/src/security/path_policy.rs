use moxxy_types::PathPolicyError;
use std::path::{Path, PathBuf};

#[derive(Clone)]
pub struct PathPolicy {
    workspace_root: PathBuf,
    core_mount: Option<PathBuf>,
    deny_prefix: Option<PathBuf>,
}

impl PathPolicy {
    pub fn new(
        workspace_root: PathBuf,
        core_mount: Option<PathBuf>,
        deny_prefix: Option<PathBuf>,
    ) -> Self {
        Self {
            workspace_root: workspace_root.canonicalize().unwrap_or(workspace_root),
            core_mount: core_mount.map(|p| p.canonicalize().unwrap_or(p)),
            deny_prefix: deny_prefix.map(|p| p.canonicalize().unwrap_or(p)),
        }
    }

    pub fn ensure_readable(&self, path: &Path) -> Result<(), PathPolicyError> {
        let canonical = path
            .canonicalize()
            .map_err(|e| PathPolicyError::OutsideWorkspace(format!("{}: {}", path.display(), e)))?;

        // 1. workspace_root — always allow (agent's own dir)
        if canonical.starts_with(&self.workspace_root) {
            return Ok(());
        }
        // 2. core_mount — allow unless under deny_prefix
        if let Some(ref core) = self.core_mount
            && canonical.starts_with(core)
        {
            if let Some(ref deny) = self.deny_prefix
                && canonical.starts_with(deny)
            {
                return Err(PathPolicyError::OutsideWorkspace(
                    canonical.display().to_string(),
                ));
            }
            return Ok(());
        }
        // 3. Outside both → block
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

        // 1. workspace_root — always allow (agent's own dir)
        if check_path.starts_with(&self.workspace_root) {
            return Ok(());
        }
        // 2. core_mount — allow writes unless under deny_prefix
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

        let file = config_dir.join("gateway.json");
        std::fs::write(&file, "{}").unwrap();
        assert!(policy.ensure_readable(&file).is_ok());
        assert!(policy.ensure_writable(&file).is_ok());
    }
}
