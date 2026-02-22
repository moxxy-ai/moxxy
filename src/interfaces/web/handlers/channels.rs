use axum::{
    Json,
    extract::{Form, Path, State},
};
use std::sync::Arc;
use teloxide::prelude::*;
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
        let whatsapp_has_token = matches!(vault.get_secret("whatsapp_token").await, Ok(Some(_)));

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
    token: String,
}

pub async fn set_telegram_token(
    Path(agent): Path<String>,
    State(state): State<AppState>,
    Json(payload): Json<SetChannelTokenRequest>,
) -> Json<serde_json::Value> {
    if payload.token.trim().is_empty() {
        return Json(
            serde_json::json!({ "success": false, "error": "Telegram token cannot be empty." }),
        );
    }

    if let Some(owner) =
        find_agent_with_secret_value(&state, "telegram_token", &payload.token, &agent).await
    {
        return Json(serde_json::json!({
            "success": false,
            "error": format!(
                "This Telegram bot token is already bound to agent '{}'. One Telegram channel can only be bound to one agent.",
                owner
            )
        }));
    }

    let reg = state.registry.lock().await;
    if let Some(mem_mutex) = reg.get(&agent) {
        let mem = mem_mutex.lock().await;
        let vault = crate::core::vault::SecretsVault::new(mem.get_db());
        match vault.set_secret("telegram_token", &payload.token).await {
            Ok(_) => Json(
                serde_json::json!({ "success": true, "message": "Telegram token saved. Restart gateway to activate the bot." }),
            ),
            Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
        }
    } else {
        Json(serde_json::json!({ "success": false, "error": "Agent not found" }))
    }
}

#[derive(serde::Deserialize)]
pub struct PairChannelRequest {
    code: String,
}

pub async fn pair_telegram(
    Path(agent): Path<String>,
    State(state): State<AppState>,
    Json(payload): Json<PairChannelRequest>,
) -> Json<serde_json::Value> {
    let mem_mutex = {
        let reg = state.registry.lock().await;
        match reg.get(&agent) {
            Some(mem_mutex) => mem_mutex.clone(),
            None => {
                return Json(serde_json::json!({ "success": false, "error": "Agent not found" }));
            }
        }
    };

    let mem = mem_mutex.lock().await;
    let vault = crate::core::vault::SecretsVault::new(mem.get_db());

    let stored_code = match vault.get_secret("telegram_pairing_code").await {
        Ok(Some(c)) => c,
        _ => {
            return Json(
                serde_json::json!({ "success": false, "error": "No pairing code found. Send /start to your Telegram bot first." }),
            );
        }
    };

    if payload.code.trim() != stored_code.trim() {
        return Json(
            serde_json::json!({ "success": false, "error": "Pairing code does not match." }),
        );
    }

    let chat_id = match vault.get_secret("telegram_pairing_chat_id").await {
        Ok(Some(id)) => id,
        _ => {
            return Json(
                serde_json::json!({ "success": false, "error": "No chat ID found. Send /start to the bot again." }),
            );
        }
    };

    if let Ok(Some(token)) = vault.get_secret("telegram_token").await
        && let Some(owner) =
            find_agent_with_secret_value(&state, "telegram_token", &token, &agent).await
    {
        return Json(serde_json::json!({
            "success": false,
            "error": format!(
                "This Telegram bot token is already bound to agent '{}'. One Telegram channel can only be bound to one agent.",
                owner
            )
        }));
    }

    // We allow multiple agents to be paired with the same Telegram user (same chat_id)
    // as long as they use different bot tokens. This is already enforced by the token check.
    /*
    if let Some(owner) =
        find_agent_with_secret_value(&state, "telegram_chat_id", &chat_id, &agent).await
    {
        return Json(serde_json::json!({
            "success": false,
            "error": format!(
                "This Telegram chat is already paired with agent '{}'. One Telegram channel can only be bound to one agent.",
                owner
            )
        }));
    }
    */

    if let Err(e) = vault.set_secret("telegram_chat_id", &chat_id).await {
        return Json(serde_json::json!({ "success": false, "error": e.to_string() }));
    }
    let _ = vault.remove_secret("telegram_pairing_code").await;
    let _ = vault.remove_secret("telegram_pairing_chat_id").await;

    Json(
        serde_json::json!({ "success": true, "message": "Telegram paired successfully!", "chat_id": chat_id }),
    )
}

