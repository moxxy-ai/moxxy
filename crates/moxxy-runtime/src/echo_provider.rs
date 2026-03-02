use async_trait::async_trait;

use crate::provider::{Message, ModelConfig, Provider, ProviderResponse, ToolCall};
use crate::registry::{PrimitiveError, ToolDefinition};

/// A configurable stub provider for development and testing.
/// Returns a templated response echoing the last user message.
pub struct EchoProvider {
    response_template: String,
    initial_tool_calls: Vec<ToolCall>,
    always_call_tools: bool,
}

impl EchoProvider {
    pub fn new() -> Self {
        Self {
            response_template: "Received: {input}".into(),
            initial_tool_calls: vec![],
            always_call_tools: false,
        }
    }

    pub fn with_response(mut self, response: impl Into<String>) -> Self {
        self.response_template = response.into();
        self
    }

    pub fn with_tool_calls(mut self, calls: Vec<ToolCall>) -> Self {
        self.initial_tool_calls = calls;
        self
    }

    pub fn with_always_call_tools(mut self) -> Self {
        self.always_call_tools = true;
        self
    }
}

impl Default for EchoProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Provider for EchoProvider {
    async fn complete(
        &self,
        messages: Vec<Message>,
        _config: &ModelConfig,
        _tools: &[ToolDefinition],
    ) -> Result<ProviderResponse, PrimitiveError> {
        let last_user = messages
            .iter()
            .rev()
            .find(|m| m.role == "user")
            .map(|m| m.content.clone())
            .unwrap_or_default();

        let content = self.response_template.replace("{input}", &last_user);

        // Only return tool_calls on first call (before any tool results),
        // unless always_call_tools is set.
        let has_tool_results = messages.iter().any(|m| m.role == "tool");
        let tool_calls = if self.always_call_tools || !has_tool_results {
            self.initial_tool_calls.clone()
        } else {
            vec![]
        };

        Ok(ProviderResponse {
            content,
            tool_calls,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn echo_provider_returns_templated_response() {
        let provider = EchoProvider::new();
        let config = ModelConfig {
            temperature: 0.7,
            max_tokens: 100,
        };
        let messages = vec![Message::user("hello world")];
        let resp = provider.complete(messages, &config, &[]).await.unwrap();
        assert_eq!(resp.content, "Received: hello world");
        assert!(resp.tool_calls.is_empty());
    }

    #[tokio::test]
    async fn echo_provider_custom_response() {
        let provider = EchoProvider::new().with_response("You said: {input}");
        let config = ModelConfig {
            temperature: 0.7,
            max_tokens: 100,
        };
        let messages = vec![Message::user("test")];
        let resp = provider.complete(messages, &config, &[]).await.unwrap();
        assert_eq!(resp.content, "You said: test");
    }

    #[tokio::test]
    async fn echo_provider_returns_tool_calls_only_first_time() {
        let provider = EchoProvider::new().with_tool_calls(vec![ToolCall {
            id: "call_0".into(),
            name: "fs.read".into(),
            arguments: serde_json::json!({"path": "/tmp/test"}),
        }]);
        let config = ModelConfig {
            temperature: 0.7,
            max_tokens: 100,
        };

        // First call: has tool_calls
        let messages = vec![Message::user("read file")];
        let resp = provider.complete(messages, &config, &[]).await.unwrap();
        assert_eq!(resp.tool_calls.len(), 1);
        assert_eq!(resp.tool_calls[0].id, "call_0");

        // Second call with tool result: no tool_calls
        let messages = vec![
            Message::user("read file"),
            Message::assistant("reading..."),
            Message::tool_result("call_0", "fs.read", "file content"),
        ];
        let resp = provider.complete(messages, &config, &[]).await.unwrap();
        assert!(resp.tool_calls.is_empty());
    }

    #[tokio::test]
    async fn echo_provider_handles_empty_messages() {
        let provider = EchoProvider::new();
        let config = ModelConfig {
            temperature: 0.7,
            max_tokens: 100,
        };
        let resp = provider.complete(vec![], &config, &[]).await.unwrap();
        assert_eq!(resp.content, "Received: ");
    }
}
