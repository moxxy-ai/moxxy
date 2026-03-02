use axum::extract::FromRef;
use moxxy_core::ApiTokenService;
use moxxy_storage::StoredTokenRow;
use std::sync::Arc;

use crate::state::AppState;

pub struct AuthToken(pub StoredTokenRow);

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
        let auth_header = parts
            .headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| {
                (
                    axum::http::StatusCode::UNAUTHORIZED,
                    axum::Json(serde_json::json!({
                        "error": "unauthorized",
                        "message": "Missing authorization header"
                    })),
                )
            })?;

        let token = auth_header.strip_prefix("Bearer ").ok_or_else(|| {
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
                (
                    axum::http::StatusCode::UNAUTHORIZED,
                    axum::Json(serde_json::json!({
                        "error": "unauthorized",
                        "message": "Invalid token"
                    })),
                )
            })?;

        if stored.status == "revoked" {
            return Err((
                axum::http::StatusCode::UNAUTHORIZED,
                axum::Json(serde_json::json!({
                    "error": "unauthorized",
                    "message": "Token revoked"
                })),
            ));
        }

        if let Some(ref exp) = stored.expires_at {
            if let Ok(expires) = exp.parse::<chrono::DateTime<chrono::Utc>>() {
                if expires < chrono::Utc::now() {
                    return Err((
                        axum::http::StatusCode::UNAUTHORIZED,
                        axum::Json(serde_json::json!({
                            "error": "unauthorized",
                            "message": "Token expired"
                        })),
                    ));
                }
            }
        }

        Ok(AuthToken(stored))
    }
}

pub fn check_scope(
    token: &StoredTokenRow,
    required: &moxxy_types::TokenScope,
) -> Result<(), (axum::http::StatusCode, axum::Json<serde_json::Value>)> {
    let scopes: Vec<moxxy_types::TokenScope> =
        serde_json::from_str(&token.scopes_json).map_err(|_| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({
                    "error": "internal",
                    "message": "Invalid scope data"
                })),
            )
        })?;
    if scopes.contains(required) {
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
