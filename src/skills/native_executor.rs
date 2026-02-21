use anyhow::Result;
use async_trait::async_trait;
use std::sync::Arc;
use tokio::process::Command;
use tracing::info;

use crate::core::vault::SecretsVault;
use crate::skills::{SkillManifest, SkillSandbox};

/// Native skill executor - runs skills directly on the host via `sh`.
///
/// In the agent-level containerization model, the agent's container provides
/// the isolation boundary, so skills execute natively within it.
pub struct NativeExecutor {
    vault: Arc<SecretsVault>,
    agent_name: String,
    api_host: String,
    api_port: u16,
    internal_token: String,
}

impl NativeExecutor {
    pub fn new(
        vault: Arc<SecretsVault>,
        agent_name: String,
        api_host: String,
        api_port: u16,
        internal_token: String,
    ) -> Self {
        Self {
            vault,
            agent_name,
            api_host,
            api_port,
            internal_token,
        }
    }
}

#[async_trait]
impl SkillSandbox for NativeExecutor {
    async fn execute(&self, manifest: &SkillManifest, args: &[String]) -> Result<String> {
        info!(
            "Executing skill [{}] natively... (v{})",
            manifest.name, manifest.version
        );
        info!("Description: {}", manifest.description);

        let script_path = manifest.skill_dir.join(&manifest.entrypoint);
        if !script_path.exists() {
            return Err(anyhow::anyhow!(
                "Skill entrypoint not found at {:?}",
                script_path
            ));
        }

        let mut cmd = Command::new(&manifest.run_command);
        cmd.arg(&script_path);

        // Check total args size - if it exceeds a safe threshold, skip CLI args
        // and pass them only via stdin to avoid OS ARG_MAX errors.
        let total_args_len: usize = args.iter().map(|a| a.len()).sum();
        let use_stdin_args = total_args_len > 100_000; // ~100KB threshold

        if !use_stdin_args {
            cmd.args(args);
        }
        cmd.current_dir(&manifest.skill_dir);

        // Inject environment
        cmd.env("AGENT_NAME", &self.agent_name);
        cmd.env(
            "MOXXY_API_BASE",
            format!("http://{}:{}/api", self.api_host, self.api_port),
        );
        cmd.env("MOXXY_INTERNAL_TOKEN", &self.internal_token);

        // Inject source directory for self-modifying skills (evolve_core)
        if let Ok(exe_path) = std::env::current_exe()
            && let Some(source_dir) = exe_path
                .parent()
                .and_then(|p| p.parent())
                .and_then(|p| p.parent())
        {
            // exe is at target/release/moxxy, source is 2 levels up
            if source_dir.join("Cargo.toml").exists() {
                cmd.env("MOXXY_SOURCE_DIR", source_dir);
            }
        }

        if manifest.needs_env {
            info!("Injecting vault secrets for skill: {}", manifest.name);
            let secrets = self.vault.list_keys().await?;
            for key in secrets {
                if let Some(val) = self.vault.get_secret(&key).await? {
                    cmd.env(&key, &val);
                }
            }
        }

        // Pass arguments via stdin as JSON to avoid OS ARG_MAX limits on large payloads.
        // Skills read from MOXXY_ARGS_MODE=stdin and parse JSON array from stdin.
        let args_json = serde_json::to_string(args).unwrap_or_else(|_| "[]".to_string());
        cmd.env("MOXXY_ARGS_MODE", "stdin");
        cmd.stdin(std::process::Stdio::piped());

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
