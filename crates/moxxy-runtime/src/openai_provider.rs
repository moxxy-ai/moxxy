use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::provider::{Message, ModelConfig, Provider, ProviderResponse, ToolCall};
use crate::registry::{PrimitiveError, ToolDefinition};

/// An OpenAI-compatible LLM provider that calls the Chat Completions API.
pub struct OpenAIProvider {
    api_base: String,
    api_key: String,
    model: String,
    client: reqwest::Client,
}

// ── Request types ──────────────────────────────────────────────────

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f64>,
    max_completion_tokens: u32,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tools: Vec<OpenAIToolDef>,
}

#[derive(Serialize)]
struct ChatMessage {
    role: String,
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_calls: Option<Vec<OpenAIToolCallOut>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
}

#[derive(Serialize)]
struct OpenAIToolDef {
    #[serde(rename = "type")]
    tool_type: String,
    function: OpenAIFunctionDef,
}

#[derive(Serialize)]
struct OpenAIFunctionDef {
    name: String,
    description: String,
    parameters: serde_json::Value,
}

/// Outgoing tool_call in assistant messages
#[derive(Serialize)]
struct OpenAIToolCallOut {
    id: String,
    #[serde(rename = "type")]
    call_type: String,
    function: OpenAIFunctionCallOut,
}

#[derive(Serialize)]
struct OpenAIFunctionCallOut {
    name: String,
    arguments: String,
}

// ── Response types ─────────────────────────────────────────────────

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    message: ResponseMessage,
}

#[derive(Deserialize)]
struct ResponseMessage {
    content: Option<String>,
    tool_calls: Option<Vec<OpenAIToolCall>>,
}

#[derive(Deserialize)]
struct OpenAIToolCall {
    id: Option<String>,
    function: OpenAIFunction,
}

#[derive(Deserialize)]
struct OpenAIFunction {
    name: String,
    arguments: String,
}

// ── Name sanitization ─────────────────────────────────────────────
// OpenAI requires tool names to match ^[a-zA-Z0-9_-]+$ (no dots).
// We translate dots to double-underscores at the provider boundary only.

fn to_openai_name(name: &str) -> String {
    name.replace('.', "__")
}

fn from_openai_name(name: &str) -> String {
    name.replace("__", ".")
}

/// Returns true for reasoning models that reject custom temperature values.
/// Checks both bare names (e.g. "o3-mini") and router-prefixed names (e.g. "openai/o3-mini").
fn is_fixed_temperature_model(model: &str) -> bool {
    // Use the last path segment so router prefixes like "openai/o3-mini" still match
    let name = model.rsplit('/').next().unwrap_or(model).to_lowercase();
    name.starts_with("o1") || name.starts_with("o3") || name.starts_with("o4")
}

// ── Implementation ─────────────────────────────────────────────────

impl OpenAIProvider {
    pub fn new(
        api_base: impl Into<String>,
        api_key: impl Into<String>,
        model: impl Into<String>,
    ) -> Self {
        Self {
            api_base: api_base.into(),
            api_key: api_key.into(),
            model: model.into(),
            client: reqwest::Client::new(),
        }
    }
}

fn convert_tool_def(td: &ToolDefinition) -> OpenAIToolDef {
    OpenAIToolDef {
        tool_type: "function".into(),
        function: OpenAIFunctionDef {
            name: to_openai_name(&td.name),
            description: td.description.clone(),
            parameters: td.parameters.clone(),
        },
    }
}

fn convert_message(m: Message) -> ChatMessage {
    ChatMessage {
        role: m.role,
        content: m.content,
        tool_calls: m.tool_calls.map(|calls| {
            calls
                .into_iter()
                .map(|tc| OpenAIToolCallOut {
                    id: tc.id,
                    call_type: "function".into(),
                    function: OpenAIFunctionCallOut {
                        name: to_openai_name(&tc.name),
                        arguments: serde_json::to_string(&tc.arguments).unwrap_or_default(),
                    },
                })
                .collect()
        }),
        tool_call_id: m.tool_call_id,
        name: m.name.map(|n| to_openai_name(&n)),
    }
}

