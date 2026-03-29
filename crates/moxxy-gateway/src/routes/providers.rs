use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use moxxy_core::{ProviderDoc, ProviderLoader, ProviderModelEntry, ProviderStore};
use moxxy_types::TokenScope;
use std::sync::Arc;

use crate::auth_extractor::{AuthToken, check_scope};
use crate::state::AppState;

const OLLAMA_DEFAULT_API_BASE: &str = "http://127.0.0.1:11434/v1";

fn is_ollama_provider(doc: &ProviderDoc) -> bool {
    doc.id == "ollama"
}

fn ollama_api_base(doc: &ProviderDoc) -> String {
    doc.api_base
        .clone()
        .or_else(|| doc.models.iter().find_map(|model| model.api_base.clone()))
        .unwrap_or_else(|| OLLAMA_DEFAULT_API_BASE.to_string())
}

fn build_ollama_discovery_urls(api_base: &str) -> Vec<String> {
    let base = api_base.trim_end_matches('/');
    let normalized = if let Some(stripped) = base.strip_suffix("/chat/completions") {
        stripped.to_string()
    } else if let Some(stripped) = base.strip_suffix("/models") {
        stripped.to_string()
    } else {
        base.to_string()
    };
    let mut bases = vec![normalized];
    if let Ok(parsed) = reqwest::Url::parse(api_base) {
        let mut alternate = parsed.clone();
        match parsed.host_str() {
            Some("localhost") => {
                let _ = alternate.set_host(Some("127.0.0.1"));
            }
            Some("127.0.0.1") => {
                let _ = alternate.set_host(Some("localhost"));
            }
            _ => {}
        }
        let alt_str = alternate.to_string().trim_end_matches('/').to_string();
        let alt_normalized = if let Some(stripped) = alt_str.strip_suffix("/chat/completions") {
            stripped.to_string()
        } else if let Some(stripped) = alt_str.strip_suffix("/models") {
            stripped.to_string()
        } else {
            alt_str
        };
        if !bases.contains(&alt_normalized) {
            bases.push(alt_normalized);
        }
    }

    let mut urls = Vec::new();
    for base in bases {
        let legacy = base.strip_suffix("/v1").unwrap_or(&base).to_string();
        let openai_url = format!("{base}/models");
        if !urls.contains(&openai_url) {
            urls.push(openai_url);
        }

        let legacy_url = format!("{legacy}/api/tags");
        if !urls.contains(&legacy_url) {
            urls.push(legacy_url);
        }
    }
    urls
}

fn parse_ollama_models_payload(
    payload: &serde_json::Value,
    api_base: &str,
) -> Vec<ProviderModelEntry> {
    let rows = payload
        .get("models")
        .and_then(|value| value.as_array())
        .or_else(|| payload.get("data").and_then(|value| value.as_array()));

    let Some(rows) = rows else {
        return Vec::new();
    };

    let mut entries = rows
        .iter()
        .filter_map(|row| {
            let id = row
                .get("id")
                .and_then(|value| value.as_str())
                .or_else(|| row.get("name").and_then(|value| value.as_str()))
                .map(str::trim)
                .filter(|value| !value.is_empty())?;

            let display_name = row
                .get("name")
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or(id);

            Some(ProviderModelEntry {
                id: id.to_string(),
                display_name: display_name.to_string(),
                api_base: Some(api_base.to_string()),
                chatgpt_account_id: None,
            })
        })
        .collect::<Vec<_>>();

    entries.sort_by(|left, right| {
        left.display_name
            .to_lowercase()
            .cmp(&right.display_name.to_lowercase())
    });
    entries.dedup_by(|left, right| left.id == right.id);
    entries
}

async fn fetch_live_ollama_models(doc: &ProviderDoc) -> Vec<ProviderModelEntry> {
    if !is_ollama_provider(doc) {
        return Vec::new();
    }

    let api_base = ollama_api_base(doc);
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(1))
        .build()
    {
        Ok(client) => client,
        Err(_) => return Vec::new(),
    };

    for url in build_ollama_discovery_urls(&api_base) {
        let Ok(response) = client.get(&url).send().await else {
            continue;
        };
        if !response.status().is_success() {
            continue;
        }

        let Ok(payload) = response.json::<serde_json::Value>().await else {
            continue;
        };
        let models = parse_ollama_models_payload(&payload, &api_base);
        if !models.is_empty() {
            return models;
        }
    }

    Vec::new()
}

#[derive(serde::Deserialize)]
pub struct ProviderInstallRequest {
    pub id: String,
    pub display_name: String,
    pub api_base: Option<String>,
    #[serde(default)]
    pub models: Vec<ModelEntry>,
}

#[derive(serde::Deserialize)]
pub struct ModelEntry {
    pub model_id: String,
    pub display_name: String,
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
}

