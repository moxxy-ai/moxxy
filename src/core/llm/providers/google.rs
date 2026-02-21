use anyhow::{Result, anyhow};
use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::core::llm::{LlmProvider, ModelInfo, ProviderType};

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

pub struct GoogleProvider {
    api_key: String,
    client: Client,
}

impl GoogleProvider {
    pub fn new(api_key: String) -> Self {
        Self {
            api_key,
            client: Client::new(),
        }
    }
}

#[async_trait]
impl LlmProvider for GoogleProvider {
    fn provider_type(&self) -> ProviderType {
        ProviderType::Google
    }

    async fn fetch_models(&self) -> Result<Vec<ModelInfo>> {
        Ok(vec![
            ModelInfo {
                id: "gemini-3.1-pro".to_string(),
                name: "Gemini 3.1 Pro".to_string(),
            },
            ModelInfo {
                id: "gemini-3-flash".to_string(),
                name: "Gemini 3 Flash".to_string(),
            },
            ModelInfo {
                id: "gemini-2.5-pro".to_string(),
                name: "Gemini 2.5 Pro".to_string(),
            },
            ModelInfo {
                id: "gemini-2.5-flash".to_string(),
                name: "Gemini 2.5 Flash".to_string(),
            },
            ModelInfo {
                id: "gemini-2.0-flash".to_string(),
                name: "Gemini 2.0 Flash".to_string(),
            },
        ])
    }

    async fn generate(
        &self,
        model_id: &str,
        messages: &[crate::core::llm::ChatMessage],
    ) -> Result<String> {
        let mut contents = Vec::new();
        let mut system_instruction: Option<GeminiContent> = None;

        // Collect leading system messages into system_instruction.
        // Mid-conversation system messages become user-role entries with [SYSTEM] prefix.
        let mut past_first_non_system = false;

        for m in messages {
            if m.role == "system" {
                if !past_first_non_system {
                    // Accumulate into system_instruction
                    if let Some(ref mut si) = system_instruction {
                        // Append to existing system instruction text
                        if let Some(part) = si.parts.first_mut() {
                            part.text.push('\n');
                            part.text.push_str(&m.content);
                        }
                    } else {
                        system_instruction = Some(GeminiContent {
                            role: "user".to_string(), // role is ignored for system_instruction but required by struct
                            parts: vec![GeminiPart {
                                text: m.content.clone(),
                            }],
                        });
                    }
                } else {
                    // Mid-conversation system message: inject as user with [SYSTEM] prefix
                    // Gemini requires alternating user/model turns, so merge into
                    // the previous user turn if the last entry is user, else add new user entry.
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
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
            model_id, self.api_key
        );
        let res = self.client.post(&url).json(&req).send().await?;
        if !res.status().is_success() {
            return Err(anyhow!(
                "Google Gemini API Error: {}",
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
