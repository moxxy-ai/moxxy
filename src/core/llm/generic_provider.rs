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

        let mut request = self.client.post(&self.provider_def.base_url).json(&req);
        request = match self.provider_def.auth.auth_type {
            AuthType::Bearer => {
                request.header("Authorization", format!("Bearer {}", self.api_key))
            }
            AuthType::QueryParam => request, // Not used for OpenAI-format providers currently
        };

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
            AuthType::Bearer => self.provider_def.base_url.replace("{model}", model_id),
        };

        let mut request = self.client.post(&url).json(&req);
        if self.provider_def.auth.auth_type == AuthType::Bearer {
            request = request.header("Authorization", format!("Bearer {}", self.api_key));
        }

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
        }
    }
}
