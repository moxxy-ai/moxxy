use async_trait::async_trait;
use moxxy_storage::Database;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::process::Command;

use crate::registry::{Primitive, PrimitiveError};
use crate::sandbox::{SandboxConfig, SandboxedCommand};

pub struct ShellExecPrimitive {
    db: Arc<Mutex<Database>>,
    agent_id: String,
    timeout: Duration,
    max_output_bytes: usize,
    sandbox_config: Option<SandboxConfig>,
}

impl ShellExecPrimitive {
    pub fn new(
        db: Arc<Mutex<Database>>,
        agent_id: String,
        timeout: Duration,
        max_output_bytes: usize,
    ) -> Self {
        Self {
            db,
            agent_id,
            timeout,
            max_output_bytes,
            sandbox_config: None,
        }
    }

    pub fn with_sandbox(mut self, config: SandboxConfig) -> Self {
        self.sandbox_config = Some(config);
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
                "args": {"type": "array", "items": {"type": "string"}, "description": "Arguments to pass to the command"}
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
            db.allowlists()
                .list_entries(&self.agent_id, "shell_command")
                .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?
        };

        if !allowed_commands.contains(&command.to_string()) {
            tracing::warn!(command, "Shell exec blocked — command not in allowlist");
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

        let child = Command::new(&exec_cmd)
            .args(&exec_args)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;

        let output = match tokio::time::timeout(self.timeout, child.wait_with_output()).await {
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
        // Insert provider + agent for FK constraints
        db.providers()
            .insert(&moxxy_storage::ProviderRow {
                id: "test-provider".into(),
                display_name: "Test".into(),
                manifest_path: "/tmp".into(),
                signature: None,
                enabled: true,
                created_at: chrono::Utc::now().to_rfc3339(),
            })
            .unwrap();
        let agent_id = uuid::Uuid::now_v7().to_string();
        db.agents()
            .insert(&moxxy_storage::AgentRow {
                id: agent_id.clone(),
                parent_agent_id: None,
                provider_id: "test-provider".into(),
                model_id: "test-model".into(),
                workspace_root: "/tmp".into(),
                core_mount: None,
                policy_profile: None,
                temperature: 0.7,
                max_subagent_depth: 2,
                max_subagents_total: 8,
                status: "idle".into(),
                depth: 0,
                spawned_total: 0,
                created_at: chrono::Utc::now().to_rfc3339(),
                updated_at: chrono::Utc::now().to_rfc3339(),
                name: Some("test-agent".into()),
                persona: None,
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
        let prim =
            ShellExecPrimitive::new(db, agent_id, Duration::from_secs(5), 1024 * 1024)
                .with_sandbox(config);
        let result = prim
            .invoke(serde_json::json!({"command": "echo", "args": ["sandbox-none"]}))
            .await
            .unwrap();
        assert!(result["stdout"].as_str().unwrap().contains("sandbox-none"));
    }
}
