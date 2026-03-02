use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use moxxy_channel::TelegramTransport;
use moxxy_storage::{ChannelBindingRow, ChannelRow, VaultSecretRefRow};
use moxxy_types::TokenScope;
use std::sync::Arc;

use crate::auth_extractor::{AuthToken, check_scope};
use crate::state::AppState;

#[derive(serde::Deserialize)]
pub struct ChannelCreateRequest {
    pub channel_type: String,
    pub display_name: String,
    pub bot_token: String,
    pub config: Option<serde_json::Value>,
}

#[derive(serde::Deserialize)]
pub struct PairRequest {
    pub code: String,
    pub agent_id: String,
}

pub async fn create_channel(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Json(body): Json<ChannelCreateRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::ChannelsWrite)?;

    tracing::info!(channel_type = %body.channel_type, display_name = %body.display_name, "Creating channel");

    let now = chrono::Utc::now().to_rfc3339();
    let channel_id = uuid::Uuid::now_v7().to_string();
    let secret_ref_id = uuid::Uuid::now_v7().to_string();

    // Store bot token reference in vault_secret_refs
    let secret_ref = VaultSecretRefRow {
        id: secret_ref_id.clone(),
        key_name: format!("channel:{}:bot_token", channel_id),
        backend_key: format!("keyring://moxxy/channel-{}", channel_id),
        policy_label: Some("channel".into()),
        created_at: now.clone(),
        updated_at: now.clone(),
    };

    let channel = ChannelRow {
        id: channel_id.clone(),
        channel_type: body.channel_type.clone(),
        display_name: body.display_name.clone(),
        vault_secret_ref_id: secret_ref_id,
        status: "active".into(),
        config_json: body
            .config
            .as_ref()
            .map(|c| serde_json::to_string(c).unwrap_or_default()),
        created_at: now.clone(),
        updated_at: now.clone(),
    };

    // Store vault ref in DB
    {
        let db = state.db.lock().unwrap();
        db.vault_refs().insert(&secret_ref).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal", "message": format!("Failed to store secret ref: {}", e)})),
            )
        })?;
        db.channels().insert(&channel).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal", "message": format!("Failed to create channel: {}", e)})),
            )
        })?;
    }

    // Store actual bot token in vault backend
    state.vault_backend.set_secret(&secret_ref.backend_key, &body.bot_token).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": format!("Failed to store bot token: {}", e)})),
        )
    })?;

    tracing::debug!(channel_id = %channel_id, "Bot token stored in vault backend");

    // Register transport on running bridge if it's a Telegram channel
    if body.channel_type == "telegram" {
        let transport = Arc::new(TelegramTransport::new(body.bot_token.clone()));
        if let Ok(bridge_lock) = state.channel_bridge.lock()
            && let Some(bridge) = bridge_lock.as_ref()
        {
            bridge.add_transport(channel_id.clone(), transport);
        }
    }

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": channel_id,
            "channel_type": body.channel_type,
            "display_name": body.display_name,
            "status": "active",
            "created_at": now
        })),
    ))
}

pub async fn list_channels(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::ChannelsRead)?;

    tracing::debug!("Listing channels");
    let db = state.db.lock().unwrap();
    let channels = db.channels().list_all().map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": "Database error"})),
        )
    })?;

    let result: Vec<serde_json::Value> = channels
        .iter()
        .map(|c| {
            serde_json::json!({
                "id": c.id,
                "channel_type": c.channel_type,
                "display_name": c.display_name,
                "status": c.status,
                "created_at": c.created_at
            })
        })
        .collect();

    Ok(Json(serde_json::json!(result)))
}

pub async fn get_channel(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::ChannelsRead)?;

    tracing::debug!(channel_id = %id, "Getting channel");
    let db = state.db.lock().unwrap();
    let channel = db
        .channels()
        .find_by_id(&id)
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal", "message": "Database error"})),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "not_found", "message": "Channel not found"})),
            )
        })?;

    Ok(Json(serde_json::json!({
        "id": channel.id,
        "channel_type": channel.channel_type,
        "display_name": channel.display_name,
        "status": channel.status,
        "created_at": channel.created_at
    })))
}

