use anyhow::Result;
use async_trait::async_trait;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::process::Command;
use tracing::{info, warn};

use crate::core::vault::SecretsVault;
use crate::skills::{SkillManifest, SkillSandbox};

/// Native skill executor - runs skills directly on the host via `sh`.
///
/// Skills are executed in one of two modes based on their `privileged` flag:
/// - **Privileged**: Full host access (host_shell, host_python, etc.)
/// - **Sandboxed**: Restricted to agent workspace, no internal token, OS-level sandbox
pub struct NativeExecutor {
    vault: Arc<SecretsVault>,
    agent_name: String,
    agent_dir: PathBuf,
    api_host: String,
    api_port: u16,
    internal_token: String,
}

impl NativeExecutor {
    pub fn new(
        vault: Arc<SecretsVault>,
        agent_name: String,
        agent_dir: PathBuf,
        api_host: String,
        api_port: u16,
        internal_token: String,
    ) -> Self {
        Self {
            vault,
            agent_name,
            agent_dir,
            api_host,
            api_port,
            internal_token,
        }
    }

    /// Build a sandboxed command that wraps the skill execution with OS-level filesystem isolation.
    /// Returns the Command with sandbox wrapper applied, or a plain command if no sandbox is available.
    #[allow(unused_variables)]
    fn build_sandboxed_command(
        &self,
        manifest: &SkillManifest,
        script_path: &std::path::Path,
        workspace_path: &std::path::Path,
    ) -> Command {
        // Try OS-level sandbox first
        #[cfg(target_os = "macos")]
        {
            if Self::has_sandbox_exec() {
                return self.build_macos_sandbox(manifest, script_path, workspace_path);
            }
        }

        #[cfg(target_os = "linux")]
        {
            if Self::has_bwrap() {
                return self.build_linux_sandbox(manifest, script_path, workspace_path);
            }
        }

        // Fallback: no OS-level sandbox available
        warn!(
            "No OS-level sandbox available for skill [{}]. Relying on environment restrictions only.",
            manifest.name
        );
        use crate::platform::{NativePlatform, Platform};
        let cmd = NativePlatform::shell_command_async(script_path);
        cmd
    }

    #[cfg(target_os = "macos")]
    fn has_sandbox_exec() -> bool {
        std::path::Path::new("/usr/bin/sandbox-exec").exists()
    }

