use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use moxxy_types::TokenScope;
use std::sync::Arc;

use crate::auth_extractor::{AuthToken, check_scope};
use crate::state::AppState;

pub async fn list_webhooks(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(agent_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsRead)?;

    tracing::debug!(agent_id = %agent_id, "Listing webhooks");
    let db = state.db.lock().unwrap();
    let webhooks = db.webhooks().find_by_agent(&agent_id).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": "Database error"})),
        )
    })?;

    let result: Vec<serde_json::Value> = webhooks
        .iter()
        .map(|w| {
            serde_json::json!({
                "id": w.id,
                "agent_id": w.agent_id,
                "label": w.label,
                "url": w.url,
                "event_filter": w.event_filter,
                "enabled": w.enabled,
                "retry_count": w.retry_count,
                "timeout_seconds": w.timeout_seconds,
                "created_at": w.created_at,
                "updated_at": w.updated_at,
            })
        })
        .collect();

    Ok(Json(serde_json::json!(result)))
}

pub async fn delete_webhook(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path((_agent_id, webhook_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsWrite)?;

    tracing::info!(webhook_id = %webhook_id, "Deleting webhook");
    let db = state.db.lock().unwrap();
    db.webhooks().delete(&webhook_id).map_err(|e| match e {
        moxxy_types::StorageError::NotFound => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "not_found", "message": "Webhook not found"})),
        ),
        _ => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": "Database error"})),
        ),
    })?;

    Ok(Json(
        serde_json::json!({"status": "deleted", "id": webhook_id}),
    ))
}

pub async fn list_deliveries(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path((_agent_id, webhook_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsRead)?;

    tracing::debug!(webhook_id = %webhook_id, "Listing webhook deliveries");
    let db = state.db.lock().unwrap();
    let deliveries = db
        .webhook_deliveries()
        .find_by_webhook(&webhook_id)
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal", "message": "Database error"})),
            )
        })?;

    let result: Vec<serde_json::Value> = deliveries
        .iter()
        .map(|d| {
            serde_json::json!({
                "id": d.id,
                "webhook_id": d.webhook_id,
                "event_id": d.event_id,
                "status": d.status,
                "response_status": d.response_status,
                "attempt": d.attempt,
                "error": d.error,
                "delivered_at": d.delivered_at,
                "created_at": d.created_at,
            })
        })
        .collect();

    Ok(Json(serde_json::json!(result)))
}
