use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::provider::{Message, ModelConfig, Provider, ProviderResponse, ToolCall};
use crate::registry::{PrimitiveError, ToolDefinition};

const ANTHROPIC_OAUTH_SESSION_MODE: &str = "anthropic_oauth_session";
const ANTHROPIC_OAUTH_TOKEN_ENDPOINT: &str = "https://console.anthropic.com/v1/oauth/token";
const ANTHROPIC_OAUTH_CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

/// An Anthropic provider that calls the Messages API.
pub struct AnthropicProvider {
    api_base: String,
    auth: AnthropicAuth,
    model: String,
    client: reqwest::Client,
}

enum AnthropicAuth {
    ApiKey(String),
    OAuthSession(Mutex<AnthropicOAuthSession>),
}

#[derive(Debug, Clone, Deserialize)]
struct AnthropicOAuthSession {
    #[serde(default)]
    mode: String,
    access_token: String,
    refresh_token: String,
    expires_at: u64,
    #[serde(default)]
    client_id: String,
}

#[derive(Deserialize)]
struct AnthropicOAuthRefreshResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    expires_in: Option<u64>,
}

// ── Request types ──────────────────────────────────────────────────

#[derive(Serialize)]
struct AnthropicRequest {
    model: String,
    max_tokens: u32,
    messages: Vec<AnthropicMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f64>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tools: Vec<AnthropicToolDef>,
}

#[derive(Serialize, Clone, Debug)]
struct AnthropicMessage {
    role: String,
    content: AnthropicContent,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(untagged)]
enum AnthropicContent {
    Text(String),
    Blocks(Vec<ContentBlock>),
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type")]
#[allow(clippy::enum_variant_names)]
enum ContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    #[serde(rename = "tool_result")]
    ToolResult {
        tool_use_id: String,
        content: String,
    },
}

#[derive(Serialize)]
struct AnthropicToolDef {
    name: String,
    description: String,
    input_schema: serde_json::Value,
}

// ── Response types ─────────────────────────────────────────────────

#[derive(Deserialize)]
struct AnthropicResponse {
    content: Vec<ResponseContentBlock>,
}

#[derive(Deserialize)]
#[serde(tag = "type")]
enum ResponseContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
}

#[derive(Deserialize)]
struct AnthropicErrorResponse {
    error: AnthropicErrorDetail,
}

#[derive(Deserialize)]
struct AnthropicErrorDetail {
    #[serde(rename = "type")]
    error_type: String,
    message: String,
}

// ── Conversion helpers ────────────────────────────────────────────

fn convert_tool_def(td: &ToolDefinition) -> AnthropicToolDef {
    AnthropicToolDef {
        name: td.name.clone(),
        description: td.description.clone(),
        input_schema: td.parameters.clone(),
    }
}

