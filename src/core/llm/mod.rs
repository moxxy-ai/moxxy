pub mod providers;

use anyhow::Result;
use async_trait::async_trait;
use tracing::info;

#[derive(Debug, Clone, PartialEq)]
pub enum ProviderType {
    OpenAI,
    Google,
    ZAi,
}

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

#[async_trait]
pub trait LlmProvider: Send + Sync {
    fn provider_type(&self) -> ProviderType;

    // Dynamically fetch available models from the provider's API
    #[allow(dead_code)]
    async fn fetch_models(&self) -> Result<Vec<ModelInfo>>;

    // Execute a prompt against a selected model using a structured conversation history
    async fn generate(&self, model_id: &str, messages: &[ChatMessage]) -> Result<String>;
}

pub struct LlmManager {
    providers: Vec<Box<dyn LlmProvider>>,
    selected_provider: Option<ProviderType>,
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
        info!("Registered LLM Provider: {:?}", provider.provider_type());
        self.providers.push(provider);
    }

    pub fn set_active(&mut self, provider: ProviderType, model_id: String) {
        info!("Setting active LLM: {:?} ({})", provider, model_id);
        self.selected_provider = Some(provider);
        self.selected_model = Some(model_id);
    }

    pub fn get_provider(&self, pt: ProviderType) -> Option<&dyn LlmProvider> {
        self.providers.iter().find(|p| p.provider_type() == pt).map(|p| p.as_ref())
    }

    #[allow(dead_code)]
    pub fn list_providers(&self) -> Vec<ProviderType> {
        self.providers.iter().map(|p| p.provider_type()).collect()
    }

    pub fn get_active_info(&self) -> (Option<&ProviderType>, Option<&String>) {
        (
            self.selected_provider.as_ref(),
            self.selected_model.as_ref(),
        )
    }

    pub async fn generate_with_selected(&self, messages: &[ChatMessage]) -> Result<String> {
        let provider_type = self.selected_provider.as_ref().ok_or_else(|| {
            anyhow::anyhow!("No LLM Provider selected. Please configure one via the CLI.")
        })?;

        let model_id = self
            .selected_model
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("No LLM Model selected."))?;

        let provider = self
            .get_provider(provider_type.clone())
            .ok_or_else(|| anyhow::anyhow!("Selected provider not found in registry"))?;

        provider.generate(model_id, messages).await
    }
}
