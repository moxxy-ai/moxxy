use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use moxxy_storage::{AgentRow, AllowlistRow};
use moxxy_types::{AgentConfig, TokenScope};
use std::sync::Arc;

use crate::auth_extractor::{AuthToken, check_scope};
use crate::state::AppState;

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
            // Read config from agent.yaml if available
            let agent_dir = state.moxxy_home.join("agents").join(&a.id);
            let config = AgentConfig::load(&agent_dir.join("agent.yaml")).ok();
            serde_json::json!({
                "id": a.id,
                "name": a.name,
                "provider_id": config.as_ref().map(|c| c.provider_id.as_str()),
                "model_id": config.as_ref().map(|c| c.model_id.as_str()),
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
    std::fs::create_dir_all(&workspace_dir).ok();

    // Write agent.yaml
    let agent_config = AgentConfig {
        name: body.name.clone(),
        provider_id: body.provider_id.clone(),
        model_id: body.model_id.clone(),
        temperature: body.temperature,
        max_subagent_depth: body.max_subagent_depth,
        max_subagents_total: body.max_subagents_total,
        policy_profile: body.policy_profile.clone(),
    };
    agent_config.save(&agent_dir.join("agent.yaml")).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": format!("Failed to write agent.yaml: {e}")})),
        )
    })?;

    // Write persona.md
    std::fs::write(
        agent_dir.join("persona.md"),
        body.persona.as_deref().unwrap_or(""),
    )
    .ok();

    // Write empty memory.yaml
    std::fs::write(agent_dir.join("memory.yaml"), "").ok();

    let row = AgentRow {
        id: id.clone(),
        parent_agent_id: None,
        name: Some(body.name.clone()),
        status: "idle".into(),
        depth: 0,
        spawned_total: 0,
        workspace_root,
        created_at: now.clone(),
        updated_at: now.clone(),
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
    pub name: Option<String>,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    #[serde(default)]
    pub temperature: Option<f64>,
    pub persona: Option<String>,
}

impl AgentUpdateRequest {
    fn validate(&self) -> Result<(), ValidationError> {
        if let Some(ref name) = self.name
            && !is_valid_agent_name(name)
        {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "validation",
                    "message": "name must be 1-64 chars, lowercase alphanumeric + hyphens"
                })),
            ));
        }
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

    // Verify agent exists in DB
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

    let agent_dir = state.moxxy_home.join("agents").join(&id);
    let config_path = agent_dir.join("agent.yaml");

    // Read current config from file
    let mut config = AgentConfig::load(&config_path).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": format!("Failed to read agent.yaml: {e}")})),
        )
    })?;

    // Merge updates
    if let Some(ref name) = body.name {
        config.name = name.clone();
    }
    if let Some(ref provider_id) = body.provider_id {
        config.provider_id = provider_id.clone();
    }
    if let Some(ref model_id) = body.model_id {
        config.model_id = model_id.clone();
    }
    if let Some(temp) = body.temperature {
        config.temperature = temp;
    }

    // Write back
    config.save(&config_path).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": format!("Failed to write agent.yaml: {e}")})),
        )
    })?;

    // If name changed, update DB too (for uniqueness index)
    if let Some(ref name) = body.name {
        let db = state.db.lock().unwrap();
        db.agents()
            .update_name(&id, name)
            .map_err(|e| {
                if e.to_string().contains("UNIQUE") || e.to_string().contains("Duplicate") {
                    (
                        StatusCode::CONFLICT,
                        Json(serde_json::json!({"error": "conflict", "message": format!("Agent name '{}' already exists", name)})),
                    )
                } else {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(serde_json::json!({"error": "internal", "message": "Failed to update agent name"})),
                    )
                }
            })?;
    }

    // If persona provided, write persona.md
    if let Some(ref persona) = body.persona {
        std::fs::write(agent_dir.join("persona.md"), persona).ok();
    }

    Ok(Json(serde_json::json!({
        "id": id,
        "name": config.name,
        "provider_id": config.provider_id,
        "model_id": config.model_id,
        "temperature": config.temperature,
        "status": "updated",
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

    // Read config from agent.yaml
    let agent_dir = state.moxxy_home.join("agents").join(&id);
    let config = AgentConfig::load(&agent_dir.join("agent.yaml")).ok();
    let persona = std::fs::read_to_string(agent_dir.join("persona.md")).ok();

    Ok(Json(serde_json::json!({
        "id": agent.id,
        "name": agent.name,
        "provider_id": config.as_ref().map(|c| c.provider_id.as_str()),
        "model_id": config.as_ref().map(|c| c.model_id.as_str()),
        "status": agent.status,
        "persona": persona,
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

pub async fn reset_session(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::RunsWrite)?;

    tracing::info!(agent_id = %id, "Resetting agent session");

    // Verify agent exists
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

    state.run_service.do_reset_session(&id).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": e})),
        )
    })?;

    Ok(Json(serde_json::json!({
        "agent_id": id,
        "status": "reset"
    })))
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

    // Read parent's config from agent.yaml to get lineage limits
    let parent_dir = state.moxxy_home.join("agents").join(&parent.id);
    let parent_config = AgentConfig::load(&parent_dir.join("agent.yaml")).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": format!("Failed to read parent config: {e}")})),
        )
    })?;

    // Enforce lineage limits
    let lineage = moxxy_core::AgentLineage {
        root_agent_id: parent
            .parent_agent_id
            .clone()
            .unwrap_or_else(|| parent.id.clone()),
        current_depth: parent.depth as u32,
        max_depth: parent_config.max_subagent_depth as u32,
        spawned_total: parent.spawned_total as u32,
        max_total: parent_config.max_subagents_total as u32,
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
    let short_id = &id[id.len() - 8..];
    let auto_name = format!("{}-sub-{}", parent_name, short_id);
    let agent_dir = state.moxxy_home.join("agents").join(&id);
    let workspace_root = agent_dir.to_string_lossy().to_string();

    // Create agent directories
    std::fs::create_dir_all(agent_dir.join("workspace")).ok();

    // Write agent.yaml (inherit from parent config but use request overrides)
    let child_config = AgentConfig {
        name: auto_name.clone(),
        provider_id: body.provider_id.clone(),
        model_id: body.model_id.clone(),
        temperature: body.temperature,
        max_subagent_depth: body.max_subagent_depth,
        max_subagents_total: body.max_subagents_total,
        policy_profile: body.policy_profile.clone(),
    };
    child_config.save(&agent_dir.join("agent.yaml")).ok();

    // Write empty persona.md and memory.yaml
    std::fs::write(agent_dir.join("persona.md"), "").ok();
    std::fs::write(agent_dir.join("memory.yaml"), "").ok();

    let row = AgentRow {
        id: id.clone(),
        parent_agent_id: Some(parent_id.clone()),
        name: Some(auto_name.clone()),
        status: "idle".into(),
        depth: parent.depth + 1,
        spawned_total: 0,
        workspace_root,
        created_at: now.clone(),
        updated_at: now.clone(),
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
