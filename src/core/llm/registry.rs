use serde::{Deserialize, Serialize};

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
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApiFormat {
    Openai,
    Gemini,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthConfig {
    #[serde(rename = "type")]
    pub auth_type: AuthType,
    #[serde(default)]
    pub param_name: Option<String>,
    pub vault_key: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthType {
    Bearer,
    QueryParam,
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
