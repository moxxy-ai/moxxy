use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use moxxy_core::{TemplateLoader, TemplateStore};
use moxxy_types::TokenScope;
use std::sync::Arc;

use crate::auth_extractor::{AuthToken, check_scope};
use crate::state::AppState;

#[derive(serde::Deserialize)]
pub struct TemplateCreateRequest {
    pub content: String,
}

#[derive(serde::Deserialize)]
pub struct TemplateUpdateRequest {
    pub content: String,
}

#[derive(serde::Deserialize)]
pub struct SetAgentTemplateRequest {
    pub template: Option<String>,
}

pub async fn create_template(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Json(body): Json<TemplateCreateRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsWrite)?;

    let doc = TemplateStore::create(&state.moxxy_home, &body.content).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "invalid_template", "message": e.to_string()})),
        )
    })?;

    let slug = doc.slug();
    tracing::info!(slug = %slug, name = %doc.name, "Template created");

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "slug": slug,
            "name": doc.name,
            "description": doc.description,
            "version": doc.version,
            "tags": doc.tags,
        })),
    ))
}

pub async fn list_templates(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsRead)?;

    let templates = TemplateLoader::load_all(&state.moxxy_home);
    let result: Vec<serde_json::Value> = templates
        .iter()
        .map(|t| {
            serde_json::json!({
                "slug": t.doc.slug(),
                "name": t.doc.name,
                "description": t.doc.description,
                "version": t.doc.version,
                "tags": t.doc.tags,
            })
        })
        .collect();

    Ok(Json(serde_json::json!(result)))
}

pub async fn get_template(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(slug): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsRead)?;

    let loaded = TemplateLoader::load_by_slug(&state.moxxy_home, &slug).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "not_found", "message": "Template not found"})),
        )
    })?;

    Ok(Json(serde_json::json!({
        "slug": loaded.doc.slug(),
        "name": loaded.doc.name,
        "description": loaded.doc.description,
        "version": loaded.doc.version,
        "tags": loaded.doc.tags,
        "body": loaded.doc.body,
    })))
}

pub async fn update_template(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(slug): Path<String>,
    Json(body): Json<TemplateUpdateRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsWrite)?;

    let doc = TemplateStore::update(&state.moxxy_home, &slug, &body.content).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "invalid_template", "message": e.to_string()})),
        )
    })?;

    tracing::info!(slug = %slug, name = %doc.name, "Template updated");

    Ok(Json(serde_json::json!({
        "slug": slug,
        "name": doc.name,
        "description": doc.description,
        "version": doc.version,
        "tags": doc.tags,
    })))
}

pub async fn delete_template(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(slug): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsWrite)?;

    TemplateStore::delete(&state.moxxy_home, &slug).map_err(|e| {
        (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "not_found", "message": e})),
        )
    })?;

    tracing::info!(slug = %slug, "Template deleted");
    Ok(StatusCode::NO_CONTENT)
}

pub async fn set_agent_template(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(name): Path<String>,
    Json(body): Json<SetAgentTemplateRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsWrite)?;

    // Verify agent exists
    let runtime = state.registry.get(&name).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "not_found", "message": "Agent not found"})),
        )
    })?;

    // Validate template exists (if non-null)
    if let Some(ref slug) = body.template {
        let template_path = state
            .moxxy_home
            .join("templates")
            .join(slug)
            .join("TEMPLATE.md");
        if !template_path.is_file() {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(
                    serde_json::json!({"error": "validation", "message": format!("template '{}' not found", slug)}),
                ),
            ));
        }
    }

    // Update agent.yaml
    let config_path = state
        .moxxy_home
        .join("agents")
        .join(&name)
        .join("agent.yaml");
    let mut config = moxxy_types::AgentConfig::load(&config_path).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": e})),
        )
    })?;
    config.template = body.template.clone();
    config.save(&config_path).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": e})),
        )
    })?;

    // Update in-memory registry
    state.registry.unregister(&name);
    let updated = moxxy_types::AgentRuntime {
        name: name.clone(),
        agent_type: runtime.agent_type.clone(),
        config,
        status: runtime.status,
        parent_name: runtime.parent_name.clone(),
        hive_role: runtime.hive_role,
        depth: runtime.depth,
        spawned_count: runtime.spawned_count,
        persona: runtime.persona.clone(),
        last_result: runtime.last_result.clone(),
    };
    let _ = state.registry.register(updated);

    Ok(Json(serde_json::json!({
        "name": name,
        "template": body.template,
        "status": "updated",
    })))
}
