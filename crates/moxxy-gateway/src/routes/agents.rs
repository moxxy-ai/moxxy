use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use moxxy_core::AgentStore;
use moxxy_core::AllowlistFile;
use moxxy_types::{AgentConfig, AgentRuntime, AgentStatus, AgentType, TokenScope};
use std::sync::Arc;

use crate::auth_extractor::{AuthToken, check_scope};
use crate::run_service::{QueuedRun, StartRunOutcome};
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

    let agents = state.registry.list();
    let result: Vec<serde_json::Value> = agents
        .iter()
        .filter(|a| a.agent_type == AgentType::Agent) // Only show user-created agents
        .map(|a| {
            serde_json::json!({
                "name": a.name,
                "provider_id": a.config.provider,
                "model_id": a.config.model,
                "status": a.status.to_string(),
                "template": a.config.template,
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

    let config = AgentConfig {
        provider: body.provider_id.clone(),
        model: body.model_id.clone(),
        temperature: body.temperature,
        max_subagent_depth: body.max_subagent_depth,
        max_subagents_total: body.max_subagents_total,
        policy_profile: body.policy_profile.clone(),
        core_mount: None,
        template: None,
    };

    // Create agent directory + YAML config
    AgentStore::create(&state.moxxy_home, &body.name, &config).map_err(|e| {
        if e.contains("already exists") {
            (
                StatusCode::CONFLICT,
                Json(serde_json::json!({"error": "conflict", "message": format!("Agent '{}' already exists", body.name)})),
            )
        } else {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal", "message": e})),
            )
        }
    })?;

    // Save persona if provided
    if let Some(ref persona) = body.persona {
        AgentStore::save_persona(&state.moxxy_home, &body.name, persona).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal", "message": e})),
            )
        })?;
    }

    // Register in the in-memory registry
    let runtime = AgentRuntime {
        name: body.name.clone(),
        agent_type: AgentType::Agent,
        config,
        status: AgentStatus::Idle,
        parent_name: None,
        hive_role: None,
        depth: 0,
        spawned_count: 0,
        persona: body.persona.clone(),
        last_result: None,
    };
    state.registry.register(runtime).map_err(|e| {
        // Clean up filesystem if registry fails
        let _ = AgentStore::delete(&state.moxxy_home, &body.name);
        (
            StatusCode::CONFLICT,
            Json(serde_json::json!({"error": "conflict", "message": e})),
        )
    })?;

    // Insert a minimal row into agents table for FK compatibility
    // (heartbeats, skills, vault_grants, allowlists reference agents.id)
    let now = chrono::Utc::now().to_rfc3339();
    if let Ok(db) = state.db.lock() {
        let _ = db.agents().insert(&moxxy_storage::AgentRow {
            id: body.name.clone(),
            parent_agent_id: None,
            name: Some(body.name.clone()),
            status: "idle".into(),
            depth: 0,
            spawned_total: 0,
            workspace_root: state
                .moxxy_home
                .join("agents")
                .join(&body.name)
                .join("workspace")
                .to_string_lossy()
                .to_string(),
            created_at: now.clone(),
            updated_at: now.clone(),
        });
    }

    // Seed default shell command allowlist (YAML-backed)
    {
        let agent_dir = state.moxxy_home.join("agents").join(&body.name);
        let al_path = moxxy_core::allowlist_path(&agent_dir);
        let mut al_file = AllowlistFile::default();
        for cmd in &[
            // Core POSIX utilities
            "ls",
            "cat",
            "grep",
            "find",
            "echo",
            "wc",
            "head",
            "tail",
            "sort",
            "uniq",
            "cut",
            "tr",
            "sed",
            "awk",
            "diff",
            "tee",
            "xargs",
            "mkdir",
            "cp",
            "mv",
            "touch",
            "date",
            "basename",
            "dirname",
            "realpath",
            // Scripting runtimes (for data processing)
            "python3",
            "python",
            "node",
            "deno",
            "bun",
            "ruby",
            "bash",
            "sh",
            // Build / package tools
            "npm",
            "npx",
            "pip",
            "pip3",
            "cargo",
            "make",
            "cmake",
            "go",
            // Common dev tools
            "git",
            "curl",
            "wget",
            "jq",
            "tar",
            "zip",
            "unzip",
            "gzip",
            "gunzip",
            // macOS-specific
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
            al_file.add_allow("shell_command", cmd.to_string());
        }
        let _ = al_file.save(&al_path);
    }

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "name": body.name,
            "provider_id": body.provider_id,
            "model_id": body.model_id,
            "persona": body.persona,
            "status": "idle",
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
    Path(name): Path<String>,
    Json(body): Json<AgentUpdateRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsWrite)?;
    body.validate()?;

    let runtime = state.registry.get(&name).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "not_found", "message": "Agent not found"})),
        )
    })?;

    let mut config = runtime.config.clone();
    if let Some(ref p) = body.provider_id {
        config.provider = p.clone();
    }
    if let Some(ref m) = body.model_id {
        config.model = m.clone();
    }
    if let Some(t) = body.temperature {
        config.temperature = t;
    }

    // Persist to YAML
    AgentStore::save(&state.moxxy_home, &name, &config).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": e})),
        )
    })?;

    // Update persona if provided
    if let Some(ref persona) = body.persona {
        AgentStore::save_persona(&state.moxxy_home, &name, persona).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal", "message": e})),
            )
        })?;
    }

    // Re-register with updated config (unregister + register)
    state.registry.unregister(&name);
    let updated = AgentRuntime {
        name: name.clone(),
        agent_type: AgentType::Agent,
        config: config.clone(),
        status: runtime.status,
        parent_name: None,
        hive_role: None,
        depth: 0,
        spawned_count: runtime.spawned_count,
        persona: body.persona.clone().or(runtime.persona.clone()),
        last_result: runtime.last_result.clone(),
    };
    let _ = state.registry.register(updated);

    Ok(Json(serde_json::json!({
        "name": name,
        "provider_id": config.provider,
        "model_id": config.model,
        "temperature": config.temperature,
        "status": runtime.status.to_string(),
    })))
}

