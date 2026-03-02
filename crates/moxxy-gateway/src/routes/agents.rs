use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use moxxy_storage::{AgentRow, AllowlistRow};
use moxxy_types::TokenScope;
use std::sync::Arc;

use crate::auth_extractor::{AuthToken, check_scope};
use crate::state::AppState;

// Tracing is used via the tracing::info!/warn!/error! macros throughout this module.

#[derive(serde::Deserialize)]
pub struct AgentCreateRequest {
    pub name: String,
    pub provider_id: String,
    pub model_id: String,
    pub persona: Option<String>,
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

fn is_valid_agent_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && name
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
}

impl AgentCreateRequest {
    fn validate(&self) -> Result<(), ValidationError> {
        if !is_valid_agent_name(&self.name) {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "validation",
                    "message": "name must be 1-64 chars, lowercase alphanumeric + hyphens, starting with alphanumeric"
                })),
            ));
        }
        if let Some(ref persona) = self.persona
            && persona.len() > 10 * 1024
        {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "validation",
                    "message": "persona must not exceed 10KB"
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
                "name": a.name,
                "provider_id": a.provider_id,
                "model_id": a.model_id,
                "status": a.status,
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

    tracing::info!(
        name = %body.name,
        provider = %body.provider_id,
        model = %body.model_id,
        "Creating agent"
    );

    let now = chrono::Utc::now().to_rfc3339();
    let id = uuid::Uuid::now_v7().to_string();

    // Compute workspace root from moxxy_home (keyed by agent ID, not name)
    let agent_dir = state.moxxy_home.join("agents").join(&id);
    let workspace_root = agent_dir.to_string_lossy().to_string();

    // Create agent directories
    let workspace_dir = agent_dir.join("workspace");
    let memory_dir = agent_dir.join("memory");
    std::fs::create_dir_all(&workspace_dir).ok();
    std::fs::create_dir_all(&memory_dir).ok();

    let row = AgentRow {
        id: id.clone(),
        parent_agent_id: None,
        provider_id: body.provider_id.clone(),
        model_id: body.model_id.clone(),
        workspace_root,
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
        name: Some(body.name.clone()),
        persona: body.persona.clone(),
    };

    let db = state.db.lock().unwrap();
    db.agents().insert(&row).map_err(|e| {
        if e.to_string().contains("UNIQUE") || e.to_string().contains("Duplicate") {
            (
                StatusCode::CONFLICT,
                Json(serde_json::json!({"error": "conflict", "message": format!("Agent name '{}' already exists", body.name)})),
            )
        } else {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal", "message": "Failed to create agent"})),
            )
        }
    })?;

    // Seed default shell command allowlist
    for cmd in &[
        "ls",
        "cat",
        "grep",
        "find",
        "echo",
        "wc",
        // OS X computer-control commands
        "osascript",
        "screencapture",
        "open",
        "pbcopy",
        "pbpaste",
        "defaults",
        "pmset",
        "say",
        "networksetup",
        "system_profiler",
        "mdls",
        "mdfind",
        "killall",
    ] {
        let _ = db.allowlists().insert(&AllowlistRow {
            id: uuid::Uuid::now_v7().to_string(),
            agent_id: id.clone(),
            list_type: "shell_command".into(),
            entry: cmd.to_string(),
            created_at: now.clone(),
        });
    }

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": id,
            "name": body.name,
            "provider_id": body.provider_id,
            "model_id": body.model_id,
            "persona": body.persona,
            "status": "idle",
            "created_at": now
        })),
    ))
}

#[derive(serde::Deserialize)]
pub struct AgentUpdateRequest {
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    #[serde(default)]
    pub temperature: Option<f64>,
    pub persona: Option<String>,
}

impl AgentUpdateRequest {
    fn validate(&self) -> Result<(), ValidationError> {
        if let Some(t) = self.temperature
            && !(0.0..=2.0).contains(&t)
        {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "validation",
                    "message": "temperature must be between 0.0 and 2.0"
                })),
            ));
        }
        Ok(())
    }
}

