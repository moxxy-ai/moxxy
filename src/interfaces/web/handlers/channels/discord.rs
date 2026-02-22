use axum::{
    Json,
    extract::{Form, Path, State},
};

use super::super::super::AppState;
use super::{SetChannelTokenRequest, find_agent_with_secret_value};

pub async fn set_discord_token(
    Path(agent): Path<String>,
    State(state): State<AppState>,
    Json(payload): Json<SetChannelTokenRequest>,
) -> Json<serde_json::value::Value> {
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
