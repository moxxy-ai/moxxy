use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;
use tracing::{info, warn};

const PROVIDERS_JSON: &str = include_str!("providers.json");
const LIVE_MODEL_DISCOVERY_TIMEOUT: Duration = Duration::from_millis(1000);

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
    #[serde(default)]
    pub deployment: Option<ModelDeployment>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelDeployment {
    Local,
    Cloud,
}

impl ModelDeployment {
    pub fn as_str(self) -> &'static str {
        match self {
            ModelDeployment::Local => "local",
            ModelDeployment::Cloud => "cloud",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LiveModelSource {
    Live,
    StaticFallback,
}

impl LiveModelSource {
    pub fn as_str(self) -> &'static str {
        match self {
            LiveModelSource::Live => "live",
            LiveModelSource::StaticFallback => "static_fallback",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ProviderModelResolution {
    pub models: Vec<ModelDef>,
    pub source: LiveModelSource,
}

fn custom_providers_path() -> PathBuf {
    use crate::platform::{NativePlatform, Platform};
    NativePlatform::data_dir().join("custom_providers.json")
}

fn ollama_models_endpoint(provider: &ProviderDef) -> Option<String> {
    if !supports_live_models(provider) {
        return None;
    }

    let mut url = reqwest::Url::parse(&provider.base_url)
        .map_err(|e| warn!("Invalid provider URL: {}", e))
        .ok()?;
    url.set_path("/v1/models");
    url.set_query(None);
    Some(url.to_string())
}

fn ollama_tags_endpoint(provider: &ProviderDef) -> Option<String> {
    if !supports_live_models(provider) {
        return None;
    }

    let mut url = reqwest::Url::parse(&provider.base_url)
        .map_err(|e| warn!("Invalid provider URL: {}", e))
        .ok()?;
    url.set_path("/api/tags");
    url.set_query(None);
    Some(url.to_string())
}

fn is_cloud_model_alias(model_id: &str) -> bool {
    let normalized = model_id.trim().to_lowercase();
    normalized.contains(":cloud") || normalized.contains("-cloud")
}

fn detect_model_deployment(model: &serde_json::Value, id: &str) -> ModelDeployment {
    if model.get("remote_model").is_some()
        || model.get("remote_host").is_some()
        || is_cloud_model_alias(id)
    {
        ModelDeployment::Cloud
    } else {
        ModelDeployment::Local
    }
}

fn sort_live_models(mut models: Vec<ModelDef>) -> Vec<ModelDef> {
    models.sort_by(|left, right| {
        let left_rank = match left.deployment.unwrap_or(ModelDeployment::Local) {
            ModelDeployment::Local => 0,
            ModelDeployment::Cloud => 1,
        };
        let right_rank = match right.deployment.unwrap_or(ModelDeployment::Local) {
            ModelDeployment::Local => 0,
            ModelDeployment::Cloud => 1,
        };

        left_rank
            .cmp(&right_rank)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    models
}

fn parse_live_models_response(value: serde_json::Value) -> Result<Vec<ModelDef>, String> {
    let models = value
        .get("models")
        .and_then(|v| v.as_array())
        .or_else(|| value.get("data").and_then(|v| v.as_array()))
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
        let deployment = detect_model_deployment(model, id);

        out.push(ModelDef {
            id: id.to_string(),
            name: name.to_string(),
            deployment: Some(deployment),
        });
    }

    Ok(out)
}

async fn fetch_live_model_payload(url: String) -> Result<serde_json::Value, String> {
    tokio::time::timeout(LIVE_MODEL_DISCOVERY_TIMEOUT, async {
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

        response
            .json::<serde_json::Value>()
            .await
            .map_err(|e| format!("Failed to parse live models response: {}", e))
    })
    .await
    .map_err(|_| {
        format!(
            "Live models endpoint timed out after {} ms",
            LIVE_MODEL_DISCOVERY_TIMEOUT.as_millis()
        )
    })?
}

pub async fn fetch_live_models(provider: &ProviderDef) -> Result<Option<Vec<ModelDef>>, String> {
    if !supports_live_models(provider) {
        return Ok(None);
    }

    if let Some(url) = ollama_tags_endpoint(provider)
        && let Ok(body) = fetch_live_model_payload(url).await
    {
        return parse_live_models_response(body).map(Some);
    }

    let Some(url) = ollama_models_endpoint(provider) else {
        return Ok(None);
    };
    let body = fetch_live_model_payload(url).await?;

    parse_live_models_response(body).map(Some)
}

pub fn supports_live_models(provider: &ProviderDef) -> bool {
    provider.id == "ollama"
}

pub async fn resolve_provider_models(provider: &ProviderDef) -> ProviderModelResolution {
    if !supports_live_models(provider) {
        return ProviderModelResolution {
            models: provider.models.clone(),
            source: LiveModelSource::StaticFallback,
        };
    }

    match fetch_live_models(provider).await {
        Ok(Some(models)) => {
            let sorted = sort_live_models(models);
            if !sorted.is_empty() {
                ProviderModelResolution {
                    models: sorted,
                    source: LiveModelSource::Live,
                }
            } else {
                ProviderModelResolution {
                    models: provider.models.clone(),
                    source: LiveModelSource::StaticFallback,
                }
            }
        }
        Ok(_) | Err(_) => ProviderModelResolution {
            models: provider.models.clone(),
            source: LiveModelSource::StaticFallback,
        },
    }
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

    #[test]
    fn parse_live_models_response_reads_openai_compatible_data_payload() {
        let models = parse_live_models_response(serde_json::json!({
            "object": "list",
            "data": [
                { "id": "gpt-oss:20b", "object": "model", "owned_by": "library" },
                { "id": "SpeakLeash/bielik-11b-v3.0-instruct:Q8_0", "object": "model", "owned_by": "SpeakLeash" }
            ]
        }))
        .expect("models should parse");

        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "gpt-oss:20b");
        assert_eq!(models[0].name, "gpt-oss:20b");
        assert_eq!(models[0].deployment, Some(ModelDeployment::Local));
        assert_eq!(models[1].id, "SpeakLeash/bielik-11b-v3.0-instruct:Q8_0");
        assert_eq!(models[1].name, "SpeakLeash/bielik-11b-v3.0-instruct:Q8_0");
        assert_eq!(models[1].deployment, Some(ModelDeployment::Local));
    }

    #[test]
    fn parse_live_models_response_reads_api_tags_payload_with_cloud_and_local_models() {
        let models = parse_live_models_response(serde_json::json!({
            "models": [
                {
                    "name": "gpt-oss:20b",
                    "details": { "format": "gguf" }
                },
                {
                    "name": "glm-5:cloud",
                    "remote_model": "glm-5",
                    "remote_host": "https://ollama.com:443"
                },
                {
                    "name": "glm-4.7-flash:latest"
                }
            ]
        }))
        .expect("models should parse");

        assert_eq!(models.len(), 3);
        assert_eq!(models[0].id, "gpt-oss:20b");
        assert_eq!(models[0].deployment, Some(ModelDeployment::Local));
        assert_eq!(models[1].id, "glm-5:cloud");
        assert_eq!(models[1].deployment, Some(ModelDeployment::Cloud));
        assert_eq!(models[2].id, "glm-4.7-flash:latest");
        assert_eq!(models[2].deployment, Some(ModelDeployment::Local));
    }

    #[test]
    fn supports_live_models_is_only_enabled_for_ollama() {
        let ollama = test_ollama_provider("http://localhost:11434/v1/chat/completions".to_string());
        let openai = ProviderDef {
            id: "openai".to_string(),
            name: "OpenAI".to_string(),
            api_format: ApiFormat::Openai,
            base_url: "https://api.openai.com/v1/chat/completions".to_string(),
            auth: AuthConfig {
                auth_type: AuthType::Bearer,
                param_name: None,
                header_name: None,
                vault_key: "openai_api_key".to_string(),
            },
            default_model: "gpt-4o".to_string(),
            models: vec![ModelDef {
                id: "gpt-4o".to_string(),
                name: "GPT-4o".to_string(),
                deployment: None,
            }],
            extra_headers: HashMap::new(),
            custom: false,
        };

        assert!(supports_live_models(&ollama));
        assert!(!supports_live_models(&openai));
    }

    #[tokio::test]
    async fn resolve_provider_models_falls_back_to_static_when_live_lookup_fails() {
        let provider = ProviderDef {
            id: "ollama".to_string(),
            name: "Ollama".to_string(),
            api_format: ApiFormat::Openai,
            base_url: "http://127.0.0.1:9/v1/chat/completions".to_string(),
            auth: AuthConfig {
                auth_type: AuthType::None,
                param_name: None,
                header_name: None,
                vault_key: "ollama_api_key".to_string(),
            },
            default_model: "qwen3:8b".to_string(),
            models: vec![ModelDef {
                id: "qwen3:8b".to_string(),
                name: "Qwen 3 8B".to_string(),
                deployment: Some(ModelDeployment::Local),
            }],
            extra_headers: HashMap::new(),
            custom: false,
        };

        let resolved = resolve_provider_models(&provider).await;
        assert_eq!(resolved.source, LiveModelSource::StaticFallback);
        assert_eq!(resolved.models.len(), 1);
        assert_eq!(resolved.models[0].id, "qwen3:8b");
    }

    #[test]
    fn sort_live_models_orders_local_before_cloud() {
        let filtered = sort_live_models(vec![
            ModelDef {
                id: "gpt-oss:20b".to_string(),
                name: "gpt-oss:20b".to_string(),
                deployment: Some(ModelDeployment::Local),
            },
            ModelDef {
                id: "glm-5:cloud".to_string(),
                name: "glm-5:cloud".to_string(),
                deployment: Some(ModelDeployment::Cloud),
            },
            ModelDef {
                id: "qwen3-coder:480b-cloud".to_string(),
                name: "qwen3-coder:480b-cloud".to_string(),
                deployment: Some(ModelDeployment::Cloud),
            },
            ModelDef {
                id: "glm-4.7-flash:latest".to_string(),
                name: "glm-4.7-flash:latest".to_string(),
                deployment: Some(ModelDeployment::Local),
            },
        ]);

        assert_eq!(filtered[0].id, "glm-4.7-flash:latest");
        assert_eq!(filtered[1].id, "gpt-oss:20b");
        assert_eq!(filtered[2].id, "glm-5:cloud");
        assert_eq!(filtered[3].id, "qwen3-coder:480b-cloud");
    }
}
