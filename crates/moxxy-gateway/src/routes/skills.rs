use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use moxxy_core::{SkillDoc, SkillLoader, SkillSource};
use moxxy_types::TokenScope;
use std::sync::Arc;

use crate::auth_extractor::{AuthToken, check_scope};
use crate::state::AppState;

#[derive(serde::Deserialize)]
pub struct SkillInstallRequest {
    pub content: String,
}

pub async fn install_skill(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(agent_id): Path<String>,
    Json(body): Json<SkillInstallRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsWrite)?;

    let doc = SkillDoc::parse(&body.content).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "invalid_skill", "message": e.to_string()})),
        )
    })?;

    let slug = doc.slug();
    let agent_skills_dir = state
        .moxxy_home
        .join("agents")
        .join(&agent_id)
        .join("skills")
        .join(&slug);

    std::fs::create_dir_all(&agent_skills_dir).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": format!("Failed to create skill dir: {e}")})),
        )
    })?;

    std::fs::write(agent_skills_dir.join("SKILL.md"), &body.content).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": format!("Failed to write SKILL.md: {e}")})),
        )
    })?;

    tracing::info!(
        agent_id = %agent_id,
        slug = %slug,
        skill_name = %doc.name,
        version = %doc.version,
        "Skill created"
    );

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "slug": slug,
            "agent_id": agent_id,
            "name": doc.name,
            "version": doc.version,
            "source": "agent"
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
    let agent_dir = state.moxxy_home.join("agents").join(&agent_id);
    let skills = SkillLoader::load_all(&state.moxxy_home, &agent_dir);

    let result: Vec<serde_json::Value> = skills
        .iter()
        .map(|s| {
            let source = match s.source {
                SkillSource::Builtin => "builtin",
                SkillSource::Agent => "agent",
            };
            serde_json::json!({
                "slug": s.doc.slug(),
                "name": s.doc.name,
                "description": s.doc.description,
                "version": s.doc.version,
                "source": source,
            })
        })
        .collect();

    Ok(Json(serde_json::json!(result)))
}

pub async fn delete_skill(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path((agent_id, skill_id)): Path<(String, String)>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsWrite)?;

    // Check if this is a built-in skill
    let builtin_path = state
        .moxxy_home
        .join("skills")
        .join(&skill_id)
        .join("SKILL.md");
    if builtin_path.exists() {
        return Err((
            StatusCode::FORBIDDEN,
            Json(
                serde_json::json!({"error": "forbidden", "message": "Cannot delete a built-in skill"}),
            ),
        ));
    }

    let agent_skill_dir = state
        .moxxy_home
        .join("agents")
        .join(&agent_id)
        .join("skills")
        .join(&skill_id);

    if !agent_skill_dir.exists() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "not_found", "message": "Skill not found"})),
        ));
    }

    std::fs::remove_dir_all(&agent_skill_dir).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": format!("Failed to delete skill: {e}")})),
        )
    })?;

    tracing::info!(skill_id = %skill_id, agent_id = %agent_id, "Skill deleted");
    Ok(StatusCode::NO_CONTENT)
}