pub async fn install_provider(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Json(body): Json<ProviderInstallRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsWrite)?;

    tracing::info!(provider_id = %body.id, display_name = %body.display_name, models_count = body.models.len(), "Installing provider");

    let models: Vec<ProviderModelEntry> = body
        .models
        .iter()
        .map(|m| {
            let metadata = m.metadata.as_ref();
            let api_base = metadata
                .and_then(|md| md.get("api_base"))
                .and_then(|v| v.as_str())
                .map(String::from);
            let chatgpt_account_id = metadata
                .and_then(|md| md.get("chatgpt_account_id"))
                .and_then(|v| v.as_str())
                .map(String::from);
            ProviderModelEntry {
                id: m.model_id.clone(),
                display_name: m.display_name.clone(),
                api_base,
                chatgpt_account_id,
            }
        })
        .collect();

    let doc = ProviderDoc {
        id: body.id.clone(),
        display_name: body.display_name.clone(),
        enabled: true,
        secret_ref: None,
        api_base: body.api_base.clone(),
        models,
    };

    ProviderStore::create(&state.moxxy_home, &doc).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": format!("Failed to install provider: {}", e)})),
        )
    })?;

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": body.id,
            "display_name": body.display_name,
            "models_count": body.models.len(),
            "enabled": true
        })),
    ))
}

pub async fn list_providers(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsRead)?;

    tracing::debug!("Listing providers");
    let loaded = ProviderLoader::load_all(&state.moxxy_home);

    let result: Vec<serde_json::Value> = loaded
        .iter()
        .map(|p| {
            serde_json::json!({
                "id": p.doc.id,
                "display_name": p.doc.display_name,
                "enabled": p.doc.enabled,
                "api_base": p.doc.api_base,
            })
        })
        .collect();

    Ok(Json(serde_json::json!(result)))
}

pub async fn list_models(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsRead)?;

    tracing::debug!(provider_id = %id, "Listing provider models");
    let loaded = ProviderLoader::load(&state.moxxy_home, &id);

    let models = match loaded {
        Some(provider) => {
            let live_models = fetch_live_ollama_models(&provider.doc).await;
            if live_models.is_empty() {
                provider.doc.models
            } else {
                live_models
            }
        }
        None => vec![],
    };

    let result: Vec<serde_json::Value> = models
        .iter()
        .map(|m| {
            let mut metadata = serde_json::Map::new();
            if let Some(ref base) = m.api_base {
                metadata.insert("api_base".into(), serde_json::json!(base));
            }
            if let Some(ref acct) = m.chatgpt_account_id {
                metadata.insert("chatgpt_account_id".into(), serde_json::json!(acct));
            }
            serde_json::json!({
                "provider_id": id,
                "model_id": m.id,
                "display_name": m.display_name,
                "metadata": if metadata.is_empty() { serde_json::Value::Null } else { serde_json::Value::Object(metadata) }
            })
        })
        .collect();

    Ok(Json(serde_json::json!(result)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ollama_doc(api_base: &str) -> ProviderDoc {
        ProviderDoc {
            id: "ollama".into(),
            display_name: "Ollama".into(),
            enabled: true,
            secret_ref: None,
            api_base: None,
            models: vec![ProviderModelEntry {
                id: "qwen3:8b".into(),
                display_name: "Qwen 3 8B".into(),
                api_base: Some(api_base.into()),
                chatgpt_account_id: None,
            }],
        }
    }

    #[test]
    fn build_ollama_discovery_urls_supports_openai_and_legacy_paths() {
        let urls = build_ollama_discovery_urls("http://localhost:11434/v1");
        assert_eq!(urls[0], "http://localhost:11434/v1/models");
        assert!(urls.contains(&"http://localhost:11434/api/tags".to_string()));
        assert!(urls.contains(&"http://127.0.0.1:11434/v1/models".to_string()));
        assert!(urls.contains(&"http://127.0.0.1:11434/api/tags".to_string()));
    }

    #[test]
    fn parse_ollama_models_payload_reads_openai_compatible_models() {
        let models = parse_ollama_models_payload(
            &serde_json::json!({
                "models": [
                    { "id": "gpt-oss:20b", "name": "GPT OSS 20B" },
                    { "name": "gemma3" }
                ]
            }),
            "http://localhost:11434/v1",
        );

        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "gemma3");
        assert_eq!(models[0].display_name, "gemma3");
        assert_eq!(models[1].id, "gpt-oss:20b");
        assert_eq!(models[1].display_name, "GPT OSS 20B");
        assert_eq!(
            models[0].api_base.as_deref(),
            Some("http://localhost:11434/v1")
        );
    }

    #[tokio::test]
    async fn fetch_live_ollama_models_falls_back_cleanly_when_server_is_unreachable() {
        let models = fetch_live_ollama_models(&ollama_doc("http://127.0.0.1:9/v1")).await;
        assert!(models.is_empty());
    }
}
