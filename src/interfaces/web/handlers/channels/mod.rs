mod discord;
mod telegram;
mod whatsapp;

pub use discord::*;
pub use telegram::*;
pub use whatsapp::*;

use axum::{
    Json,
    extract::{Path, State},
};
use std::sync::Arc;
use tokio::sync::Mutex;

use super::super::AppState;
use crate::core::memory::MemorySystem;

pub(crate) async fn list_agent_memory_handles(
    state: &AppState,
) -> Vec<(String, Arc<Mutex<MemorySystem>>)> {
    let reg = state.registry.lock().await;
    reg.iter()
        .map(|(name, mem)| (name.clone(), mem.clone()))
        .collect()
}

pub(crate) async fn find_agent_with_secret_value(
    state: &AppState,
    key: &str,
    value: &str,
    exclude_agent: &str,
) -> Option<String> {
    let candidates = list_agent_memory_handles(state).await;
    for (agent_name, mem_mutex) in candidates {
        if agent_name == exclude_agent {
            continue;
        }
        let mem = mem_mutex.lock().await;
        let vault = crate::core::vault::SecretsVault::new(mem.get_db());
        if let Ok(Some(existing)) = vault.get_secret(key).await
            && existing.trim() == value.trim()
        {
            return Some(agent_name);
        }
    }
    None
}

pub async fn get_channels(
    Path(agent): Path<String>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let reg = state.registry.lock().await;
    if let Some(mem_mutex) = reg.get(&agent) {
        let mem = mem_mutex.lock().await;
        let vault = crate::core::vault::SecretsVault::new(mem.get_db());

        let tg_has_token = matches!(vault.get_secret("telegram_token").await, Ok(Some(_)));
        let tg_is_paired = matches!(vault.get_secret("telegram_chat_id").await, Ok(Some(_)));
        let tg_pairing_active =
            matches!(vault.get_secret("telegram_pairing_code").await, Ok(Some(_)));
        let tg_stt_enabled = matches!(vault.get_secret("telegram_stt_enabled").await, Ok(Some(ref v)) if v == "true");
        let tg_has_stt_token = matches!(vault.get_secret("telegram_stt_token").await, Ok(Some(ref v)) if !v.is_empty());
        let discord_has_token = matches!(vault.get_secret("discord_token").await, Ok(Some(_)));
        let slack_has_token = matches!(vault.get_secret("slack_token").await, Ok(Some(_)));
        let whatsapp_has_token =
            matches!(vault.get_secret("whatsapp_account_sid").await, Ok(Some(_)));

        Json(serde_json::json!({
            "success": true,
            "channels": [
                { "type": "telegram", "has_token": tg_has_token, "is_paired": tg_is_paired, "pairing_active": tg_pairing_active, "stt_enabled": tg_stt_enabled, "has_stt_token": tg_has_stt_token },
                { "type": "discord", "has_token": discord_has_token, "is_paired": false },
                { "type": "slack", "has_token": slack_has_token, "is_paired": false },
                { "type": "whatsapp", "has_token": whatsapp_has_token, "is_paired": false }
            ]
        }))
    } else {
        Json(serde_json::json!({ "success": false, "error": "Agent not found" }))
    }
}

#[derive(serde::Deserialize)]
pub struct SetChannelTokenRequest {
    pub token: String,
}