/// Convert internal messages to Anthropic API format.
///
/// Rules:
/// 1. System messages are extracted and concatenated into a separate `system` field.
/// 2. User messages become `{ role: "user", content: "..." }`.
/// 3. Assistant messages with tool_calls become `{ role: "assistant", content: [text_block?, ...tool_use_blocks] }`.
/// 4. Tool result messages (role="tool") are buffered and consecutive ones are merged
///    into a single `{ role: "user", content: [tool_result_blocks...] }`.
fn convert_messages(messages: Vec<Message>) -> (Option<String>, Vec<AnthropicMessage>) {
    let mut system_parts: Vec<String> = Vec::new();
    let mut output: Vec<AnthropicMessage> = Vec::new();
    let mut tool_result_buffer: Vec<ContentBlock> = Vec::new();

    let flush_tool_results = |buf: &mut Vec<ContentBlock>, out: &mut Vec<AnthropicMessage>| {
        if buf.is_empty() {
            return;
        }
        out.push(AnthropicMessage {
            role: "user".into(),
            content: AnthropicContent::Blocks(std::mem::take(buf)),
        });
    };

    for msg in messages {
        match msg.role.as_str() {
            "system" => {
                flush_tool_results(&mut tool_result_buffer, &mut output);
                let text = msg.content.trim().to_string();
                if !text.is_empty() {
                    system_parts.push(text);
                }
            }
            "user" => {
                flush_tool_results(&mut tool_result_buffer, &mut output);
                output.push(AnthropicMessage {
                    role: "user".into(),
                    content: AnthropicContent::Text(msg.content),
                });
            }
            "assistant" => {
                flush_tool_results(&mut tool_result_buffer, &mut output);
                if let Some(calls) = msg.tool_calls {
                    let mut blocks: Vec<ContentBlock> = Vec::new();
                    let text = msg.content.trim();
                    if !text.is_empty() {
                        blocks.push(ContentBlock::Text {
                            text: text.to_string(),
                        });
                    }
                    for tc in calls {
                        blocks.push(ContentBlock::ToolUse {
                            id: tc.id,
                            name: tc.name,
                            input: tc.arguments,
                        });
                    }
                    output.push(AnthropicMessage {
                        role: "assistant".into(),
                        content: AnthropicContent::Blocks(blocks),
                    });
                } else {
                    output.push(AnthropicMessage {
                        role: "assistant".into(),
                        content: AnthropicContent::Text(msg.content),
                    });
                }
            }
            "tool" => {
                let tool_call_id = msg.tool_call_id.unwrap_or_default();
                tool_result_buffer.push(ContentBlock::ToolResult {
                    tool_use_id: tool_call_id,
                    content: msg.content,
                });
            }
            _ => {
                flush_tool_results(&mut tool_result_buffer, &mut output);
                output.push(AnthropicMessage {
                    role: "user".into(),
                    content: AnthropicContent::Text(msg.content),
                });
            }
        }
    }

    flush_tool_results(&mut tool_result_buffer, &mut output);

    let system = if system_parts.is_empty() {
        None
    } else {
        Some(system_parts.join("\n\n"))
    };

    (system, output)
}

fn parse_response(resp: AnthropicResponse) -> ProviderResponse {
    let mut content = String::new();
    let mut tool_calls = Vec::new();

    for block in resp.content {
        match block {
            ResponseContentBlock::Text { text } => {
                content.push_str(&text);
            }
            ResponseContentBlock::ToolUse { id, name, input } => {
                tool_calls.push(ToolCall {
                    id,
                    name,
                    arguments: input,
                });
            }
        }
    }

    ProviderResponse {
        content,
        tool_calls,
        usage: None,
    }
}

fn parse_api_error(body: &str) -> String {
    if let Ok(err_resp) = serde_json::from_str::<AnthropicErrorResponse>(body) {
        format!("{}: {}", err_resp.error.error_type, err_resp.error.message)
    } else {
        body.to_string()
    }
}

// ── Implementation ─────────────────────────────────────────────────

impl AnthropicProvider {
    pub fn new(
        api_base: impl Into<String>,
        api_key_or_secret: impl Into<String>,
        model: impl Into<String>,
    ) -> Self {
        let raw_secret = api_key_or_secret.into();
        let parsed_session = serde_json::from_str::<AnthropicOAuthSession>(&raw_secret)
            .ok()
            .filter(|s| {
                s.mode == ANTHROPIC_OAUTH_SESSION_MODE
                    && !s.access_token.trim().is_empty()
                    && !s.refresh_token.trim().is_empty()
            });
        let auth = match parsed_session {
            Some(mut session) => {
                if session.client_id.trim().is_empty() {
                    session.client_id = ANTHROPIC_OAUTH_CLIENT_ID.to_string();
                }
                AnthropicAuth::OAuthSession(Mutex::new(session))
            }
            None => AnthropicAuth::ApiKey(raw_secret),
        };

        Self {
            api_base: api_base.into(),
            auth,
            model: model.into(),
            client: reqwest::Client::new(),
        }
    }

