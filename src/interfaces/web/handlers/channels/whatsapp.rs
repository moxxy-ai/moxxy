use axum::{
    Json,
    extract::{Form, Path, State},
};

use super::super::super::AppState;

#[derive(serde::Deserialize)]
pub struct SetWhatsAppConfigRequest {
    pub account_sid: String,
    pub auth_token: String,
    pub from_number: String,
}

pub async fn set_whatsapp_config(
    Path(agent): Path<String>,
    State(state): State<AppState>,
    Json(payload): Json<SetWhatsAppConfigRequest>,
) -> Json<serde_json::Value> {
    if payload.account_sid.trim().is_empty()
        || payload.auth_token.trim().is_empty()
        || payload.from_number.trim().is_empty()
    {
        return Json(
            serde_json::json!({ "success": false, "error": "account_sid, auth_token, and from_number are all required." }),
        );
    }

    let reg = state.registry.lock().await;
    if let Some(mem_mutex) = reg.get(&agent) {
        let mem = mem_mutex.lock().await;
        let vault = crate::core::vault::SecretsVault::new(mem.get_db());

        if let Err(e) = vault
            .set_secret("whatsapp_account_sid", &payload.account_sid)
            .await
        {
            return Json(serde_json::json!({ "success": false, "error": e.to_string() }));
        }
        if let Err(e) = vault
            .set_secret("whatsapp_auth_token", &payload.auth_token)
            .await
        {
            return Json(serde_json::json!({ "success": false, "error": e.to_string() }));
        }
        if let Err(e) = vault
            .set_secret("whatsapp_from_number", &payload.from_number)
            .await
        {
            return Json(serde_json::json!({ "success": false, "error": e.to_string() }));
        }
        // Also mark whatsapp as enabled
        let _ = vault.set_secret("whatsapp_enabled", "true").await;

        Json(
            serde_json::json!({ "success": true, "message": "WhatsApp (Twilio) configuration saved. Restart gateway to activate." }),
        )
    } else {
        Json(serde_json::json!({ "success": false, "error": "Agent not found" }))
    }
}

#[derive(serde::Deserialize)]
pub struct WhatsAppSendRequest {
    message: String,
}

pub async fn send_whatsapp_message(
    Path(agent): Path<String>,
    State(state): State<AppState>,
    Form(payload): Form<WhatsAppSendRequest>,
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

    let account_sid = match vault.get_secret("whatsapp_account_sid").await {
        Ok(Some(v)) if !v.trim().is_empty() => v,
        _ => {
            return Json(
                serde_json::json!({ "success": false, "error": "WhatsApp account SID is not configured for this agent." }),
            );
        }
    };

    let auth_token = match vault.get_secret("whatsapp_auth_token").await {
        Ok(Some(v)) if !v.trim().is_empty() => v,
        _ => {
            return Json(
                serde_json::json!({ "success": false, "error": "WhatsApp auth token is not configured for this agent." }),
            );
        }
    };

    let from_number = match vault.get_secret("whatsapp_from_number").await {
        Ok(Some(v)) if !v.trim().is_empty() => v,
        _ => {
            return Json(
                serde_json::json!({ "success": false, "error": "WhatsApp sender number is not configured for this agent." }),
            );
        }
    };

    let user_number = match vault.get_secret("whatsapp_user_number").await {
        Ok(Some(v)) if !v.trim().is_empty() => v,
        _ => {
            return Json(
                serde_json::json!({ "success": false, "error": "No WhatsApp user paired. The user must send a message to the bot first." }),
            );
        }
    };
    drop(mem);

    let client = reqwest::Client::new();
    let url = format!(
        "https://api.twilio.com/2010-04-01/Accounts/{}/Messages.json",
        account_sid.trim()
    );

    // Twilio expects the WhatsApp prefix on numbers
    let from = if from_number.starts_with("whatsapp:") {
        from_number.trim().to_string()
    } else {
        format!("whatsapp:{}", from_number.trim())
    };

    let to = if user_number.starts_with("whatsapp:") {
        user_number.trim().to_string()
    } else {
        format!("whatsapp:{}", user_number.trim())
    };

    match client
        .post(&url)
        .basic_auth(account_sid.trim(), Some(auth_token.trim()))
        .form(&[("From", &from), ("To", &to), ("Body", &message.to_string())])
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            Json(serde_json::json!({ "success": true, "message": "WhatsApp message sent." }))
        }
        Ok(resp) => {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            Json(
                serde_json::json!({ "success": false, "error": format!("Twilio API error ({}): {}", status, body) }),
            )
        }
        Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
    }
}

pub async fn disconnect_whatsapp(
    Path(agent): Path<String>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let reg = state.registry.lock().await;
    if let Some(mem_mutex) = reg.get(&agent) {
        let mem = mem_mutex.lock().await;
        let vault = crate::core::vault::SecretsVault::new(mem.get_db());
        let _ = vault.remove_secret("whatsapp_account_sid").await;
        let _ = vault.remove_secret("whatsapp_auth_token").await;
        let _ = vault.remove_secret("whatsapp_from_number").await;
        let _ = vault.remove_secret("whatsapp_user_number").await;
        let _ = vault.remove_secret("whatsapp_enabled").await;
        Json(serde_json::json!({ "success": true, "message": "WhatsApp disconnected." }))
    } else {
        Json(serde_json::json!({ "success": false, "error": "Agent not found" }))
    }
}
