use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use moxxy_storage::AgentRow;
use moxxy_types::TokenScope;
use std::sync::Arc;

use crate::auth_extractor::{AuthToken, check_scope};
use crate::state::AppState;

#[derive(serde::Deserialize)]
pub struct AgentCreateRequest {
    pub provider_id: String,
    pub model_id: String,
    pub workspace_root: String,
    pub policy_profile: Option<String>,
    #[serde(default = "default_temperature")]
    pub temperature: f64,
    #[serde(default = "default_max_depth")]
    pub max_subagent_depth: i32,
    #[serde(default = "default_max_total")]
    pub max_subagents_total: i32,
}

fn default_temperature() -> f64 {
    0.7
}
fn default_max_depth() -> i32 {
    2
}
fn default_max_total() -> i32 {
    8
}

type ValidationError = (StatusCode, Json<serde_json::Value>);

impl AgentCreateRequest {
    fn validate(&self) -> Result<(), ValidationError> {
        if self.workspace_root.is_empty()
            || !std::path::Path::new(&self.workspace_root).is_absolute()
        {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "validation",
                    "message": "workspace_root must be an absolute path"
                })),
            ));
        }
        if !(0.0..=2.0).contains(&self.temperature) {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "validation",
                    "message": "temperature must be between 0.0 and 2.0"
                })),
            ));
        }
        if self.max_subagent_depth < 0 || self.max_subagent_depth > 10 {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "validation",
                    "message": "max_subagent_depth must be between 0 and 10"
                })),
            ));
        }
        if self.max_subagents_total < 0 || self.max_subagents_total > 100 {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "validation",
                    "message": "max_subagents_total must be between 0 and 100"
                })),
            ));
        }
        Ok(())
    }
}

#[derive(serde::Deserialize)]
pub struct RunStartRequest {
    pub task: String,
}

impl RunStartRequest {
    fn validate(&self) -> Result<(), ValidationError> {
        if self.task.is_empty() {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "validation",
                    "message": "task must not be empty"
                })),
            ));
        }
        if self.task.len() > 100 * 1024 {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "validation",
                    "message": "task must not exceed 100KB"
                })),
            ));
        }
        Ok(())
    }
}

pub async fn list_agents(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsRead)?;

    let db = state.db.lock().unwrap();
    let agents = db.agents().list_all().map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": "Database error"})),
        )
    })?;

    let result: Vec<serde_json::Value> = agents
        .iter()
        .map(|a| {
            serde_json::json!({
                "id": a.id,
                "provider_id": a.provider_id,
                "model_id": a.model_id,
                "status": a.status,
                "workspace_root": a.workspace_root,
                "created_at": a.created_at
            })
        })
        .collect();

    Ok(Json(serde_json::json!(result)))
}

pub async fn create_agent(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Json(body): Json<AgentCreateRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsWrite)?;
    body.validate()?;

    let now = chrono::Utc::now().to_rfc3339();
    let id = uuid::Uuid::now_v7().to_string();

    let row = AgentRow {
        id: id.clone(),
        parent_agent_id: None,
        provider_id: body.provider_id.clone(),
        model_id: body.model_id.clone(),
        workspace_root: body.workspace_root.clone(),
        core_mount: None,
        policy_profile: body.policy_profile.clone(),
        temperature: body.temperature,
        max_subagent_depth: body.max_subagent_depth,
        max_subagents_total: body.max_subagents_total,
        status: "idle".into(),
        depth: 0,
        spawned_total: 0,
        created_at: now.clone(),
        updated_at: now.clone(),
    };

    let db = state.db.lock().unwrap();
    db.agents().insert(&row).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": "Failed to create agent"})),
        )
    })?;

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": id,
            "provider_id": body.provider_id,
            "model_id": body.model_id,
            "status": "idle",
            "workspace_root": body.workspace_root,
            "created_at": now
        })),
    ))
}

