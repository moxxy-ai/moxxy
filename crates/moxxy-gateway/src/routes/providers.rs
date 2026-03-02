use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use moxxy_storage::{ProviderModelRow, ProviderRow};
use moxxy_types::TokenScope;
use std::sync::Arc;

use crate::auth_extractor::{AuthToken, check_scope};
use crate::state::AppState;

#[derive(serde::Deserialize)]
pub struct ProviderInstallRequest {
    pub id: String,
    pub display_name: String,
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

    let now = chrono::Utc::now().to_rfc3339();

    let row = ProviderRow {
        id: body.id.clone(),
        display_name: body.display_name.clone(),
        manifest_path: format!("builtin://{}", body.id),
        signature: None,
        enabled: true,
        created_at: now,
    };

    let db = state.db.lock().unwrap();

    // Upsert: delete existing provider (cascades models) then re-insert
    let _ = db.providers().delete(&body.id);
    db.providers().insert(&row).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": format!("Failed to install provider: {}", e)})),
        )
    })?;

    // Insert models
    for model in &body.models {
        let model_row = ProviderModelRow {
            provider_id: body.id.clone(),
            model_id: model.model_id.clone(),
            display_name: model.display_name.clone(),
            metadata_json: model
                .metadata
                .as_ref()
                .map(|m| serde_json::to_string(m).unwrap_or_default()),
        };
        db.providers().insert_model(&model_row).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal", "message": format!("Failed to add model: {}", e)})),
            )
        })?;
    }

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

    let db = state.db.lock().unwrap();
    let providers = db.providers().list_all().map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": "Database error"})),
        )
    })?;

    let result: Vec<serde_json::Value> = providers
        .iter()
        .map(|p| {
            serde_json::json!({
                "id": p.id,
                "display_name": p.display_name,
                "enabled": p.enabled,
                "created_at": p.created_at
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

    let db = state.db.lock().unwrap();
    let models = db.providers().list_models(&id).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": "Database error"})),
        )
    })?;

    let result: Vec<serde_json::Value> = models
        .iter()
        .map(|m| {
            serde_json::json!({
                "provider_id": m.provider_id,
                "model_id": m.model_id,
                "display_name": m.display_name,
                "metadata": m.metadata_json.as_deref()
                    .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
            })
        })
        .collect();

    Ok(Json(serde_json::json!(result)))
}
