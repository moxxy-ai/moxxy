use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use moxxy_channel::TelegramTransport;
use moxxy_core::{BindingEntry, ChannelDoc, ChannelStore};
use moxxy_storage::VaultSecretRefRow;
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

    // Store vault ref in DB (secrets stay in DB)
    {
        let db = state.db.lock().unwrap();
        db.vault_refs().insert(&secret_ref).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal", "message": format!("Failed to store secret ref: {}", e)})),
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

    // Create channel on disk
    let doc = ChannelDoc {
        channel_type: body.channel_type.clone(),
        display_name: body.display_name.clone(),
        vault_secret_ref_id: secret_ref_id,
        status: "active".into(),
        config: body.config.clone(),
        created_at: now.clone(),
        updated_at: now.clone(),
    };
    ChannelStore::create(&state.moxxy_home, &channel_id, &doc).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": format!("Failed to create channel: {}", e)})),
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
    let channels = ChannelStore::list(&state.moxxy_home);

    let result: Vec<serde_json::Value> = channels
        .iter()
        .map(|(id, doc)| {
            serde_json::json!({
                "id": id,
                "channel_type": doc.channel_type,
                "display_name": doc.display_name,
                "status": doc.status,
                "created_at": doc.created_at
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
    let doc = ChannelStore::load(&state.moxxy_home, &id).map_err(|_| {
        (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "not_found", "message": "Channel not found"})),
        )
    })?;

    Ok(Json(serde_json::json!({
        "id": id,
        "channel_type": doc.channel_type,
        "display_name": doc.display_name,
        "status": doc.status,
        "created_at": doc.created_at
    })))
}

pub async fn delete_channel(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::ChannelsWrite)?;

    tracing::info!(channel_id = %id, "Deleting channel");
    ChannelStore::delete(&state.moxxy_home, &id).map_err(|_| {
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

    // Brute-force protection: 5 attempts per 5-minute window per channel
    {
        let mut attempts = state.pairing_attempts.lock().unwrap();
        let now = chrono::Utc::now();
        let entry = attempts.entry(channel_id.clone()).or_insert((0, now));

        // Reset window if expired
        if now.signed_duration_since(entry.1) >= chrono::Duration::minutes(5) {
            *entry = (0, now);
        }

        if entry.0 >= 5 {
            tracing::warn!(channel_id = %channel_id, "Pairing brute-force protection triggered");
            return Err((
                StatusCode::TOO_MANY_REQUESTS,
                Json(serde_json::json!({
                    "error": "rate_limited",
                    "message": "Too many pairing attempts. Try again in 5 minutes."
                })),
            ));
        }

        entry.0 += 1;
    }

    // Verify channel exists on disk
    ChannelStore::load(&state.moxxy_home, &channel_id).map_err(|_| {
        (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "not_found", "message": "Channel not found"})),
        )
    })?;

    // Use PairingService from the bridge to consume the code
    let bridge_lock = state.channel_bridge.lock().map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": "Bridge not available"})),
        )
    })?;

    // If bridge isn't started yet, fall back to direct pairing via ChannelStore
    // We need the pairing service from the bridge, but if it's not available,
    // do a manual pair by creating the binding directly.
    if bridge_lock.is_none() {
        // Direct binding creation (no pairing code validation, just for API use)
        let mut bindings = ChannelStore::load_bindings(&state.moxxy_home, &channel_id);

        // Remove existing active bindings (one agent per channel)
        bindings.0.retain(|_, entry| entry.status != "active");

        let now = chrono::Utc::now().to_rfc3339();
        let external_chat_id = body.code.clone(); // In API-only mode, code might be the chat ID
        bindings.0.insert(
            external_chat_id.clone(),
            BindingEntry {
                agent_name: body.agent_id.clone(),
                status: "active".into(),
                created_at: now.clone(),
            },
        );
        ChannelStore::save_bindings(&state.moxxy_home, &channel_id, &bindings).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal", "message": format!("Failed to save bindings: {}", e)})),
            )
        })?;

        // Clear brute-force counter on success
        {
            let mut attempts = state.pairing_attempts.lock().unwrap();
            attempts.remove(&channel_id);
        }

        return Ok((
            StatusCode::CREATED,
            Json(serde_json::json!({
                "channel_id": channel_id,
                "agent_id": body.agent_id,
                "external_chat_id": external_chat_id,
                "status": "active"
            })),
        ));
    }

    // Bridge is available - use PairingService to resolve the real external_chat_id
    // from the 6-digit pairing code (generated when user sent /start on the platform).
    let bridge = bridge_lock.as_ref().unwrap().clone();
    drop(bridge_lock);

    match bridge.consume_pairing_code(&body.code, &body.agent_id) {
        Ok(consumed) => {
            // Clear brute-force counter on success
            {
                let mut attempts = state.pairing_attempts.lock().unwrap();
                attempts.remove(&channel_id);
            }

            Ok((
                StatusCode::CREATED,
                Json(serde_json::json!({
                    "channel_id": consumed.channel_id,
                    "agent_id": consumed.agent_name,
                    "external_chat_id": consumed.external_chat_id,
                    "status": "active"
                })),
            ))
        }
        Err(e) => {
            tracing::warn!(
                channel_id = %channel_id,
                code = %body.code,
                error = %e,
                "Pairing code consumption failed"
            );
            Err((
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "pairing_failed",
                    "message": format!("Invalid or expired pairing code: {}", e)
                })),
            ))
        }
    }
}

pub async fn list_bindings(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(channel_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::ChannelsRead)?;

    tracing::debug!(channel_id = %channel_id, "Listing channel bindings");
    let bindings = ChannelStore::find_bindings_by_channel(&state.moxxy_home, &channel_id);

    let result: Vec<serde_json::Value> = bindings
        .iter()
        .map(|(chat_id, entry)| {
            serde_json::json!({
                "channel_id": channel_id,
                "agent_id": entry.agent_name,
                "external_chat_id": chat_id,
                "status": entry.status,
                "created_at": entry.created_at
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

    let mut bindings = ChannelStore::load_bindings(&state.moxxy_home, &channel_id);

    // binding_id is the external_chat_id in the new system
    if bindings.0.remove(&binding_id).is_none() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "not_found", "message": "Binding not found"})),
        ));
    }

    ChannelStore::save_bindings(&state.moxxy_home, &channel_id, &bindings).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": "Failed to save bindings"})),
        )
    })?;

    Ok(Json(
        serde_json::json!({"deleted": true, "channel_id": channel_id}),
    ))
}
