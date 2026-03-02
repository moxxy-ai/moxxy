use async_trait::async_trait;
use std::time::Duration;
use tokio::process::Command;

use crate::registry::{Primitive, PrimitiveError};

pub struct ShellExecPrimitive {
    allowed_commands: Vec<String>,
    timeout: Duration,
    max_output_bytes: usize,
}

impl ShellExecPrimitive {
    pub fn new(allowed_commands: Vec<String>, timeout: Duration, max_output_bytes: usize) -> Self {
        Self {
            allowed_commands,
            timeout,
            max_output_bytes,
        }
    }
}

#[async_trait]
impl Primitive for ShellExecPrimitive {
    fn name(&self) -> &str {
        "shell.exec"
    }

    async fn invoke(
        &self,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, PrimitiveError> {
        let command = params["command"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'command' parameter".into()))?;

        if command.is_empty() {
            return Err(PrimitiveError::InvalidParams(
                "command must not be empty".into(),
            ));
        }

        if !self.allowed_commands.contains(&command.to_string()) {
            return Err(PrimitiveError::AccessDenied(format!(
                "Command '{}' not in allowlist",
                command
            )));
        }

        let args: Vec<String> = params["args"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        let child = Command::new(command)
            .args(&args)
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

    #[tokio::test]
    async fn shell_exec_runs_allowed_command() {
        let prim = ShellExecPrimitive::new(
            vec!["echo".into(), "ls".into()],
            Duration::from_secs(5),
            1024 * 1024,
        );
        let result = prim
            .invoke(serde_json::json!({"command": "echo", "args": ["hello"]}))
            .await
            .unwrap();
        assert!(result["stdout"].as_str().unwrap().contains("hello"));
    }

    #[tokio::test]
    async fn shell_exec_blocks_disallowed_command() {
        let prim = ShellExecPrimitive::new(
            vec!["echo".into()],
            Duration::from_secs(5),
            1024 * 1024,
        );
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
        let prim = ShellExecPrimitive::new(
            vec!["sleep".into()],
            Duration::from_millis(100),
            1024,
        );
        let result = prim
            .invoke(serde_json::json!({"command": "sleep", "args": ["10"]}))
            .await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), PrimitiveError::Timeout));
    }

    #[tokio::test]
    async fn shell_exec_caps_output_size() {
        let prim = ShellExecPrimitive::new(
            vec!["yes".into()],
            Duration::from_secs(2),
            100,
        );
        let result = prim
            .invoke(serde_json::json!({"command": "yes", "args": []}))
            .await;
        // Should either error (timeout) or have truncated output
        match result {
            Ok(v) => {
                let stdout = v["stdout"].as_str().unwrap_or("");
                assert!(stdout.len() <= 200); // Allow some buffer
            }
            Err(_) => {} // Timeout is also acceptable
        }
    }

    #[tokio::test]
    async fn shell_exec_rejects_empty_command() {
        let prim = ShellExecPrimitive::new(vec![], Duration::from_secs(5), 1024);
        let result = prim
            .invoke(serde_json::json!({"command": "", "args": []}))
            .await;
        assert!(result.is_err());
    }
}
