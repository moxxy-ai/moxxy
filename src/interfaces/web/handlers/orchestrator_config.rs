use axum::{
    Json,
    extract::{Path, State},
};

use super::super::AppState;

pub async fn get_orchestrator_config(
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
    match mem.get_orchestrator_config().await {
        Ok(Some(config)) => Json(serde_json::json!({ "success": true, "config": config })),
        Ok(None) => Json(serde_json::json!({
            "success": true,
            "config": crate::core::orchestrator::OrchestratorAgentConfig::default()
        })),
        Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
    }
}

pub async fn set_orchestrator_config(
    Path(agent): Path<String>,
    State(state): State<AppState>,
    Json(payload): Json<crate::core::orchestrator::OrchestratorAgentConfig>,
) -> Json<serde_json::Value> {
    let mem_arc = {
        let registry = state.registry.lock().await;
        registry.get(&agent).cloned()
    };

    let Some(mem_arc) = mem_arc else {
        return Json(serde_json::json!({ "success": false, "error": "Agent not found" }));
    };

    let mem = mem_arc.lock().await;
    match mem.set_orchestrator_config(&payload).await {
        Ok(()) => Json(serde_json::json!({ "success": true, "config": payload })),
        Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
    }
}