pub async fn delete_channel(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::ChannelsWrite)?;

    tracing::info!(channel_id = %id, "Deleting channel");
    let db = state.db.lock().unwrap();
    db.channels().delete(&id).map_err(|_| {
        (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "not_found", "message": "Channel not found"})),
        )
    })?;

    Ok(Json(serde_json::json!({"deleted": true})))
}

pub async fn pair_channel(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(channel_id): Path<String>,
    Json(body): Json<PairRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::ChannelsWrite)?;

    tracing::info!(channel_id = %channel_id, agent_id = %body.agent_id, "Pairing channel");

    let db = state.db.lock().unwrap();

    // Verify channel exists
    db.channels()
        .find_by_id(&channel_id)
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal", "message": "Database error"})),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "not_found", "message": "Channel not found"})),
            )
        })?;

    // Find and validate pairing code
    let pairing = db
        .channel_pairing()
        .find_by_code(&body.code)
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal", "message": "Database error"})),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "invalid_code", "message": "Pairing code not found"})),
            )
        })?;

    if pairing.consumed {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(
                serde_json::json!({"error": "invalid_code", "message": "Pairing code already used"}),
            ),
        ));
    }

    // Check expiry
    if let Ok(expires_at) = pairing.expires_at.parse::<chrono::DateTime<chrono::Utc>>()
        && expires_at < chrono::Utc::now()
    {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "expired_code", "message": "Pairing code expired"})),
        ));
    }

    // Consume code
    db.channel_pairing().consume(&pairing.id).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": "Failed to consume code"})),
        )
    })?;

    tracing::debug!(channel_id = %channel_id, "Pairing code consumed");

    // One agent per channel: remove existing binding if any
    let existing_bindings = db
        .channel_bindings()
        .find_by_channel(&pairing.channel_id)
        .unwrap_or_default();
    for existing in &existing_bindings {
        let _ = db.channel_bindings().delete(&existing.id);
    }

    // Create binding
    let now = chrono::Utc::now().to_rfc3339();
    let binding_id = uuid::Uuid::now_v7().to_string();
    let binding = ChannelBindingRow {
        id: binding_id.clone(),
        channel_id: pairing.channel_id.clone(),
        agent_id: body.agent_id.clone(),
        external_chat_id: pairing.external_chat_id.clone(),
        status: "active".into(),
        created_at: now.clone(),
        updated_at: now,
    };

    db.channel_bindings().insert(&binding).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": "Failed to create binding"})),
        )
    })?;

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": binding_id,
            "channel_id": pairing.channel_id,
            "agent_id": body.agent_id,
            "external_chat_id": pairing.external_chat_id,
            "status": "active"
        })),
    ))
}

pub async fn list_bindings(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(channel_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::ChannelsRead)?;

    tracing::debug!(channel_id = %channel_id, "Listing channel bindings");
    let db = state.db.lock().unwrap();
    let bindings = db
        .channel_bindings()
        .find_by_channel(&channel_id)
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal", "message": "Database error"})),
            )
        })?;

    let result: Vec<serde_json::Value> = bindings
        .iter()
        .map(|b| {
            serde_json::json!({
                "id": b.id,
                "channel_id": b.channel_id,
                "agent_id": b.agent_id,
                "external_chat_id": b.external_chat_id,
                "status": b.status,
                "created_at": b.created_at
            })
        })
        .collect();

    Ok(Json(serde_json::json!(result)))
}

pub async fn unbind(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path((channel_id, binding_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::ChannelsWrite)?;

    tracing::info!(channel_id = %channel_id, binding_id = %binding_id, "Unbinding channel");
    let db = state.db.lock().unwrap();
    db.channel_bindings().delete(&binding_id).map_err(|_| {
        (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "not_found", "message": "Binding not found"})),
        )
    })?;

    Ok(Json(
        serde_json::json!({"deleted": true, "channel_id": channel_id}),
    ))
}