/// Parse a raw `ChatResponse` into a `ProviderResponse`.
fn parse_chat_response(resp: ChatResponse) -> Result<ProviderResponse, PrimitiveError> {
    let choice = resp
        .choices
        .into_iter()
        .next()
        .ok_or_else(|| PrimitiveError::ExecutionFailed("no choices in response".into()))?;

    let content = choice.message.content.unwrap_or_default();

    let tool_calls = match choice.message.tool_calls {
        Some(calls) => calls
            .into_iter()
            .enumerate()
            .map(|(i, tc)| {
                let arguments: serde_json::Value = serde_json::from_str(&tc.function.arguments)
                    .map_err(|e| {
                        PrimitiveError::ExecutionFailed(format!(
                            "failed to parse tool_call arguments: {}",
                            e
                        ))
                    })?;
                Ok(ToolCall {
                    id: tc.id.unwrap_or_else(|| format!("call_{i}")),
                    name: from_openai_name(&tc.function.name),
                    arguments,
                })
            })
            .collect::<Result<Vec<_>, PrimitiveError>>()?,
        None => vec![],
    };

    Ok(ProviderResponse {
        content,
        tool_calls,
    })
}

/// Parse an OpenAI error response body, returning (human-readable message, error code).
fn parse_api_error(body: &str) -> (String, Option<String>) {
    let parsed = serde_json::from_str::<serde_json::Value>(body).ok();
    let error_obj = parsed.as_ref().and_then(|v| v.get("error"));
    let message = error_obj
        .and_then(|e| e.get("message"))
        .and_then(|m| m.as_str().map(String::from))
        .unwrap_or_else(|| body.to_string());
    let code = error_obj
        .and_then(|e| e.get("code"))
        .and_then(|c| c.as_str().map(String::from));
    (message, code)
}

impl OpenAIProvider {
    async fn send_request(&self, body: &ChatRequest) -> Result<ProviderResponse, PrimitiveError> {
        let url = format!("{}/chat/completions", self.api_base);

        let response = self
            .client
            .post(&url)
            .bearer_auth(&self.api_key)
            .json(body)
            .send()
            .await
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("HTTP request failed: {}", e)))?;

        let status = response.status();
        if !status.is_success() {
            let body_text = response
                .text()
                .await
                .unwrap_or_else(|_| "<failed to read body>".into());
            let (message, code) = parse_api_error(&body_text);
            return Err(PrimitiveError::ExecutionFailed(format!(
                "OpenAI API error ({}): {}\t{}",
                status,
                message,
                code.unwrap_or_default()
            )));
        }

        let chat_resp: ChatResponse = response.json().await.map_err(|e| {
            PrimitiveError::ExecutionFailed(format!("failed to parse response JSON: {}", e))
        })?;

        parse_chat_response(chat_resp)
    }
}

