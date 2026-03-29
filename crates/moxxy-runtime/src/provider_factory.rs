use std::sync::Arc;

use crate::anthropic_provider::AnthropicProvider;
use crate::claude_cli_provider::ClaudeCliProvider;
use crate::openai_provider::OpenAIProvider;
use crate::provider::Provider;

/// All the information needed to create a provider instance.
/// Gathered by the gateway from YAML config + vault; the runtime
/// handles the provider-specific instantiation.
pub struct ProviderConfig {
    pub provider_id: String,
    pub model_id: String,
    pub api_base: Option<String>,
    pub api_key: Option<String>,
    pub chatgpt_account_id: Option<String>,
    pub workspace: Option<std::path::PathBuf>,
}

/// Create the appropriate [`Provider`] implementation from a generic config.
///
/// Provider selection logic:
/// 1. `claude-cli` — shells out to locally-installed `claude` binary (no API key needed)
/// 2. Anthropic — if `provider_id` is `"anthropic"` or `api_base` contains `"anthropic.com"`
/// 3. OpenAI-compatible — fallback for all other API-based providers
pub fn create_provider(config: ProviderConfig) -> Option<Arc<dyn Provider>> {
    // CLI-based provider: no API key or base URL required
    if config.provider_id == "claude-cli" {
        let binary_path = ClaudeCliProvider::discover().or_else(|| {
            tracing::warn!("claude CLI binary not found on system");
            None
        })?;
        let mut provider = ClaudeCliProvider::new(binary_path, config.model_id);
        if let Some(ws) = config.workspace {
            provider = provider.with_workspace(ws);
        }
        return Some(Arc::new(provider));
    }

    let api_base = config.api_base?;

    // Ollama uses an OpenAI-compatible endpoint but does not require auth.
    if config.provider_id == "ollama" {
        return Some(Arc::new(OpenAIProvider::new_no_auth(
            api_base,
            config.model_id,
        )));
    }

    // Other API-based providers require an API key or session secret.
    let api_key = config.api_key?;

    if config.provider_id == "anthropic" || api_base.contains("anthropic.com") {
        Some(Arc::new(AnthropicProvider::new(
            api_base,
            api_key,
            config.model_id,
        )))
    } else {
        Some(Arc::new(OpenAIProvider::new(
            api_base,
            api_key,
            config.model_id,
            config.chatgpt_account_id,
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_provider_returns_none_for_missing_api_key() {
        let config = ProviderConfig {
            provider_id: "anthropic".into(),
            model_id: "claude-sonnet-4-20250514".into(),
            api_base: Some("https://api.anthropic.com".into()),
            api_key: None,
            chatgpt_account_id: None,
            workspace: None,
        };
        assert!(create_provider(config).is_none());
    }

    #[test]
    fn create_provider_returns_none_for_missing_api_base() {
        let config = ProviderConfig {
            provider_id: "openai".into(),
            model_id: "gpt-4o".into(),
            api_base: None,
            api_key: Some("sk-test".into()),
            chatgpt_account_id: None,
            workspace: None,
        };
        assert!(create_provider(config).is_none());
    }

    #[test]
    fn create_provider_anthropic() {
        let config = ProviderConfig {
            provider_id: "anthropic".into(),
            model_id: "claude-sonnet-4-20250514".into(),
            api_base: Some("https://api.anthropic.com".into()),
            api_key: Some("sk-test".into()),
            chatgpt_account_id: None,
            workspace: None,
        };
        assert!(create_provider(config).is_some());
    }

    #[test]
    fn create_provider_openai() {
        let config = ProviderConfig {
            provider_id: "openai".into(),
            model_id: "gpt-4o".into(),
            api_base: Some("https://api.openai.com/v1".into()),
            api_key: Some("sk-test".into()),
            chatgpt_account_id: None,
            workspace: None,
        };
        assert!(create_provider(config).is_some());
    }

    #[test]
    fn create_provider_ollama_without_api_key() {
        let config = ProviderConfig {
            provider_id: "ollama".into(),
            model_id: "gpt-oss:20b".into(),
            api_base: Some("http://localhost:11434/v1".into()),
            api_key: None,
            chatgpt_account_id: None,
            workspace: None,
        };
        assert!(create_provider(config).is_some());
    }

    #[test]
    fn create_provider_anthropic_detected_by_url() {
        let config = ProviderConfig {
            provider_id: "custom-anthropic".into(),
            model_id: "claude-sonnet-4-20250514".into(),
            api_base: Some("https://api.anthropic.com/v1".into()),
            api_key: Some("sk-test".into()),
            chatgpt_account_id: None,
            workspace: None,
        };
        // Should still use AnthropicProvider because api_base contains "anthropic.com"
        assert!(create_provider(config).is_some());
    }
}
