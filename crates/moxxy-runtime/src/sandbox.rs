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

    #[cfg(target_os = "macos")]
    fn build_strict(
        config: &SandboxConfig,
        command: &str,
        args: &[String],
    ) -> Option<(String, Vec<String>)> {
        let profile = format!(
            "(version 1)(deny default)(allow process-exec)(allow file-read* (subpath \"{}\"))(allow file-read* (subpath \"/usr\"))(allow file-read* (subpath \"/System\"))(allow file-read* (subpath \"/Library\"))(allow sysctl-read)",
            config.workspace_root.display()
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
        let profile = format!(
            "(version 1)(deny default)(allow process-exec)(allow file-read* (subpath \"{ws}\"))(allow file-write* (subpath \"{ws}\"))(allow file-read* (subpath \"/usr\"))(allow file-read* (subpath \"/System\"))(allow file-read* (subpath \"/Library\"))(allow network-outbound)(allow sysctl-read)",
            ws = config.workspace_root.display()
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
        assert!(args[1].contains("/tmp/workspace"));
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
}
