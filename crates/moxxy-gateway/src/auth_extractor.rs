use axum::extract::{ConnectInfo, FromRef};
use moxxy_core::ApiTokenService;
use moxxy_storage::StoredTokenRow;
use std::net::SocketAddr;
use std::sync::Arc;

use crate::state::AppState;

pub struct AuthToken(pub StoredTokenRow);

/// Creates a synthetic token row used when loopback mode bypasses auth.
fn loopback_token() -> StoredTokenRow {
    StoredTokenRow {
        id: "loopback".to_string(),
        created_by: "system".to_string(),
        token_hash: String::new(),
        scopes_json: r#"["*"]"#.to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
        expires_at: None,
        status: "active".to_string(),
    }
}

impl<S: Send + Sync> axum::extract::FromRequestParts<S> for AuthToken
where
    Arc<AppState>: FromRef<S>,
{
    type Rejection = (axum::http::StatusCode, axum::Json<serde_json::Value>);

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &S,
    ) -> Result<Self, Self::Rejection> {
        let app_state = Arc::<AppState>::from_ref(state);
        let path = parts.uri.path().to_string();

        // Loopback bypass: skip auth for localhost connections when enabled
        if app_state.auth_mode.is_loopback()
            && let Some(connect_info) = parts.extensions.get::<ConnectInfo<SocketAddr>>()
            && connect_info.0.ip().is_loopback()
        {
            return Ok(AuthToken(loopback_token()));
        }

        let auth_header = parts
            .headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| {
                tracing::warn!(path = %path, "Auth failure: missing authorization header");
                (
                    axum::http::StatusCode::UNAUTHORIZED,
                    axum::Json(serde_json::json!({
                        "error": "unauthorized",
                        "message": "Missing authorization header"
                    })),
                )
            })?;

        let token = auth_header.strip_prefix("Bearer ").ok_or_else(|| {
            tracing::warn!(path = %path, "Auth failure: invalid authorization format");
            (
                axum::http::StatusCode::UNAUTHORIZED,
                axum::Json(serde_json::json!({
                    "error": "unauthorized",
                    "message": "Invalid authorization format"
                })),
            )
        })?;

        let hash = ApiTokenService::hash(token);
        let db = app_state.db.lock().unwrap();
        let stored = db
            .tokens()
            .find_by_hash(&hash)
            .map_err(|_| {
                (
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    axum::Json(serde_json::json!({
                        "error": "internal",
                        "message": "Database error"
                    })),
                )
            })?
            .ok_or_else(|| {
                tracing::warn!(path = %path, "Auth failure: invalid token");
                (
                    axum::http::StatusCode::UNAUTHORIZED,
                    axum::Json(serde_json::json!({
                        "error": "unauthorized",
                        "message": "Invalid token"
                    })),
                )
            })?;

        if stored.status == "revoked" {
            tracing::warn!(path = %path, token_id = %stored.id, "Auth failure: revoked token");
            return Err((
                axum::http::StatusCode::UNAUTHORIZED,
                axum::Json(serde_json::json!({
                    "error": "unauthorized",
                    "message": "Token revoked"
                })),
            ));
        }

        if let Some(ref exp) = stored.expires_at
            && let Ok(expires) = exp.parse::<chrono::DateTime<chrono::Utc>>()
            && expires < chrono::Utc::now()
        {
            tracing::warn!(path = %path, token_id = %stored.id, "Auth failure: expired token");
            return Err((
                axum::http::StatusCode::UNAUTHORIZED,
                axum::Json(serde_json::json!({
                    "error": "unauthorized",
                    "message": "Token expired"
                })),
            ));
        }

        Ok(AuthToken(stored))
    }
}

pub fn check_scope(
    token: &StoredTokenRow,
    required: &moxxy_types::TokenScope,
) -> Result<(), (axum::http::StatusCode, axum::Json<serde_json::Value>)> {
    // Deserialize known scopes, silently skipping any unrecognised strings
    // so that adding new scope variants never causes a 500 against tokens
    // written by an older or newer version of the gateway.
    let raw: Vec<serde_json::Value> = serde_json::from_str(&token.scopes_json).map_err(|e| {
        tracing::error!(token_id = %token.id, error = %e, "Failed to parse scopes_json");
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({
                "error": "internal",
                "message": "Invalid scope data"
            })),
        )
    })?;
    let scopes: Vec<moxxy_types::TokenScope> = raw
        .into_iter()
        .filter_map(|v| serde_json::from_value(v).ok())
        .collect();

    if scopes.contains(required) || scopes.contains(&moxxy_types::TokenScope::Wildcard) {
        Ok(())
    } else {
        Err((
            axum::http::StatusCode::FORBIDDEN,
            axum::Json(serde_json::json!({
                "error": "forbidden",
                "message": format!("Missing required scope: {:?}", required)
            })),
        ))
    }
}
