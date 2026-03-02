use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use moxxy_types::TokenScope;
use std::sync::Arc;

use crate::auth_extractor::{check_scope, AuthToken};
use crate::state::AppState;

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
