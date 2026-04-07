use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq)]
pub enum SandboxProfile {
    Strict,
    Standard,
    None,
}

impl SandboxProfile {
    pub fn from_str_name(s: &str) -> Option<Self> {
        match s {
            "strict" => Some(Self::Strict),
            "standard" => Some(Self::Standard),
            "none" => Some(Self::None),
            _ => Option::None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct SandboxConfig {
    pub profile: SandboxProfile,
    pub workspace_root: PathBuf,
}

impl SandboxConfig {
    /// Build a SandboxConfig from a policy profile string.
    /// - None -> Standard (sandbox ON by default)
    /// - "strict" -> Strict
    /// - "standard" -> Standard
    /// - "none" -> None (explicit opt-out)
    /// - Unknown -> warn + fallback to Standard
    pub fn from_policy_profile(profile: Option<&str>, workspace_root: std::path::PathBuf) -> Self {
        let sandbox_profile = match profile {
            None => SandboxProfile::Standard,
            Some("strict") => SandboxProfile::Strict,
            Some("standard") => SandboxProfile::Standard,
            Some("none") => SandboxProfile::None,
            Some(unknown) => {
                tracing::warn!(
                    profile = unknown,
                    "Unknown sandbox policy profile, falling back to Standard"
                );
                SandboxProfile::Standard
            }
        };
        Self {
            profile: sandbox_profile,
            workspace_root,
        }
    }
}

/// Check if the platform sandbox binary is available on PATH.
pub fn is_sandbox_available() -> bool {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("which")
            .arg("sandbox-exec")
            .output()
            .is_ok_and(|o| o.status.success())
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("which")
            .arg("bwrap")
            .output()
            .is_ok_and(|o| o.status.success())
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        false
    }
}

pub struct SandboxedCommand;

impl SandboxedCommand {
    /// Build a sandboxed command wrapper.
    /// Returns None if profile is None or platform is unsupported.
    pub fn build(
        config: &SandboxConfig,
        command: &str,
        args: &[String],
    ) -> Option<(String, Vec<String>)> {
        match config.profile {
            SandboxProfile::None => Option::None,
            SandboxProfile::Strict => Self::build_strict(config, command, args),
            SandboxProfile::Standard => Self::build_standard(config, command, args),
        }
    }

    /// Resolve symlinks in the workspace path (e.g. /tmp -> /private/tmp on macOS)
    /// so sandbox profiles match the canonical path the OS actually sees.
    fn canonical_workspace(workspace_root: &std::path::Path) -> String {
        workspace_root
            .canonicalize()
            .unwrap_or_else(|_| workspace_root.to_path_buf())
            .display()
            .to_string()
    }

    #[cfg(target_os = "macos")]
    fn build_strict(
        config: &SandboxConfig,
        command: &str,
        args: &[String],
    ) -> Option<(String, Vec<String>)> {
        let ws = Self::canonical_workspace(&config.workspace_root);
        let profile = format!(
            "(version 1)\
             (deny default)\
             (allow process-exec)\
             (allow process-fork)\
             (allow file-read* (literal \"/\"))\
             (allow file-read* (subpath \"{ws}\"))\
             (allow file-read* (subpath \"/usr\"))\
             (allow file-read* (subpath \"/bin\"))\
             (allow file-read* (subpath \"/sbin\"))\
             (allow file-read* (subpath \"/private\"))\
             (allow file-read* (subpath \"/opt\"))\
             (allow file-read* (subpath \"/System\"))\
             (allow file-read* (subpath \"/Library\"))\
             (allow file-read* (subpath \"/var\"))\
             (allow file-read* (subpath \"/dev\"))\
             (allow file-write* (literal \"/dev/null\"))\
             (allow file-read* (subpath \"/Applications\"))\
             (allow file-read* (subpath \"/tmp\"))\
             (allow file-read* (subpath \"/Users\"))\
             (allow sysctl-read)"
        );
        let mut sb_args = vec!["-p".into(), profile, command.into()];
        sb_args.extend(args.iter().cloned());
        Some(("sandbox-exec".into(), sb_args))
    }

    #[cfg(target_os = "macos")]
    fn build_standard(
        config: &SandboxConfig,
        command: &str,
        args: &[String],
    ) -> Option<(String, Vec<String>)> {
        let ws = Self::canonical_workspace(&config.workspace_root);
        let profile = format!(
            "(version 1)\
             (deny default)\
             (allow process-exec)\
             (allow process-fork)\
             (allow file-read* (literal \"/\"))\
             (allow file-read* (subpath \"{ws}\"))\
             (allow file-write* (subpath \"{ws}\"))\
             (allow file-read* (subpath \"/usr\"))\
             (allow file-read* (subpath \"/bin\"))\
             (allow file-read* (subpath \"/sbin\"))\
             (allow file-read* (subpath \"/private\"))\
             (allow file-read* (subpath \"/opt\"))\
             (allow file-read* (subpath \"/System\"))\
             (allow file-read* (subpath \"/Library\"))\
             (allow file-read* (subpath \"/var\"))\
             (allow file-read* (subpath \"/dev\"))\
             (allow file-write* (literal \"/dev/null\"))\
             (allow file-read* (subpath \"/Applications\"))\
             (allow file-read* (subpath \"/tmp\"))\
             (allow file-write* (subpath \"/tmp\"))\
             (allow file-read* (subpath \"/Users\"))\
             (allow network-outbound)\
             (allow sysctl-read)"
        );
        let mut sb_args = vec!["-p".into(), profile, command.into()];
        sb_args.extend(args.iter().cloned());
        Some(("sandbox-exec".into(), sb_args))
    }

    #[cfg(target_os = "linux")]
    fn build_strict(
        config: &SandboxConfig,
        command: &str,
        args: &[String],
    ) -> Option<(String, Vec<String>)> {
        let ws = config.workspace_root.to_string_lossy();
        let mut bwrap_args = vec![
            "--unshare-pid".into(),
            "--unshare-uts".into(),
            "--unshare-net".into(),
            "--die-with-parent".into(),
            "--ro-bind".into(),
            ws.to_string(),
            ws.to_string(),
            "--ro-bind".into(),
            "/usr".into(),
            "/usr".into(),
            "--ro-bind".into(),
            "/lib".into(),
            "/lib".into(),
            "--ro-bind".into(),
            "/lib64".into(),
            "/lib64".into(),
            "--symlink".into(),
            "usr/bin".into(),
            "/bin".into(),
            "--proc".into(),
            "/proc".into(),
            "--dev".into(),
            "/dev".into(),
            command.into(),
        ];
        bwrap_args.extend(args.iter().cloned());
        Some(("bwrap".into(), bwrap_args))
    }

    #[cfg(target_os = "linux")]
    fn build_standard(
        config: &SandboxConfig,
        command: &str,
        args: &[String],
    ) -> Option<(String, Vec<String>)> {
        let ws = config.workspace_root.to_string_lossy();
        let mut bwrap_args = vec![
            "--unshare-pid".into(),
            "--unshare-uts".into(),
            "--die-with-parent".into(),
            "--bind".into(),
            ws.to_string(),
            ws.to_string(),
            "--ro-bind".into(),
            "/usr".into(),
            "/usr".into(),
            "--ro-bind".into(),
            "/lib".into(),
            "/lib".into(),
            "--ro-bind".into(),
            "/lib64".into(),
            "/lib64".into(),
            "--symlink".into(),
            "usr/bin".into(),
            "/bin".into(),
            "--proc".into(),
            "/proc".into(),
            "--dev".into(),
            "/dev".into(),
            command.into(),
        ];
        bwrap_args.extend(args.iter().cloned());
        Some(("bwrap".into(), bwrap_args))
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    fn build_strict(
        _config: &SandboxConfig,
        _command: &str,
        _args: &[String],
    ) -> Option<(String, Vec<String>)> {
        Option::None
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    fn build_standard(
        _config: &SandboxConfig,
        _command: &str,
        _args: &[String],
    ) -> Option<(String, Vec<String>)> {
        Option::None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sandbox_profile_none_returns_none() {
        let config = SandboxConfig {
            profile: SandboxProfile::None,
            workspace_root: PathBuf::from("/tmp/workspace"),
        };
        let result = SandboxedCommand::build(&config, "echo", &["hello".into()]);
        assert!(result.is_none());
    }

    #[test]
    fn sandbox_profile_parsing() {
        assert_eq!(
            SandboxProfile::from_str_name("strict"),
            Some(SandboxProfile::Strict)
        );
        assert_eq!(
            SandboxProfile::from_str_name("standard"),
            Some(SandboxProfile::Standard)
        );
        assert_eq!(
            SandboxProfile::from_str_name("none"),
            Some(SandboxProfile::None)
        );
        assert_eq!(SandboxProfile::from_str_name("invalid"), Option::None);
    }

    #[test]
    fn sandbox_config_clone() {
        let config = SandboxConfig {
            profile: SandboxProfile::Strict,
            workspace_root: PathBuf::from("/tmp/ws"),
        };
        let cloned = config.clone();
        assert_eq!(cloned.profile, SandboxProfile::Strict);
        assert_eq!(cloned.workspace_root, PathBuf::from("/tmp/ws"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn sandbox_strict_builds_correct_command() {
        let config = SandboxConfig {
            profile: SandboxProfile::Strict,
            workspace_root: PathBuf::from("/tmp/workspace"),
        };
        let result = SandboxedCommand::build(&config, "ls", &["-la".into()]);
        assert!(result.is_some());
        let (cmd, args) = result.unwrap();
        assert_eq!(cmd, "sandbox-exec");
        assert_eq!(args[0], "-p");
        assert!(args[1].contains("deny default"));
        // Canonicalized: /tmp -> /private/tmp on macOS
        assert!(args[1].contains("/tmp/workspace") || args[1].contains("/private/tmp/workspace"));
        // Strict should NOT allow network-outbound
        assert!(!args[1].contains("network-outbound"));
        assert_eq!(args[2], "ls");
        assert_eq!(args[3], "-la");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn sandbox_standard_builds_correct_command() {
        let config = SandboxConfig {
            profile: SandboxProfile::Standard,
            workspace_root: PathBuf::from("/tmp/workspace"),
        };
        let result = SandboxedCommand::build(&config, "curl", &["https://example.com".into()]);
        assert!(result.is_some());
        let (cmd, args) = result.unwrap();
        assert_eq!(cmd, "sandbox-exec");
        assert_eq!(args[0], "-p");
        // Standard should allow network and file-write
        assert!(args[1].contains("network-outbound"));
        assert!(args[1].contains("file-write*"));
        assert_eq!(args[2], "curl");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn sandbox_strict_builds_correct_command() {
        let config = SandboxConfig {
            profile: SandboxProfile::Strict,
            workspace_root: PathBuf::from("/tmp/workspace"),
        };
        let result = SandboxedCommand::build(&config, "ls", &["-la".into()]);
        assert!(result.is_some());
        let (cmd, args) = result.unwrap();
        assert_eq!(cmd, "bwrap");
        assert!(args.contains(&"--unshare-net".to_string()));
        assert!(args.contains(&"--ro-bind".to_string()));
        assert!(args.contains(&"--die-with-parent".to_string()));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn sandbox_standard_builds_correct_command() {
        let config = SandboxConfig {
            profile: SandboxProfile::Standard,
            workspace_root: PathBuf::from("/tmp/workspace"),
        };
        let result = SandboxedCommand::build(&config, "curl", &["https://example.com".into()]);
        assert!(result.is_some());
        let (cmd, args) = result.unwrap();
        assert_eq!(cmd, "bwrap");
        // Standard should NOT unshare net
        assert!(!args.contains(&"--unshare-net".to_string()));
        // Standard should use --bind (rw) instead of --ro-bind for workspace
        assert!(args.contains(&"--bind".to_string()));
    }

    #[test]
    fn from_policy_profile_none_defaults_to_standard() {
        let config = SandboxConfig::from_policy_profile(None, PathBuf::from("/tmp"));
        assert_eq!(config.profile, SandboxProfile::Standard);
    }

    #[test]
    fn from_policy_profile_explicit_values() {
        let strict = SandboxConfig::from_policy_profile(Some("strict"), PathBuf::from("/tmp"));
        assert_eq!(strict.profile, SandboxProfile::Strict);

        let standard = SandboxConfig::from_policy_profile(Some("standard"), PathBuf::from("/tmp"));
        assert_eq!(standard.profile, SandboxProfile::Standard);

        let none = SandboxConfig::from_policy_profile(Some("none"), PathBuf::from("/tmp"));
        assert_eq!(none.profile, SandboxProfile::None);
    }

    #[test]
    fn from_policy_profile_unknown_falls_back_to_standard() {
        let config = SandboxConfig::from_policy_profile(Some("foobar"), PathBuf::from("/tmp"));
        assert_eq!(config.profile, SandboxProfile::Standard);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn sandbox_available_on_macos() {
        // sandbox-exec should be available on macOS
        assert!(is_sandbox_available());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn canonical_workspace_resolves_symlinks() {
        // /tmp on macOS is a symlink to /private/tmp
        let result = SandboxedCommand::canonical_workspace(std::path::Path::new("/tmp"));
        assert_eq!(result, "/private/tmp");
    }

    #[test]
    fn canonical_workspace_falls_back_for_nonexistent() {
        let result =
            SandboxedCommand::canonical_workspace(std::path::Path::new("/nonexistent/path"));
        assert_eq!(result, "/nonexistent/path");
    }
}