pub async fn update_agent(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(id): Path<String>,
    Json(body): Json<AgentUpdateRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsWrite)?;
    body.validate()?;

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

    let new_provider = body.provider_id.as_deref().unwrap_or(&agent.provider_id);
    let new_model = body.model_id.as_deref().unwrap_or(&agent.model_id);
    let new_temperature = body.temperature.unwrap_or(agent.temperature);

    db.agents()
        .update_config(&id, new_provider, new_model, new_temperature)
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal", "message": "Failed to update agent"})),
            )
        })?;

    Ok(Json(serde_json::json!({
        "id": id,
        "name": agent.name,
        "provider_id": new_provider,
        "model_id": new_model,
        "temperature": new_temperature,
        "status": agent.status,
        "updated_at": chrono::Utc::now().to_rfc3339()
    })))
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
        "name": agent.name,
        "provider_id": agent.provider_id,
        "model_id": agent.model_id,
        "status": agent.status,
        "persona": agent.persona,
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

    tracing::info!(agent_id = %id, task_len = body.task.len(), "Starting run");

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

    tracing::info!(agent_id = %id, "Stopping run");

    // Verify agent exists first
    {
        let db = state.db.lock().unwrap();
        db.agents()
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
    }

    // Cancel the running executor and update status via RunService
    state.run_service.do_stop_agent(&id).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": e})),
        )
    })?;

    Ok(Json(serde_json::json!({
        "agent_id": id,
        "status": "idle"
    })))
}

#[derive(serde::Deserialize)]
pub struct AskResponseRequest {
    pub answer: String,
}

pub async fn respond_to_ask(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path((_agent_id, question_id)): Path<(String, String)>,
    Json(body): Json<AskResponseRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::RunsWrite)?;

    state
        .run_service
        .resolve_ask(&question_id, &body.answer)
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
        "question_id": question_id,
        "status": "answered"
    })))
}

#[derive(serde::Deserialize)]
pub struct SubagentSpawnRequest {
    pub provider_id: String,
    pub model_id: String,
    pub policy_profile: Option<String>,
    #[serde(default = "default_temperature")]
    pub temperature: f64,
    #[serde(default = "default_max_depth")]
    pub max_subagent_depth: i32,
    #[serde(default = "default_max_total")]
    pub max_subagents_total: i32,
}

pub async fn delete_agent(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsWrite)?;

    tracing::info!(agent_id = %id, "Deleting agent");

    // Stop any active run first
    let _ = state.run_service.do_stop_agent(&id);

    let db = state.db.lock().unwrap();
    db.agents().delete(&id).map_err(|e| match e {
        moxxy_types::StorageError::NotFound => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "not_found", "message": "Agent not found"})),
        ),
        _ => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": "Database error"})),
        ),
    })?;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn spawn_subagent(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(parent_id): Path<String>,
    Json(body): Json<SubagentSpawnRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsWrite)?;

    tracing::info!(parent_id = %parent_id, provider = %body.provider_id, model = %body.model_id, "Spawning subagent");

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
        tracing::warn!(
            parent_id = %parent_id,
            depth = lineage.current_depth,
            max_depth = lineage.max_depth,
            total = lineage.spawned_total,
            max_total = lineage.max_total,
            "Subagent spawn denied by lineage limits"
        );
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

    // Auto-generate name from parent name + short UUID
    let parent_name = parent.name.as_deref().unwrap_or(&parent.id);
    let short_id = &id[id.len() - 8..]; // last 8 hex chars (random portion of UUIDv7)
    let auto_name = format!("{}-sub-{}", parent_name, short_id);
    let agent_dir = state.moxxy_home.join("agents").join(&auto_name);
    let workspace_root = agent_dir.to_string_lossy().to_string();

    // Create agent directories
    std::fs::create_dir_all(agent_dir.join("workspace")).ok();
    std::fs::create_dir_all(agent_dir.join("memory")).ok();

    let row = AgentRow {
        id: id.clone(),
        parent_agent_id: Some(parent_id.clone()),
        provider_id: body.provider_id.clone(),
        model_id: body.model_id.clone(),
        workspace_root,
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
        name: Some(auto_name.clone()),
        persona: None,
    };

    db.agents().insert(&row).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal"})),
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

    // Inherit parent's allowlists
    let _ = db.allowlists().copy_from_agent(&parent_id, &id);

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": id,
            "name": auto_name,
            "parent_agent_id": parent.id,
            "provider_id": body.provider_id,
            "model_id": body.model_id,
            "status": "idle",
            "depth": parent.depth + 1,
            "created_at": now
        })),
    ))
}
