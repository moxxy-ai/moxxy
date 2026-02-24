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
    #[serde(default)]
    channel_id: Option<String>,
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

    let channel_id = if let Some(ref override_id) = payload.channel_id {
        let id = override_id.trim().to_string();
        if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) {
            return Json(
                serde_json::json!({ "success": false, "error": "channel_id must be a numeric Discord snowflake." }),
            );
        }
        id
    } else {
        let channels: Vec<String> = match vault.get_secret("discord_listen_channels").await {
            Ok(Some(ref raw)) if !raw.is_empty() => serde_json::from_str(raw).unwrap_or_default(),
            _ => Vec::new(),
        };
        match channels.first() {
            Some(id) => id.clone(),
            None => {
                return Json(
                    serde_json::json!({ "success": false, "error": "No channel_id provided and no listen channels configured. Use discord_channels to find the channel ID first." }),
                );
            }
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
        Ok(resp) if resp.status().is_success() => Json(
            serde_json::json!({ "success": true, "message": format!("Discord message sent to channel {}.", channel_id) }),
        ),
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

/// List all text channels the bot can see across its guilds.
pub async fn list_discord_channels(
    Path(agent): Path<String>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let mem_mutex = {
        let reg = state.registry.lock().await;
        match reg.get(&agent) {
            Some(m) => m.clone(),
            None => {
                return Json(serde_json::json!({ "success": false, "error": "Agent not found" }));
            }
        }
    };

    let mem = mem_mutex.lock().await;
    let vault = crate::core::vault::SecretsVault::new(mem.get_db());

    let token = match vault.get_secret("discord_token").await {
        Ok(Some(t)) if !t.trim().is_empty() => t.trim().to_string(),
        _ => {
            return Json(
                serde_json::json!({ "success": false, "error": "Discord token is not configured for this agent." }),
            );
        }
    };
    drop(mem);

    let client = reqwest::Client::new();

    let guilds_resp = match client
        .get("https://discord.com/api/v10/users/@me/guilds")
        .header("Authorization", format!("Bot {}", token))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return Json(
                serde_json::json!({ "success": false, "error": format!("Failed to fetch guilds: {}", e) }),
            );
        }
    };

    if !guilds_resp.status().is_success() {
        let status = guilds_resp.status();
        let body = guilds_resp.text().await.unwrap_or_default();
        return Json(
            serde_json::json!({ "success": false, "error": format!("Discord API error fetching guilds ({}): {}", status, body) }),
        );
    }

    let guilds: Vec<serde_json::Value> = match guilds_resp.json().await {
        Ok(g) => g,
        Err(e) => {
            return Json(
                serde_json::json!({ "success": false, "error": format!("Failed to parse guilds: {}", e) }),
            );
        }
    };

    let mut all_channels: Vec<serde_json::Value> = Vec::new();

    for guild in &guilds {
        let guild_id = match guild.get("id").and_then(|v| v.as_str()) {
            Some(id) => id,
            None => continue,
        };
        let guild_name = guild
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown");

        let channels_url = format!("https://discord.com/api/v10/guilds/{}/channels", guild_id);
        let channels_resp = match client
            .get(&channels_url)
            .header("Authorization", format!("Bot {}", token))
            .send()
            .await
        {
            Ok(r) if r.status().is_success() => r,
            _ => continue,
        };

        let channels: Vec<serde_json::Value> = match channels_resp.json().await {
            Ok(c) => c,
            Err(_) => continue,
        };

        // type 0 = text channel
        for ch in channels {
            let ch_type = ch.get("type").and_then(|v| v.as_u64()).unwrap_or(999);
            if ch_type != 0 {
                continue;
            }
            let ch_id = ch.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let ch_name = ch.get("name").and_then(|v| v.as_str()).unwrap_or("");
            all_channels.push(serde_json::json!({
                "guild": guild_name,
                "guild_id": guild_id,
                "channel": ch_name,
                "channel_id": ch_id
            }));
        }
    }

    Json(serde_json::json!({ "success": true, "channels": all_channels }))
}

#[derive(serde::Deserialize)]
pub struct DiscordListenChannelRequest {
    pub channel_id: String,
}

async fn read_listen_channels(vault: &crate::core::vault::SecretsVault) -> Vec<String> {
    match vault.get_secret("discord_listen_channels").await {
        Ok(Some(ref raw)) if !raw.is_empty() => serde_json::from_str(raw).unwrap_or_default(),
        _ => Vec::new(),
    }
}

async fn write_listen_channels(
    vault: &crate::core::vault::SecretsVault,
    channels: &[String],
) -> Result<(), String> {
    let json = serde_json::to_string(channels).map_err(|e| e.to_string())?;
    vault
        .set_secret("discord_listen_channels", &json)
        .await
        .map_err(|e| e.to_string())
}

