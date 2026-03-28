use async_trait::async_trait;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::process::Command;

use crate::registry::{Primitive, PrimitiveError};
use crate::sandbox::{SandboxConfig, SandboxedCommand};

const DEFAULT_TIMEOUT_SECS: u64 = 30;

pub struct ShellExecPrimitive {
    allowlist_path: PathBuf,
    max_timeout: Duration,
    max_output_bytes: usize,
    sandbox_config: Option<SandboxConfig>,
    working_dir: Option<Arc<Mutex<PathBuf>>>,
}

impl ShellExecPrimitive {
    pub fn new(
        allowlist_path: PathBuf,
        max_timeout: Duration,
        max_output_bytes: usize,
    ) -> Self {
        Self {
            allowlist_path,
            max_timeout,
            max_output_bytes,
            sandbox_config: None,
            working_dir: None,
        }
    }

    pub fn with_sandbox(mut self, config: SandboxConfig) -> Self {
        self.sandbox_config = Some(config);
        self
    }

    pub fn with_working_dir(mut self, dir: Arc<Mutex<PathBuf>>) -> Self {
        self.working_dir = Some(dir);
        self
    }
}

#[async_trait]
impl Primitive for ShellExecPrimitive {
    fn name(&self) -> &str {
        "shell.exec"
    }

