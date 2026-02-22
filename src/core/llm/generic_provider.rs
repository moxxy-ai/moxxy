use anyhow::{Result, anyhow};
use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};

use super::registry::{ApiFormat, AuthType, ProviderDef};
use super::{ChatMessage, LlmProvider, ModelInfo};

// ── OpenAI-compatible request/response ──

#[derive(Serialize)]
struct OpenAiRequest<'a> {
    model: &'a str,
    messages: Vec<OpenAiMessage<'a>>,
}

#[derive(Serialize, Deserialize)]
struct OpenAiMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize)]
struct OpenAiResponse {
    choices: Vec<OpenAiChoice>,
}

#[derive(Deserialize)]
struct OpenAiChoice {
    message: OpenAiMessageOwned,
}

#[derive(Deserialize)]
struct OpenAiMessageOwned {
    content: String,
}

// ── Gemini request/response ──

#[derive(Serialize)]
struct GeminiRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    system_instruction: Option<GeminiContent>,
    contents: Vec<GeminiContent>,
}

#[derive(Serialize)]
struct GeminiContent {
    role: String,
    parts: Vec<GeminiPart>,
}

#[derive(Serialize)]
struct GeminiPart {
    text: String,
}

#[derive(Deserialize)]
struct GeminiResponse {
    candidates: Vec<GeminiCandidate>,
}

#[derive(Deserialize)]
struct GeminiCandidate {
    content: GeminiResContent,
}

#[derive(Deserialize)]
struct GeminiResContent {
    parts: Vec<GeminiResPart>,
}

#[derive(Deserialize)]
struct GeminiResPart {
    text: String,
}

// ── Anthropic Messages API request/response ──

#[derive(Serialize)]
struct AnthropicRequest<'a> {
    model: &'a str,
    max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<String>,
    messages: Vec<AnthropicMessage<'a>>,
}

#[derive(Serialize)]
struct AnthropicMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize)]
struct AnthropicResponse {
    content: Vec<AnthropicContentBlock>,
}

#[derive(Deserialize)]
struct AnthropicContentBlock {
    text: Option<String>,
}

// ── Generic Provider ──

pub struct GenericProvider {
    provider_def: ProviderDef,
    api_key: String,
    client: Client,
}

impl GenericProvider {
    pub fn new(provider_def: ProviderDef, api_key: String) -> Self {
        Self {
            provider_def,
            api_key,
            client: Client::new(),
        }
    }

    /// Apply auth and extra headers to a request builder.
    fn apply_auth(&self, mut request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        match self.provider_def.auth.auth_type {
            AuthType::Bearer => {
                request = request.header("Authorization", format!("Bearer {}", self.api_key));
            }
            AuthType::Header => {
                let header_name = self
                    .provider_def
                    .auth
                    .header_name
                    .as_deref()
                    .unwrap_or("Authorization");
                request = request.header(header_name, &self.api_key);
            }
            AuthType::QueryParam => {
                // Handled at URL level, not here
            }
        }

        // Apply any extra static headers from the provider config
        for (k, v) in &self.provider_def.extra_headers {
            request = request.header(k.as_str(), v.as_str());
        }

        request
    }

    async fn generate_openai(&self, model_id: &str, messages: &[ChatMessage]) -> Result<String> {
        let req_messages: Vec<OpenAiMessage> = messages
            .iter()
            .map(|m| OpenAiMessage {
                role: &m.role,
                content: &m.content,
            })
            .collect();

        let req = OpenAiRequest {
            model: model_id,
            messages: req_messages,
        };

        let request = self.client.post(&self.provider_def.base_url).json(&req);
        let request = self.apply_auth(request);

        let res = request.send().await?;
        if !res.status().is_success() {
            return Err(anyhow!(
                "{} API Error: {}",
                self.provider_def.name,
                res.text().await.unwrap_or_default()
            ));
        }
        let parsed: OpenAiResponse = res.json().await?;
        Ok(parsed
            .choices
            .into_iter()
            .next()
            .map(|c| c.message.content)
            .unwrap_or_default())
    }

