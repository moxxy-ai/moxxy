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
                SkillSource::Quarantined => "quarantined",
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

/// List quarantined skills awaiting approval. Separate endpoint from
/// `list_skills` so the default tool-catalog view doesn't mix in pending items.
pub async fn list_quarantined_skills(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(agent_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsRead)?;

    let agent_dir = state.moxxy_home.join("agents").join(&agent_id);
    let skills = SkillLoader::load_quarantine(&agent_dir);

    let result: Vec<serde_json::Value> = skills
        .iter()
        .map(|s| {
            serde_json::json!({
                "slug": s.doc.slug(),
                "name": s.doc.name,
                "description": s.doc.description,
                "version": s.doc.version,
                "author": s.doc.author,
                "allowed_primitives": s.doc.allowed_primitives,
            })
        })
        .collect();

    Ok(Json(serde_json::json!(result)))
}

/// Promote a quarantined skill to active. Moves the directory from
/// `skills_quarantine/<slug>/` → `skills/<slug>/`.
pub async fn approve_quarantined_skill(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path((agent_id, slug)): Path<(String, String)>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsWrite)?;

    let agent_dir = state.moxxy_home.join("agents").join(&agent_id);
    match SkillLoader::approve_quarantined(&agent_dir, &slug) {
        Ok(dst) => {
            tracing::info!(agent_id = %agent_id, slug = %slug, "Quarantined skill approved");
            Ok((
                StatusCode::OK,
                Json(serde_json::json!({
                    "slug": slug,
                    "agent_id": agent_id,
                    "status": "approved",
                    "path": dst.display().to_string(),
                })),
            ))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "not_found", "message": e.to_string()})),
        )),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Err((
            StatusCode::CONFLICT,
            Json(serde_json::json!({"error": "conflict", "message": e.to_string()})),
        )),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": e.to_string()})),
        )),
    }
}

/// Reject (delete) a quarantined skill without promoting it.
pub async fn reject_quarantined_skill(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path((agent_id, slug)): Path<(String, String)>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsWrite)?;

    let agent_dir = state.moxxy_home.join("agents").join(&agent_id);
    match SkillLoader::reject_quarantined(&agent_dir, &slug) {
        Ok(()) => {
            tracing::info!(agent_id = %agent_id, slug = %slug, "Quarantined skill rejected");
            Ok(StatusCode::NO_CONTENT)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "not_found", "message": e.to_string()})),
        )),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": e.to_string()})),
        )),
    }
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
