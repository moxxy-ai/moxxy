use async_trait::async_trait;
use base64::Engine;
use moxxy_types::{MediaAttachmentRef, MediaKind};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::provider::{
    Message, ModelConfig, Provider, ProviderResponse, TokenUsage, ToolCall, ToolChoice,
};
use crate::registry::{PrimitiveError, ToolDefinition};

const OPENAI_OAUTH_TOKEN_ENDPOINT: &str = "https://auth.openai.com/oauth/token";
const OPENAI_CODEX_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_CODEX_SESSION_MODE: &str = "chatgpt_oauth_session";
/// Matches the originator string sent by the official `codex` CLI. Requests
/// without this header are rate-limited by the ChatGPT backend (429).
const OPENAI_CODEX_ORIGINATOR: &str = "codex_cli_rs";
/// User-agent that impersonates the official Rust Codex CLI; required for the
/// chatgpt.com/backend-api/codex/* endpoints to avoid abuse-detection 429s.
const OPENAI_CODEX_CLIENT_VERSION: &str = "0.50.0";

fn codex_user_agent() -> String {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    format!("{OPENAI_CODEX_ORIGINATOR}/{OPENAI_CODEX_CLIENT_VERSION} ({os}; {arch})")
}

fn codex_default_headers() -> reqwest::header::HeaderMap {
    let mut headers = reqwest::header::HeaderMap::new();
    if let Ok(value) = reqwest::header::HeaderValue::from_str(OPENAI_CODEX_ORIGINATOR) {
        headers.insert("originator", value);
    }
    headers
}

fn build_codex_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(codex_user_agent())
        .default_headers(codex_default_headers())
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

/// An OpenAI-compatible LLM provider that calls the Chat Completions API.
pub struct OpenAIProvider {
    api_base: String,
    auth: OpenAIAuth,
    chatgpt_account_id: Option<String>,
    model: String,
    client: reqwest::Client,
}

enum OpenAIAuth {
    None,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    image_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_data: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    filename: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
}

#[derive(Serialize)]
struct ChatMessage {
    role: String,
    content: ChatMessageContent,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_calls: Option<Vec<OpenAIToolCallOut>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
}

#[derive(Serialize)]
#[serde(untagged)]
enum ChatMessageContent {
    Text(String),
    Parts(Vec<ChatContentPart>),
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case", tag = "type")]
enum ChatContentPart {
    Text { text: String },
    ImageUrl { image_url: ChatImageUrl },
    File { file: ChatFile },
}

#[derive(Serialize)]
struct ChatImageUrl {
    url: String,
    detail: String,
}

#[derive(Serialize)]
struct ChatFile {
    filename: String,
    file_data: String,
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
    pub fn new_no_auth(api_base: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            api_base: api_base.into(),
            auth: OpenAIAuth::None,
            chatgpt_account_id: None,
            model: model.into(),
            client: reqwest::Client::new(),
        }
    }

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
        let is_oauth = parsed_session.is_some();
        let auth = match parsed_session {
            Some(mut session) => {
                if session.client_id.trim().is_empty() {
                    session.client_id = OPENAI_CODEX_CLIENT_ID.to_string();
                }
                OpenAIAuth::ChatGptOAuthSession(Mutex::new(session))
            }
            None => OpenAIAuth::ApiKey(raw_secret),
        };

        let api_base: String = api_base.into();
        let model: String = model.into();
        let needs_codex_client = is_oauth
            || api_base.to_ascii_lowercase().contains("/backend-api/codex")
            || model.to_ascii_lowercase().contains("codex");
        let client = if needs_codex_client {
            build_codex_http_client()
        } else {
            reqwest::Client::new()
        };

