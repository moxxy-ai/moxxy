use axum::{
    Json,
    extract::{Path, State},
};

use super::super::AppState;

#[derive(serde::Deserialize)]
pub struct PatchTemplateRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub default_worker_mode: Option<crate::core::orchestrator::WorkerMode>,
    pub default_max_parallelism: Option<usize>,
    pub default_retry_limit: Option<usize>,
    pub default_failure_policy: Option<crate::core::orchestrator::JobFailurePolicy>,
    pub default_merge_policy: Option<crate::core::orchestrator::JobMergePolicy>,
    pub spawn_profiles: Option<Vec<crate::core::orchestrator::SpawnProfile>>,
}

fn validate_template(
    template: &crate::core::orchestrator::OrchestratorTemplate,
) -> Result<(), String> {
    if template.template_id.trim().is_empty() {
        return Err("template_id is required".to_string());
    }
    if template.name.trim().is_empty() {
        return Err("name is required".to_string());
    }

    let providers = crate::core::llm::registry::ProviderRegistry::load();
    for profile in &template.spawn_profiles {
        if profile.role.trim().is_empty() {
            return Err("spawn profile role is required".to_string());
        }
        if profile.provider.trim().is_empty() || profile.model.trim().is_empty() {
            return Err("spawn profile provider/model is required".to_string());
        }

        let Some(provider_def) = providers.get_provider(&profile.provider) else {
            return Err(format!("unknown provider '{}'", profile.provider));
        };

        let model_ok = provider_def
            .models
            .iter()
            .any(|m| m.id == profile.model || m.name == profile.model);
        if !model_ok {
            return Err(format!(
                "unknown model '{}' for provider '{}'",
                profile.model, provider_def.id
            ));
        }
    }

    Ok(())
}

pub async fn list_orchestrator_templates(
    Path(agent): Path<String>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let mem_arc = {
        let registry = state.registry.lock().await;
        registry.get(&agent).cloned()
    };

    let Some(mem_arc) = mem_arc else {
        return Json(serde_json::json!({ "success": false, "error": "Agent not found" }));
    };

    let mem = mem_arc.lock().await;
    match mem.list_orchestrator_templates().await {
        Ok(templates) => Json(serde_json::json!({ "success": true, "templates": templates })),
        Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
    }
}

pub async fn upsert_orchestrator_template(
    Path(agent): Path<String>,
    State(state): State<AppState>,
    Json(payload): Json<crate::core::orchestrator::OrchestratorTemplate>,
) -> Json<serde_json::Value> {
    if let Err(e) = validate_template(&payload) {
        return Json(serde_json::json!({ "success": false, "error": e }));
    }

    let mem_arc = {
        let registry = state.registry.lock().await;
        registry.get(&agent).cloned()
    };

    let Some(mem_arc) = mem_arc else {
        return Json(serde_json::json!({ "success": false, "error": "Agent not found" }));
    };

    let mem = mem_arc.lock().await;
    match mem.upsert_orchestrator_template(&payload).await {
        Ok(()) => Json(serde_json::json!({ "success": true, "template": payload })),
        Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
    }
}

pub async fn get_orchestrator_template(
    Path((agent, template_id)): Path<(String, String)>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let mem_arc = {
        let registry = state.registry.lock().await;
        registry.get(&agent).cloned()
    };

    let Some(mem_arc) = mem_arc else {
        return Json(serde_json::json!({ "success": false, "error": "Agent not found" }));
    };

    let mem = mem_arc.lock().await;
    match mem.get_orchestrator_template(&template_id).await {
        Ok(Some(template)) => Json(serde_json::json!({ "success": true, "template": template })),
        Ok(None) => Json(serde_json::json!({ "success": false, "error": "Template not found" })),
        Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
    }
}

pub async fn patch_orchestrator_template(
    Path((agent, template_id)): Path<(String, String)>,
    State(state): State<AppState>,
    Json(payload): Json<PatchTemplateRequest>,
) -> Json<serde_json::Value> {
    let mem_arc = {
        let registry = state.registry.lock().await;
        registry.get(&agent).cloned()
    };

    let Some(mem_arc) = mem_arc else {
        return Json(serde_json::json!({ "success": false, "error": "Agent not found" }));
    };

    let mem = mem_arc.lock().await;
    let Some(mut template) = (match mem.get_orchestrator_template(&template_id).await {
        Ok(value) => value,
        Err(e) => {
            return Json(serde_json::json!({ "success": false, "error": e.to_string() }));
        }
    }) else {
        return Json(serde_json::json!({ "success": false, "error": "Template not found" }));
    };

    if let Some(name) = payload.name {
        template.name = name;
    }
    if let Some(description) = payload.description {
        template.description = description;
    }
    if let Some(default_worker_mode) = payload.default_worker_mode {
        template.default_worker_mode = Some(default_worker_mode);
    }
    if let Some(default_max_parallelism) = payload.default_max_parallelism {
        template.default_max_parallelism = Some(default_max_parallelism);
    }
    if let Some(default_retry_limit) = payload.default_retry_limit {
        template.default_retry_limit = Some(default_retry_limit);
    }
    if let Some(default_failure_policy) = payload.default_failure_policy {
        template.default_failure_policy = Some(default_failure_policy);
    }
    if let Some(default_merge_policy) = payload.default_merge_policy {
        template.default_merge_policy = Some(default_merge_policy);
    }
    if let Some(spawn_profiles) = payload.spawn_profiles {
        template.spawn_profiles = spawn_profiles;
    }

    if let Err(e) = validate_template(&template) {
        return Json(serde_json::json!({ "success": false, "error": e }));
    }

    match mem.upsert_orchestrator_template(&template).await {
        Ok(()) => Json(serde_json::json!({ "success": true, "template": template })),
        Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
    }
}

pub async fn delete_orchestrator_template(
    Path((agent, template_id)): Path<(String, String)>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let mem_arc = {
        let registry = state.registry.lock().await;
        registry.get(&agent).cloned()
    };

    let Some(mem_arc) = mem_arc else {
        return Json(serde_json::json!({ "success": false, "error": "Agent not found" }));
    };

    let mem = mem_arc.lock().await;
    match mem.delete_orchestrator_template(&template_id).await {
        Ok(true) => Json(serde_json::json!({ "success": true })),
        Ok(false) => Json(serde_json::json!({ "success": false, "error": "Template not found" })),
        Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
    }
}