pub async fn get_discord_listen_channels(
    Path(agent): Path<String>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let reg = state.registry.lock().await;
    if let Some(mem_mutex) = reg.get(&agent) {
        let mem = mem_mutex.lock().await;
        let vault = crate::core::vault::SecretsVault::new(mem.get_db());
        let channels = read_listen_channels(&vault).await;
        Json(serde_json::json!({ "success": true, "channels": channels }))
    } else {
        Json(serde_json::json!({ "success": false, "error": "Agent not found" }))
    }
}

pub async fn add_discord_listen_channel(
    Path(agent): Path<String>,
    State(state): State<AppState>,
    Json(payload): Json<DiscordListenChannelRequest>,
) -> Json<serde_json::Value> {
    let channel_id = payload.channel_id.trim().to_string();
    if channel_id.is_empty() || !channel_id.chars().all(|c| c.is_ascii_digit()) {
        return Json(
            serde_json::json!({ "success": false, "error": "channel_id must be a numeric Discord snowflake." }),
        );
    }

    let reg = state.registry.lock().await;
    if let Some(mem_mutex) = reg.get(&agent) {
        let mem = mem_mutex.lock().await;
        let vault = crate::core::vault::SecretsVault::new(mem.get_db());
        let mut channels = read_listen_channels(&vault).await;

        if channels.contains(&channel_id) {
            return Json(serde_json::json!({
                "success": true,
                "message": format!("Channel {} is already in the listen list.", channel_id),
                "channels": channels
            }));
        }

        channels.push(channel_id.clone());
        match write_listen_channels(&vault, &channels).await {
            Ok(_) => Json(serde_json::json!({
                "success": true,
                "message": format!("Channel {} added to listen list.", channel_id),
                "channels": channels
            })),
            Err(e) => Json(serde_json::json!({ "success": false, "error": e })),
        }
    } else {
        Json(serde_json::json!({ "success": false, "error": "Agent not found" }))
    }
}

pub async fn remove_discord_listen_channel(
    Path(agent): Path<String>,
    State(state): State<AppState>,
    Json(payload): Json<DiscordListenChannelRequest>,
) -> Json<serde_json::Value> {
    let channel_id = payload.channel_id.trim().to_string();

    let reg = state.registry.lock().await;
    if let Some(mem_mutex) = reg.get(&agent) {
        let mem = mem_mutex.lock().await;
        let vault = crate::core::vault::SecretsVault::new(mem.get_db());
        let mut channels = read_listen_channels(&vault).await;

        let before_len = channels.len();
        channels.retain(|id| id != &channel_id);

        if channels.len() == before_len {
            return Json(serde_json::json!({
                "success": true,
                "message": format!("Channel {} was not in the listen list.", channel_id),
                "channels": channels
            }));
        }

        match write_listen_channels(&vault, &channels).await {
            Ok(_) => Json(serde_json::json!({
                "success": true,
                "message": format!("Channel {} removed from listen list.", channel_id),
                "channels": channels
            })),
            Err(e) => Json(serde_json::json!({ "success": false, "error": e })),
        }
    } else {
        Json(serde_json::json!({ "success": false, "error": "Agent not found" }))
    }
}

#[derive(serde::Deserialize)]
pub struct SetDiscordListenModeRequest {
    pub mode: String,
}

pub async fn get_discord_listen_mode(
    Path(agent): Path<String>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let reg = state.registry.lock().await;
    if let Some(mem_mutex) = reg.get(&agent) {
        let mem = mem_mutex.lock().await;
        let vault = crate::core::vault::SecretsVault::new(mem.get_db());
        let mode = match vault.get_secret("discord_listen_mode").await {
            Ok(Some(ref m)) if !m.is_empty() => m.clone(),
            _ => "all".to_string(),
        };
        Json(serde_json::json!({ "success": true, "mode": mode }))
    } else {
        Json(serde_json::json!({ "success": false, "error": "Agent not found" }))
    }
}

pub async fn set_discord_listen_mode(
    Path(agent): Path<String>,
    State(state): State<AppState>,
    Json(payload): Json<SetDiscordListenModeRequest>,
) -> Json<serde_json::Value> {
    let mode = payload.mode.trim().to_lowercase();
    if mode != "all" && mode != "mentions" {
        return Json(serde_json::json!({
            "success": false,
            "error": "mode must be 'all' or 'mentions'."
        }));
    }

    let reg = state.registry.lock().await;
    if let Some(mem_mutex) = reg.get(&agent) {
        let mem = mem_mutex.lock().await;
        let vault = crate::core::vault::SecretsVault::new(mem.get_db());
        match vault.set_secret("discord_listen_mode", &mode).await {
            Ok(_) => Json(serde_json::json!({
                "success": true,
                "message": format!("Discord listen mode set to '{}'.", mode)
            })),
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
        let _ = vault.remove_secret("discord_listen_channels").await;
        let _ = vault.remove_secret("discord_listen_mode").await;
        let _ = vault.remove_secret("discord_channel_id").await;
        Json(serde_json::json!({ "success": true, "message": "Discord disconnected." }))
    } else {
        Json(serde_json::json!({ "success": false, "error": "Agent not found" }))
    }
}