pub async fn get_agent(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(name): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsRead)?;

    let runtime = state.registry.get(&name).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "not_found", "message": "Agent not found"})),
        )
    })?;

    Ok(Json(serde_json::json!({
        "name": runtime.name,
        "provider_id": runtime.config.provider,
        "model_id": runtime.config.model,
        "status": runtime.status.to_string(),
        "persona": runtime.persona,
        "template": runtime.config.template,
    })))
}

pub async fn start_run(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(name): Path<String>,
    Json(body): Json<RunStartRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::RunsWrite)?;
    body.validate()?;

    tracing::info!(agent_name = %name, task_len = body.task.len(), "Starting run");

    let outcome = state
        .run_service
        .start_or_queue_run(QueuedRun {
            agent_name: name.clone(),
            task: body.task.clone(),
            source: "api".into(),
            metadata: serde_json::json!({}),
        })
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

    match outcome {
        StartRunOutcome::Started { run_id } => Ok(Json(serde_json::json!({
            "agent_name": name,
            "run_id": run_id,
            "task": body.task,
            "status": "running"
        }))),
        StartRunOutcome::Queued { position } => Ok(Json(serde_json::json!({
            "agent_name": name,
            "task": body.task,
            "status": "queued",
            "queue_position": position
        }))),
        StartRunOutcome::QueueFull => Err((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
                "error": "queue_full",
                "message": "Agent is busy and run queue is full"
            })),
        )),
    }
}

pub async fn stop_run(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(name): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::RunsWrite)?;

    tracing::info!(agent_name = %name, "Stopping run");

    // Verify agent exists
    state.registry.get(&name).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "not_found", "message": "Agent not found"})),
        )
    })?;

    state.run_service.do_stop_agent(&name).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": e})),
        )
    })?;

    Ok(Json(serde_json::json!({
        "agent_name": name,
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
    Path((_agent_name, question_id)): Path<(String, String)>,
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

pub async fn reset_session(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(name): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::RunsWrite)?;

    tracing::info!(agent_name = %name, "Resetting agent session");

    // Verify agent exists
    state.registry.get(&name).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "not_found", "message": "Agent not found"})),
        )
    })?;

    // Stop any active run
    let _ = state.run_service.do_stop_agent(&name);

    // Clear STM file
    let stm_path = state
        .moxxy_home
        .join("agents")
        .join(&name)
        .join("memory")
        .join("stm.yaml");
    if stm_path.exists() {
        let _ = std::fs::remove_file(&stm_path);
    }

    // Clear conversation history
    if let Ok(db) = state.db.lock() {
        let _ = db.conversations().delete_all_by_agent(&name);
    }

    Ok(Json(serde_json::json!({
        "agent_name": name,
        "status": "reset"
    })))
}

pub async fn delete_agent(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(name): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsWrite)?;

    tracing::info!(agent_name = %name, "Deleting agent");

    // Stop any active run first
    let _ = state.run_service.do_stop_agent(&name);

    // Unregister from in-memory registry
    state.registry.unregister(&name).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "not_found", "message": "Agent not found"})),
        )
    })?;

    // Remove filesystem directory
    AgentStore::delete(&state.moxxy_home, &name).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": e})),
        )
    })?;

    Ok(StatusCode::NO_CONTENT)
}

#[derive(serde::Deserialize)]
pub struct HistoryQuery {
    pub limit: Option<u32>,
}

pub async fn get_history(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(name): Path<String>,
    Query(query): Query<HistoryQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsRead)?;

    let limit = query.limit.unwrap_or(50).min(200);

    let db = state.db.lock().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": e.to_string()})),
        )
    })?;

    let rows = db
        .conversations()
        .find_recent_by_agent(&name, limit)
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal", "message": e.to_string()})),
            )
        })?;

    let messages: Vec<serde_json::Value> = rows
        .iter()
        .map(|r| {
            serde_json::json!({
                "id": r.id,
                "run_id": r.run_id,
                "role": r.role,
                "content": r.content,
                "created_at": r.created_at,
            })
        })
        .collect();

    Ok(Json(serde_json::json!({ "messages": messages })))
}
