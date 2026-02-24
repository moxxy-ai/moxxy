use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tracing::{info, warn};

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
    /// Whether this provider was added by the user (not built-in).
    #[serde(default)]
    pub custom: bool,
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

fn custom_providers_path() -> PathBuf {
    use crate::platform::{NativePlatform, Platform};
    NativePlatform::data_dir().join("custom_providers.json")
}

impl ProviderRegistry {
    pub fn load() -> Self {
        let mut registry: Self =
            serde_json::from_str(PROVIDERS_JSON).expect("providers.json is invalid");

        // Load custom providers and merge (custom overrides built-in on id collision)
        let custom_path = custom_providers_path();
        if custom_path.exists() {
            match std::fs::read_to_string(&custom_path) {
                Ok(contents) => match serde_json::from_str::<ProviderRegistry>(&contents) {
                    Ok(custom) => {
                        for mut cp in custom.providers {
                            cp.custom = true;
                            if let Some(pos) = registry.providers.iter().position(|p| p.id == cp.id)
                            {
                                registry.providers[pos] = cp;
                            } else {
                                registry.providers.push(cp);
                            }
                        }
                        info!("Loaded custom providers from {}", custom_path.display());
                    }
                    Err(e) => warn!("Failed to parse {}: {}", custom_path.display(), e),
                },
                Err(e) => warn!("Failed to read {}: {}", custom_path.display(), e),
            }
        }

        registry
    }

    pub fn get_provider(&self, id: &str) -> Option<&ProviderDef> {
        let normalized = id.to_lowercase();
        self.providers
            .iter()
            .find(|p| p.id == normalized || p.name.to_lowercase() == normalized)
    }

    /// Returns only the custom (user-defined) providers.
    pub fn custom_providers(&self) -> Vec<&ProviderDef> {
        self.providers.iter().filter(|p| p.custom).collect()
    }

    /// Add a custom provider and persist to disk.
    pub fn add_custom_provider(provider: ProviderDef) -> Result<(), String> {
        let mut custom_registry = Self::load_custom_file();

        // Replace if exists, else push
        if let Some(pos) = custom_registry
            .providers
            .iter()
            .position(|p| p.id == provider.id)
        {
            custom_registry.providers[pos] = provider;
        } else {
            custom_registry.providers.push(provider);
        }

        Self::save_custom_file(&custom_registry)
    }

    /// Remove a custom provider by ID and persist to disk.
    pub fn remove_custom_provider(id: &str) -> Result<(), String> {
        let mut custom_registry = Self::load_custom_file();
        let before = custom_registry.providers.len();
        custom_registry.providers.retain(|p| p.id != id);
        if custom_registry.providers.len() == before {
            return Err(format!("Custom provider '{}' not found", id));
        }
        Self::save_custom_file(&custom_registry)
    }

    fn load_custom_file() -> ProviderRegistry {
        let custom_path = custom_providers_path();
        if custom_path.exists() {
            std::fs::read_to_string(&custom_path)
                .ok()
                .and_then(|c| serde_json::from_str(&c).ok())
                .unwrap_or(ProviderRegistry {
                    providers: Vec::new(),
                })
        } else {
            ProviderRegistry {
                providers: Vec::new(),
            }
        }
    }

    fn save_custom_file(registry: &ProviderRegistry) -> Result<(), String> {
        let custom_path = custom_providers_path();
        if let Some(parent) = custom_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        }
        let json = serde_json::to_string_pretty(registry)
            .map_err(|e| format!("Serialize error: {}", e))?;
        std::fs::write(&custom_path, json)
            .map_err(|e| format!("Failed to write {}: {}", custom_path.display(), e))
    }
}
