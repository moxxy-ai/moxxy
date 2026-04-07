use async_trait::async_trait;
use futures_util::Stream;
use serde::Deserialize;
use std::path::PathBuf;
use std::pin::Pin;
use std::process::Stdio;

#[allow(unused_imports)]
use crate::provider::ToolCall;
use crate::provider::{Message, ModelConfig, Provider, ProviderResponse, StreamEvent, TokenUsage};
use crate::registry::{PrimitiveError, ToolDefinition};

/// Default timeout for CLI invocations (120 seconds).
const CLI_TIMEOUT_SECS: u64 = 120;

/// Prompt size threshold above which we pipe via stdin instead of CLI arg.
const STDIN_THRESHOLD: usize = 100_000;

/// A provider that shells out to the locally-installed `claude` CLI binary.
///
/// This enables using a Claude Max subscription (no API key required) as a
/// backend for Moxxy agents.  The CLI handles authentication via `claude auth`.
pub struct ClaudeCliProvider {
    binary_path: PathBuf,
    model: String,
    workspace: Option<PathBuf>,
}

// ── CLI JSON output types ──────────────────────────────────────────

#[derive(Deserialize)]
struct CliJsonOutput {
    #[serde(rename = "type")]
    _output_type: String,
    #[serde(default)]
    subtype: Option<String>,
    #[serde(default)]
    is_error: Option<bool>,
    #[serde(default)]
    result: String,
    #[serde(default)]
    usage: Option<CliUsage>,
}

#[derive(Deserialize)]
struct CliUsage {
    #[serde(default)]
    input_tokens: Option<u32>,
    #[serde(default)]
    output_tokens: Option<u32>,
}

// ── Implementation ─────────────────────────────────────────────────

impl ClaudeCliProvider {
    pub fn new(binary_path: PathBuf, model: impl Into<String>) -> Self {
        Self {
            binary_path,
            model: model.into(),
            workspace: None,
        }
    }

    pub fn with_workspace(mut self, workspace: PathBuf) -> Self {
        self.workspace = Some(workspace);
        self
    }

    /// Locate the `claude` binary on the system.
    pub fn discover() -> Option<PathBuf> {
        // Try `which claude` first
        let found = std::process::Command::new("which")
            .arg("claude")
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
            .ok()
            .filter(|o| o.status.success())
            .and_then(|o| {
                let path = String::from_utf8_lossy(&o.stdout).trim().to_string();
                let p = PathBuf::from(&path);
                p.exists().then_some(p)
            });
        if found.is_some() {
            return found;
        }

        // Fallback paths
        let home = dirs_or_home();
        let candidates = [
            home.join(".local/bin/claude"),
            PathBuf::from("/usr/local/bin/claude"),
            home.join(".claude/bin/claude"),
        ];
        candidates.into_iter().find(|p| p.exists())
    }
}

/// Separate system messages from the conversation and serialize the rest into
/// a text prompt.  Returns `(system_prompt, conversation_body)`.
fn serialize_conversation(messages: &[Message]) -> (Option<String>, String) {
    let mut system_parts: Vec<&str> = Vec::new();
    let mut body = String::new();

    for msg in messages {
        match msg.role.as_str() {
            "system" => {
                system_parts.push(&msg.content);
            }
            "user" => {
                body.push_str(&format!("[User]: {}\n", msg.content));
            }
            "assistant" => {
                if !msg.content.is_empty() {
                    body.push_str(&format!("[Assistant]: {}\n", msg.content));
                }
                if let Some(calls) = &msg.tool_calls {
                    for tc in calls {
                        body.push_str(&format!(
                            "[Assistant called tool: {}({})]\n",
                            tc.name, tc.arguments
                        ));
                    }
                }
            }
            "tool" => {
                let name = msg.name.as_deref().unwrap_or("unknown");
                let id = msg.tool_call_id.as_deref().unwrap_or("?");
                body.push_str(&format!(
                    "[Tool result for {} (id: {})]: {}\n",
                    name, id, msg.content
                ));
            }
            _ => {
                body.push_str(&format!("[{}]: {}\n", msg.role, msg.content));
            }
        }
    }

    let system = if system_parts.is_empty() {
        None
    } else {
        Some(system_parts.join("\n\n"))
    };

    (system, body)
}