pub async fn revoke_telegram_pairing(
    Path(agent): Path<String>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let reg = state.registry.lock().await;
    if let Some(mem_mutex) = reg.get(&agent) {
        let mem = mem_mutex.lock().await;
        let vault = crate::core::vault::SecretsVault::new(mem.get_db());
        let _ = vault.remove_secret("telegram_pairing_code").await;
        let _ = vault.remove_secret("telegram_pairing_chat_id").await;
        Json(serde_json::json!({ "success": true, "message": "Telegram pairing request revoked." }))
    } else {
        Json(serde_json::json!({ "success": false, "error": "Agent not found" }))
    }
}

#[derive(serde::Deserialize)]
pub struct TelegramSendRequest {
    message: String,
}

pub async fn send_telegram_message(
    Path(agent): Path<String>,
    State(state): State<AppState>,
    Form(payload): Form<TelegramSendRequest>,
) -> Json<serde_json::Value> {
    let message = payload.message.trim();
    if message.is_empty() {
        return Json(serde_json::json!({ "success": false, "error": "Message cannot be empty." }));
    }

    let mem_mutex = {
        let reg = state.registry.lock().await;
        match reg.get(&agent) {
            Some(mem_mutex) => mem_mutex.clone(),
            None => {
                return Json(serde_json::json!({ "success": false, "error": "Agent not found" }));
            }
        }
    };

    let mem = mem_mutex.lock().await;
    let vault = crate::core::vault::SecretsVault::new(mem.get_db());

    let token = match vault.get_secret("telegram_token").await {
        Ok(Some(token)) if !token.trim().is_empty() => token,
        _ => {
            return Json(
                serde_json::json!({ "success": false, "error": "Telegram token is not configured for this agent." }),
            );
        }
    };

    let chat_id = match vault.get_secret("telegram_chat_id").await {
        Ok(Some(chat_id)) if !chat_id.trim().is_empty() => chat_id,
        _ => {
            return Json(
                serde_json::json!({ "success": false, "error": "Telegram is not paired for this agent." }),
            );
        }
    };
    drop(mem);

    let chat_id_num = match chat_id.parse::<i64>() {
        Ok(id) => id,
        Err(_) => {
            return Json(
                serde_json::json!({ "success": false, "error": "Stored Telegram chat ID is invalid." }),
            );
        }
    };

    let bot = Bot::new(token);
    match bot
        .send_message(ChatId(chat_id_num), message.to_string())
        .await
    {
        Ok(_) => Json(serde_json::json!({ "success": true, "message": "Telegram message sent." })),
        Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
    }
}

#[derive(serde::Deserialize)]
pub struct DiscordSendRequest {
    message: String,
}

pub async fn send_discord_message(
    Path(agent): Path<String>,
    State(state): State<AppState>,
    Form(payload): Form<DiscordSendRequest>,
) -> Json<serde_json::Value> {
    let message = payload.message.trim();
    if message.is_empty() {
        return Json(serde_json::json!({ "success": false, "error": "Message cannot be empty." }));
    }

    let mem_mutex = {
        let reg = state.registry.lock().await;
        match reg.get(&agent) {
            Some(mem_mutex) => mem_mutex.clone(),
            None => {
                return Json(serde_json::json!({ "success": false, "error": "Agent not found" }));
            }
        }
    };

    let mem = mem_mutex.lock().await;
    let vault = crate::core::vault::SecretsVault::new(mem.get_db());

    let token = match vault.get_secret("discord_token").await {
        Ok(Some(token)) if !token.trim().is_empty() => token,
        _ => {
            return Json(
                serde_json::json!({ "success": false, "error": "Discord token is not configured for this agent." }),
            );
        }
    };

    let channel_id = match vault.get_secret("discord_channel_id").await {
        Ok(Some(id)) if !id.trim().is_empty() => id,
        _ => {
            return Json(
                serde_json::json!({ "success": false, "error": "Discord channel is not paired for this agent. Send a message in Discord first." }),
            );
        }
    };
    drop(mem);

    let client = reqwest::Client::new();
    let url = format!(
        "https://discord.com/api/v10/channels/{}/messages",
        channel_id.trim()
    );

    match client
        .post(&url)
        .header("Authorization", format!("Bot {}", token.trim()))
        .json(&serde_json::json!({ "content": message }))
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            Json(serde_json::json!({ "success": true, "message": "Discord message sent." }))
        }
        Ok(resp) => {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            Json(
                serde_json::json!({ "success": false, "error": format!("Discord API error ({}): {}", status, body) }),
            )
        }
        Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
    }
}

