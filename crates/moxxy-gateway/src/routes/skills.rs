use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use moxxy_storage::SkillRow;
use moxxy_types::TokenScope;
use std::sync::Arc;

use crate::auth_extractor::{AuthToken, check_scope};
use crate::state::AppState;

#[derive(serde::Deserialize)]
pub struct SkillInstallRequest {
    pub name: String,
    pub version: String,
    pub source: Option<String>,
    pub content: String,
}

pub async fn install_skill(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(agent_id): Path<String>,
    Json(body): Json<SkillInstallRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsWrite)?;

    tracing::info!(agent_id = %agent_id, skill_name = %body.name, version = %body.version, "Installing skill");

    let now = chrono::Utc::now().to_rfc3339();
    let id = uuid::Uuid::now_v7().to_string();

    let row = SkillRow {
        id: id.clone(),
        agent_id: agent_id.clone(),
        name: body.name.clone(),
        version: body.version.clone(),
        source: body.source.clone(),
        status: "quarantined".into(),
        raw_content: Some(body.content.clone()),
        metadata_json: None,
        installed_at: now.clone(),
        approved_at: None,
    };

    let db = state.db.lock().unwrap();
    db.skills().insert(&row).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": "Failed to install skill"})),
        )
    })?;

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": id,
            "agent_id": agent_id,
            "name": body.name,
            "version": body.version,
            "status": "quarantined",
            "installed_at": now
        })),
    ))
}

pub async fn list_skills(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(agent_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsRead)?;

    tracing::debug!(agent_id = %agent_id, "Listing skills");
    let db = state.db.lock().unwrap();
    let skills = db.skills().find_by_agent(&agent_id).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": "Database error"})),
        )
    })?;

    let result: Vec<serde_json::Value> = skills
        .iter()
        .map(|s| {
            serde_json::json!({
                "id": s.id,
                "name": s.name,
                "version": s.version,
                "status": s.status,
                "installed_at": s.installed_at,
                "approved_at": s.approved_at
            })
        })
        .collect();

    Ok(Json(serde_json::json!(result)))
}

pub async fn approve_skill(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path((_agent_id, skill_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsWrite)?;

    tracing::info!(skill_id = %skill_id, "Approving skill");
    let db = state.db.lock().unwrap();
    db.skills()
        .update_status(&skill_id, "approved")
        .map_err(|e| match e {
            moxxy_types::StorageError::NotFound => (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "not_found", "message": "Skill not found"})),
            ),
            _ => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal", "message": "Database error"})),
            ),
        })?;

    let skill = db.skills().find_by_id(&skill_id).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": "Database error"})),
        )
    })?;

    if let Some(s) = skill {
        Ok(Json(serde_json::json!({
            "id": s.id,
            "agent_id": s.agent_id,
            "name": s.name,
            "status": s.status,
            "approved_at": s.approved_at
        })))
    } else {
        Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "not_found", "message": "Skill not found"})),
        ))
    }
}