/// Parse the CLI JSON output into a `ProviderResponse`.
fn parse_cli_output(raw: &str, stderr: &str) -> Result<ProviderResponse, PrimitiveError> {
    let output: CliJsonOutput = serde_json::from_str(raw).map_err(|e| {
        let context = if stderr.trim().is_empty() {
            raw.chars().take(500).collect::<String>()
        } else {
            stderr.trim().to_string()
        };
        PrimitiveError::ExecutionFailed(format!(
            "Failed to parse CLI JSON output: {e}\nOutput: {context}"
        ))
    })?;

    // Check for errors
    if output.is_error.unwrap_or(false) || output.subtype.as_deref() == Some("error") {
        let mut msg = output.result.clone();
        if msg.is_empty() && !stderr.trim().is_empty() {
            msg = stderr.trim().to_string();
        }
        if msg.is_empty() {
            msg = "unknown error (empty response)".to_string();
        }
        if msg.contains("Not logged in") || msg.contains("not logged in") {
            return Err(PrimitiveError::AccessDenied(
                "Claude CLI is not authenticated. Run `claude auth login`.".into(),
            ));
        }
        return Err(PrimitiveError::ExecutionFailed(format!(
            "Claude CLI error: {msg}"
        )));
    }

    let usage = output.usage.map(|u| TokenUsage {
        input_tokens: u.input_tokens,
        output_tokens: u.output_tokens,
        prompt_tokens: u.input_tokens,
        completion_tokens: u.output_tokens,
        total_tokens: match (u.input_tokens, u.output_tokens) {
            (Some(i), Some(o)) => Some(i + o),
            _ => None,
        },
    });

    // The CLI runs its own tool loop internally; we just get the final text.
    Ok(ProviderResponse {
        content: output.result,
        tool_calls: vec![],
        usage,
    })
}

fn dirs_or_home() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/tmp"))
}

impl ClaudeCliProvider {
    /// Build the base CLI command for a completion request.
    fn build_cli_command(
        &self,
        conversation_body: &str,
        system_prompt: &Option<String>,
        streaming: bool,
    ) -> (tokio::process::Command, bool) {
        let mut cmd = tokio::process::Command::new(&self.binary_path);
        cmd.arg("-p");

        let use_stdin = conversation_body.len() > STDIN_THRESHOLD;
        if !use_stdin {
            cmd.arg(conversation_body);
        }

        if streaming {
            cmd.arg("--output-format").arg("stream-json");
            cmd.arg("--verbose");
            cmd.arg("--include-partial-messages");
        } else {
            cmd.arg("--output-format").arg("json");
        }

        cmd.arg("--no-session-persistence");
        cmd.arg("--dangerously-skip-permissions");
        cmd.arg("--model").arg(&self.model);

        if let Some(sp) = system_prompt {
            cmd.arg("--system-prompt").arg(sp);
        }

        // Run in the agent's workspace directory
        if let Some(ref ws) = self.workspace {
            cmd.current_dir(ws);
        }

        if use_stdin {
            cmd.stdin(Stdio::piped());
        } else {
            cmd.stdin(Stdio::null());
        }
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        (cmd, use_stdin)
    }
}

#[async_trait]
impl Provider for ClaudeCliProvider {
    async fn complete(
        &self,
        messages: Vec<Message>,
        _config: &ModelConfig,
        _tools: &[ToolDefinition],
    ) -> Result<ProviderResponse, PrimitiveError> {
        let (system_prompt, conversation_body) = serialize_conversation(&messages);
        let (mut cmd, use_stdin) =
            self.build_cli_command(&conversation_body, &system_prompt, false);

        let mut child = cmd.spawn().map_err(|e| {
            PrimitiveError::ExecutionFailed(format!(
                "Failed to spawn claude CLI at {}: {e}",
                self.binary_path.display()
            ))
        })?;

        if let (true, Some(mut stdin)) = (use_stdin, child.stdin.take()) {
            use tokio::io::AsyncWriteExt;
            let body = conversation_body.clone();
            tokio::spawn(async move {
                let _ = stdin.write_all(body.as_bytes()).await;
                let _ = stdin.shutdown().await;
            });
        }

        let output = tokio::time::timeout(
            std::time::Duration::from_secs(CLI_TIMEOUT_SECS),
            child.wait_with_output(),
        )
        .await
        .map_err(|_| PrimitiveError::Timeout)?
        .map_err(|e| PrimitiveError::ExecutionFailed(format!("Claude CLI process error: {e}")))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);

        if !output.status.success() && stdout.trim().is_empty() {
            return Err(PrimitiveError::ExecutionFailed(format!(
                "Claude CLI exited with status {}: {}",
                output.status,
                stderr.trim()
            )));
        }

