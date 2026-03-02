use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::registry::PrimitiveError;

#[derive(Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: String,
    pub content: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct ModelConfig {
    pub temperature: f64,
    pub max_tokens: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProviderResponse {
    pub content: String,
    pub tool_calls: Vec<ToolCall>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ToolCall {
    pub name: String,
    pub arguments: serde_json::Value,
}

#[async_trait]
pub trait Provider: Send + Sync {
    async fn complete(
        &self,
        messages: Vec<Message>,
        config: &ModelConfig,
    ) -> Result<ProviderResponse, PrimitiveError>;
}

#[cfg(test)]
mod tests {
    use super::*;

    struct MockProvider;

    #[async_trait]
    impl Provider for MockProvider {
        async fn complete(
            &self,
            _messages: Vec<Message>,
            _config: &ModelConfig,
        ) -> Result<ProviderResponse, PrimitiveError> {
            Ok(ProviderResponse {
                content: "Hello from mock".into(),
                tool_calls: vec![],
            })
        }
    }

    #[tokio::test]
    async fn provider_trait_mock_returns_expected_response() {
        let provider = MockProvider;
        let config = ModelConfig {
            temperature: 0.7,
            max_tokens: 1000,
        };
        let resp = provider.complete(vec![], &config).await.unwrap();
        assert_eq!(resp.content, "Hello from mock");
    }
}
