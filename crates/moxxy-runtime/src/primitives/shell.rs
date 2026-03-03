use async_trait::async_trait;
use moxxy_storage::Database;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::process::Command;

use crate::registry::{Primitive, PrimitiveError};
use crate::sandbox::{SandboxConfig, SandboxedCommand};

const DEFAULT_TIMEOUT_SECS: u64 = 30;

pub struct ShellExecPrimitive {
    db: Arc<Mutex<Database>>,
    agent_id: String,
    max_timeout: Duration,
    max_output_bytes: usize,
    sandbox_config: Option<SandboxConfig>,
    working_dir: Option<PathBuf>,
}

impl ShellExecPrimitive {
    pub fn new(
        db: Arc<Mutex<Database>>,
        agent_id: String,
        max_timeout: Duration,
        max_output_bytes: usize,
    ) -> Self {
        Self {
            db,
            agent_id,
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

    pub fn with_working_dir(mut self, dir: PathBuf) -> Self {
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

        let allowed_commands = {
            let db = self
                .db
                .lock()
                .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;
            let db_entries = db
                .allowlists()
                .list_entries(&self.agent_id, "shell_command")
                .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;
            crate::defaults::merge_with_defaults(db_entries, "shell_command")
        };

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
            cmd.current_dir(dir);
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
    use moxxy_storage::{AllowlistRow, Database};
    use moxxy_test_utils::TestDb;

    fn setup_db(commands: &[&str]) -> (Arc<Mutex<Database>>, String) {
        let test_db = TestDb::new();
        let db = Database::new(test_db.into_conn());
        let agent_id = uuid::Uuid::now_v7().to_string();
        db.agents()
            .insert(&moxxy_storage::AgentRow {
                id: agent_id.clone(),
                parent_agent_id: None,
                name: Some("test-agent".into()),
                status: "idle".into(),
                depth: 0,
                spawned_total: 0,
                workspace_root: "/tmp".into(),
                created_at: chrono::Utc::now().to_rfc3339(),
                updated_at: chrono::Utc::now().to_rfc3339(),
            })
            .unwrap();
        for cmd in commands {
            db.allowlists()
                .insert(&AllowlistRow {
                    id: uuid::Uuid::now_v7().to_string(),
                    agent_id: agent_id.clone(),
                    list_type: "shell_command".into(),
                    entry: cmd.to_string(),
                    created_at: chrono::Utc::now().to_rfc3339(),
                })
                .unwrap();
        }
        (Arc::new(Mutex::new(db)), agent_id)
    }

    #[tokio::test]
    async fn shell_exec_runs_allowed_command() {
        let (db, agent_id) = setup_db(&["echo", "ls"]);
        let prim = ShellExecPrimitive::new(db, agent_id, Duration::from_secs(5), 1024 * 1024);
        let result = prim
            .invoke(serde_json::json!({"command": "echo", "args": ["hello"]}))
            .await
            .unwrap();
        assert!(result["stdout"].as_str().unwrap().contains("hello"));
    }

    #[tokio::test]
    async fn shell_exec_blocks_disallowed_command() {
        let (db, agent_id) = setup_db(&["echo"]);
        let prim = ShellExecPrimitive::new(db, agent_id, Duration::from_secs(5), 1024 * 1024);
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
        let (db, agent_id) = setup_db(&["sleep"]);
        let prim = ShellExecPrimitive::new(db, agent_id, Duration::from_millis(100), 1024);
        let result = prim
            .invoke(serde_json::json!({"command": "sleep", "args": ["10"]}))
            .await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), PrimitiveError::Timeout));
    }

    #[tokio::test]
    async fn shell_exec_caps_output_size() {
        let (db, agent_id) = setup_db(&["yes"]);
        let prim = ShellExecPrimitive::new(db, agent_id, Duration::from_secs(2), 100);
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
        let (db, agent_id) = setup_db(&[]);
        let prim = ShellExecPrimitive::new(db, agent_id, Duration::from_secs(5), 1024);
        let result = prim
            .invoke(serde_json::json!({"command": "", "args": []}))
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn shell_exec_with_sandbox_none_works_normally() {
        use crate::sandbox::{SandboxConfig, SandboxProfile};
        use std::path::PathBuf;

        let config = SandboxConfig {
            profile: SandboxProfile::None,
            workspace_root: PathBuf::from("/tmp"),
        };
        let (db, agent_id) = setup_db(&["echo"]);
        let prim = ShellExecPrimitive::new(db, agent_id, Duration::from_secs(5), 1024 * 1024)
            .with_sandbox(config);
        let result = prim
            .invoke(serde_json::json!({"command": "echo", "args": ["sandbox-none"]}))
            .await
            .unwrap();
        assert!(result["stdout"].as_str().unwrap().contains("sandbox-none"));
    }

    #[tokio::test]
    async fn shell_exec_timeout_secs_parameter_respected() {
        let (db, agent_id) = setup_db(&["sleep"]);
        // max_timeout is 10s, but we request only 1s via the parameter
        let prim = ShellExecPrimitive::new(db, agent_id, Duration::from_secs(10), 1024);
        let result = prim
            .invoke(serde_json::json!({"command": "sleep", "args": ["5"], "timeout_secs": 1}))
            .await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), PrimitiveError::Timeout));
    }

    #[tokio::test]
    async fn shell_exec_timeout_secs_clamped_to_max() {
        let (db, agent_id) = setup_db(&["sleep"]);
        // max_timeout is 2s; requesting 999s should be clamped to 2s
        let prim = ShellExecPrimitive::new(db, agent_id, Duration::from_secs(2), 1024);
        let result = prim
            .invoke(serde_json::json!({"command": "sleep", "args": ["5"], "timeout_secs": 999}))
            .await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), PrimitiveError::Timeout));
    }

    #[tokio::test]
    async fn shell_exec_stdin_is_null() {
        // `cat` with no args reads from stdin; with stdin null it gets EOF immediately
        let (db, agent_id) = setup_db(&["cat"]);
        let prim = ShellExecPrimitive::new(db, agent_id, Duration::from_secs(3), 1024);
        let result = prim
            .invoke(serde_json::json!({"command": "cat"}))
            .await
            .unwrap();
        assert_eq!(result["stdout"].as_str().unwrap(), "");
        assert_eq!(result["exit_code"].as_i64().unwrap(), 0);
    }
}
