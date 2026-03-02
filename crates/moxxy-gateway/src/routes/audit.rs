use axum::Json;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use moxxy_types::TokenScope;
use std::sync::Arc;

use crate::auth_extractor::{AuthToken, check_scope};
use crate::state::AppState;

#[derive(serde::Deserialize)]
pub struct AuditLogQuery {
    pub agent_id: Option<String>,
    pub event_type: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

pub async fn list_audit_logs(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Query(query): Query<AuditLogQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::EventsRead)?;

    let limit = query.limit.unwrap_or(50).clamp(1, 100);
    let offset = query.offset.unwrap_or(0).max(0);

    let db = state.db.lock().unwrap();

    let events = if let Some(ref agent_id) = query.agent_id {
        db.events().find_by_agent(agent_id).map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal", "message": "Database error"})),
            )
        })?
    } else {
        db.events().list_all().map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal", "message": "Database error"})),
            )
        })?
    };

    // Apply event_type filter if provided
    let filtered: Vec<_> = events
        .into_iter()
        .filter(|e| {
            query
                .event_type
                .as_ref()
                .is_none_or(|et| e.event_type == *et)
        })
        .collect();

    let total = filtered.len() as i64;

    let page: Vec<serde_json::Value> = filtered
        .into_iter()
        .skip(offset as usize)
        .take(limit as usize)
        .map(|e| {
            serde_json::json!({
                "event_id": e.event_id,
                "ts": e.ts,
                "agent_id": e.agent_id,
                "run_id": e.run_id,
                "sequence": e.sequence,
                "event_type": e.event_type,
                "payload": e.payload_json.and_then(|p| serde_json::from_str::<serde_json::Value>(&p).ok()),
                "sensitive": e.sensitive,
                "created_at": e.created_at,
            })
        })
        .collect();

    Ok(Json(serde_json::json!({
        "data": page,
        "pagination": {
            "limit": limit,
            "offset": offset,
            "total": total,
        }
    })))
}
