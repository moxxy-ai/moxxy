use axum::{Json, extract::{Path, State}};

use super::super::AppState;

pub async fn get_vault_keys(
    Path(agent): Path<String>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let reg = state.registry.lock().await;
    if let Some(mem_mutex) = reg.get(&agent) {
        let mem = mem_mutex.lock().await;
        let vault = crate::core::vault::SecretsVault::new(mem.get_db());
        match vault.list_keys().await {
            Ok(keys) => Json(serde_json::json!({ "success": true, "keys": keys })),
            Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
        }
    } else {
        Json(serde_json::json!({ "success": false, "error": "Agent not found" }))
    }
}

#[derive(serde::Deserialize)]
pub struct SetVaultSecretRequest {
    key: String,
    value: String,
}

pub async fn set_vault_secret(
    Path(agent): Path<String>,
    State(state): State<AppState>,
    Json(payload): Json<SetVaultSecretRequest>,
) -> Json<serde_json::Value> {
    let reg = state.registry.lock().await;
    if let Some(mem_mutex) = reg.get(&agent) {
        let mem = mem_mutex.lock().await;
        let vault = crate::core::vault::SecretsVault::new(mem.get_db());
        match vault.set_secret(&payload.key, &payload.value).await {
            Ok(_) => Json(serde_json::json!({ "success": true, "message": "Secret updated" })),
            Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
        }
    } else {
        Json(serde_json::json!({ "success": false, "error": "Agent not found" }))
    }
}

pub async fn get_vault_secret(
    Path((agent, key)): Path<(String, String)>,
    State(state): State<AppState>,
) -> Json<serde_json::value::Value> {
    let reg = state.registry.lock().await;
    if let Some(mem_mutex) = reg.get(&agent) {
        let mem = mem_mutex.lock().await;
        let vault = crate::core::vault::SecretsVault::new(mem.get_db());
        match vault.get_secret(&key).await {
            Ok(Some(value)) => Json(serde_json::json!({ "success": true, "value": value })),
            Ok(None) => Json(serde_json::json!({ "success": false, "error": format!("Secret '{}' not found in vault", key) })),
            Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
        }
    } else {
        Json(serde_json::json!({ "success": false, "error": "Agent not found" }))
    }
}

pub async fn delete_vault_secret(
    Path((agent, key)): Path<(String, String)>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let reg = state.registry.lock().await;
    if let Some(mem_mutex) = reg.get(&agent) {
        let mem = mem_mutex.lock().await;
        let vault = crate::core::vault::SecretsVault::new(mem.get_db());
        match vault.remove_secret(&key).await {
            Ok(_) => Json(serde_json::json!({ "success": true, "message": "Secret removed" })),
            Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
        }
    } else {
        Json(serde_json::json!({ "success": false, "error": "Agent not found" }))
    }
}
