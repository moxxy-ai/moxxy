use axum::{
    Json,
    extract::{Path, State},
};

use crate::interfaces::web::AppState;

#[derive(serde::Deserialize)]
pub struct CreateTokenRequest {
    pub name: String,
}

pub async fn list_tokens(
    Path(agent): Path<String>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let reg = state.registry.lock().await;
    if let Some(mem_mutex) = reg.get(&agent) {
        let mem = mem_mutex.lock().await;
        match mem.list_api_tokens().await {
            Ok(tokens) => Json(serde_json::json!({ "success": true, "tokens": tokens })),
            Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
        }
    } else {
        Json(serde_json::json!({ "success": false, "error": "Agent not found" }))
    }
}

pub async fn create_token(
    Path(agent): Path<String>,
    State(state): State<AppState>,
    Json(payload): Json<CreateTokenRequest>,
) -> Json<serde_json::Value> {
    let name = payload.name.trim().to_string();
    if name.is_empty() {
        return Json(serde_json::json!({ "success": false, "error": "Token name is required" }));
    }

    let reg = state.registry.lock().await;
    if let Some(mem_mutex) = reg.get(&agent) {
        let mem = mem_mutex.lock().await;
        match mem.create_api_token(&name).await {
            Ok((raw_token, record)) => Json(serde_json::json!({
                "success": true,
                "token": raw_token,
                "record": record,
                "message": "Token created. Save the token value - it will not be shown again."
            })),
            Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
        }
    } else {
        Json(serde_json::json!({ "success": false, "error": "Agent not found" }))
    }
}

pub async fn delete_token(
    Path((agent, token_id)): Path<(String, String)>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let reg = state.registry.lock().await;
    if let Some(mem_mutex) = reg.get(&agent) {
        let mem = mem_mutex.lock().await;
        match mem.delete_api_token(&token_id).await {
            Ok(true) => Json(serde_json::json!({ "success": true, "message": "Token revoked" })),
            Ok(false) => Json(serde_json::json!({ "success": false, "error": "Token not found" })),
            Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
        }
    } else {
        Json(serde_json::json!({ "success": false, "error": "Agent not found" }))
    }
}