    fn now_ms() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }

    async fn refresh_oauth_session(
        &self,
        refresh_token: &str,
        client_id: &str,
    ) -> Result<AnthropicOAuthRefreshResponse, PrimitiveError> {
        let body = serde_json::json!({
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": client_id,
        });

        let response = self
            .client
            .post(ANTHROPIC_OAUTH_TOKEN_ENDPOINT)
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("OAuth refresh failed: {e}")))?;

        let status = response.status();
        if !status.is_success() {
            let body_text = response.text().await.unwrap_or_default();
            let message = parse_api_error(&body_text);
            return Err(PrimitiveError::ExecutionFailed(format!(
                "OAuth refresh error ({status}): {message}"
            )));
        }

        response
            .json::<AnthropicOAuthRefreshResponse>()
            .await
            .map_err(|e| {
                PrimitiveError::ExecutionFailed(format!("OAuth refresh parse failed: {e}"))
            })
    }

    async fn resolve_auth(&self) -> Result<reqwest::header::HeaderMap, PrimitiveError> {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("anthropic-version", "2023-06-01".parse().unwrap());
        headers.insert("content-type", "application/json".parse().unwrap());

        match &self.auth {
            AnthropicAuth::ApiKey(key) => {
                headers.insert(
                    "x-api-key",
                    key.parse().map_err(|_| {
                        PrimitiveError::ExecutionFailed("invalid API key header value".into())
                    })?,
                );
            }
            AnthropicAuth::OAuthSession(state) => {
                let (needs_refresh, refresh_token, client_id) = {
                    let locked = state.lock().map_err(|_| {
                        PrimitiveError::ExecutionFailed("OAuth session lock poisoned".into())
                    })?;
                    let now = Self::now_ms();
                    let threshold = now.saturating_add(60_000);
                    let refresh_needed = locked.expires_at <= threshold;
                    (
                        refresh_needed,
                        locked.refresh_token.clone(),
                        if locked.client_id.trim().is_empty() {
                            ANTHROPIC_OAUTH_CLIENT_ID.to_string()
                        } else {
                            locked.client_id.clone()
                        },
                    )
                };

                if needs_refresh {
                    let refreshed = self
                        .refresh_oauth_session(&refresh_token, &client_id)
                        .await?;
                    let now = Self::now_ms();
                    let expires_at = now.saturating_add(
                        refreshed
                            .expires_in
                            .unwrap_or(3600)
                            .max(60)
                            .saturating_mul(1000),
                    );

                    let mut locked = state.lock().map_err(|_| {
                        PrimitiveError::ExecutionFailed("OAuth session lock poisoned".into())
                    })?;
                    locked.access_token = refreshed.access_token;
                    if let Some(next_refresh) = refreshed.refresh_token
                        && !next_refresh.trim().is_empty()
                    {
                        locked.refresh_token = next_refresh;
                    }
                    locked.expires_at = expires_at;
                }

                let locked = state.lock().map_err(|_| {
                    PrimitiveError::ExecutionFailed("OAuth session lock poisoned".into())
                })?;
                let bearer_value = format!("Bearer {}", locked.access_token);
                headers.insert(
                    reqwest::header::AUTHORIZATION,
                    bearer_value.parse().map_err(|_| {
                        PrimitiveError::ExecutionFailed("invalid Bearer header value".into())
                    })?,
                );
            }
        }

        Ok(headers)
    }
}

