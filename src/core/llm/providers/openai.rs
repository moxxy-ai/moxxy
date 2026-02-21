use anyhow::{Result, anyhow};
use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::core::llm::{LlmProvider, ModelInfo, ProviderType};

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

pub struct OpenAiProvider {
    api_key: String,
    client: Client,
}

impl OpenAiProvider {
    pub fn new(api_key: String) -> Self {
        Self {
            api_key,
            client: Client::new(),
        }
    }
}

#[async_trait]
impl LlmProvider for OpenAiProvider {
    fn provider_type(&self) -> ProviderType {
        ProviderType::OpenAI
    }

    async fn fetch_models(&self) -> Result<Vec<ModelInfo>> {
        Ok(vec![
            ModelInfo {
                id: "o3-mini".to_string(),
                name: "OpenAI o3-mini".to_string(),
            },
            ModelInfo {
                id: "o1".to_string(),
                name: "OpenAI o1".to_string(),
            },
            ModelInfo {
                id: "gpt-5.2".to_string(),
                name: "GPT-5.2".to_string(),
            },
            ModelInfo {
                id: "gpt-5.1-pro".to_string(),
                name: "GPT-5.1 Pro".to_string(),
            },
            ModelInfo {
                id: "gpt-4.5-preview".to_string(),
                name: "GPT-4.5".to_string(),
            },
            ModelInfo {
                id: "gpt-4o".to_string(),
                name: "GPT-4o".to_string(),
            },
            ModelInfo {
                id: "gpt-4o-mini".to_string(),
                name: "GPT-4o Mini".to_string(),
            },
        ])
    }

    async fn generate(
        &self,
        model_id: &str,
        messages: &[crate::core::llm::ChatMessage],
    ) -> Result<String> {
        let req_messages = messages
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
        let res = self
            .client
            .post("https://api.openai.com/v1/chat/completions")
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&req)
            .send()
            .await?;
        if !res.status().is_success() {
            return Err(anyhow!(
                "OpenAI API Error: {}",
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
}
