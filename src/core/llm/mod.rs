pub mod generic_provider;
pub mod registry;

use anyhow::Result;
use async_trait::async_trait;
use tracing::info;

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize)]
pub struct TokenUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
    #[serde(default)]
    pub estimated: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LlmGenerateOutput {
    pub text: String,
    pub usage: Option<TokenUsage>,
}

#[async_trait]
pub trait LlmProvider: Send + Sync {
    fn provider_id(&self) -> &str;

    #[allow(dead_code)]
    async fn fetch_models(&self) -> Result<Vec<ModelInfo>>;

    async fn generate(&self, model_id: &str, messages: &[ChatMessage])
    -> Result<LlmGenerateOutput>;

    /// Update the API key at runtime (e.g. after vault change).
    fn set_api_key(&mut self, _key: String) {}

    /// Returns the vault key name for this provider's API key.
    fn vault_key(&self) -> Option<&str> {
        None
    }
}

pub struct LlmManager {
    providers: Vec<Box<dyn LlmProvider>>,
    selected_provider: Option<String>,
    selected_model: Option<String>,
}

impl LlmManager {
    pub fn new() -> Self {
        Self {
            providers: Vec::new(),
            selected_provider: None,
            selected_model: None,
        }
    }

    pub fn register_provider(&mut self, provider: Box<dyn LlmProvider>) {
        info!("Registered LLM Provider: {}", provider.provider_id());
        self.providers.push(provider);
    }

    pub fn set_active(&mut self, provider_id: &str, model_id: String) {
        info!("Setting active LLM: {} ({})", provider_id, model_id);
        self.selected_provider = Some(provider_id.to_string());
        self.selected_model = Some(model_id);
    }

    pub fn get_provider(&self, id: &str) -> Option<&dyn LlmProvider> {
        self.providers
            .iter()
            .find(|p| p.provider_id() == id)
            .map(|p| p.as_ref())
    }

    /// Update the API key for any provider whose vault_key matches.
    pub fn update_key_for_vault_entry(&mut self, vault_key: &str, new_api_key: &str) {
        for provider in &mut self.providers {
            if provider.vault_key().is_some_and(|k| k == vault_key) {
                provider.set_api_key(new_api_key.to_string());
                info!(
                    "Hot-reloaded API key for provider: {}",
                    provider.provider_id()
                );
            }
        }
    }

    #[allow(dead_code)]
    pub fn list_providers(&self) -> Vec<&str> {
        self.providers.iter().map(|p| p.provider_id()).collect()
    }

    pub fn get_active_info(&self) -> (Option<&str>, Option<&str>) {
        (
            self.selected_provider.as_deref(),
            self.selected_model.as_deref(),
        )
    }

    pub async fn generate_with_selected(
        &self,
        messages: &[ChatMessage],
    ) -> Result<LlmGenerateOutput> {
        let provider_id = self.selected_provider.as_ref().ok_or_else(|| {
            anyhow::anyhow!("No LLM Provider selected. Please configure one via the CLI.")
        })?;

        let model_id = self
            .selected_model
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("No LLM Model selected."))?;

        let provider = self
            .get_provider(provider_id)
            .ok_or_else(|| anyhow::anyhow!("Selected provider not found in registry"))?;

        provider.generate(model_id, messages).await
    }
}
