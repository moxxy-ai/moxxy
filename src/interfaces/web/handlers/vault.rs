use axum::{
    Json,
    extract::{Path, State},
};

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
            Ok(_) => {
                // Hot-reload API key on the LLM provider if this vault key matches one
                let llm_reg = state.llm_registry.lock().await;
                if let Some(llm_mutex) = llm_reg.get(&agent) {
                    let mut llm = llm_mutex.write().await;
                    llm.update_key_for_vault_entry(&payload.key, &payload.value);
                }
                Json(serde_json::json!({ "success": true, "message": "Secret updated" }))
            }
            Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
        }
    } else {
        Json(serde_json::json!({ "success": false, "error": "Agent not found" }))
    }
}

/// Mask a secret value for safe display (show first 4 chars + asterisks).
fn mask_secret(value: &str) -> String {
    if value.len() <= 4 {
        "*".repeat(value.len())
    } else {
        format!("{}****", &value[..4])
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
            Ok(Some(value)) => {
                // Never return plaintext secrets via API. Return masked value only.
                let masked = mask_secret(&value);
                Json(serde_json::json!({ "success": true, "exists": true, "masked_value": masked }))
            }
            Ok(None) => Json(
                serde_json::json!({ "success": false, "error": format!("Secret '{}' not found in vault", key) }),
            ),
            Err(_e) => {
                Json(serde_json::json!({ "success": false, "error": "Failed to read secret" }))
            }
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
