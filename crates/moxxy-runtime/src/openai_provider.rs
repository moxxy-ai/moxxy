use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::provider::{
    Message, ModelConfig, Provider, ProviderResponse, TokenUsage, ToolCall, ToolChoice,
};
use crate::registry::{PrimitiveError, ToolDefinition};

const OPENAI_OAUTH_TOKEN_ENDPOINT: &str = "https://auth.openai.com/oauth/token";
const OPENAI_CODEX_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_CODEX_SESSION_MODE: &str = "chatgpt_oauth_session";

/// An OpenAI-compatible LLM provider that calls the Chat Completions API.
pub struct OpenAIProvider {
    api_base: String,
    auth: OpenAIAuth,
    chatgpt_account_id: Option<String>,
    model: String,
    client: reqwest::Client,
}

enum OpenAIAuth {
    ApiKey(String),
    ChatGptOAuthSession(Mutex<ChatGptOAuthSession>),
}

#[derive(Debug, Clone, Deserialize)]
struct ChatGptOAuthSession {
    #[serde(default)]
    mode: String,
    access_token: String,
    refresh_token: String,
    expires_at: u64,
    #[serde(default)]
    client_id: String,
    #[serde(default)]
    account_id: Option<String>,
}

#[derive(Deserialize)]
struct OAuthRefreshResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    expires_in: Option<u64>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_choice: Option<String>,
}