    async fn generate_gemini(&self, model_id: &str, messages: &[ChatMessage]) -> Result<String> {
        let mut contents = Vec::new();
        let mut system_instruction: Option<GeminiContent> = None;

        // Collect leading system messages into system_instruction.
        // Mid-conversation system messages become user-role entries with [SYSTEM] prefix.
        let mut past_first_non_system = false;

        for m in messages {
            if m.role == "system" {
                if !past_first_non_system {
                    if let Some(ref mut si) = system_instruction {
                        if let Some(part) = si.parts.first_mut() {
                            part.text.push('\n');
                            part.text.push_str(&m.content);
                        }
                    } else {
                        system_instruction = Some(GeminiContent {
                            role: "user".to_string(),
                            parts: vec![GeminiPart {
                                text: m.content.clone(),
                            }],
                        });
                    }
                } else {
                    let prefixed = format!("[SYSTEM] {}", m.content);
                    let should_merge = contents
                        .last()
                        .map(|c: &GeminiContent| c.role == "user")
                        .unwrap_or(false);

                    if should_merge {
                        if let Some(last) = contents.last_mut()
                            && let Some(part) = last.parts.first_mut()
                        {
                            part.text.push('\n');
                            part.text.push_str(&prefixed);
                        }
                    } else {
                        contents.push(GeminiContent {
                            role: "user".to_string(),
                            parts: vec![GeminiPart { text: prefixed }],
                        });
                    }
                }
            } else {
                past_first_non_system = true;
                let gemini_role = if m.role == "assistant" {
                    "model"
                } else {
                    "user"
                };

                // Gemini requires strictly alternating roles. Merge consecutive same-role entries.
                let should_merge = contents
                    .last()
                    .map(|c: &GeminiContent| c.role == gemini_role)
                    .unwrap_or(false);

                if should_merge {
                    if let Some(last) = contents.last_mut()
                        && let Some(part) = last.parts.first_mut()
                    {
                        part.text.push('\n');
                        part.text.push_str(&m.content);
                    }
                } else {
                    contents.push(GeminiContent {
                        role: gemini_role.to_string(),
                        parts: vec![GeminiPart {
                            text: m.content.clone(),
                        }],
                    });
                }
            }
        }

        let req = GeminiRequest {
            system_instruction,
            contents,
        };

        let url = match self.provider_def.auth.auth_type {
            AuthType::QueryParam => {
                let param_name = self
                    .provider_def
                    .auth
                    .param_name
                    .as_deref()
                    .unwrap_or("key");
                let base = self.provider_def.base_url.replace("{model}", model_id);
                format!("{}?{}={}", base, param_name, self.api_key)
            }
            _ => self.provider_def.base_url.replace("{model}", model_id),
        };

        let request = self.client.post(&url).json(&req);
        let request = self.apply_auth(request);

        let res = request.send().await?;
        if !res.status().is_success() {
            return Err(anyhow!(
                "{} API Error: {}",
                self.provider_def.name,
                res.text().await.unwrap_or_default()
            ));
        }
        let parsed: GeminiResponse = res.json().await?;
        Ok(parsed
            .candidates
            .into_iter()
            .next()
            .and_then(|c| c.content.parts.into_iter().next())
            .map(|p| p.text)
            .unwrap_or_default())
    }

    async fn generate_anthropic(&self, model_id: &str, messages: &[ChatMessage]) -> Result<String> {
        let mut system_text: Option<String> = None;
        let mut api_messages: Vec<AnthropicMessage> = Vec::new();

        for m in messages {
            if m.role == "system" {
                // Anthropic uses a top-level `system` field; concatenate all system messages.
                match &mut system_text {
                    Some(s) => {
                        s.push('\n');
                        s.push_str(&m.content);
                    }
                    None => system_text = Some(m.content.clone()),
                }
            } else {
                api_messages.push(AnthropicMessage {
                    role: &m.role,
                    content: &m.content,
                });
            }
        }

        let req = AnthropicRequest {
            model: model_id,
            max_tokens: 8192,
            system: system_text,
            messages: api_messages,
        };

        let request = self.client.post(&self.provider_def.base_url).json(&req);
        let request = self.apply_auth(request);

        let res = request.send().await?;
        if !res.status().is_success() {
            return Err(anyhow!(
                "{} API Error: {}",
                self.provider_def.name,
                res.text().await.unwrap_or_default()
            ));
        }
        let parsed: AnthropicResponse = res.json().await?;
        Ok(parsed
            .content
            .into_iter()
            .filter_map(|b| b.text)
            .collect::<Vec<_>>()
            .join(""))
    }
}

#[async_trait]
impl LlmProvider for GenericProvider {
    fn provider_id(&self) -> &str {
        &self.provider_def.id
    }

    async fn fetch_models(&self) -> Result<Vec<ModelInfo>> {
        Ok(self
            .provider_def
            .models
            .iter()
            .map(|m| ModelInfo {
                id: m.id.clone(),
                name: m.name.clone(),
            })
            .collect())
    }

    async fn generate(&self, model_id: &str, messages: &[ChatMessage]) -> Result<String> {
        match self.provider_def.api_format {
            ApiFormat::Openai => self.generate_openai(model_id, messages).await,
            ApiFormat::Gemini => self.generate_gemini(model_id, messages).await,
            ApiFormat::Anthropic => self.generate_anthropic(model_id, messages).await,
        }
    }

    fn set_api_key(&mut self, key: String) {
        self.api_key = key;
    }

    fn vault_key(&self) -> Option<&str> {
        Some(&self.provider_def.auth.vault_key)
    }
}
