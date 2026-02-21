use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const PROVIDERS_JSON: &str = include_str!("providers.json");

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderRegistry {
    pub providers: Vec<ProviderDef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderDef {
    pub id: String,
    pub name: String,
    pub api_format: ApiFormat,
    pub base_url: String,
    pub auth: AuthConfig,
    pub default_model: String,
    pub models: Vec<ModelDef>,
    #[serde(default)]
    pub extra_headers: HashMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApiFormat {
    Openai,
    Gemini,
    Anthropic,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthConfig {
    #[serde(rename = "type")]
    pub auth_type: AuthType,
    #[serde(default)]
    pub param_name: Option<String>,
    /// Custom header name for the API key (defaults to "Authorization" with "Bearer " prefix for bearer type)
    #[serde(default)]
    pub header_name: Option<String>,
    pub vault_key: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthType {
    Bearer,
    QueryParam,
    /// Raw header: sends the key as-is in the header specified by `header_name`
    Header,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelDef {
    pub id: String,
    pub name: String,
}

impl ProviderRegistry {
    pub fn load() -> Self {
        serde_json::from_str(PROVIDERS_JSON).expect("providers.json is invalid")
    }

    pub fn get_provider(&self, id: &str) -> Option<&ProviderDef> {
        let normalized = id.to_lowercase();
        self.providers
            .iter()
            .find(|p| p.id == normalized || p.name.to_lowercase() == normalized)
    }
}
