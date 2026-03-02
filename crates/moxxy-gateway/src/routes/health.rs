use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use std::sync::Arc;

use crate::state::AppState;

pub async fn health_check(
    State(state): State<Arc<AppState>>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let db_ok = match state.db.lock() {
        Ok(db) => db.conn().execute_batch("SELECT 1").is_ok(),
        Err(_) => false,
    };

    if !db_ok {
        tracing::warn!("Health check failed: database unreachable");
    }

    if db_ok {
        Ok(Json(serde_json::json!({
            "status": "healthy",
            "database": "connected",
            "version": env!("CARGO_PKG_VERSION"),
        })))
    } else {
        Err((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
                "status": "unhealthy",
                "database": "disconnected",
            })),
        ))
    }
}
