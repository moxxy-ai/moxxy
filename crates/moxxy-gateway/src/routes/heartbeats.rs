use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use moxxy_storage::HeartbeatRow;
use moxxy_types::TokenScope;
use std::sync::Arc;

use crate::auth_extractor::{check_scope, AuthToken};
use crate::state::AppState;

#[derive(serde::Deserialize)]
pub struct HeartbeatCreateRequest {
    pub interval_minutes: i32,
    pub action_type: String,
    pub action_payload: Option<String>,
}

pub async fn create_heartbeat(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(agent_id): Path<String>,
    Json(body): Json<HeartbeatCreateRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsWrite)?;

    let now = chrono::Utc::now();
    let next_run = now + chrono::Duration::minutes(body.interval_minutes as i64);
    let id = uuid::Uuid::now_v7().to_string();

    let row = HeartbeatRow {
        id: id.clone(),
        agent_id: agent_id.clone(),
        interval_minutes: body.interval_minutes,
        action_type: body.action_type.clone(),
        action_payload: body.action_payload.clone(),
        enabled: true,
        next_run_at: next_run.to_rfc3339(),
        created_at: now.to_rfc3339(),
        updated_at: now.to_rfc3339(),
    };

    let db = state.db.lock().unwrap();
    db.heartbeats().insert(&row).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": "Failed to create heartbeat"})),
        )
    })?;

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": id,
            "agent_id": agent_id,
            "interval_minutes": body.interval_minutes,
            "action_type": body.action_type,
            "action_payload": body.action_payload,
            "enabled": true,
            "next_run_at": next_run.to_rfc3339(),
            "created_at": now.to_rfc3339()
        })),
    ))
}

pub async fn list_heartbeats(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(agent_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsRead)?;

    let db = state.db.lock().unwrap();
    let heartbeats = db.heartbeats().find_by_agent(&agent_id).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": "Database error"})),
        )
    })?;

    let result: Vec<serde_json::Value> = heartbeats
        .iter()
        .map(|h| {
            serde_json::json!({
                "id": h.id,
                "agent_id": h.agent_id,
                "interval_minutes": h.interval_minutes,
                "action_type": h.action_type,
                "action_payload": h.action_payload,
                "enabled": h.enabled,
                "next_run_at": h.next_run_at,
                "created_at": h.created_at
            })
        })
        .collect();

    Ok(Json(serde_json::json!(result)))
}
