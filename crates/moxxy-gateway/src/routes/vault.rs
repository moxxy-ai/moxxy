use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use moxxy_storage::{VaultGrantRow, VaultSecretRefRow};
use moxxy_types::TokenScope;
use std::sync::Arc;

use crate::auth_extractor::{check_scope, AuthToken};
use crate::state::AppState;

#[derive(serde::Deserialize)]
pub struct SecretRefCreateRequest {
    pub key_name: String,
    pub backend_key: String,
    pub policy_label: Option<String>,
}

#[derive(serde::Deserialize)]
pub struct GrantCreateRequest {
    pub agent_id: String,
    pub secret_ref_id: String,
}

pub async fn create_secret_ref(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Json(body): Json<SecretRefCreateRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::VaultWrite)?;

    let now = chrono::Utc::now().to_rfc3339();
    let id = uuid::Uuid::now_v7().to_string();

    let row = VaultSecretRefRow {
        id: id.clone(),
        key_name: body.key_name.clone(),
        backend_key: body.backend_key.clone(),
        policy_label: body.policy_label.clone(),
        created_at: now.clone(),
        updated_at: now.clone(),
    };

    let db = state.db.lock().unwrap();
    db.vault_refs().insert(&row).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": "Failed to create secret ref"})),
        )
    })?;

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": id,
            "key_name": body.key_name,
            "backend_key": body.backend_key,
            "policy_label": body.policy_label,
            "created_at": now
        })),
    ))
}

pub async fn create_grant(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Json(body): Json<GrantCreateRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::VaultWrite)?;

    let now = chrono::Utc::now().to_rfc3339();
    let id = uuid::Uuid::now_v7().to_string();

    let row = VaultGrantRow {
        id: id.clone(),
        agent_id: body.agent_id.clone(),
        secret_ref_id: body.secret_ref_id.clone(),
        created_at: now.clone(),
        revoked_at: None,
    };

    let db = state.db.lock().unwrap();
    db.vault_grants().insert(&row).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": "Failed to create grant"})),
        )
    })?;

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": id,
            "agent_id": body.agent_id,
            "secret_ref_id": body.secret_ref_id,
            "created_at": now
        })),
    ))
}