#[derive(Serialize)]
struct CodexRequest {
    model: String,
    instructions: String,
    input: Vec<CodexInputItem>,
    store: bool,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_output_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tools: Vec<CodexToolDef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_choice: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case", tag = "type")]
enum CodexInputItem {
    Message {
        role: String,
        content: Vec<CodexMessageContent>,
    },
    FunctionCall {
        call_id: String,
        name: String,
        arguments: String,
    },
    FunctionCallOutput {
        call_id: String,
        output: String,
    },
}

#[derive(Serialize)]
struct CodexMessageContent {
    #[serde(rename = "type")]
    content_type: String,
    text: String,
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
struct CodexToolDef {
    #[serde(rename = "type")]
    tool_type: String,
    name: String,
    description: String,
    parameters: serde_json::Value,
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
    #[serde(default)]
    usage: Option<ChatUsage>,
}

#[derive(Deserialize)]
struct ChatUsage {
    #[serde(default)]
    prompt_tokens: Option<u32>,
    #[serde(default)]
    completion_tokens: Option<u32>,
    #[serde(default)]
    total_tokens: Option<u32>,
    #[serde(default)]
    input_tokens: Option<u32>,
    #[serde(default)]
    output_tokens: Option<u32>,
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
        api_key_or_secret: impl Into<String>,
        model: impl Into<String>,
        chatgpt_account_id: Option<String>,
    ) -> Self {
        let raw_secret = api_key_or_secret.into();
        let parsed_session = serde_json::from_str::<ChatGptOAuthSession>(&raw_secret)
            .ok()
            .filter(|s| {
                s.mode == OPENAI_CODEX_SESSION_MODE
                    && !s.access_token.trim().is_empty()
                    && !s.refresh_token.trim().is_empty()
            });
        let auth = match parsed_session {
            Some(mut session) => {
                if session.client_id.trim().is_empty() {
                    session.client_id = OPENAI_CODEX_CLIENT_ID.to_string();
                }
                OpenAIAuth::ChatGptOAuthSession(Mutex::new(session))
            }
            None => OpenAIAuth::ApiKey(raw_secret),
        };

        Self {
            api_base: api_base.into(),
            auth,
            chatgpt_account_id,
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

fn convert_codex_tool_def(td: &ToolDefinition) -> CodexToolDef {
    CodexToolDef {
        tool_type: "function".into(),
        name: to_openai_name(&td.name),
        description: td.description.clone(),
        parameters: td.parameters.clone(),
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

impl CodexMessageContent {
    fn input_text(text: impl Into<String>) -> Self {
        Self {
            content_type: "input_text".into(),
            text: text.into(),
        }
    }

    fn output_text(text: impl Into<String>) -> Self {
        Self {
            content_type: "output_text".into(),
            text: text.into(),
        }
    }
}

fn convert_codex_input(messages: &[Message]) -> Vec<CodexInputItem> {
    let mut input = Vec::new();

    for (i, message) in messages.iter().enumerate() {
        match message.role.as_str() {
            // Codex backend expects system prompt in the top-level `instructions` field.
            "system" => {}
            "assistant" => {
                let text = message.content.trim();
                if !text.is_empty() {
                    input.push(CodexInputItem::Message {
                        role: "assistant".into(),
                        content: vec![CodexMessageContent::output_text(text)],
                    });
                }

                if let Some(calls) = &message.tool_calls {
                    for call in calls {
                        let arguments =
                            serde_json::to_string(&call.arguments).unwrap_or_else(|_| "{}".into());
                        input.push(CodexInputItem::FunctionCall {
                            call_id: call.id.clone(),
                            name: to_openai_name(&call.name),
                            arguments,
                        });
                    }
                }
            }
            "tool" => {
                let call_id = message
                    .tool_call_id
                    .clone()
                    .unwrap_or_else(|| format!("tool_call_{i}"));
                input.push(CodexInputItem::FunctionCallOutput {
                    call_id,
                    output: message.content.clone(),
                });
            }
            _ => {
                let text = message.content.trim();
                if text.is_empty() {
                    continue;
                }
                let role = if message.role == "developer" {
                    "developer"
                } else {
                    "user"
                };
                input.push(CodexInputItem::Message {
                    role: role.into(),
                    content: vec![CodexMessageContent::input_text(text)],
                });
            }
        }
    }

    input
}

/// Parse a raw `ChatResponse` into a `ProviderResponse`.
fn parse_chat_response(resp: ChatResponse) -> Result<ProviderResponse, PrimitiveError> {
    let usage = resp.usage.map(|u| TokenUsage {
        prompt_tokens: u.prompt_tokens,
        completion_tokens: u.completion_tokens,
        total_tokens: u.total_tokens,
        input_tokens: u.input_tokens,
        output_tokens: u.output_tokens,
    });

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
        usage,
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

fn build_codex_instructions(messages: &[Message]) -> String {
    let system_parts: Vec<&str> = messages
        .iter()
        .filter(|m| m.role == "system")
        .map(|m| m.content.trim())
        .filter(|s| !s.is_empty())
        .collect();
    if system_parts.is_empty() {
        "You are a helpful assistant.".to_string()
    } else {
        system_parts.join("\n\n")
    }
}

fn parse_tool_call_arguments(value: &serde_json::Value) -> serde_json::Value {
    if let Some(raw) = value.as_str() {
        serde_json::from_str(raw).unwrap_or_else(|_| serde_json::Value::String(raw.to_string()))
    } else if value.is_null() {
        serde_json::json!({})
    } else {
        value.clone()
    }
}

fn parse_codex_function_call_item(item: &serde_json::Value, i: usize) -> Option<ToolCall> {
    let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
    if item_type != "function_call" {
        return None;
    }

    let id = item
        .get("id")
        .and_then(|v| v.as_str())
        .or_else(|| item.get("call_id").and_then(|v| v.as_str()))
        .map(str::to_string)
        .unwrap_or_else(|| format!("call_{i}"));

    let name_raw = item
        .get("name")
        .and_then(|v| v.as_str())
        .or_else(|| {
            item.get("function")
                .and_then(|f| f.get("name"))
                .and_then(|v| v.as_str())
        })
        .unwrap_or("unknown_tool");
    let name = from_openai_name(name_raw);

    let arguments_value = item
        .get("arguments")
        .or_else(|| item.get("function").and_then(|f| f.get("arguments")))
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    let arguments = parse_tool_call_arguments(&arguments_value);

    Some(ToolCall {
        id,
        name,
        arguments,
    })
}

fn parse_codex_response_output(
    response_obj: &serde_json::Value,
) -> Result<ProviderResponse, PrimitiveError> {
    let mut content = String::new();
    let mut tool_calls = Vec::new();
    let output = response_obj
        .get("output")
        .and_then(|v| v.as_array())
        .ok_or_else(|| {
            PrimitiveError::ExecutionFailed("codex response missing output array".into())
        })?;

    for (i, part) in output.iter().enumerate() {
        match part.get("type").and_then(|v| v.as_str()).unwrap_or("") {
            "message" => {
                if let Some(items) = part.get("content").and_then(|v| v.as_array()) {
                    for item in items {
                        if item.get("type").and_then(|v| v.as_str()) == Some("output_text")
                            && let Some(text) = item.get("text").and_then(|v| v.as_str())
                        {
                            content.push_str(text);
                        }
                    }
                }
            }
            "function_call" => {
                if let Some(tc) = parse_codex_function_call_item(part, i) {
                    tool_calls.push(tc);
                }
            }
            _ => {}
        }
    }

    Ok(ProviderResponse {
        content,
        tool_calls,
        usage: None,
    })
}

fn parse_codex_sse_events(body: &str) -> Vec<serde_json::Value> {
    let mut events = Vec::new();
    let mut data_lines: Vec<String> = Vec::new();
    let flush = |events: &mut Vec<serde_json::Value>, data_lines: &mut Vec<String>| {
        if data_lines.is_empty() {
            return;
        }
        let payload = data_lines.join("\n");
        data_lines.clear();
        if payload.trim() == "[DONE]" {
            return;
        }
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&payload) {
            events.push(json);
        }
    };

    for raw_line in body.lines() {
        let line = raw_line.trim_end_matches('\r');
        if line.is_empty() {
            flush(&mut events, &mut data_lines);
            continue;
        }
        if let Some(rest) = line.strip_prefix("data:") {
            data_lines.push(rest.trim_start().to_string());
        }
    }
    flush(&mut events, &mut data_lines);
    events
}

fn parse_codex_stream_response(body: &str) -> Result<ProviderResponse, PrimitiveError> {
    let events = parse_codex_sse_events(body);
    if events.is_empty() {
        return Err(PrimitiveError::ExecutionFailed(
            "codex stream returned no events".into(),
        ));
    }

    for event in events.iter().rev() {
        let event_type = event.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if (event_type == "response.completed" || event_type == "response.done")
            && let Some(response_obj) = event.get("response")
            && let Ok(parsed) = parse_codex_response_output(response_obj)
        {
            return Ok(parsed);
        }
    }

    let mut content = String::new();
    let mut tool_calls = Vec::new();
    let mut seen_tool_ids = HashSet::new();
    for (i, event) in events.iter().enumerate() {
        match event.get("type").and_then(|v| v.as_str()).unwrap_or("") {
            "response.output_text.delta" => {
                if let Some(delta) = event.get("delta").and_then(|v| v.as_str()) {
                    content.push_str(delta);
                }
            }
            "response.output_text.done" => {
                if let Some(text) = event.get("text").and_then(|v| v.as_str()) {
                    content.push_str(text);
                }
            }
            "response.output_item.added" | "response.output_item.done" => {
                if let Some(item) = event.get("item")
                    && let Some(tc) = parse_codex_function_call_item(item, i)
                    && !seen_tool_ids.contains(&tc.id)
                {
                    seen_tool_ids.insert(tc.id.clone());
                    tool_calls.push(tc);
                }
            }
            _ => {}
        }
    }

    Ok(ProviderResponse {
        content,
        tool_calls,
        usage: None,
    })
}

impl OpenAIProvider {
    fn now_ms() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }

    fn request_url(&self) -> String {
        let base = self.api_base.trim_end_matches('/');
        if self.is_codex_backend() {
            if base.ends_with("/responses") {
                base.to_string()
            } else {
                format!("{base}/responses")
            }
        } else {
            format!("{base}/chat/completions")
        }
    }

    fn is_codex_backend(&self) -> bool {
        let base = self.api_base.to_ascii_lowercase();
        let model = self.model.to_ascii_lowercase();
        base.contains("chatgpt.com/backend-api/codex")
            || base.contains("/backend-api/codex")
            || model.contains("codex")
            || matches!(&self.auth, OpenAIAuth::ChatGptOAuthSession(_))
    }

    async fn refresh_oauth_session(
        &self,
        refresh_token: &str,
        client_id: &str,
    ) -> Result<OAuthRefreshResponse, PrimitiveError> {
        let body = [
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", client_id),
        ];

        let response = self
            .client
            .post(OPENAI_OAUTH_TOKEN_ENDPOINT)
            .header("content-type", "application/x-www-form-urlencoded")
            .form(&body)
            .send()
            .await
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("OAuth refresh failed: {e}")))?;

        let status = response.status();
        if !status.is_success() {
            let body_text = response.text().await.unwrap_or_default();
            let (message, code) = parse_api_error(&body_text);
            return Err(PrimitiveError::ExecutionFailed(format!(
                "OAuth refresh error ({}): {} {}",
                status,
                message,
                code.unwrap_or_default()
            )));
        }

        response.json::<OAuthRefreshResponse>().await.map_err(|e| {
            PrimitiveError::ExecutionFailed(format!("OAuth refresh parse failed: {e}"))
        })
    }

    async fn resolve_bearer_auth(&self) -> Result<(String, Option<String>), PrimitiveError> {
        match &self.auth {
            OpenAIAuth::ApiKey(key) => Ok((key.clone(), self.chatgpt_account_id.clone())),
            OpenAIAuth::ChatGptOAuthSession(state) => {
                let (needs_refresh, refresh_token, client_id, account_id) = {
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
                            OPENAI_CODEX_CLIENT_ID.to_string()
                        } else {
                            locked.client_id.clone()
                        },
                        locked.account_id.clone(),
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
                let account = self
                    .chatgpt_account_id
                    .clone()
                    .or(account_id)
                    .or_else(|| locked.account_id.clone());
                Ok((locked.access_token.clone(), account))
            }
        }
    }

    async fn send_request(
        &self,
        body: &serde_json::Value,
        is_codex: bool,
    ) -> Result<ProviderResponse, PrimitiveError> {
        let url = self.request_url();
        let (bearer, chatgpt_account_id) = self.resolve_bearer_auth().await?;

        let mut request = self.client.post(&url).bearer_auth(&bearer);
        if let Some(account_id) = chatgpt_account_id
            && !account_id.trim().is_empty()
        {
            request = request.header("ChatGPT-Account-Id", account_id);
        }
        if is_codex {
            request = request.header("accept", "text/event-stream");
            tracing::debug!(
                url = %url,
                has_instructions = body.get("instructions").is_some(),
                store = ?body.get("store"),
                stream = ?body.get("stream"),
                input_items = body
                    .get("input")
                    .and_then(|v| v.as_array())
                    .map_or(0, |arr| arr.len()),
                "Sending OpenAI Codex request"
            );
        }

        let response =
            request.json(body).send().await.map_err(|e| {
                PrimitiveError::ExecutionFailed(format!("HTTP request failed: {}", e))
            })?;

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

        if is_codex {
            let body_text = response.text().await.map_err(|e| {
                PrimitiveError::ExecutionFailed(format!("failed to read codex stream: {}", e))
            })?;
            return parse_codex_stream_response(&body_text);
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
        let is_codex = self.is_codex_backend();

        if is_codex {
            let codex_tools: Vec<CodexToolDef> = tools.iter().map(convert_codex_tool_def).collect();
            let tool_choice = if !codex_tools.is_empty() {
                Some(match config.tool_choice {
                    ToolChoice::Any => "required".to_string(),
                    ToolChoice::Auto => "auto".to_string(),
                })
            } else {
                None
            };
            let body = CodexRequest {
                model: self.model.clone(),
                instructions: build_codex_instructions(&messages),
                input: convert_codex_input(&messages),
                store: false,
                stream: true,
                max_output_tokens: None,
                tools: codex_tools,
                tool_choice,
            };
            let json_body = serde_json::to_value(body).map_err(|e| {
                PrimitiveError::ExecutionFailed(format!("failed to serialize codex request: {e}"))
            })?;
            return self.send_request(&json_body, true).await;
        }

        let chat_messages: Vec<ChatMessage> = messages.into_iter().map(convert_message).collect();
        let openai_tools: Vec<OpenAIToolDef> = tools.iter().map(convert_tool_def).collect();

        let temperature = if is_fixed_temperature_model(&self.model) {
            None
        } else {
            Some(config.temperature)
        };

        let tool_choice = if !openai_tools.is_empty() {
            Some(match config.tool_choice {
                ToolChoice::Any => "required".to_string(),
                ToolChoice::Auto => "auto".to_string(),
            })
        } else {
            None
        };

        let mut body = ChatRequest {
            model: self.model.clone(),
            messages: chat_messages,
            temperature,
            max_completion_tokens: config.max_tokens,
            tools: openai_tools,
            tool_choice,
        };
        let mut json_body = serde_json::to_value(&body).map_err(|e| {
            PrimitiveError::ExecutionFailed(format!("failed to serialize chat request: {e}"))
        })?;

        let result = self.send_request(&json_body, false).await;

        // If the API rejected our temperature, retry without it
        if let Err(ref e) = result
            && body.temperature.is_some()
            && e.to_string().contains("unsupported_value")
        {
            body.temperature = None;
            json_body = serde_json::to_value(body).map_err(|ser_err| {
                PrimitiveError::ExecutionFailed(format!(
                    "failed to serialize chat retry request: {ser_err}"
                ))
            })?;
            return self.send_request(&json_body, false).await;
        }

        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openai_provider_constructs_correctly() {
        let provider = OpenAIProvider::new(
            "https://api.openai.com/v1",
            "sk-test-key-123",
            "gpt-4",
            None,
        );
        assert_eq!(provider.api_base, "https://api.openai.com/v1");
        assert_eq!(provider.model, "gpt-4");
        match &provider.auth {
            OpenAIAuth::ApiKey(key) => assert_eq!(key, "sk-test-key-123"),
            OpenAIAuth::ChatGptOAuthSession(_) => panic!("expected api key auth"),
        }
    }

    #[test]
    fn openai_provider_detects_chatgpt_oauth_secret() {
        let secret = serde_json::json!({
            "mode": "chatgpt_oauth_session",
            "access_token": "access_123",
            "refresh_token": "refresh_456",
            "expires_at": 1_700_000_000_000u64
        })
        .to_string();
        let provider = OpenAIProvider::new(
            "https://chatgpt.com/backend-api/codex",
            secret,
            "gpt-5.3-codex",
            Some("acct_abc".into()),
        );

        match &provider.auth {
            OpenAIAuth::ApiKey(_) => panic!("expected oauth session auth"),
            OpenAIAuth::ChatGptOAuthSession(state) => {
                let locked = state.lock().unwrap();
                assert_eq!(locked.access_token, "access_123");
                assert_eq!(locked.refresh_token, "refresh_456");
                assert_eq!(locked.client_id, OPENAI_CODEX_CLIENT_ID);
            }
        }
    }

    #[test]
    fn request_url_uses_codex_responses_endpoint() {
        let provider = OpenAIProvider::new(
            "https://chatgpt.com/backend-api/codex",
            "sk-test-key-123",
            "gpt-5.3-codex",
            None,
        );
        assert_eq!(
            provider.request_url(),
            "https://chatgpt.com/backend-api/codex/responses"
        );
    }

    #[test]
    fn codex_backend_detected_for_codex_model_name() {
        let provider = OpenAIProvider::new(
            "https://api.openai.com/v1",
            "sk-test-key-123",
            "gpt-5.3-codex",
            None,
        );
        assert!(provider.is_codex_backend());
        assert_eq!(
            provider.request_url(),
            "https://api.openai.com/v1/responses"
        );
    }

    #[test]
    fn codex_instructions_use_system_messages() {
        let messages = vec![
            Message::system("Rule one"),
            Message::user("hello"),
            Message::system("Rule two"),
        ];
        assert_eq!(build_codex_instructions(&messages), "Rule one\n\nRule two");
    }

    #[test]
    fn codex_instructions_have_default_when_no_system() {
        let messages = vec![Message::user("hello")];
        assert_eq!(
            build_codex_instructions(&messages),
            "You are a helpful assistant."
        );
    }

    #[test]
    fn codex_request_serializes_instructions_store_and_stream_fields() {
        let td = ToolDefinition {
            name: "fs.read".into(),
            description: "Read file".into(),
            parameters: serde_json::json!({"type":"object"}),
        };
        let body = CodexRequest {
            model: "gpt-5.3-codex".into(),
            instructions: "System rules".into(),
            input: vec![CodexInputItem::Message {
                role: "user".into(),
                content: vec![CodexMessageContent::input_text("hello")],
            }],
            store: false,
            stream: true,
            max_output_tokens: None,
            tools: vec![convert_codex_tool_def(&td)],
            tool_choice: Some("auto".into()),
        };
        let json = serde_json::to_value(&body).unwrap();
        assert_eq!(
            json.get("instructions").and_then(|v| v.as_str()),
            Some("System rules")
        );
        assert_eq!(json.get("store").and_then(|v| v.as_bool()), Some(false));
        assert_eq!(json.get("stream").and_then(|v| v.as_bool()), Some(true));
        assert!(json.get("input").and_then(|v| v.as_array()).is_some());
        assert!(json.get("max_output_tokens").is_none());
        assert_eq!(
            json["tools"][0].get("name").and_then(|v| v.as_str()),
            Some("fs__read")
        );
        assert!(json["tools"][0].get("function").is_none());
        assert_eq!(
            json.get("tool_choice").and_then(|v| v.as_str()),
            Some("auto")
        );
    }

    #[test]
    fn convert_codex_input_maps_tool_calls_and_outputs() {
        let messages = vec![
            Message::system("System rule"),
            Message::user("hello"),
            Message::assistant_with_tool_calls(
                "",
                vec![ToolCall {
                    id: "call_1".into(),
                    name: "fs.read".into(),
                    arguments: serde_json::json!({"path": "/tmp/a.txt"}),
                }],
            ),
            Message::tool_result("call_1", "fs.read", "{\"ok\":true}"),
        ];

        let input = convert_codex_input(&messages);
        assert_eq!(input.len(), 3);

        let json = serde_json::to_value(&input).unwrap();
        assert_eq!(json[0]["type"], "message");
        assert_eq!(json[0]["role"], "user");
        assert_eq!(json[1]["type"], "function_call");
        assert_eq!(json[1]["name"], "fs__read");
        assert_eq!(json[2]["type"], "function_call_output");
        assert_eq!(json[2]["call_id"], "call_1");
    }

    #[test]
    fn parse_codex_stream_response_reads_completed_event() {
        let body = concat!(
            "data: {\"type\":\"response.output_text.delta\",\"delta\":\"Hello\"}\n\n",
            "data: {\"type\":\"response.completed\",\"response\":{\"output\":[{\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"Hello world\"}]},{\"type\":\"function_call\",\"id\":\"call_1\",\"name\":\"fs__read\",\"arguments\":\"{\\\"path\\\":\\\"/tmp/a\\\"}\"}]}}\n\n",
            "data: [DONE]\n\n"
        );
        let parsed = parse_codex_stream_response(body).unwrap();
        assert_eq!(parsed.content, "Hello world");
        assert_eq!(parsed.tool_calls.len(), 1);
        assert_eq!(parsed.tool_calls[0].name, "fs.read");
        assert_eq!(parsed.tool_calls[0].arguments["path"], "/tmp/a");
    }

    #[test]
    fn parse_codex_stream_response_falls_back_to_delta_events() {
        let body = concat!(
            "data: {\"type\":\"response.output_text.delta\",\"delta\":\"Hel\"}\n\n",
            "data: {\"type\":\"response.output_text.delta\",\"delta\":\"lo\"}\n\n",
            "data: {\"type\":\"response.output_item.done\",\"item\":{\"type\":\"function_call\",\"id\":\"call_2\",\"name\":\"fs__list\",\"arguments\":\"{\\\"path\\\":\\\"/tmp\\\"}\"}}\n\n",
            "data: [DONE]\n\n"
        );
        let parsed = parse_codex_stream_response(body).unwrap();
        assert_eq!(parsed.content, "Hello");
        assert_eq!(parsed.tool_calls.len(), 1);
        assert_eq!(parsed.tool_calls[0].name, "fs.list");
        assert_eq!(parsed.tool_calls[0].arguments["path"], "/tmp");
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
            usage: None,
        };

        let result = parse_chat_response(resp).unwrap();
        assert_eq!(result.content, "Hello, world!");
        assert!(result.tool_calls.is_empty());
        assert!(result.usage.is_none());
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
            usage: None,
        };

        let result = parse_chat_response(resp).unwrap();
        assert_eq!(result.content, "");
        assert!(result.tool_calls.is_empty());
        assert!(result.usage.is_none());
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
            usage: None,
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
        let resp = ChatResponse {
            choices: vec![],
            usage: None,
        };

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
            usage: None,
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
        assert_eq!(
            result.usage.as_ref().and_then(|u| u.prompt_tokens),
            Some(50)
        );
        assert_eq!(
            result.usage.as_ref().and_then(|u| u.completion_tokens),
            Some(30)
        );
        assert_eq!(result.usage.as_ref().and_then(|u| u.total_tokens), Some(80));
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
        assert_eq!(result.usage.as_ref().and_then(|u| u.total_tokens), Some(18));
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
            usage: None,
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
            usage: None,
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
            tool_choice: None,
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(!json.contains("tools"));
        assert!(!json.contains("tool_choice"));
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
            tool_choice: Some("auto".into()),
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("tools"));
        assert!(json.contains("fs__read"));
        assert!(!json.contains("fs.read"));
        assert!(json.contains("tool_choice"));
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
            tool_choice: None,
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
            "skill.create",
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
