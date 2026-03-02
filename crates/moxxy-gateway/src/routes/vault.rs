use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use moxxy_storage::{VaultGrantRow, VaultSecretRefRow};
use moxxy_types::TokenScope;
use std::sync::Arc;

use crate::auth_extractor::{AuthToken, check_scope};
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

pub async fn list_secrets(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::VaultRead)?;

    let db = state.db.lock().unwrap();
    let refs = db.vault_refs().list_all().map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": "Database error"})),
        )
    })?;

    let result: Vec<serde_json::Value> = refs
        .iter()
        .map(|r| {
            serde_json::json!({
                "id": r.id,
                "key_name": r.key_name,
                "backend_key": r.backend_key,
                "policy_label": r.policy_label,
                "created_at": r.created_at
            })
        })
        .collect();

    Ok(Json(serde_json::json!(result)))
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
            Json(
                serde_json::json!({"error": "internal", "message": "Failed to create secret ref"}),
            ),
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

pub async fn list_grants(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::VaultRead)?;

    let db = state.db.lock().unwrap();
    let grants = db.vault_grants().list_all().map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": "Database error"})),
        )
    })?;

    let result: Vec<serde_json::Value> = grants
        .iter()
        .map(|g| {
            serde_json::json!({
                "id": g.id,
                "agent_id": g.agent_id,
                "secret_ref_id": g.secret_ref_id,
                "created_at": g.created_at,
                "revoked_at": g.revoked_at
            })
        })
        .collect();

    Ok(Json(serde_json::json!(result)))
}

pub async fn revoke_grant(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(grant_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::VaultWrite)?;

    let db = state.db.lock().unwrap();
    db.vault_grants().revoke(&grant_id).map_err(|e| match e {
        moxxy_types::StorageError::NotFound => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "not_found", "message": "Grant not found"})),
        ),
        _ => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": "Database error"})),
        ),
    })?;

    Ok(Json(serde_json::json!({
        "message": "Grant revoked",
        "grant_id": grant_id
    })))
}
