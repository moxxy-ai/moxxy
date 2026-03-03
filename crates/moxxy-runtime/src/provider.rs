use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::registry::{PrimitiveError, ToolDefinition};

#[derive(Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

impl Message {
    pub fn system(content: impl Into<String>) -> Self {
        Self {
            role: "system".into(),
            content: content.into(),
            tool_calls: None,
            tool_call_id: None,
            name: None,
        }
    }

    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: "user".into(),
            content: content.into(),
            tool_calls: None,
            tool_call_id: None,
            name: None,
        }
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: "assistant".into(),
            content: content.into(),
            tool_calls: None,
            tool_call_id: None,
            name: None,
        }
    }

    pub fn assistant_with_tool_calls(
        content: impl Into<String>,
        tool_calls: Vec<ToolCall>,
    ) -> Self {
        Self {
            role: "assistant".into(),
            content: content.into(),
            tool_calls: Some(tool_calls),
            tool_call_id: None,
            name: None,
        }
    }

    pub fn tool_result(
        tool_call_id: impl Into<String>,
        name: impl Into<String>,
        content: impl Into<String>,
    ) -> Self {
        Self {
            role: "tool".into(),
            content: content.into(),
            tool_calls: None,
            tool_call_id: Some(tool_call_id.into()),
            name: Some(name.into()),
        }
    }
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<TokenUsage>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct TokenUsage {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completion_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<u32>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: serde_json::Value,
}

#[async_trait]
pub trait Provider: Send + Sync {
    async fn complete(
        &self,
        messages: Vec<Message>,
        config: &ModelConfig,
        tools: &[ToolDefinition],
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
            _tools: &[ToolDefinition],
        ) -> Result<ProviderResponse, PrimitiveError> {
            Ok(ProviderResponse {
                content: "Hello from mock".into(),
                tool_calls: vec![],
                usage: None,
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
        let resp = provider.complete(vec![], &config, &[]).await.unwrap();
        assert_eq!(resp.content, "Hello from mock");
    }

    #[test]
    fn message_constructors_set_correct_roles() {
        let sys = Message::system("sys");
        assert_eq!(sys.role, "system");
        assert!(sys.tool_calls.is_none());

        let user = Message::user("hi");
        assert_eq!(user.role, "user");

        let asst = Message::assistant("reply");
        assert_eq!(asst.role, "assistant");
        assert!(asst.tool_calls.is_none());

        let calls = vec![ToolCall {
            id: "call_1".into(),
            name: "fs.read".into(),
            arguments: serde_json::json!({}),
        }];
        let asst_tc = Message::assistant_with_tool_calls("", calls.clone());
        assert_eq!(asst_tc.role, "assistant");
        assert_eq!(asst_tc.tool_calls.as_ref().unwrap().len(), 1);

        let tool = Message::tool_result("call_1", "fs.read", "content");
        assert_eq!(tool.role, "tool");
        assert_eq!(tool.tool_call_id.as_deref(), Some("call_1"));
        assert_eq!(tool.name.as_deref(), Some("fs.read"));
    }

    #[test]
    fn tool_call_has_id_field() {
        let tc = ToolCall {
            id: "call_abc".into(),
            name: "test".into(),
            arguments: serde_json::json!({"key": "val"}),
        };
        let json = serde_json::to_string(&tc).unwrap();
        assert!(json.contains("call_abc"));
    }

    #[test]
    fn message_skips_none_fields_in_serialization() {
        let msg = Message::user("hello");
        let json = serde_json::to_string(&msg).unwrap();
        assert!(!json.contains("tool_calls"));
        assert!(!json.contains("tool_call_id"));
        assert!(!json.contains("name"));
    }
}