    fn description(&self) -> &str {
        "Execute a shell command from the allowlist with given arguments."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "command": {"type": "string", "description": "The command to run (must be in the allowlist)"},
                "args": {"type": "array", "items": {"type": "string"}, "description": "Arguments to pass to the command"},
                "timeout_secs": {"type": "integer", "description": "Timeout in seconds (default: 30, max: 300). Use higher values for slow commands like npm install or cargo build."}
            },
            "required": ["command"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let command = params["command"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'command' parameter".into()))?;

        if command.is_empty() {
            return Err(PrimitiveError::InvalidParams(
                "command must not be empty".into(),
            ));
        }

        let file = moxxy_core::AllowlistFile::load(&self.allowlist_path);
        let allows = file.allows("shell_command");
        let denials = file.denials("shell_command");
        let allowed_commands =
            crate::defaults::merge_with_defaults_and_denials(allows, denials, "shell_command");

        if !allowed_commands.contains(&command.to_string()) {
            tracing::warn!(command, "Shell exec blocked = command not in allowlist");
            return Err(PrimitiveError::AccessDenied(format!(
                "Command '{}' not in allowlist",
                command
            )));
        }

        tracing::info!(command, "Executing shell command");

        let args: Vec<String> = params["args"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        let (exec_cmd, exec_args) = if let Some(ref sandbox_cfg) = self.sandbox_config {
            if let Some((sb_cmd, sb_args)) = SandboxedCommand::build(sandbox_cfg, command, &args) {
                (sb_cmd, sb_args)
            } else {
                (command.to_string(), args.clone())
            }
        } else {
            (command.to_string(), args.clone())
        };

        let timeout = {
            let requested = params
                .get("timeout_secs")
                .and_then(|v| v.as_u64())
                .unwrap_or(DEFAULT_TIMEOUT_SECS);
            Duration::from_secs(requested.max(1).min(self.max_timeout.as_secs()))
        };

        let mut cmd = Command::new(&exec_cmd);
        cmd.args(&exec_args)
            .env("PATH", super::git::augmented_path())
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        if let Some(ref dir) = self.working_dir {
            let cwd = dir.lock().unwrap().clone();
            // Canonicalize the workspace path so symlinks (e.g. /tmp -> /private/tmp
            // on macOS) are resolved. This is important for sandbox profiles that
            // use the canonical path and for consistent cwd behavior.
            let canonical_cwd = cwd.canonicalize().unwrap_or_else(|_| cwd.clone());
            cmd.current_dir(&canonical_cwd);
            // Set PWD so that sub-shells and scripting runtimes (python3, node,
            // etc.) see the workspace even if they don't inherit the OS cwd.
            cmd.env("PWD", &canonical_cwd);
            cmd.env("MOXXY_WORKSPACE", &canonical_cwd);
        }

        let child = cmd
            .spawn()
            .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;

        let output = match tokio::time::timeout(timeout, child.wait_with_output()).await {
            Ok(result) => result.map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?,
            Err(_) => {
                // Process will be killed when dropped
                return Err(PrimitiveError::Timeout);
            }
        };

        let mut stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let mut stderr = String::from_utf8_lossy(&output.stderr).to_string();

        if stdout.len() > self.max_output_bytes {
            stdout.truncate(self.max_output_bytes);
        }
        if stderr.len() > self.max_output_bytes {
            stderr.truncate(self.max_output_bytes);
        }

        Ok(serde_json::json!({
            "stdout": stdout,
            "stderr": stderr,
            "exit_code": output.status.code(),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_allowlist(commands: &[&str]) -> PathBuf {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("allowlists.yaml");
        let mut file = moxxy_core::AllowlistFile::default();
        for cmd in commands {
            file.add_allow("shell_command", cmd.to_string());
        }
        file.save(&path).unwrap();
        // Leak the tempdir so it lives long enough
        std::mem::forget(tmp);
        path
    }

    #[tokio::test]
    async fn shell_exec_runs_allowed_command() {
        let path = setup_allowlist(&["echo", "ls"]);
        let prim = ShellExecPrimitive::new(path, Duration::from_secs(5), 1024 * 1024);
        let result = prim
            .invoke(serde_json::json!({"command": "echo", "args": ["hello"]}))
            .await
            .unwrap();
        assert!(result["stdout"].as_str().unwrap().contains("hello"));
    }

    #[tokio::test]
    async fn shell_exec_blocks_disallowed_command() {
        let path = setup_allowlist(&["echo"]);
        let prim = ShellExecPrimitive::new(path, Duration::from_secs(5), 1024 * 1024);
        let result = prim
            .invoke(serde_json::json!({"command": "rm", "args": ["-rf", "/"]}))
            .await;
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::AccessDenied(_)
        ));
    }

    #[tokio::test]
    async fn shell_exec_enforces_timeout() {
        let path = setup_allowlist(&["sleep"]);
        let prim = ShellExecPrimitive::new(path, Duration::from_millis(100), 1024);
        let result = prim
            .invoke(serde_json::json!({"command": "sleep", "args": ["10"]}))
            .await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), PrimitiveError::Timeout));
    }

    #[tokio::test]
    async fn shell_exec_caps_output_size() {
        let path = setup_allowlist(&["yes"]);
        let prim = ShellExecPrimitive::new(path, Duration::from_secs(2), 100);
        let result = prim
            .invoke(serde_json::json!({"command": "yes", "args": []}))
            .await;
        // Should either error (timeout) or have truncated output
        if let Ok(v) = result {
            let stdout = v["stdout"].as_str().unwrap_or("");
            assert!(stdout.len() <= 200); // Allow some buffer
        }
    }

    #[tokio::test]
    async fn shell_exec_rejects_empty_command() {
        let path = setup_allowlist(&[]);
        let prim = ShellExecPrimitive::new(path, Duration::from_secs(5), 1024);
        let result = prim
            .invoke(serde_json::json!({"command": "", "args": []}))
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn shell_exec_with_sandbox_none_works_normally() {
        use crate::sandbox::{SandboxConfig, SandboxProfile};

        let config = SandboxConfig {
            profile: SandboxProfile::None,
            workspace_root: PathBuf::from("/tmp"),
        };
        let path = setup_allowlist(&["echo"]);
        let prim = ShellExecPrimitive::new(path, Duration::from_secs(5), 1024 * 1024)
            .with_sandbox(config);
        let result = prim
            .invoke(serde_json::json!({"command": "echo", "args": ["sandbox-none"]}))
            .await
            .unwrap();
        assert!(result["stdout"].as_str().unwrap().contains("sandbox-none"));
    }

    #[tokio::test]
    async fn shell_exec_timeout_secs_parameter_respected() {
        let path = setup_allowlist(&["sleep"]);
        // max_timeout is 10s, but we request only 1s via the parameter
        let prim = ShellExecPrimitive::new(path, Duration::from_secs(10), 1024);
        let result = prim
            .invoke(serde_json::json!({"command": "sleep", "args": ["5"], "timeout_secs": 1}))
            .await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), PrimitiveError::Timeout));
    }

    #[tokio::test]
    async fn shell_exec_timeout_secs_clamped_to_max() {
        let path = setup_allowlist(&["sleep"]);
        // max_timeout is 2s; requesting 999s should be clamped to 2s
        let prim = ShellExecPrimitive::new(path, Duration::from_secs(2), 1024);
        let result = prim
            .invoke(serde_json::json!({"command": "sleep", "args": ["5"], "timeout_secs": 999}))
            .await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), PrimitiveError::Timeout));
    }

    #[tokio::test]
    async fn shell_exec_stdin_is_null() {
        // `cat` with no args reads from stdin; with stdin null it gets EOF immediately
        let path = setup_allowlist(&["cat"]);
        let prim = ShellExecPrimitive::new(path, Duration::from_secs(3), 1024);
        let result = prim
            .invoke(serde_json::json!({"command": "cat"}))
            .await
            .unwrap();
        assert_eq!(result["stdout"].as_str().unwrap(), "");
        assert_eq!(result["exit_code"].as_i64().unwrap(), 0);
    }

    #[tokio::test]
    async fn shell_exec_runs_in_workspace_cwd() {
        let tmp = tempfile::tempdir().unwrap();
        let ws = tmp.path().to_path_buf();
        let path = setup_allowlist(&["pwd"]);
        let prim = ShellExecPrimitive::new(path, Duration::from_secs(5), 1024 * 1024)
            .with_working_dir(Arc::new(Mutex::new(ws.clone())));
        let result = prim
            .invoke(serde_json::json!({"command": "pwd"}))
            .await
            .unwrap();
        let stdout = result["stdout"].as_str().unwrap().trim();
        // Canonicalize both for comparison (handles /tmp -> /private/tmp on macOS)
        let canonical_ws = ws.canonicalize().unwrap();
        let canonical_out = PathBuf::from(stdout).canonicalize().unwrap();
        assert_eq!(canonical_out, canonical_ws);
    }

    #[tokio::test]
    async fn shell_exec_sets_pwd_env_var() {
        let tmp = tempfile::tempdir().unwrap();
        let ws = tmp.path().to_path_buf();
        let path = setup_allowlist(&["bash"]);
        let prim = ShellExecPrimitive::new(path, Duration::from_secs(5), 1024 * 1024)
            .with_working_dir(Arc::new(Mutex::new(ws.clone())));
        let result = prim
            .invoke(serde_json::json!({"command": "bash", "args": ["-c", "echo $PWD"]}))
            .await
            .unwrap();
        let stdout = result["stdout"].as_str().unwrap().trim();
        let canonical_ws = ws.canonicalize().unwrap();
        assert_eq!(PathBuf::from(stdout), canonical_ws);
    }

    #[tokio::test]
    async fn shell_exec_sets_moxxy_workspace_env_var() {
        let tmp = tempfile::tempdir().unwrap();
        let ws = tmp.path().to_path_buf();
        let path = setup_allowlist(&["bash"]);
        let prim = ShellExecPrimitive::new(path, Duration::from_secs(5), 1024 * 1024)
            .with_working_dir(Arc::new(Mutex::new(ws.clone())));
        let result = prim
            .invoke(
                serde_json::json!({"command": "bash", "args": ["-c", "echo $MOXXY_WORKSPACE"]}),
            )
            .await
            .unwrap();
        let stdout = result["stdout"].as_str().unwrap().trim();
        let canonical_ws = ws.canonicalize().unwrap();
        assert_eq!(PathBuf::from(stdout), canonical_ws);
    }
}