pub async fn get_agent(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsRead)?;

    let db = state.db.lock().unwrap();
    let agent = db
        .agents()
        .find_by_id(&id)
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal", "message": "Database error"})),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "not_found", "message": "Agent not found"})),
            )
        })?;

    Ok(Json(serde_json::json!({
        "id": agent.id,
        "provider_id": agent.provider_id,
        "model_id": agent.model_id,
        "status": agent.status,
        "workspace_root": agent.workspace_root,
        "created_at": agent.created_at
    })))
}

pub async fn start_run(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(id): Path<String>,
    Json(body): Json<RunStartRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::RunsWrite)?;
    body.validate()?;

    let run_id = state
        .run_service
        .do_start_run(&id, &body.task)
        .await
        .map_err(|e| {
            let status = if e.contains("not found") {
                StatusCode::NOT_FOUND
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            };
            (
                status,
                Json(serde_json::json!({"error": "internal", "message": e})),
            )
        })?;

    Ok(Json(serde_json::json!({
        "agent_id": id,
        "run_id": run_id,
        "task": body.task,
        "status": "running"
    })))
}

pub async fn stop_run(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::RunsWrite)?;

    let db = state.db.lock().unwrap();
    let agent = db
        .agents()
        .find_by_id(&id)
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal", "message": "Database error"})),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "not_found", "message": "Agent not found"})),
            )
        })?;

    db.agents().update_status(&agent.id, "idle").map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": "Failed to update status"})),
        )
    })?;

    Ok(Json(serde_json::json!({
        "agent_id": agent.id,
        "status": "idle"
    })))
}

pub async fn spawn_subagent(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(parent_id): Path<String>,
    Json(body): Json<AgentCreateRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsWrite)?;

    let db = state.db.lock().unwrap();
    let parent = db
        .agents()
        .find_by_id(&parent_id)
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal", "message": "Database error"})),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(
                    serde_json::json!({"error": "not_found", "message": "Parent agent not found"}),
                ),
            )
        })?;

    // Enforce lineage limits
    let lineage = moxxy_core::AgentLineage {
        root_agent_id: parent
            .parent_agent_id
            .clone()
            .unwrap_or_else(|| parent.id.clone()),
        current_depth: parent.depth as u32,
        max_depth: parent.max_subagent_depth as u32,
        spawned_total: parent.spawned_total as u32,
        max_total: parent.max_subagents_total as u32,
    };

    if !lineage.can_spawn() {
        return Err((
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "error": "spawn_limit",
                "message": format!(
                    "Cannot spawn subagent: depth={}/{}, total={}/{}",
                    lineage.current_depth, lineage.max_depth,
                    lineage.spawned_total, lineage.max_total
                )
            })),
        ));
    }

    let now = chrono::Utc::now().to_rfc3339();
    let id = uuid::Uuid::now_v7().to_string();

    let row = AgentRow {
        id: id.clone(),
        parent_agent_id: Some(parent_id.clone()),
        provider_id: body.provider_id.clone(),
        model_id: body.model_id.clone(),
        workspace_root: body.workspace_root.clone(),
        core_mount: None,
        policy_profile: body.policy_profile.clone(),
        temperature: body.temperature,
        max_subagent_depth: body.max_subagent_depth,
        max_subagents_total: body.max_subagents_total,
        status: "idle".into(),
        depth: parent.depth + 1,
        spawned_total: 0,
        created_at: now.clone(),
        updated_at: now.clone(),
    };

    db.agents().insert(&row).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": "Failed to create sub-agent"})),
        )
    })?;

    // Increment parent's spawned_total
    db.agents()
        .increment_spawned_total(&parent_id)
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(
                    serde_json::json!({"error": "internal", "message": "Failed to update parent"}),
                ),
            )
        })?;

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": id,
            "parent_agent_id": parent.id,
            "provider_id": body.provider_id,
            "model_id": body.model_id,
            "status": "idle",
            "depth": parent.depth + 1,
            "created_at": now
        })),
    ))
}
