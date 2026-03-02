use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use moxxy_core::HeartbeatScheduler;
use moxxy_storage::HeartbeatRow;
use moxxy_types::TokenScope;
use std::sync::Arc;

use crate::auth_extractor::{AuthToken, check_scope};
use crate::state::AppState;

#[derive(serde::Deserialize)]
pub struct HeartbeatCreateRequest {
    pub interval_minutes: Option<i32>,
    pub cron_expr: Option<String>,
    pub timezone: Option<String>,
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
    let timezone = body.timezone.as_deref().unwrap_or("UTC").to_string();

    // Validate: exactly one of interval_minutes or cron_expr must be provided
    let (interval_minutes, cron_expr, next_run_at) = match (&body.interval_minutes, &body.cron_expr)
    {
        (Some(mins), None) => {
            if *mins < 1 {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(
                        serde_json::json!({"error": "bad_request", "message": "interval_minutes must be >= 1"}),
                    ),
                ));
            }
            let next = now + chrono::Duration::minutes(*mins as i64);
            (*mins, None, next.to_rfc3339())
        }
        (None, Some(expr)) => {
            // Validate cron expression
            if let Err(e) = HeartbeatScheduler::validate_cron_expr(expr) {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({"error": "bad_request", "message": e.to_string()})),
                ));
            }
            // Validate timezone
            if let Err(e) = HeartbeatScheduler::validate_timezone(&timezone) {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({"error": "bad_request", "message": e.to_string()})),
                ));
            }
            let next_run = HeartbeatScheduler::compute_next_cron_run(expr, &timezone, now)
                .map_err(|e| {
                    (
                        StatusCode::BAD_REQUEST,
                        Json(serde_json::json!({"error": "bad_request", "message": e.to_string()})),
                    )
                })?;
            (0, Some(expr.clone()), next_run)
        }
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "bad_request",
                    "message": "Exactly one of interval_minutes or cron_expr must be provided"
                })),
            ));
        }
    };

    let id = uuid::Uuid::now_v7().to_string();

    let row = HeartbeatRow {
        id: id.clone(),
        agent_id: agent_id.clone(),
        interval_minutes,
        action_type: body.action_type.clone(),
        action_payload: body.action_payload.clone(),
        enabled: true,
        next_run_at: next_run_at.clone(),
        cron_expr: cron_expr.clone(),
        timezone: timezone.clone(),
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
            "interval_minutes": interval_minutes,
            "cron_expr": cron_expr,
            "timezone": timezone,
            "action_type": body.action_type,
            "action_payload": body.action_payload,
            "enabled": true,
            "next_run_at": next_run_at,
            "created_at": now.to_rfc3339()
        })),
    ))
}

pub async fn disable_heartbeat(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path((agent_id, hb_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsWrite)?;

    let db = state.db.lock().unwrap();
    db.heartbeats().disable(&hb_id).map_err(|e| match e {
        moxxy_types::StorageError::NotFound => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "not_found", "message": "Heartbeat not found"})),
        ),
        _ => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": "Database error"})),
        ),
    })?;

    Ok(Json(serde_json::json!({
        "message": "Heartbeat disabled",
        "agent_id": agent_id,
        "heartbeat_id": hb_id
    })))
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
        .filter(|h| h.enabled)
        .map(|h| {
            serde_json::json!({
                "id": h.id,
                "agent_id": h.agent_id,
                "interval_minutes": h.interval_minutes,
                "cron_expr": h.cron_expr,
                "timezone": h.timezone,
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
