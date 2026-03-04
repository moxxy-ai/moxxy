use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use moxxy_core::{
    HeartbeatEntry, HeartbeatScheduler, heartbeat_path, mutate_heartbeat_file, read_heartbeat_file,
};
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

    tracing::info!(
        agent_id = %agent_id,
        action_type = %body.action_type,
        has_cron = body.cron_expr.is_some(),
        interval = ?body.interval_minutes,
        "Creating heartbeat"
    );

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
            (Some(*mins), None, next.to_rfc3339())
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
            (None, Some(expr.clone()), next_run)
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

    let entry = HeartbeatEntry {
        id: id.clone(),
        action_type: body.action_type.clone(),
        action_payload: body.action_payload.clone(),
        interval_minutes,
        cron_expr: cron_expr.clone(),
        timezone: timezone.clone(),
        enabled: true,
        next_run_at: next_run_at.clone(),
        created_at: now.to_rfc3339(),
        updated_at: now.to_rfc3339(),
    };

    let path = heartbeat_path(&state.moxxy_home, &agent_id);
    mutate_heartbeat_file(&path, |f| {
        f.entries.push(entry);
    })
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": format!("Failed to create heartbeat: {e}")})),
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

    tracing::info!(agent_id = %agent_id, heartbeat_id = %hb_id, "Disabling heartbeat");

    let path = heartbeat_path(&state.moxxy_home, &agent_id);
    let hb_id_clone = hb_id.clone();
    let file = mutate_heartbeat_file(&path, |f| {
        if let Some(entry) = f.entries.iter_mut().find(|e| e.id == hb_id_clone) {
            entry.enabled = false;
            entry.updated_at = chrono::Utc::now().to_rfc3339();
        }
    })
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": "Database error"})),
        )
    })?;

    if !file.entries.iter().any(|e| e.id == hb_id) {
        return Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "not_found", "message": "Heartbeat not found"})),
        ));
    }

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

    tracing::debug!(agent_id = %agent_id, "Listing heartbeats");

    let path = heartbeat_path(&state.moxxy_home, &agent_id);
    let file = read_heartbeat_file(&path).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": "File read error"})),
        )
    })?;

    let result: Vec<serde_json::Value> = file
        .entries
        .iter()
        .filter(|h| h.enabled)
        .map(|h| {
            serde_json::json!({
                "id": h.id,
                "agent_id": agent_id,
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