pub async fn disconnect_telegram(
    Path(agent): Path<String>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let reg = state.registry.lock().await;
    if let Some(mem_mutex) = reg.get(&agent) {
        let mem = mem_mutex.lock().await;
        let vault = crate::core::vault::SecretsVault::new(mem.get_db());
        let _ = vault.remove_secret("telegram_token").await;
        let _ = vault.remove_secret("telegram_chat_id").await;
        let _ = vault.remove_secret("telegram_pairing_code").await;
        let _ = vault.remove_secret("telegram_pairing_chat_id").await;
        Json(serde_json::json!({ "success": true, "message": "Telegram disconnected." }))
    } else {
        Json(serde_json::json!({ "success": false, "error": "Agent not found" }))
    }
}

#[derive(serde::Deserialize)]
pub struct SetTelegramSttRequest {
    enabled: bool,
    token: Option<String>,
}

pub async fn set_discord_token(
    Path(agent): Path<String>,
    State(state): State<AppState>,
    Json(payload): Json<SetChannelTokenRequest>,
) -> Json<serde_json::Value> {
    if payload.token.trim().is_empty() {
        return Json(
            serde_json::json!({ "success": false, "error": "Discord token cannot be empty." }),
        );
    }

    if let Some(owner) =
        find_agent_with_secret_value(&state, "discord_token", &payload.token, &agent).await
    {
        return Json(serde_json::json!({
            "success": false,
            "error": format!(
                "This Discord bot token is already bound to agent '{}'. One Discord bot can only be bound to one agent.",
                owner
            )
        }));
    }

    let reg = state.registry.lock().await;
    if let Some(mem_mutex) = reg.get(&agent) {
        let mem = mem_mutex.lock().await;
        let vault = crate::core::vault::SecretsVault::new(mem.get_db());
        match vault.set_secret("discord_token", &payload.token).await {
            Ok(_) => Json(
                serde_json::json!({ "success": true, "message": "Discord token saved. Restart gateway to activate the bot." }),
            ),
            Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
        }
    } else {
        Json(serde_json::json!({ "success": false, "error": "Agent not found" }))
    }
}

pub async fn disconnect_discord(
    Path(agent): Path<String>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let reg = state.registry.lock().await;
    if let Some(mem_mutex) = reg.get(&agent) {
        let mem = mem_mutex.lock().await;
        let vault = crate::core::vault::SecretsVault::new(mem.get_db());
        let _ = vault.remove_secret("discord_token").await;
        Json(serde_json::json!({ "success": true, "message": "Discord disconnected." }))
    } else {
        Json(serde_json::json!({ "success": false, "error": "Agent not found" }))
    }
}

pub async fn set_telegram_stt(
    Path(agent): Path<String>,
    State(state): State<AppState>,
    Json(payload): Json<SetTelegramSttRequest>,
) -> Json<serde_json::Value> {
    let reg = state.registry.lock().await;
    if let Some(mem_mutex) = reg.get(&agent) {
        let mem = mem_mutex.lock().await;
        let vault = crate::core::vault::SecretsVault::new(mem.get_db());

        let enabled_str = if payload.enabled { "true" } else { "false" };
        if let Err(e) = vault.set_secret("telegram_stt_enabled", enabled_str).await {
            return Json(serde_json::json!({ "success": false, "error": e.to_string() }));
        }

        if let Some(ref token) = payload.token
            && !token.trim().is_empty()
            && let Err(e) = vault.set_secret("telegram_stt_token", token).await
        {
            return Json(serde_json::json!({ "success": false, "error": e.to_string() }));
        }

        Json(serde_json::json!({ "success": true, "message": "Telegram STT configuration saved." }))
    } else {
        Json(serde_json::json!({ "success": false, "error": "Agent not found" }))
    }
}
