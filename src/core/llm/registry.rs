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

impl AuthConfig {
    pub fn requires_secret(&self) -> bool {
        self.auth_type != AuthType::None
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthType {
    None,
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

fn ollama_models_endpoint(provider: &ProviderDef) -> Option<String> {
    if provider.id != "ollama" {
        return None;
    }

    let mut url = reqwest::Url::parse(&provider.base_url)
        .map_err(|e| warn!("Invalid provider URL: {}", e))
        .ok()?;
    url.set_path("/v1/models");
    url.set_query(None);
    Some(url.to_string())
}

fn parse_live_models_response(value: serde_json::Value) -> Result<Vec<ModelDef>, String> {
    let models = value
        .get("models")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "Response does not contain a models array".to_string())?;

    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for model in models {
        let id = model
            .get("id")
            .and_then(|v| v.as_str())
            .or_else(|| model.get("name").and_then(|v| v.as_str()))
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .ok_or_else(|| "Model entry is missing id/name".to_string())?;

        if !seen.insert(id.to_string()) {
            continue;
        }

        let name = model
            .get("name")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .unwrap_or(id);

        out.push(ModelDef {
            id: id.to_string(),
            name: name.to_string(),
        });
    }

    Ok(out)
}

pub async fn fetch_live_models(provider: &ProviderDef) -> Result<Option<Vec<ModelDef>>, String> {
    let Some(url) = ollama_models_endpoint(provider) else {
        return Ok(None);
    };

    let response = reqwest::Client::new()
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to reach live models endpoint: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Live models endpoint returned HTTP {}",
            response.status()
        ));
    }

    let body = response
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Failed to parse live models response: {}", e))?;

    parse_live_models_response(body).map(Some)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn test_ollama_provider(base_url: String) -> ProviderDef {
        ProviderDef {
            id: "ollama".to_string(),
            name: "Ollama".to_string(),
            api_format: ApiFormat::Openai,
            base_url,
            auth: AuthConfig {
                auth_type: AuthType::None,
                param_name: None,
                header_name: None,
                vault_key: "ollama_api_key".to_string(),
            },
            default_model: "qwen3:8b".to_string(),
            models: vec![],
            extra_headers: HashMap::new(),
            custom: false,
        }
    }

    #[test]
    fn built_in_registry_contains_ollama_provider() {
        let registry = ProviderRegistry::load();
        let provider = registry
            .get_provider("ollama")
            .expect("ollama provider should exist");

        assert_eq!(provider.id, "ollama");
        assert_eq!(provider.auth.auth_type, AuthType::None);
        assert_eq!(
            provider.base_url,
            "http://localhost:11434/v1/chat/completions"
        );
        assert_eq!(provider.default_model, "qwen3:8b");
    }

    #[test]
    fn parse_live_models_response_reads_ollama_openai_models_payload() {
        let provider =
            test_ollama_provider("http://localhost:11434/v1/chat/completions".to_string());
        let endpoint = ollama_models_endpoint(&provider).expect("ollama models endpoint");
        assert_eq!(endpoint, "http://localhost:11434/v1/models");

        let models = parse_live_models_response(serde_json::json!({
            "models": [
                { "id": "gemma3", "name": "Gemma 3" },
                { "name": "qwen3:8b" }
            ]
        }))
        .expect("models should parse");

        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "gemma3");
        assert_eq!(models[0].name, "Gemma 3");
        assert_eq!(models[1].id, "qwen3:8b");
        assert_eq!(models[1].name, "qwen3:8b");
    }
}