        parse_cli_output(&stdout, &stderr)
    }

    async fn complete_stream(
        &self,
        messages: Vec<Message>,
        _config: &ModelConfig,
        _tools: &[ToolDefinition],
    ) -> Result<Pin<Box<dyn Stream<Item = StreamEvent> + Send>>, PrimitiveError> {
        let (system_prompt, conversation_body) = serialize_conversation(&messages);
        let (mut cmd, use_stdin) = self.build_cli_command(&conversation_body, &system_prompt, true);

        let mut child = cmd.spawn().map_err(|e| {
            PrimitiveError::ExecutionFailed(format!(
                "Failed to spawn claude CLI at {}: {e}",
                self.binary_path.display()
            ))
        })?;

        if let (true, Some(mut stdin)) = (use_stdin, child.stdin.take()) {
            use tokio::io::AsyncWriteExt;
            let body = conversation_body.clone();
            tokio::spawn(async move {
                let _ = stdin.write_all(body.as_bytes()).await;
                let _ = stdin.shutdown().await;
            });
        }

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| PrimitiveError::ExecutionFailed("No stdout from CLI".into()))?;

        let stream = async_stream::stream! {
            use tokio::io::{AsyncBufReadExt, BufReader};
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            let mut full_content = String::new();

            while let Ok(Some(line)) = lines.next_line().await {
                if line.is_empty() { continue; }

                let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) else {
                    continue;
                };

                let event_type = event.get("type").and_then(|t| t.as_str()).unwrap_or("");

                match event_type {
                    "stream_event" => {
                        let inner = &event["event"];
                        let inner_type = inner.get("type").and_then(|t| t.as_str()).unwrap_or("");
                        if inner_type == "content_block_delta"
                            && let Some(text) = inner
                                .get("delta")
                                .and_then(|d| d.get("text"))
                                .and_then(|t| t.as_str())
                        {
                            full_content.push_str(text);
                            yield StreamEvent::TextDelta(text.to_string());
                        }
                    }
                    "result" => {
                        // Final result — extract content and usage
                        let result_text = event.get("result")
                            .and_then(|r| r.as_str())
                            .unwrap_or("")
                            .to_string();

                        let is_error = event.get("is_error").and_then(|e| e.as_bool()).unwrap_or(false);
                        if is_error {
                            let msg = if result_text.is_empty() {
                                "unknown error".to_string()
                            } else {
                                result_text.clone()
                            };
                            yield StreamEvent::Done(ProviderResponse {
                                content: format!("Error: {msg}"),
                                tool_calls: vec![],
                                usage: None,
                            });
                            break;
                        }

                        // Use the accumulated streamed content, or fall back to result
                        let content = if full_content.is_empty() {
                            result_text
                        } else {
                            full_content.clone()
                        };

                        let usage = event.get("usage").map(|u| {
                            let input = u.get("input_tokens").and_then(|v| v.as_u64()).map(|v| v as u32);
                            let output = u.get("output_tokens").and_then(|v| v.as_u64()).map(|v| v as u32);
                            TokenUsage {
                                input_tokens: input,
                                output_tokens: output,
                                prompt_tokens: input,
                                completion_tokens: output,
                                total_tokens: match (input, output) {
                                    (Some(i), Some(o)) => Some(i + o),
                                    _ => None,
                                },
                            }
                        });

                        yield StreamEvent::Done(ProviderResponse {
                            content,
                            tool_calls: vec![],
                            usage,
                        });
                        break;
                    }
                    _ => {} // ignore init, assistant, rate_limit_event, etc.
                }
            }
        };

        Ok(Box::pin(stream))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── serialize_conversation tests ───────────────────────────────

    #[test]
    fn serialize_conversation_simple() {
        let msgs = vec![
            Message::user("hello"),
            Message::assistant("hi there"),
            Message::user("bye"),
        ];
        let (sys, body) = serialize_conversation(&msgs);
        assert!(sys.is_none());
        assert!(body.contains("[User]: hello"));
        assert!(body.contains("[Assistant]: hi there"));
        assert!(body.contains("[User]: bye"));
    }

    #[test]
    fn serialize_conversation_with_system() {
        let msgs = vec![
            Message::system("You are a helpful assistant."),
            Message::user("hello"),
        ];
        let (sys, body) = serialize_conversation(&msgs);
        assert_eq!(sys.as_deref(), Some("You are a helpful assistant."));
        assert!(!body.contains("system"));
        assert!(body.contains("[User]: hello"));
    }

    #[test]
    fn serialize_conversation_with_tool_calls() {
        let msgs = vec![Message::assistant_with_tool_calls(
            "Let me read that file.",
            vec![ToolCall {
                id: "call_1".into(),
                name: "fs.read".into(),
                arguments: serde_json::json!({"path": "/tmp/test"}),
            }],
        )];
        let (_, body) = serialize_conversation(&msgs);
        assert!(body.contains("[Assistant]: Let me read that file."));
        assert!(body.contains("[Assistant called tool: fs.read("));
        assert!(body.contains("/tmp/test"));
    }

    #[test]
    fn serialize_conversation_with_tool_results() {
        let msgs = vec![Message::tool_result(
            "call_1",
            "fs.read",
            "file content here",
        )];
        let (_, body) = serialize_conversation(&msgs);
        assert!(body.contains("[Tool result for fs.read (id: call_1)]: file content here"));
    }

    #[test]
    fn serialize_conversation_empty() {
        let (sys, body) = serialize_conversation(&[]);
        assert!(sys.is_none());
        assert!(body.is_empty());
    }

    #[test]
    fn serialize_conversation_multiple_system() {
        let msgs = vec![
            Message::system("Part 1"),
            Message::system("Part 2"),
            Message::user("hi"),
        ];
        let (sys, _) = serialize_conversation(&msgs);
        assert_eq!(sys.as_deref(), Some("Part 1\n\nPart 2"));
    }

    // ── parse_cli_output tests ─────────────────────────────────────

    #[test]
    fn parse_cli_output_simple() {
        let raw = serde_json::json!({
            "type": "result",
            "subtype": "success",
            "is_error": false,
            "result": "Hello world",
            "usage": {
                "input_tokens": 10,
                "output_tokens": 5
            }
        })
        .to_string();

        let resp = parse_cli_output(&raw, "").unwrap();
        assert_eq!(resp.content, "Hello world");
        assert!(resp.tool_calls.is_empty());
        assert_eq!(resp.usage.as_ref().unwrap().input_tokens, Some(10));
        assert_eq!(resp.usage.as_ref().unwrap().output_tokens, Some(5));
        assert_eq!(resp.usage.as_ref().unwrap().total_tokens, Some(15));
    }

    #[test]
    fn parse_cli_output_error() {
        let raw = serde_json::json!({
            "type": "result",
            "subtype": "error",
            "is_error": true,
            "result": "Something went wrong"
        })
        .to_string();

        let err = parse_cli_output(&raw, "").unwrap_err();
        match err {
            PrimitiveError::ExecutionFailed(msg) => {
                assert!(msg.contains("Something went wrong"));
            }
            _ => panic!("Expected ExecutionFailed, got {err:?}"),
        }
    }

    #[test]
    fn parse_cli_output_empty_error_includes_stderr() {
        let raw = serde_json::json!({
            "type": "result",
            "subtype": "error",
            "is_error": true,
            "result": ""
        })
        .to_string();

        let err = parse_cli_output(&raw, "some stderr info").unwrap_err();
        match err {
            PrimitiveError::ExecutionFailed(msg) => {
                assert!(msg.contains("some stderr info"));
            }
            _ => panic!("Expected ExecutionFailed, got {err:?}"),
        }
    }

    #[test]
    fn parse_cli_output_empty_error_fallback_message() {
        let raw = serde_json::json!({
            "type": "result",
            "subtype": "error",
            "is_error": true,
            "result": ""
        })
        .to_string();

        let err = parse_cli_output(&raw, "").unwrap_err();
        match err {
            PrimitiveError::ExecutionFailed(msg) => {
                assert!(msg.contains("unknown error"));
            }
            _ => panic!("Expected ExecutionFailed, got {err:?}"),
        }
    }

    #[test]
    fn parse_cli_output_auth_error() {
        let raw = serde_json::json!({
            "type": "result",
            "subtype": "error",
            "is_error": true,
            "result": "Not logged in. Please run `claude auth login`."
        })
        .to_string();

        let err = parse_cli_output(&raw, "").unwrap_err();
        assert!(matches!(err, PrimitiveError::AccessDenied(_)));
    }

    #[test]
    fn parse_cli_output_invalid_json() {
        let raw = "this is not json at all";
        let err = parse_cli_output(raw, "").unwrap_err();
        assert!(matches!(err, PrimitiveError::ExecutionFailed(_)));
    }
}