#[async_trait]
impl Provider for AnthropicProvider {
    async fn complete(
        &self,
        messages: Vec<Message>,
        config: &ModelConfig,
        tools: &[ToolDefinition],
    ) -> Result<ProviderResponse, PrimitiveError> {
        let (system, anthropic_messages) = convert_messages(messages);
        let anthropic_tools: Vec<AnthropicToolDef> = tools.iter().map(convert_tool_def).collect();

        let body = AnthropicRequest {
            model: self.model.clone(),
            max_tokens: config.max_tokens,
            messages: anthropic_messages,
            system,
            temperature: Some(config.temperature),
            tools: anthropic_tools,
        };

        let url = format!("{}/v1/messages", self.api_base.trim_end_matches('/'));
        let auth_headers = self.resolve_auth().await?;

        let response = self
            .client
            .post(&url)
            .headers(auth_headers)
            .json(&body)
            .send()
            .await
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("HTTP request failed: {e}")))?;

        let status = response.status();
        if !status.is_success() {
            let body_text = response
                .text()
                .await
                .unwrap_or_else(|_| "<failed to read body>".into());
            let message = parse_api_error(&body_text);
            return Err(PrimitiveError::ExecutionFailed(format!(
                "Anthropic API error ({status}): {message}"
            )));
        }

        let resp: AnthropicResponse = response.json().await.map_err(|e| {
            PrimitiveError::ExecutionFailed(format!("failed to parse response JSON: {e}"))
        })?;

        Ok(parse_response(resp))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anthropic_provider_constructs_with_api_key() {
        let provider = AnthropicProvider::new(
            "https://api.anthropic.com",
            "sk-ant-test-key",
            "claude-sonnet-4-20250514",
        );
        assert_eq!(provider.api_base, "https://api.anthropic.com");
        assert!(matches!(&provider.auth, AnthropicAuth::ApiKey(k) if k == "sk-ant-test-key"));
        assert_eq!(provider.model, "claude-sonnet-4-20250514");
    }

    #[test]
    fn constructor_detects_oauth_session_json() {
        let secret = serde_json::json!({
            "mode": "anthropic_oauth_session",
            "access_token": "sk-ant-oat01-test",
            "refresh_token": "sk-ant-ort01-test",
            "expires_at": 9999999999999_u64,
            "client_id": "custom-client-id",
        });
        let provider = AnthropicProvider::new(
            "https://api.anthropic.com",
            secret.to_string(),
            "claude-sonnet-4-20250514",
        );
        assert!(matches!(&provider.auth, AnthropicAuth::OAuthSession(_)));
    }

    #[test]
    fn constructor_treats_plain_string_as_api_key() {
        let provider = AnthropicProvider::new(
            "https://api.anthropic.com",
            "sk-ant-api03-plainkey",
            "claude-sonnet-4-20250514",
        );
        assert!(matches!(&provider.auth, AnthropicAuth::ApiKey(k) if k == "sk-ant-api03-plainkey"));
    }

    #[test]
    fn oauth_session_fields_parsed_correctly() {
        let secret = serde_json::json!({
            "mode": "anthropic_oauth_session",
            "access_token": "sk-ant-oat01-abc",
            "refresh_token": "sk-ant-ort01-xyz",
            "expires_at": 1700000000000_u64,
            "client_id": "my-client",
        });
        let provider = AnthropicProvider::new(
            "https://api.anthropic.com",
            secret.to_string(),
            "claude-sonnet-4-20250514",
        );
        match &provider.auth {
            AnthropicAuth::OAuthSession(mutex) => {
                let session = mutex.lock().unwrap();
                assert_eq!(session.access_token, "sk-ant-oat01-abc");
                assert_eq!(session.refresh_token, "sk-ant-ort01-xyz");
                assert_eq!(session.expires_at, 1700000000000);
                assert_eq!(session.client_id, "my-client");
            }
            _ => panic!("expected OAuthSession variant"),
        }
    }

    #[test]
    fn default_client_id_applied_when_empty() {
        let secret = serde_json::json!({
            "mode": "anthropic_oauth_session",
            "access_token": "sk-ant-oat01-abc",
            "refresh_token": "sk-ant-ort01-xyz",
            "expires_at": 1700000000000_u64,
        });
        let provider = AnthropicProvider::new(
            "https://api.anthropic.com",
            secret.to_string(),
            "claude-sonnet-4-20250514",
        );
        match &provider.auth {
            AnthropicAuth::OAuthSession(mutex) => {
                let session = mutex.lock().unwrap();
                assert_eq!(session.client_id, ANTHROPIC_OAUTH_CLIENT_ID);
            }
            _ => panic!("expected OAuthSession variant"),
        }
    }

    #[test]
    fn invalid_mode_falls_back_to_api_key() {
        let secret = serde_json::json!({
            "mode": "wrong_mode",
            "access_token": "sk-ant-oat01-abc",
            "refresh_token": "sk-ant-ort01-xyz",
            "expires_at": 1700000000000_u64,
        });
        let provider = AnthropicProvider::new(
            "https://api.anthropic.com",
            secret.to_string(),
            "claude-sonnet-4-20250514",
        );
        assert!(matches!(&provider.auth, AnthropicAuth::ApiKey(_)));
    }

    #[test]
    fn convert_messages_extracts_system() {
        let messages = vec![Message::system("You are helpful."), Message::user("Hello")];
        let (system, msgs) = convert_messages(messages);
        assert_eq!(system.as_deref(), Some("You are helpful."));
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].role, "user");
    }

    #[test]
    fn convert_messages_concatenates_multiple_system() {
        let messages = vec![
            Message::system("Rule one"),
            Message::user("Hello"),
            Message::system("Rule two"),
        ];
        let (system, msgs) = convert_messages(messages);
        assert_eq!(system.as_deref(), Some("Rule one\n\nRule two"));
        assert_eq!(msgs.len(), 1);
    }

    #[test]
    fn convert_messages_no_system_returns_none() {
        let messages = vec![Message::user("Hello")];
        let (system, msgs) = convert_messages(messages);
        assert!(system.is_none());
        assert_eq!(msgs.len(), 1);
    }

    #[test]
    fn convert_messages_user_message() {
        let messages = vec![Message::user("Hello")];
        let (_, msgs) = convert_messages(messages);
        assert_eq!(msgs[0].role, "user");
        match &msgs[0].content {
            AnthropicContent::Text(t) => assert_eq!(t, "Hello"),
            _ => panic!("expected text content"),
        }
    }

    #[test]
    fn convert_messages_assistant_plain() {
        let messages = vec![Message::assistant("Sure!")];
        let (_, msgs) = convert_messages(messages);
        assert_eq!(msgs[0].role, "assistant");
        match &msgs[0].content {
            AnthropicContent::Text(t) => assert_eq!(t, "Sure!"),
            _ => panic!("expected text content"),
        }
    }

    #[test]
    fn convert_messages_assistant_with_tool_calls() {
        let messages = vec![Message::assistant_with_tool_calls(
            "Let me check.",
            vec![ToolCall {
                id: "toolu_01".into(),
                name: "fs.read".into(),
                arguments: serde_json::json!({"path": "/tmp/a.txt"}),
            }],
        )];
        let (_, msgs) = convert_messages(messages);
        assert_eq!(msgs[0].role, "assistant");
        match &msgs[0].content {
            AnthropicContent::Blocks(blocks) => {
                assert_eq!(blocks.len(), 2);
                match &blocks[0] {
                    ContentBlock::Text { text } => assert_eq!(text, "Let me check."),
                    _ => panic!("expected text block"),
                }
                match &blocks[1] {
                    ContentBlock::ToolUse { id, name, input } => {
                        assert_eq!(id, "toolu_01");
                        assert_eq!(name, "fs.read");
                        assert_eq!(input["path"], "/tmp/a.txt");
                    }
                    _ => panic!("expected tool_use block"),
                }
            }
            _ => panic!("expected blocks content"),
        }
    }

    #[test]
    fn convert_messages_assistant_tool_calls_empty_text_omitted() {
        let messages = vec![Message::assistant_with_tool_calls(
            "",
            vec![ToolCall {
                id: "toolu_01".into(),
                name: "fs.read".into(),
                arguments: serde_json::json!({}),
            }],
        )];
        let (_, msgs) = convert_messages(messages);
        match &msgs[0].content {
            AnthropicContent::Blocks(blocks) => {
                assert_eq!(blocks.len(), 1);
                assert!(matches!(&blocks[0], ContentBlock::ToolUse { .. }));
            }
            _ => panic!("expected blocks content"),
        }
    }

    #[test]
    fn convert_messages_consecutive_tool_results_merged() {
        let messages = vec![
            Message::tool_result("toolu_01", "fs.read", "file content 1"),
            Message::tool_result("toolu_02", "fs.list", "file content 2"),
        ];
        let (_, msgs) = convert_messages(messages);
        // Should be merged into a single user message
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].role, "user");
        match &msgs[0].content {
            AnthropicContent::Blocks(blocks) => {
                assert_eq!(blocks.len(), 2);
                match &blocks[0] {
                    ContentBlock::ToolResult {
                        tool_use_id,
                        content,
                    } => {
                        assert_eq!(tool_use_id, "toolu_01");
                        assert_eq!(content, "file content 1");
                    }
                    _ => panic!("expected tool_result block"),
                }
                match &blocks[1] {
                    ContentBlock::ToolResult {
                        tool_use_id,
                        content,
                    } => {
                        assert_eq!(tool_use_id, "toolu_02");
                        assert_eq!(content, "file content 2");
                    }
                    _ => panic!("expected tool_result block"),
                }
            }
            _ => panic!("expected blocks content"),
        }
    }

    #[test]
    fn convert_messages_tool_results_flushed_before_user() {
        let messages = vec![
            Message::tool_result("toolu_01", "fs.read", "result"),
            Message::user("Next question"),
        ];
        let (_, msgs) = convert_messages(messages);
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].role, "user"); // tool result as user
        assert_eq!(msgs[1].role, "user"); // actual user message
    }

    #[test]
    fn convert_tool_def_uses_input_schema() {
        let td = ToolDefinition {
            name: "fs.read".into(),
            description: "Read a file".into(),
            parameters: serde_json::json!({"type": "object", "properties": {"path": {"type": "string"}}}),
        };
        let anthropic_td = convert_tool_def(&td);
        assert_eq!(anthropic_td.name, "fs.read");
        assert_eq!(anthropic_td.description, "Read a file");
        assert_eq!(
            anthropic_td.input_schema,
            serde_json::json!({"type": "object", "properties": {"path": {"type": "string"}}})
        );
    }

    #[test]
    fn convert_tool_def_preserves_dot_names() {
        let td = ToolDefinition {
            name: "git.pr_create".into(),
            description: "Create PR".into(),
            parameters: serde_json::json!({}),
        };
        let anthropic_td = convert_tool_def(&td);
        // Anthropic supports dots in tool names — no translation needed
        assert_eq!(anthropic_td.name, "git.pr_create");
    }

    #[test]
    fn parse_response_text_only() {
        let raw = r#"{"id":"msg_01","type":"message","role":"assistant","content":[{"type":"text","text":"Hello, world!"}],"model":"claude-sonnet-4-20250514","stop_reason":"end_turn","usage":{"input_tokens":10,"output_tokens":5}}"#;
        let resp: AnthropicResponse = serde_json::from_str(raw).unwrap();
        let result = parse_response(resp);
        assert_eq!(result.content, "Hello, world!");
        assert!(result.tool_calls.is_empty());
    }

    #[test]
    fn parse_response_tool_use_only() {
        let raw = r#"{"id":"msg_02","type":"message","role":"assistant","content":[{"type":"tool_use","id":"toolu_01","name":"fs.read","input":{"path":"/tmp/test.txt"}}],"model":"claude-sonnet-4-20250514","stop_reason":"tool_use","usage":{"input_tokens":10,"output_tokens":5}}"#;
        let resp: AnthropicResponse = serde_json::from_str(raw).unwrap();
        let result = parse_response(resp);
        assert_eq!(result.content, "");
        assert_eq!(result.tool_calls.len(), 1);
        assert_eq!(result.tool_calls[0].id, "toolu_01");
        assert_eq!(result.tool_calls[0].name, "fs.read");
        assert_eq!(result.tool_calls[0].arguments["path"], "/tmp/test.txt");
    }

    #[test]
    fn parse_response_mixed_text_and_tool_use() {
        let raw = r#"{"id":"msg_03","type":"message","role":"assistant","content":[{"type":"text","text":"Let me read that."},{"type":"tool_use","id":"toolu_02","name":"fs.read","input":{"path":"/tmp/a.txt"}}],"model":"claude-sonnet-4-20250514","stop_reason":"tool_use","usage":{"input_tokens":10,"output_tokens":15}}"#;
        let resp: AnthropicResponse = serde_json::from_str(raw).unwrap();
        let result = parse_response(resp);
        assert_eq!(result.content, "Let me read that.");
        assert_eq!(result.tool_calls.len(), 1);
        assert_eq!(result.tool_calls[0].id, "toolu_02");
        assert_eq!(result.tool_calls[0].name, "fs.read");
    }

    #[test]
    fn parse_api_error_structured() {
        let body =
            r#"{"type":"error","error":{"type":"rate_limit_error","message":"Too many requests"}}"#;
        let msg = parse_api_error(body);
        assert_eq!(msg, "rate_limit_error: Too many requests");
    }

    #[test]
    fn parse_api_error_fallback_raw() {
        let msg = parse_api_error("not json");
        assert_eq!(msg, "not json");
    }

    #[test]
    fn full_round_trip_message_conversion() {
        let messages = vec![
            Message::system("You are a coding assistant."),
            Message::user("Read the file"),
            Message::assistant_with_tool_calls(
                "I'll read it.",
                vec![ToolCall {
                    id: "toolu_01".into(),
                    name: "fs.read".into(),
                    arguments: serde_json::json!({"path": "/tmp/test.txt"}),
                }],
            ),
            Message::tool_result("toolu_01", "fs.read", "file contents here"),
            Message::assistant("The file contains: file contents here"),
        ];

        let (system, msgs) = convert_messages(messages);
        assert_eq!(system.as_deref(), Some("You are a coding assistant."));
        assert_eq!(msgs.len(), 4); // user, assistant+tool, user(tool_result), assistant
        assert_eq!(msgs[0].role, "user");
        assert_eq!(msgs[1].role, "assistant");
        assert_eq!(msgs[2].role, "user"); // tool result merged as user
        assert_eq!(msgs[3].role, "assistant");
    }

    #[test]
    fn request_serialization_structure() {
        let td = ToolDefinition {
            name: "fs.read".into(),
            description: "Read file".into(),
            parameters: serde_json::json!({"type": "object"}),
        };
        let body = AnthropicRequest {
            model: "claude-sonnet-4-20250514".into(),
            max_tokens: 4096,
            messages: vec![AnthropicMessage {
                role: "user".into(),
                content: AnthropicContent::Text("Hello".into()),
            }],
            system: Some("Be helpful.".into()),
            temperature: Some(0.7),
            tools: vec![convert_tool_def(&td)],
        };
        let json = serde_json::to_value(&body).unwrap();
        assert_eq!(json["model"], "claude-sonnet-4-20250514");
        assert_eq!(json["max_tokens"], 4096);
        assert_eq!(json["system"], "Be helpful.");
        assert!(json["messages"].is_array());
        assert_eq!(json["tools"][0]["name"], "fs.read");
        assert!(json["tools"][0].get("input_schema").is_some());
        // Anthropic uses input_schema, not parameters
        assert!(json["tools"][0].get("parameters").is_none());
    }

    #[test]
    fn request_omits_system_when_none() {
        let body = AnthropicRequest {
            model: "claude-sonnet-4-20250514".into(),
            max_tokens: 4096,
            messages: vec![],
            system: None,
            temperature: Some(0.7),
            tools: vec![],
        };
        let json = serde_json::to_string(&body).unwrap();
        assert!(!json.contains("system"));
        assert!(!json.contains("tools"));
    }
}
