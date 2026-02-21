use anyhow::{Result, anyhow};
use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::core::llm::{LlmProvider, ModelInfo, ProviderType};

#[derive(Serialize)]
struct ZAiRequest<'a> {
    model: &'a str,
    messages: Vec<ZAiMessage<'a>>,
}

#[derive(Serialize, Deserialize)]
struct ZAiMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize)]
struct ZAiResponse {
    choices: Vec<ZAiChoice>,
}

#[derive(Deserialize)]
struct ZAiChoice {
    message: ZAiMessageOwned,
}

#[derive(Deserialize)]
struct ZAiMessageOwned {
    content: String,
}

pub struct ZAiProvider {
    api_key: String,
    client: Client,
}

impl ZAiProvider {
    pub fn new(api_key: String) -> Self {
        Self {
            api_key,
            client: Client::new(),
        }
    }
}

#[async_trait]
impl LlmProvider for ZAiProvider {
    fn provider_type(&self) -> ProviderType {
        ProviderType::ZAi
    }

    async fn fetch_models(&self) -> Result<Vec<ModelInfo>> {
        Ok(vec![
            ModelInfo {
                id: "glm-5".to_string(),
                name: "GLM-5 (Flagship)".to_string(),
            },
            ModelInfo {
                id: "glm-4.7".to_string(),
                name: "GLM-4.7".to_string(),
            },
            ModelInfo {
                id: "glm-4-plus".to_string(),
                name: "GLM-4 Plus".to_string(),
            },
            ModelInfo {
                id: "glm-4-0520".to_string(),
                name: "GLM-4".to_string(),
            },
            ModelInfo {
                id: "glm-4v-plus".to_string(),
                name: "GLM-4V Plus".to_string(),
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
            .map(|m| ZAiMessage {
                role: &m.role,
                content: &m.content,
            })
            .collect();

        let req = ZAiRequest {
            model: model_id,
            messages: req_messages,
        };
        // Z.Ai (Zhipu) uses OpenAI compatible endpoints
        let res = self
            .client
            .post("https://open.bigmodel.cn/api/paas/v4/chat/completions")
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&req)
            .send()
            .await?;
        if !res.status().is_success() {
            return Err(anyhow!(
                "Z.Ai API Error: {}",
                res.text().await.unwrap_or_default()
            ));
        }
        let parsed: ZAiResponse = res.json().await?;
        Ok(parsed
            .choices
            .into_iter()
            .next()
            .map(|c| c.message.content)
            .unwrap_or_default())
    }
}
