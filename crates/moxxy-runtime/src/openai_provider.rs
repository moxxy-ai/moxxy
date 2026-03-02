use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::provider::{Message, ModelConfig, Provider, ProviderResponse, ToolCall};
use crate::registry::PrimitiveError;

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
    temperature: f64,
    max_tokens: u32,
}

#[derive(Serialize)]
struct ChatMessage {
    role: String,
    content: String,
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
    function: OpenAIFunction,
}

#[derive(Deserialize)]
struct OpenAIFunction {
    name: String,
    arguments: String,
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
            .map(|tc| {
                let arguments: serde_json::Value = serde_json::from_str(&tc.function.arguments)
                    .map_err(|e| {
                        PrimitiveError::ExecutionFailed(format!(
                            "failed to parse tool_call arguments: {}",
                            e
                        ))
                    })?;
                Ok(ToolCall {
                    name: tc.function.name,
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

#[async_trait]
impl Provider for OpenAIProvider {
    async fn complete(
        &self,
        messages: Vec<Message>,
        config: &ModelConfig,
    ) -> Result<ProviderResponse, PrimitiveError> {
        let chat_messages: Vec<ChatMessage> = messages
            .into_iter()
            .map(|m| ChatMessage {
                role: m.role,
                content: m.content,
            })
            .collect();

        let body = ChatRequest {
            model: self.model.clone(),
            messages: chat_messages,
            temperature: config.temperature,
            max_tokens: config.max_tokens,
        };

        let url = format!("{}/chat/completions", self.api_base);

        let response = self
            .client
            .post(&url)
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("HTTP request failed: {}", e)))?;

        let status = response.status();
        if !status.is_success() {
            let body_text = response
                .text()
                .await
                .unwrap_or_else(|_| "<failed to read body>".into());
            return Err(PrimitiveError::ExecutionFailed(format!(
                "OpenAI API error (status {}): {}",
                status, body_text
            )));
        }

        let chat_resp: ChatResponse = response.json().await.map_err(|e| {
            PrimitiveError::ExecutionFailed(format!("failed to parse response JSON: {}", e))
        })?;

        parse_chat_response(chat_resp)
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
                            function: OpenAIFunction {
                                name: "fs.read".into(),
                                arguments: r#"{"path":"/tmp/test.txt"}"#.into(),
                            },
                        },
                        OpenAIToolCall {
                            function: OpenAIFunction {
                                name: "fs.list".into(),
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

        assert_eq!(result.tool_calls[0].name, "fs.read");
        assert_eq!(result.tool_calls[0].arguments["path"], "/tmp/test.txt");

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
}