#[async_trait]
impl Provider for OpenAIProvider {
    async fn complete(
        &self,
        messages: Vec<Message>,
        config: &ModelConfig,
        tools: &[ToolDefinition],
    ) -> Result<ProviderResponse, PrimitiveError> {
        let chat_messages: Vec<ChatMessage> = messages.into_iter().map(convert_message).collect();
        let openai_tools: Vec<OpenAIToolDef> = tools.iter().map(convert_tool_def).collect();

        let temperature = if is_fixed_temperature_model(&self.model) {
            None
        } else {
            Some(config.temperature)
        };

        let mut body = ChatRequest {
            model: self.model.clone(),
            messages: chat_messages,
            temperature,
            max_completion_tokens: config.max_tokens,
            tools: openai_tools,
        };

        let result = self.send_request(&body).await;

        // If the API rejected our temperature, retry without it
        if let Err(ref e) = result
            && body.temperature.is_some()
            && e.to_string().contains("unsupported_value")
        {
            body.temperature = None;
            return self.send_request(&body).await;
        }

        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openai_provider_constructs_correctly() {
        let provider = OpenAIProvider::new("https://api.openai.com/v1", "sk-test-key-123", "gpt-4");
        assert_eq!(provider.api_base, "https://api.openai.com/v1");
        assert_eq!(provider.api_key, "sk-test-key-123");
        assert_eq!(provider.model, "gpt-4");
    }

    #[test]
    fn parse_response_with_content_only() {
        let resp = ChatResponse {
            choices: vec![Choice {
                message: ResponseMessage {
                    content: Some("Hello, world!".into()),
                    tool_calls: None,
                },
            }],
        };

        let result = parse_chat_response(resp).unwrap();
        assert_eq!(result.content, "Hello, world!");
        assert!(result.tool_calls.is_empty());
    }

    #[test]
    fn parse_response_with_null_content() {
        let resp = ChatResponse {
            choices: vec![Choice {
                message: ResponseMessage {
                    content: None,
                    tool_calls: None,
                },
            }],
        };

        let result = parse_chat_response(resp).unwrap();
        assert_eq!(result.content, "");
        assert!(result.tool_calls.is_empty());
    }

    #[test]
    fn parse_response_with_tool_calls() {
        let resp = ChatResponse {
            choices: vec![Choice {
                message: ResponseMessage {
                    content: Some("I'll read that file for you.".into()),
                    tool_calls: Some(vec![
                        OpenAIToolCall {
                            id: Some("call_abc".into()),
                            function: OpenAIFunction {
                                name: "fs__read".into(),
                                arguments: r#"{"path":"/tmp/test.txt"}"#.into(),
                            },
                        },
                        OpenAIToolCall {
                            id: Some("call_def".into()),
                            function: OpenAIFunction {
                                name: "fs__list".into(),
                                arguments: r#"{"path":"/tmp"}"#.into(),
                            },
                        },
                    ]),
                },
            }],
        };

        let result = parse_chat_response(resp).unwrap();
        assert_eq!(result.content, "I'll read that file for you.");
        assert_eq!(result.tool_calls.len(), 2);

        assert_eq!(result.tool_calls[0].id, "call_abc");
        assert_eq!(result.tool_calls[0].name, "fs.read");
        assert_eq!(result.tool_calls[0].arguments["path"], "/tmp/test.txt");

        assert_eq!(result.tool_calls[1].id, "call_def");
        assert_eq!(result.tool_calls[1].name, "fs.list");
        assert_eq!(result.tool_calls[1].arguments["path"], "/tmp");
    }

    #[test]
    fn parse_response_errors_on_empty_choices() {
        let resp = ChatResponse { choices: vec![] };

        let result = parse_chat_response(resp);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, PrimitiveError::ExecutionFailed(_)));
        assert!(err.to_string().contains("no choices"));
    }

    #[test]
    fn parse_response_errors_on_invalid_tool_call_arguments() {
        let resp = ChatResponse {
            choices: vec![Choice {
                message: ResponseMessage {
                    content: None,
                    tool_calls: Some(vec![OpenAIToolCall {
                        id: Some("call_1".into()),
                        function: OpenAIFunction {
                            name: "bad_tool".into(),
                            arguments: "not valid json {{".into(),
                        },
                    }]),
                },
            }],
        };

        let result = parse_chat_response(resp);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, PrimitiveError::ExecutionFailed(_)));
        assert!(
            err.to_string()
                .contains("failed to parse tool_call arguments")
        );
    }

    #[test]
    fn parse_response_from_raw_json() {
        let raw = r#"{
            "id": "chatcmpl-abc123",
            "object": "chat.completion",
            "created": 1700000000,
            "model": "gpt-4",
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": "The weather is sunny.",
                        "tool_calls": [
                            {
                                "id": "call_123",
                                "type": "function",
                                "function": {
                                    "name": "get_weather",
                                    "arguments": "{\"location\":\"San Francisco\",\"unit\":\"celsius\"}"
                                }
                            }
                        ]
                    },
                    "finish_reason": "tool_calls"
                }
            ],
            "usage": {
                "prompt_tokens": 50,
                "completion_tokens": 30,
                "total_tokens": 80
            }
        }"#;

        let chat_resp: ChatResponse = serde_json::from_str(raw).unwrap();
        let result = parse_chat_response(chat_resp).unwrap();

        assert_eq!(result.content, "The weather is sunny.");
        assert_eq!(result.tool_calls.len(), 1);
        assert_eq!(result.tool_calls[0].id, "call_123");
        assert_eq!(result.tool_calls[0].name, "get_weather");
        assert_eq!(result.tool_calls[0].arguments["location"], "San Francisco");
        assert_eq!(result.tool_calls[0].arguments["unit"], "celsius");
    }

    #[test]
    fn parse_response_from_raw_json_no_tool_calls() {
        let raw = r#"{
            "id": "chatcmpl-xyz789",
            "object": "chat.completion",
            "created": 1700000000,
            "model": "gpt-4",
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": "Hello! How can I help you today?"
                    },
                    "finish_reason": "stop"
                }
            ],
            "usage": {
                "prompt_tokens": 10,
                "completion_tokens": 8,
                "total_tokens": 18
            }
        }"#;

        let chat_resp: ChatResponse = serde_json::from_str(raw).unwrap();
        let result = parse_chat_response(chat_resp).unwrap();

        assert_eq!(result.content, "Hello! How can I help you today?");
        assert!(result.tool_calls.is_empty());
    }

    #[test]
    fn tool_call_id_preserved_through_parse() {
        let resp = ChatResponse {
            choices: vec![Choice {
                message: ResponseMessage {
                    content: None,
                    tool_calls: Some(vec![OpenAIToolCall {
                        id: Some("call_xyz_789".into()),
                        function: OpenAIFunction {
                            name: "test".into(),
                            arguments: "{}".into(),
                        },
                    }]),
                },
            }],
        };
        let result = parse_chat_response(resp).unwrap();
        assert_eq!(result.tool_calls[0].id, "call_xyz_789");
    }

    #[test]
    fn missing_tool_call_id_gets_generated() {
        let resp = ChatResponse {
            choices: vec![Choice {
                message: ResponseMessage {
                    content: None,
                    tool_calls: Some(vec![OpenAIToolCall {
                        id: None,
                        function: OpenAIFunction {
                            name: "test".into(),
                            arguments: "{}".into(),
                        },
                    }]),
                },
            }],
        };
        let result = parse_chat_response(resp).unwrap();
        assert_eq!(result.tool_calls[0].id, "call_0");
    }

    #[test]
    fn chat_request_omits_empty_tools() {
        let req = ChatRequest {
            model: "gpt-4".into(),
            messages: vec![],
            temperature: Some(0.7),
            max_completion_tokens: 100,
            tools: vec![],
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(!json.contains("tools"));
    }

    #[test]
    fn chat_request_includes_tools_when_present() {
        let td = ToolDefinition {
            name: "fs.read".into(),
            description: "Read a file".into(),
            parameters: serde_json::json!({"type": "object"}),
        };
        let req = ChatRequest {
            model: "gpt-4".into(),
            messages: vec![],
            temperature: Some(0.7),
            max_completion_tokens: 100,
            tools: vec![convert_tool_def(&td)],
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("tools"));
        assert!(json.contains("fs__read"));
        assert!(!json.contains("fs.read"));
    }

    #[test]
    fn chat_request_omits_temperature_for_reasoning_models() {
        // Bare model names
        assert!(is_fixed_temperature_model("o1"));
        assert!(is_fixed_temperature_model("o1-mini"));
        assert!(is_fixed_temperature_model("o1-preview"));
        assert!(is_fixed_temperature_model("o3"));
        assert!(is_fixed_temperature_model("o3-mini"));
        assert!(is_fixed_temperature_model("o3-mini-2025-01-31"));
        assert!(is_fixed_temperature_model("o4-mini"));
        // Router-prefixed model names
        assert!(is_fixed_temperature_model("openai/o3-mini"));
        assert!(is_fixed_temperature_model("accounts/org/o1-preview"));
        // Non-reasoning models
        assert!(!is_fixed_temperature_model("gpt-4"));
        assert!(!is_fixed_temperature_model("gpt-4o"));
        assert!(!is_fixed_temperature_model("gpt-3.5-turbo"));

        let req = ChatRequest {
            model: "o3-mini".into(),
            messages: vec![],
            temperature: None,
            max_completion_tokens: 100,
            tools: vec![],
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(!json.contains("temperature"));
    }

    #[test]
    fn parse_api_error_extracts_message_and_code() {
        let body = r#"{"error":{"message":"Bad temperature","type":"invalid_request_error","param":"temperature","code":"unsupported_value"}}"#;
        let (msg, code) = parse_api_error(body);
        assert_eq!(msg, "Bad temperature");
        assert_eq!(code.as_deref(), Some("unsupported_value"));
    }

    #[test]
    fn parse_api_error_falls_back_to_raw_body() {
        let (msg, code) = parse_api_error("not json");
        assert_eq!(msg, "not json");
        assert!(code.is_none());
    }

    #[test]
    fn convert_message_preserves_tool_call_id() {
        let msg = Message::tool_result("call_123", "fs.read", "file content");
        let chat_msg = convert_message(msg);
        assert_eq!(chat_msg.tool_call_id.as_deref(), Some("call_123"));
        assert_eq!(chat_msg.name.as_deref(), Some("fs__read"));
        assert_eq!(chat_msg.role, "tool");
    }

    #[test]
    fn convert_message_preserves_assistant_tool_calls() {
        let msg = Message::assistant_with_tool_calls(
            "thinking...",
            vec![ToolCall {
                id: "call_1".into(),
                name: "fs.read".into(),
                arguments: serde_json::json!({"path": "/tmp"}),
            }],
        );
        let chat_msg = convert_message(msg);
        assert!(chat_msg.tool_calls.is_some());
        let calls = chat_msg.tool_calls.unwrap();
        assert_eq!(calls[0].id, "call_1");
        assert_eq!(calls[0].function.name, "fs__read");
    }

    #[test]
    fn to_openai_name_replaces_dots() {
        assert_eq!(to_openai_name("fs.read"), "fs__read");
        assert_eq!(to_openai_name("git.pr_create"), "git__pr_create");
        assert_eq!(to_openai_name("no_dots"), "no_dots");
    }

    #[test]
    fn from_openai_name_reverses() {
        assert_eq!(from_openai_name("fs__read"), "fs.read");
        assert_eq!(from_openai_name("git__pr_create"), "git.pr_create");
        assert_eq!(from_openai_name("no_dots"), "no_dots");
    }

    #[test]
    fn name_sanitization_round_trips_all_primitives() {
        let names = [
            "fs.read",
            "fs.write",
            "fs.list",
            "browse.fetch",
            "browse.extract",
            "git.init",
            "git.clone",
            "git.status",
            "git.commit",
            "git.push",
            "git.checkout",
            "git.pr_create",
            "git.fork",
            "git.worktree_add",
            "git.worktree_list",
            "git.worktree_remove",
            "memory.append",
            "memory.search",
            "memory.summarize",
            "shell.exec",
            "http.request",
            "webhook.create",
            "webhook.list",
            "notify.webhook",
            "notify.cli",
            "skill.import",
            "skill.validate",
            "channel.notify",
            "heartbeat.create",
            "heartbeat.list",
            "heartbeat.disable",
            "heartbeat.delete",
            "heartbeat.update",
            "vault.set",
            "vault.get",
            "vault.delete",
            "vault.list",
            "user.ask",
            "agent.respond",
            "agent.spawn",
            "agent.status",
            "agent.list",
            "agent.stop",
        ];
        let openai_re = regex::Regex::new(r"^[a-zA-Z0-9_-]+$").unwrap();
        for name in names {
            let wire = to_openai_name(name);
            assert!(!wire.contains('.'), "{name} -> {wire} still has dots");
            assert!(openai_re.is_match(&wire), "{wire} fails OpenAI regex");
            assert_eq!(
                from_openai_name(&wire),
                name,
                "round-trip failed for {name}"
            );
        }
    }

    #[test]
    fn convert_tool_def_sanitizes_name() {
        let td = ToolDefinition {
            name: "git.pr_create".into(),
            description: "Create a PR".into(),
            parameters: serde_json::json!({}),
        };
        let openai = convert_tool_def(&td);
        assert_eq!(openai.function.name, "git__pr_create");
    }
}