        Self {
            api_base,
            auth,
            chatgpt_account_id,
            model,
            client,
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

fn image_attachment_to_data_url(attachment: &MediaAttachmentRef) -> Option<String> {
    if attachment.kind != MediaKind::Image {
        return None;
    }
    attachment_to_data_url(attachment)
}

fn document_attachment_to_data_url(attachment: &MediaAttachmentRef) -> Option<String> {
    if attachment.kind != MediaKind::Document {
        return None;
    }
    attachment_to_data_url(attachment)
}

fn attachment_to_data_url(attachment: &MediaAttachmentRef) -> Option<String> {
    let bytes = std::fs::read(&attachment.local_path).ok()?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Some(format!("data:{};base64,{}", attachment.mime, encoded))
}

fn chat_content_from_message(message: &Message) -> ChatMessageContent {
    if message.role != "user" || message.attachments.is_empty() {
        return ChatMessageContent::Text(message.content.clone());
    }

    let mut parts = Vec::new();
    let text = message.content.trim();
    if !text.is_empty() {
        parts.push(ChatContentPart::Text {
            text: text.to_string(),
        });
    }
    for attachment in &message.attachments {
        if let Some(url) = image_attachment_to_data_url(attachment) {
            parts.push(ChatContentPart::ImageUrl {
                image_url: ChatImageUrl {
                    url,
                    detail: "low".into(),
                },
            });
        } else if let Some(file_data) = document_attachment_to_data_url(attachment) {
            parts.push(ChatContentPart::File {
                file: ChatFile {
                    filename: attachment.filename.clone(),
                    file_data,
                },
            });
        }
    }

    if parts.is_empty() {
        ChatMessageContent::Text(message.content.clone())
    } else {
        ChatMessageContent::Parts(parts)
    }
}

fn convert_message(m: Message) -> ChatMessage {
    ChatMessage {
        role: m.role.clone(),
        content: chat_content_from_message(&m),
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
            text: Some(text.into()),
            image_url: None,
            file_data: None,
            filename: None,
            detail: None,
        }
    }

    fn output_text(text: impl Into<String>) -> Self {
        Self {
            content_type: "output_text".into(),
            text: Some(text.into()),
            image_url: None,
            file_data: None,
            filename: None,
            detail: None,
        }
    }

    fn input_image(image_url: impl Into<String>) -> Self {
        Self {
            content_type: "input_image".into(),
            text: None,
            image_url: Some(image_url.into()),
            file_data: None,
            filename: None,
            detail: Some("low".into()),
        }
    }

    fn input_file(filename: impl Into<String>, file_data: impl Into<String>) -> Self {
        Self {
            content_type: "input_file".into(),
            text: None,
            image_url: None,
            file_data: Some(file_data.into()),
            filename: Some(filename.into()),
            detail: Some("low".into()),
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
                let role = if message.role == "developer" {
                    "developer"
                } else {
                    "user"
                };
                let mut content = Vec::new();
                if !text.is_empty() {
                    content.push(CodexMessageContent::input_text(text));
                }
                if role == "user" {
                    for attachment in &message.attachments {
                        if let Some(url) = image_attachment_to_data_url(attachment) {
                            content.push(CodexMessageContent::input_image(url));
                        } else if let Some(file_data) = document_attachment_to_data_url(attachment)
                        {
                            content.push(CodexMessageContent::input_file(
                                attachment.filename.clone(),
                                file_data,
                            ));
                        }
                    }
                }
                if content.is_empty() {
                    continue;
                }
                input.push(CodexInputItem::Message {
                    role: role.into(),
                    content,
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

fn parse_codex_tool_arguments_if_present(
    value: Option<&serde_json::Value>,
) -> Option<serde_json::Value> {
    match value {
        Some(serde_json::Value::String(raw)) if raw.trim().is_empty() => None,
        Some(value) => Some(parse_tool_call_arguments(value)),
        None => None,
    }
}

fn parse_codex_function_call_item(item: &serde_json::Value, i: usize) -> Option<ToolCall> {
    let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
    if item_type != "function_call" {
        return None;
    }

    let id = item
        .get("call_id")
        .and_then(|v| v.as_str())
        .or_else(|| item.get("id").and_then(|v| v.as_str()))
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

#[derive(Clone, Debug)]
struct CodexStreamToolCallState {
    order: usize,
    id: String,
    name: String,
    argument_chunks: String,
    arguments: Option<serde_json::Value>,
}

impl CodexStreamToolCallState {
    fn new(order: usize, id: String) -> Self {
        Self {
            order,
            id,
            name: "unknown_tool".into(),
            argument_chunks: String::new(),
            arguments: None,
        }
    }

    fn into_tool_call(self) -> ToolCall {
        let arguments = self.arguments.unwrap_or_else(|| {
            if self.argument_chunks.trim().is_empty() {
                serde_json::json!({})
            } else {
                parse_tool_call_arguments(&serde_json::Value::String(self.argument_chunks))
            }
        });
        ToolCall {
            id: self.id,
            name: from_openai_name(&self.name),
            arguments,
        }
    }
}

fn codex_function_call_event_key(event: &serde_json::Value, i: usize) -> String {
    event
        .get("call_id")
        .and_then(|v| v.as_str())
        .or_else(|| event.get("item_id").and_then(|v| v.as_str()))
        .map(str::to_string)
        .or_else(|| {
            event
                .get("output_index")
                .map(|v| format!("output_index:{v}"))
        })
        .unwrap_or_else(|| format!("event:{i}"))
}

fn codex_function_call_item_key(item: &serde_json::Value, i: usize) -> String {
    item.get("call_id")
        .and_then(|v| v.as_str())
        .or_else(|| item.get("id").and_then(|v| v.as_str()))
        .map(str::to_string)
        .or_else(|| {
            item.get("output_index")
                .map(|v| format!("output_index:{v}"))
        })
        .unwrap_or_else(|| format!("item:{i}"))
}

fn merge_codex_function_call_item(
    states: &mut HashMap<String, CodexStreamToolCallState>,
    item: &serde_json::Value,
    i: usize,
) {
    if item.get("type").and_then(|v| v.as_str()) != Some("function_call") {
        return;
    }

    let key = codex_function_call_item_key(item, i);
    let id = item
        .get("call_id")
        .and_then(|v| v.as_str())
        .or_else(|| item.get("id").and_then(|v| v.as_str()))
        .unwrap_or(&key)
        .to_string();
    let state = states
        .entry(key)
        .or_insert_with(|| CodexStreamToolCallState::new(i, id.clone()));
    state.id = id;
    if let Some(name) = item.get("name").and_then(|v| v.as_str()).or_else(|| {
        item.get("function")
            .and_then(|f| f.get("name"))
            .and_then(|v| v.as_str())
    }) {
        state.name = name.to_string();
    }
    if let Some(arguments) = parse_codex_tool_arguments_if_present(
        item.get("arguments")
            .or_else(|| item.get("function").and_then(|f| f.get("arguments"))),
    ) {
        state.arguments = Some(arguments);
    }
}

fn collect_codex_stream_tool_calls(events: &[serde_json::Value]) -> Vec<ToolCall> {
    let mut states = HashMap::new();

    for (i, event) in events.iter().enumerate() {
        match event.get("type").and_then(|v| v.as_str()).unwrap_or("") {
            "response.output_item.added" | "response.output_item.done" => {
                if let Some(item) = event.get("item") {
                    merge_codex_function_call_item(&mut states, item, i);
                }
            }
            "response.function_call_arguments.delta" => {
                let key = codex_function_call_event_key(event, i);
                let id = event
                    .get("call_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or(&key)
                    .to_string();
                let state = states
                    .entry(key)
                    .or_insert_with(|| CodexStreamToolCallState::new(i, id.clone()));
                state.id = id;
                if let Some(delta) = event.get("delta").and_then(|v| v.as_str()) {
                    state.argument_chunks.push_str(delta);
                }
            }
            "response.function_call_arguments.done" => {
                let key = codex_function_call_event_key(event, i);
                let id = event
                    .get("call_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or(&key)
                    .to_string();
                let state = states
                    .entry(key)
                    .or_insert_with(|| CodexStreamToolCallState::new(i, id.clone()));
                state.id = id;
                if let Some(name) = event.get("name").and_then(|v| v.as_str()) {
                    state.name = name.to_string();
                }
                if let Some(arguments) =
                    parse_codex_tool_arguments_if_present(event.get("arguments"))
                {
                    state.arguments = Some(arguments);
                }
            }
            _ => {}
        }
    }

    let mut calls: Vec<_> = states.into_values().collect();
    calls.sort_by_key(|state| state.order);
    calls
        .into_iter()
        .filter(|state| state.name != "unknown_tool")
        .map(CodexStreamToolCallState::into_tool_call)
        .collect()
}

fn enrich_codex_tool_calls_from_stream(
    tool_calls: &mut [ToolCall],
    stream_tool_calls: &[ToolCall],
) {
    let by_id: HashMap<&str, &ToolCall> = stream_tool_calls
        .iter()
        .map(|call| (call.id.as_str(), call))
        .collect();

    for call in tool_calls {
        if let Some(stream_call) = by_id.get(call.id.as_str()) {
            if call.name == "unknown_tool" {
                call.name.clone_from(&stream_call.name);
            }
            if matches!(&call.arguments, serde_json::Value::String(raw) if raw.trim().is_empty()) {
                call.arguments = stream_call.arguments.clone();
            }
        }
    }
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
            "function_call" => {
                if let Some(tc) = parse_codex_function_call_item(part, i) {
                    tool_calls.push(tc);
                }
            }
            _ => append_codex_text_from_value(part, &mut content),
        }
    }

    Ok(ProviderResponse {
        content,
        tool_calls,
        usage: None,
    })
}

fn append_codex_text_from_value(value: &serde_json::Value, content: &mut String) {
    match value.get("type").and_then(|v| v.as_str()).unwrap_or("") {
        "message" => append_codex_message_content(value, content),
        "output_text" | "text" => {
            if let Some(text) = value.get("text").and_then(|v| v.as_str()) {
                content.push_str(text);
            }
        }
        _ => append_codex_message_content(value, content),
    }
}

fn append_codex_message_content(value: &serde_json::Value, content: &mut String) {
    match value.get("content") {
        Some(serde_json::Value::Array(items)) => {
            for item in items {
                append_codex_text_from_value(item, content);
            }
        }
        Some(serde_json::Value::String(text)) => content.push_str(text),
        _ => {}
    }
}

fn push_codex_final_text_part(
    parts: &mut Vec<String>,
    seen_keys: &mut HashSet<String>,
    event: &serde_json::Value,
    text: String,
) {
    if text.is_empty() {
        return;
    }
    let key = codex_final_text_part_key(event, &text);
    if seen_keys.insert(key) {
        parts.push(text);
    }
}

fn codex_final_text_part_key(event: &serde_json::Value, text: &str) -> String {
    let item_id = event.get("item_id").and_then(|v| v.as_str()).unwrap_or("");
    let output_index = event
        .get("output_index")
        .map(|v| v.to_string())
        .unwrap_or_default();
    let content_index = event
        .get("content_index")
        .map(|v| v.to_string())
        .unwrap_or_default();

    if !item_id.is_empty() || !output_index.is_empty() || !content_index.is_empty() {
        format!("{item_id}:{output_index}:{content_index}")
    } else {
        format!("text:{text}")
    }
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

    let event_types: Vec<&str> = events
        .iter()
        .filter_map(|e| e.get("type").and_then(|v| v.as_str()))
        .collect();
    tracing::debug!(
        event_count = events.len(),
        event_types = ?event_types,
        "Codex SSE events received"
    );

    let stream_tool_calls = collect_codex_stream_tool_calls(&events);
    let mut completed_empty_error: Option<String> = None;
    for event in events.iter().rev() {
        let event_type = event.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if (event_type == "response.completed" || event_type == "response.done")
            && let Some(response_obj) = event.get("response")
        {
            let status = response_obj
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            let mut parsed = match parse_codex_response_output(response_obj) {
                Ok(parsed) => parsed,
                Err(e) => {
                    tracing::warn!(
                        error = %e,
                        "Failed to parse codex response.completed output, falling back to deltas"
                    );
                    break;
                }
            };
            enrich_codex_tool_calls_from_stream(&mut parsed.tool_calls, &stream_tool_calls);
            if parsed.tool_calls.is_empty() && !stream_tool_calls.is_empty() {
                parsed.tool_calls.clone_from(&stream_tool_calls);
            }

            if parsed.content.is_empty() && parsed.tool_calls.is_empty() {
                completed_empty_error = Some(if status != "completed" {
                    let reason = response_obj
                        .get("incomplete_details")
                        .or_else(|| response_obj.get("error"))
                        .map(|v| v.to_string())
                        .unwrap_or_else(|| "no details provided".into());
                    format!("Codex response status={status} with no output; reason: {reason}")
                } else {
                    let output = response_obj
                        .get("output")
                        .map(|v| v.to_string())
                        .unwrap_or_else(|| "missing output".into());
                    format!("Codex response status=completed with no output; output: {output}")
                });
                break;
            }

            return Ok(parsed);
        }
    }

    let mut delta_content = String::new();
    let mut final_text_parts = Vec::new();
    let mut seen_final_text_keys = HashSet::new();
    let mut output_item_text_parts = Vec::new();
    let tool_calls = stream_tool_calls;
    for event in events.iter() {
        match event.get("type").and_then(|v| v.as_str()).unwrap_or("") {
            "response.output_text.delta" => {
                if let Some(delta) = event.get("delta").and_then(|v| v.as_str()) {
                    delta_content.push_str(delta);
                }
            }
            "response.output_text.done" => {
                if let Some(text) = event.get("text").and_then(|v| v.as_str()) {
                    push_codex_final_text_part(
                        &mut final_text_parts,
                        &mut seen_final_text_keys,
                        event,
                        text.to_string(),
                    );
                }
            }
            "response.content_part.done" => {
                if let Some(part) = event.get("part") {
                    let mut text = String::new();
                    append_codex_text_from_value(part, &mut text);
                    push_codex_final_text_part(
                        &mut final_text_parts,
                        &mut seen_final_text_keys,
                        event,
                        text,
                    );
                }
            }
            "response.output_item.added" | "response.output_item.done" => {
                if event.get("type").and_then(|v| v.as_str()) == Some("response.output_item.done")
                    && let Some(item) = event.get("item")
                {
                    let mut text = String::new();
                    append_codex_text_from_value(item, &mut text);
                    if !text.is_empty() {
                        output_item_text_parts.push(text);
                    }
                }
            }
            _ => {}
        }
    }
    let content = if !final_text_parts.is_empty() {
        final_text_parts.concat()
    } else if !delta_content.is_empty() {
        delta_content
    } else {
        output_item_text_parts.concat()
    };

    // No response.completed/done event and no parseable deltas — the stream was
    // truncated or only emitted events we don't understand. Error out with the
    // list of event types so the log is actionable instead of "empty response".
    if content.is_empty() && tool_calls.is_empty() {
        if let Some(message) = completed_empty_error {
            return Err(PrimitiveError::ExecutionFailed(format!(
                "{message}; event types seen: {event_types:?}"
            )));
        }
        return Err(PrimitiveError::ExecutionFailed(format!(
            "Codex stream ended without a completed response or parseable output; \
             event types seen: {event_types:?}"
        )));
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

    fn apply_request_auth(
        &self,
        mut request: reqwest::RequestBuilder,
        bearer: Option<&str>,
        chatgpt_account_id: Option<&str>,
    ) -> reqwest::RequestBuilder {
        if let Some(bearer) = bearer {
            request = request.bearer_auth(bearer);
        }
        if let Some(account_id) = chatgpt_account_id
            && !account_id.trim().is_empty()
        {
            request = request.header("ChatGPT-Account-Id", account_id);
        }
        request
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

    async fn resolve_request_auth(
        &self,
    ) -> Result<(Option<String>, Option<String>), PrimitiveError> {
        match &self.auth {
            OpenAIAuth::None => Ok((None, None)),
            OpenAIAuth::ApiKey(key) => Ok((Some(key.clone()), self.chatgpt_account_id.clone())),
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
                Ok((Some(locked.access_token.clone()), account))
            }
        }
    }

    async fn send_request(
        &self,
        body: &serde_json::Value,
        is_codex: bool,
    ) -> Result<ProviderResponse, PrimitiveError> {
        let url = self.request_url();
        let (bearer, chatgpt_account_id) = self.resolve_request_auth().await?;

        let mut request = self.apply_request_auth(
            self.client.post(&url),
            bearer.as_deref(),
            chatgpt_account_id.as_deref(),
        );
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
            let result = parse_codex_stream_response(&body_text);
            if let Ok(ref resp) = result
                && resp.content.is_empty()
                && resp.tool_calls.is_empty()
            {
                // Log the raw SSE body so we can diagnose why parsing
                // produced an empty response (e.g. unrecognised event types).
                let preview: String = body_text.chars().take(2000).collect();
                tracing::warn!(
                    body_preview = %preview,
                    body_len = body_text.len(),
                    "Codex stream parsed to empty response"
                );
            }
            return result;
        }

        let chat_resp: ChatResponse = response.json().await.map_err(|e| {
            PrimitiveError::ExecutionFailed(format!("failed to parse response JSON: {}", e))
        })?;

        parse_chat_response(chat_resp)
    }
}

#[async_trait]
impl Provider for OpenAIProvider {
    fn supports_images(&self) -> bool {
        true
    }

    fn supports_documents(&self) -> bool {
        true
    }

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

    fn test_image_attachment() -> (tempfile::TempDir, MediaAttachmentRef) {
        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join("photo.jpg");
        std::fs::write(
            &path,
            [0xff, 0xd8, 0xff, 0xe0, b'M', b'O', b'X', b'X', b'Y'],
        )
        .unwrap();
        (
            tmp,
            MediaAttachmentRef {
                id: "media_test".into(),
                kind: MediaKind::Image,
                mime: "image/jpeg".into(),
                filename: "photo.jpg".into(),
                local_path: path.to_string_lossy().to_string(),
                size_bytes: 9,
                sha256: "abc".into(),
                source: serde_json::json!({"channel": "telegram"}),
            },
        )
    }

    fn test_document_attachment() -> (tempfile::TempDir, MediaAttachmentRef) {
        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join("brief.pdf");
        std::fs::write(&path, b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\n").unwrap();
        (
            tmp,
            MediaAttachmentRef {
                id: "media_doc".into(),
                kind: MediaKind::Document,
                mime: "application/pdf".into(),
                filename: "brief.pdf".into(),
                local_path: path.to_string_lossy().to_string(),
                size_bytes: 31,
                sha256: "docabc".into(),
                source: serde_json::json!({"channel": "telegram"}),
            },
        )
    }

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
            OpenAIAuth::None => panic!("expected api key auth"),
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
            OpenAIAuth::None => panic!("expected oauth session auth"),
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
    fn codex_user_agent_matches_official_cli_format() {
        let ua = codex_user_agent();
        assert!(
            ua.starts_with("codex_cli_rs/"),
            "user agent must start with codex_cli_rs/ to avoid 429 on chatgpt.com backend; got {ua}"
        );
        assert!(
            ua.contains(';'),
            "user agent must include os/arch; got {ua}"
        );
    }

    #[test]
    fn codex_default_headers_include_originator() {
        // The chatgpt.com/backend-api/codex backend rate-limits (429) any
        // request that doesn't identify itself as the official Codex CLI via
        // the `originator` header.
        let headers = codex_default_headers();
        assert_eq!(
            headers.get("originator").and_then(|v| v.to_str().ok()),
            Some("codex_cli_rs"),
        );
    }

    #[test]
    fn oauth_session_provider_uses_codex_http_client() {
        // Make sure constructing a provider from a stored ChatGPT OAuth
        // session swaps in the identity-carrying reqwest client instead of
        // the bare default. We can't introspect reqwest defaults directly,
        // so we just exercise the code path and rely on the explicit header
        // test above.
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
            None,
        );
        assert!(matches!(provider.auth, OpenAIAuth::ChatGptOAuthSession(_)));
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
    fn no_auth_provider_skips_authorization_header() {
        let provider = OpenAIProvider::new_no_auth("http://localhost:11434/v1", "gpt-oss:20b");
        let request = provider
            .apply_request_auth(
                reqwest::Client::new().post(provider.request_url()),
                None,
                None,
            )
            .build()
            .unwrap();

        assert!(request.headers().get("authorization").is_none());
        assert!(request.headers().get("chatgpt-account-id").is_none());
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
    fn convert_codex_input_includes_image_input_for_user_attachment() {
        let (_tmp, attachment) = test_image_attachment();
        let messages = vec![Message::user_with_attachments(
            "What is this?",
            vec![attachment],
        )];

        let json = serde_json::to_value(convert_codex_input(&messages)).unwrap();

        assert_eq!(json[0]["type"], "message");
        assert_eq!(json[0]["role"], "user");
        assert_eq!(json[0]["content"][0]["type"], "input_text");
        assert_eq!(json[0]["content"][1]["type"], "input_image");
        assert_eq!(json[0]["content"][1]["detail"], "low");
        assert!(
            json[0]["content"][1]["image_url"]
                .as_str()
                .unwrap()
                .starts_with("data:image/jpeg;base64,")
        );
    }

    #[test]
    fn convert_codex_input_includes_file_input_for_document_attachment() {
        let (_tmp, attachment) = test_document_attachment();
        let messages = vec![Message::user_with_attachments(
            "Summarize this",
            vec![attachment],
        )];

        let json = serde_json::to_value(convert_codex_input(&messages)).unwrap();

        assert_eq!(json[0]["type"], "message");
        assert_eq!(json[0]["role"], "user");
        assert_eq!(json[0]["content"][0]["type"], "input_text");
        assert_eq!(json[0]["content"][1]["type"], "input_file");
        assert_eq!(json[0]["content"][1]["filename"], "brief.pdf");
        assert_eq!(json[0]["content"][1]["detail"], "low");
        assert!(
            json[0]["content"][1]["file_data"]
                .as_str()
                .unwrap()
                .starts_with("data:application/pdf;base64,")
        );
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
    fn parse_codex_stream_response_reads_completed_text_content_part() {
        let body = concat!(
            "data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"output\":[{\"type\":\"message\",\"content\":[{\"type\":\"text\",\"text\":\"Czesc z OAuth\"}]}]}}\n\n",
            "data: [DONE]\n\n"
        );
        let parsed = parse_codex_stream_response(body).unwrap();
        assert_eq!(parsed.content, "Czesc z OAuth");
        assert!(parsed.tool_calls.is_empty());
    }

    #[test]
    fn parse_codex_stream_response_reads_content_part_done_fallback() {
        let body = concat!(
            "data: {\"type\":\"response.created\",\"response\":{\"output\":[]}}\n\n",
            "data: {\"type\":\"response.content_part.done\",\"part\":{\"type\":\"text\",\"text\":\"fallback text\"}}\n\n",
            "data: [DONE]\n\n"
        );
        let parsed = parse_codex_stream_response(body).unwrap();
        assert_eq!(parsed.content, "fallback text");
        assert!(parsed.tool_calls.is_empty());
    }

    #[test]
    fn parse_codex_stream_response_falls_back_when_completed_output_is_empty() {
        let body = concat!(
            "data: {\"type\":\"response.content_part.done\",\"part\":{\"type\":\"text\",\"text\":\"text before final empty output\"}}\n\n",
            "data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"output\":[]}}\n\n",
            "data: [DONE]\n\n"
        );
        let parsed = parse_codex_stream_response(body).unwrap();
        assert_eq!(parsed.content, "text before final empty output");
        assert!(parsed.tool_calls.is_empty());
    }

    #[test]
    fn parse_codex_stream_response_deduplicates_equivalent_final_text_events() {
        let body = concat!(
            "data: {\"type\":\"response.output_text.done\",\"text\":\"same final text\"}\n\n",
            "data: {\"type\":\"response.content_part.done\",\"part\":{\"type\":\"text\",\"text\":\"same final text\"}}\n\n",
            "data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"output\":[]}}\n\n",
            "data: [DONE]\n\n"
        );
        let parsed = parse_codex_stream_response(body).unwrap();
        assert_eq!(parsed.content, "same final text");
        assert!(parsed.tool_calls.is_empty());
    }

    #[test]
    fn parse_codex_stream_response_errors_on_completed_with_no_output() {
        let body = concat!(
            "data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"output\":[]}}\n\n",
            "data: [DONE]\n\n"
        );
        let err = parse_codex_stream_response(body).unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("status=completed"), "got: {msg}");
        assert!(msg.contains("no output"), "got: {msg}");
    }

    #[test]
    fn parse_codex_stream_response_errors_on_incomplete_with_no_output() {
        // Response signaled incomplete (e.g. max_output_tokens) and produced
        // no content or tool calls. Must surface as an error with the reason
        // rather than returning Ok(empty), which would feed the stuck detector.
        let body = concat!(
            "data: {\"type\":\"response.completed\",\"response\":{\"status\":\"incomplete\",\"incomplete_details\":{\"reason\":\"max_output_tokens\"},\"output\":[]}}\n\n",
            "data: [DONE]\n\n"
        );
        let err = parse_codex_stream_response(body).unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("status=incomplete"), "got: {msg}");
        assert!(msg.contains("max_output_tokens"), "got: {msg}");
    }

    #[test]
    fn parse_codex_stream_response_returns_partial_output_on_incomplete() {
        // Incomplete response that still produced partial content — return what
        // we got instead of erroring; the caller can decide how to use it.
        let body = concat!(
            "data: {\"type\":\"response.completed\",\"response\":{\"status\":\"incomplete\",\"incomplete_details\":{\"reason\":\"max_output_tokens\"},\"output\":[{\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"partial\"}]}]}}\n\n",
            "data: [DONE]\n\n"
        );
        let parsed = parse_codex_stream_response(body).unwrap();
        assert_eq!(parsed.content, "partial");
    }

    #[test]
    fn parse_codex_stream_response_errors_on_truncated_stream() {
        // Stream ended without response.completed and deltas were unparseable
        // (only reasoning events). Must error with the event types seen so
        // logs reveal what actually came back.
        let body = concat!(
            "data: {\"type\":\"response.created\",\"response\":{}}\n\n",
            "data: {\"type\":\"response.reasoning.delta\",\"delta\":\"...\"}\n\n",
            "data: [DONE]\n\n"
        );
        let err = parse_codex_stream_response(body).unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("Codex stream ended"), "got: {msg}");
        assert!(
            msg.contains("response.reasoning.delta") || msg.contains("response.created"),
            "got: {msg}"
        );
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
    fn parse_codex_function_call_prefers_call_id_for_tool_output_pairing() {
        let body = concat!(
            "data: {\"type\":\"response.output_item.done\",\"item\":{\"type\":\"function_call\",\"id\":\"fc_0991d35038dbc3d10169f5619470e4819182df9b6d546bb34a\",\"call_id\":\"call_0991d35038dbc3d10169f5619470e4819182df9b6d546bb34a\",\"name\":\"skill__execute\",\"arguments\":\"{\\\"name\\\":\\\"news\\\"}\"}}\n\n",
            "data: [DONE]\n\n"
        );

        let parsed = parse_codex_stream_response(body).unwrap();

        assert_eq!(parsed.tool_calls.len(), 1);
        assert_eq!(
            parsed.tool_calls[0].id,
            "call_0991d35038dbc3d10169f5619470e4819182df9b6d546bb34a"
        );
    }

    #[test]
    fn parse_codex_stream_response_uses_streamed_function_call_arguments() {
        let body = concat!(
            "data: {\"type\":\"response.output_item.added\",\"item\":{\"type\":\"function_call\",\"id\":\"fc_fetch\",\"call_id\":\"call_fetch\",\"name\":\"browse__fetch\",\"arguments\":\"\"}}\n\n",
            "data: {\"type\":\"response.function_call_arguments.delta\",\"item_id\":\"fc_fetch\",\"call_id\":\"call_fetch\",\"output_index\":0,\"delta\":\"{\\\"url\\\":\"}\n\n",
            "data: {\"type\":\"response.function_call_arguments.delta\",\"item_id\":\"fc_fetch\",\"call_id\":\"call_fetch\",\"output_index\":0,\"delta\":\"\\\"https://example.com\\\"}\"}\n\n",
            "data: {\"type\":\"response.function_call_arguments.done\",\"item_id\":\"fc_fetch\",\"call_id\":\"call_fetch\",\"name\":\"browse__fetch\",\"output_index\":0,\"arguments\":\"{\\\"url\\\":\\\"https://example.com\\\"}\"}\n\n",
            "data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"output\":[{\"type\":\"function_call\",\"id\":\"fc_fetch\",\"call_id\":\"call_fetch\",\"name\":\"browse__fetch\",\"arguments\":\"\"}]}}\n\n",
            "data: [DONE]\n\n"
        );

        let parsed = parse_codex_stream_response(body).unwrap();

        assert_eq!(parsed.tool_calls.len(), 1);
        assert_eq!(parsed.tool_calls[0].id, "call_fetch");
        assert_eq!(parsed.tool_calls[0].name, "browse.fetch");
        assert_eq!(
            parsed.tool_calls[0].arguments,
            serde_json::json!({"url": "https://example.com"})
        );
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
    fn convert_message_includes_image_url_part_for_user_attachment() {
        let (_tmp, attachment) = test_image_attachment();
        let msg = Message::user_with_attachments("Describe it", vec![attachment]);

        let chat_msg = convert_message(msg);
        let json = serde_json::to_value(&chat_msg).unwrap();

        assert_eq!(json["role"], "user");
        assert_eq!(json["content"][0]["type"], "text");
        assert_eq!(json["content"][0]["text"], "Describe it");
        assert_eq!(json["content"][1]["type"], "image_url");
        assert_eq!(json["content"][1]["image_url"]["detail"], "low");
        assert!(
            json["content"][1]["image_url"]["url"]
                .as_str()
                .unwrap()
                .starts_with("data:image/jpeg;base64,")
        );
    }

    #[test]
    fn convert_message_includes_file_part_for_document_attachment() {
        let (_tmp, attachment) = test_document_attachment();
        let msg = Message::user_with_attachments("Read it", vec![attachment]);

        let chat_msg = convert_message(msg);
        let json = serde_json::to_value(&chat_msg).unwrap();

        assert_eq!(json["role"], "user");
        assert_eq!(json["content"][0]["type"], "text");
        assert_eq!(json["content"][0]["text"], "Read it");
        assert_eq!(json["content"][1]["type"], "file");
        assert_eq!(json["content"][1]["file"]["filename"], "brief.pdf");
        assert!(
            json["content"][1]["file"]["file_data"]
                .as_str()
                .unwrap()
                .starts_with("data:application/pdf;base64,")
        );
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
