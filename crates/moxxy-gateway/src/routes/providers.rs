use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use moxxy_core::{ProviderDoc, ProviderLoader, ProviderModelEntry, ProviderStore};
use moxxy_types::TokenScope;
use std::sync::Arc;

use crate::auth_extractor::{AuthToken, check_scope};
use crate::state::AppState;

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
        Some(p) => p.doc.models,
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