    #[cfg(target_os = "macos")]
    fn build_macos_sandbox(
        &self,
        manifest: &SkillManifest,
        script_path: &std::path::Path,
        workspace_path: &std::path::Path,
    ) -> Command {
        let workspace_str = workspace_path.to_string_lossy();
        let skill_dir_str = manifest.skill_dir.to_string_lossy();
        let profile = format!(
            r#"(version 1)
(deny default)
(allow process-exec (subpath "/usr/bin") (subpath "/bin") (subpath "/usr/local/bin"))
(allow process-fork)
(allow file-read* (subpath "/usr"))
(allow file-read* (subpath "/bin"))
(allow file-read* (subpath "/etc"))
(allow file-read* (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random") (literal "/dev/zero") (literal "/dev/stdin") (literal "/dev/stdout") (literal "/dev/stderr"))
(allow file-write* (literal "/dev/null") (literal "/dev/stdout") (literal "/dev/stderr"))
(allow file-read* file-write* (subpath "/tmp"))
(allow file-read* file-write* (subpath "/private/tmp"))
(allow file-read* (subpath "/var"))
(allow file-read* (subpath "/Library"))
(allow file-read* (subpath "/System"))
(allow file-read* (subpath "/opt"))
(allow file-read* (subpath "/private/var"))
(allow file-read* (subpath "{}"))
(allow file-read* file-write* (subpath "{}"))
(deny file-write-create (subpath "{}") (require-all (file-mode #o120000)))
(allow network-outbound)
(allow sysctl-read)
(allow mach-lookup)
"#,
            skill_dir_str, workspace_str, workspace_str
        );

        info!(
            "Sandboxing skill [{}] with macOS sandbox-exec (workspace: {})",
            manifest.name, workspace_str
        );

        let mut cmd = Command::new("sandbox-exec");
        cmd.arg("-p");
        cmd.arg(profile);
        cmd.arg(&manifest.run_command);
        cmd.arg(script_path);
        cmd
    }

    #[cfg(target_os = "linux")]
    fn has_bwrap() -> bool {
        std::process::Command::new("which")
            .arg("bwrap")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    #[cfg(target_os = "linux")]
    fn build_linux_sandbox(
        &self,
        manifest: &SkillManifest,
        script_path: &std::path::Path,
        workspace_path: &std::path::Path,
    ) -> Command {
        let workspace_str = workspace_path.to_string_lossy().to_string();
        let skill_dir_str = manifest.skill_dir.to_string_lossy().to_string();

        info!(
            "Sandboxing skill [{}] with bwrap (workspace: {})",
            manifest.name, workspace_str
        );

        let mut cmd = Command::new("bwrap");
        cmd.args([
            "--ro-bind",
            "/usr",
            "/usr",
            "--ro-bind",
            "/bin",
            "/bin",
            "--ro-bind",
            "/etc",
            "/etc",
            "--ro-bind-try",
            "/lib",
            "/lib",
            "--ro-bind-try",
            "/lib64",
            "/lib64",
            "--ro-bind",
            &skill_dir_str,
            &skill_dir_str,
            "--bind",
            &workspace_str,
            &workspace_str,
            "--proc",
            "/proc",
            "--dev",
            "/dev",
            "--tmpfs",
            "/tmp",
            "--unshare-all",
            "--share-net",
            "--die-with-parent",
            "--",
            &manifest.run_command,
        ]);
        cmd.arg(script_path);
        cmd
    }
}

#[async_trait]
impl SkillSandbox for NativeExecutor {
    async fn execute(&self, manifest: &SkillManifest, args: &[String]) -> Result<String> {
        info!(
            "Executing skill [{}] natively... (v{}, privileged={})",
            manifest.name, manifest.version, manifest.privileged
        );
        info!("Description: {}", manifest.description);

        let script_path = manifest.skill_dir.join(&manifest.entrypoint);
        if !script_path.exists() {
            return Err(anyhow::anyhow!(
                "Skill entrypoint not found at {:?}",
                script_path
            ));
        }

        let workspace_path = self.agent_dir.join("workspace");

        // Build the command: privileged skills get a plain command,
        // sandboxed skills get wrapped with OS-level isolation.
        use crate::platform::{NativePlatform, Platform};
        let mut cmd = if manifest.privileged {
            let c = NativePlatform::shell_command_async(&script_path);
            c
        } else {
            self.build_sandboxed_command(manifest, &script_path, &workspace_path)
        };

        // Check total args size - if it exceeds a safe threshold, skip CLI args
        // and pass them only via stdin to avoid OS ARG_MAX errors.
        let total_args_len: usize = args.iter().map(|a| a.len()).sum();
        let use_stdin_args = total_args_len > 100_000; // ~100KB threshold

        if !use_stdin_args {
            cmd.args(args);
        }

        if manifest.privileged {
            // ── Privileged execution: full host access ──
            cmd.current_dir(&manifest.skill_dir);
            cmd.env("AGENT_NAME", &self.agent_name);
            cmd.env("AGENT_HOME", &self.agent_dir);
            cmd.env("AGENT_WORKSPACE", &workspace_path);
            cmd.env(
                "MOXXY_API_BASE",
                format!("http://{}:{}/api", self.api_host, self.api_port),
            );
            // Internal token is only exposed to privileged built-in skills
            // (controlled by PRIVILEGED_SKILLS allowlist in skills/mod.rs).
            // User-installed and sandboxed skills never receive this.
            cmd.env("MOXXY_INTERNAL_TOKEN", &self.internal_token);

            // Inject source directory only for evolve_core
            if manifest.name == "evolve_core" {
                if let Ok(exe_path) = std::env::current_exe()
                    && let Some(source_dir) = exe_path
                        .parent()
                        .and_then(|p| p.parent())
                        .and_then(|p| p.parent())
                {
                    if source_dir.join("Cargo.toml").exists() {
                        cmd.env("MOXXY_SOURCE_DIR", source_dir);
                    }
                }
            }

            if manifest.needs_env {
                info!("Injecting vault secrets for skill: {}", manifest.name);
                let secrets = self.vault.list_keys().await?;
                for key in secrets {
                    if !manifest.env_keys.is_empty() && !manifest.env_keys.contains(&key) {
                        continue;
                    }
                    if let Some(val) = self.vault.get_secret(&key).await? {
                        cmd.env(&key, &val);
                    }
                }
            }
        } else {
            // ── Sandboxed execution: workspace-only access ──
            cmd.env_clear();
            cmd.current_dir(&workspace_path);
            cmd.env("AGENT_NAME", &self.agent_name);
            cmd.env("AGENT_WORKSPACE", &workspace_path);
            cmd.env("HOME", &workspace_path);
            cmd.env("PATH", NativePlatform::sandboxed_path());
            cmd.env(
                "MOXXY_API_BASE",
                format!("http://{}:{}/api", self.api_host, self.api_port),
            );
            // NOTE: MOXXY_INTERNAL_TOKEN intentionally NOT injected.
            // Sandboxed skills cannot call the host proxy.
            // NOTE: AGENT_HOME intentionally NOT injected.
            // NOTE: MOXXY_SOURCE_DIR intentionally NOT injected.

            if manifest.needs_env {
                info!(
                    "Injecting vault secrets for sandboxed skill: {}",
                    manifest.name
                );
                let secrets = self.vault.list_keys().await?;
                for key in secrets {
                    if !manifest.env_keys.is_empty() && !manifest.env_keys.contains(&key) {
                        continue;
                    }
                    if let Some(val) = self.vault.get_secret(&key).await? {
                        cmd.env(&key, &val);
                    }
                }
            }
        }

        // Pass arguments via stdin as JSON to avoid OS ARG_MAX limits on large payloads.
        // Skills read from MOXXY_ARGS_MODE=stdin and parse JSON array from stdin.
        let args_json = serde_json::to_string(args).unwrap_or_else(|_| "[]".to_string());
        cmd.env("MOXXY_ARGS_MODE", "stdin");
        cmd.stdin(std::process::Stdio::piped());
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        let mut child = cmd.spawn()?;
        if let Some(mut stdin) = child.stdin.take() {
            use tokio::io::AsyncWriteExt;
            let _ = stdin.write_all(args_json.as_bytes()).await;
            drop(stdin);
        }
        let output = child.wait_with_output().await?;

        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            return Err(anyhow::anyhow!(
                "Skill execution failed: {} {}",
                err,
                stdout
            ));
        }

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }
}
