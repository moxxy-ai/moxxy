use axum::Json;
use axum::extract::{Request, State};
use axum::http::StatusCode;
use moxxy_core::ApiTokenService;
use moxxy_storage::StoredTokenRow;
use moxxy_types::TokenScope;
use std::sync::Arc;

use crate::auth_extractor::{AuthToken, check_scope};
use crate::state::AppState;

#[derive(serde::Deserialize)]
pub struct TokenCreateRequest {
    pub scopes: Vec<TokenScope>,
    pub ttl_seconds: Option<i64>,
    pub description: Option<String>,
}

fn try_extract_token(state: &AppState, headers: &axum::http::HeaderMap) -> Option<StoredTokenRow> {
    let auth_header = headers.get("authorization")?.to_str().ok()?;
    let token_str = auth_header.strip_prefix("Bearer ")?;
    let hash = ApiTokenService::hash(token_str);
    let db = state.db.lock().unwrap();
    let stored = db.tokens().find_by_hash(&hash).ok()??;
    if stored.status == "revoked" {
        return None;
    }
    if let Some(ref exp) = stored.expires_at
        && let Ok(expires) = exp.parse::<chrono::DateTime<chrono::Utc>>()
        && expires < chrono::Utc::now()
    {
        return None;
    }
    Some(stored)
}

pub async fn create_token(
    State(state): State<Arc<AppState>>,
    req: Request,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    let (parts, body) = req.into_parts();
    let body_bytes = axum::body::to_bytes(body, 1024 * 1024).await.map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "bad_request", "message": "Invalid request body"})),
        )
    })?;
    let body: TokenCreateRequest = serde_json::from_slice(&body_bytes).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "bad_request", "message": "Invalid JSON body"})),
        )
    })?;

    let db = state.db.lock().unwrap();
    let existing_tokens = db.tokens().list_all().map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": "Database error"})),
        )
    })?;

    let is_bootstrap = existing_tokens.is_empty();
    drop(db);

    if is_bootstrap {
        tracing::info!("Bootstrap token creation (no existing tokens)");
    }

    if !is_bootstrap {
        let token = try_extract_token(&state, &parts.headers).ok_or_else(|| {
            (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({"error": "unauthorized", "message": "Authentication required"})),
            )
        })?;
        check_scope(&token, &TokenScope::TokensAdmin)?;
    }

    let created_by = body.description.as_deref().unwrap_or("api");
    let ttl = body.ttl_seconds.map(chrono::Duration::seconds);
    tracing::info!(
        created_by,
        scopes_count = body.scopes.len(),
        has_ttl = ttl.is_some(),
        "Creating API token"
    );
    let (plaintext, issued) = ApiTokenService::issue(created_by, body.scopes, ttl);

    let row = StoredTokenRow {
        id: issued.id.clone(),
        created_by: issued.created_by,
        token_hash: issued.token_hash,
        scopes_json: issued.scopes_json.clone(),
        created_at: issued.created_at.clone(),
        expires_at: issued.expires_at.clone(),
        status: issued.status,
    };

    let db = state.db.lock().unwrap();
    db.tokens().insert(&row).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": "Failed to store token"})),
        )
    })?;

    let scopes: Vec<TokenScope> = serde_json::from_str(&issued.scopes_json).unwrap_or_default();

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": issued.id,
            "token": plaintext,
            "scopes": scopes,
            "created_at": issued.created_at,
            "expires_at": issued.expires_at,
            "status": "active"
        })),
    ))
}

pub async fn list_tokens(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::TokensAdmin)?;

    tracing::debug!("Listing API tokens");
    let db = state.db.lock().unwrap();
    let tokens = db.tokens().list_all().map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": "Database error"})),
        )
    })?;

    let result: Vec<serde_json::Value> = tokens
        .iter()
        .map(|t| {
            let scopes: Vec<TokenScope> = serde_json::from_str(&t.scopes_json).unwrap_or_default();
            serde_json::json!({
                "id": t.id,
                "scopes": scopes,
                "created_at": t.created_at,
                "expires_at": t.expires_at,
                "status": t.status
            })
        })
        .collect();

    Ok(Json(serde_json::json!(result)))
}

pub async fn revoke_token(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::TokensAdmin)?;

    tracing::info!(token_id = %id, "Revoking API token");
    let db = state.db.lock().unwrap();
    db.tokens().revoke(&id).map_err(|e| match e {
        moxxy_types::StorageError::NotFound => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "not_found", "message": "Token not found"})),
        ),
        _ => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": "Database error"})),
        ),
    })?;

    Ok(StatusCode::OK)
}
