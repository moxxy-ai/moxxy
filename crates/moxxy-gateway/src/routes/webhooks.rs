use axum::Json;
use axum::body::Bytes;
use axum::extract::{ConnectInfo, Path, State};
use axum::http::{HeaderMap, StatusCode};
use hmac::{Hmac, Mac};
use moxxy_storage::WebhookDeliveryRow;
use moxxy_types::{EventEnvelope, EventType, TokenScope};
use sha2::Sha256;
use std::net::SocketAddr;
use std::sync::Arc;

use crate::auth_extractor::{AuthToken, check_scope};
use crate::state::AppState;

type HmacSha256 = Hmac<Sha256>;

/// Unauthenticated handler for `POST /v1/hooks/{token}`.
/// Verifies HMAC-SHA256 signature and triggers an agent run.
pub async fn receive_webhook(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(token): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    // Look up webhook by token
    let webhook = {
        let db = state.db.lock().unwrap();
        db.webhooks().find_by_token(&token).map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal", "message": "Database error"})),
            )
        })?
    };

    let webhook = match webhook {
        Some(w) => w,
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "not_found", "message": "Unknown webhook token"})),
            ));
        }
    };

    if !webhook.enabled {
        return Err((
            StatusCode::GONE,
            Json(serde_json::json!({"error": "disabled", "message": "Webhook is disabled"})),
        ));
    }

    // Retrieve HMAC secret from vault
    let secret = {
        let db = state.db.lock().unwrap();
        let secret_ref = db
            .vault_refs()
            .find_by_id(&webhook.secret_ref_id)
            .map_err(|_| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": "internal", "message": "Secret ref error"})),
                )
            })?
            .ok_or_else(|| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(
                        serde_json::json!({"error": "internal", "message": "Secret ref not found"}),
                    ),
                )
            })?;
        state
            .vault_backend
            .get_secret(&secret_ref.backend_key)
            .map_err(|_| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": "internal", "message": "Vault error"})),
                )
            })?
    };

    // Verify HMAC-SHA256 signature
    let signature_header = headers
        .get("x-hub-signature-256")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let signature_valid = verify_hmac_signature(&secret, &body, signature_header);

    // Collect headers as JSON
    let headers_json: serde_json::Value = headers
        .iter()
        .map(|(k, v)| {
            (
                k.as_str().to_string(),
                serde_json::Value::String(v.to_str().unwrap_or("").to_string()),
            )
        })
        .collect::<serde_json::Map<String, serde_json::Value>>()
        .into();

    let body_str = String::from_utf8_lossy(&body).to_string();
    let source_ip = addr.ip().to_string();

    if !signature_valid {
        // Record failed delivery
        let delivery = WebhookDeliveryRow {
            id: uuid::Uuid::now_v7().to_string(),
            webhook_id: webhook.id.clone(),
            source_ip: Some(source_ip),
            headers_json: Some(serde_json::to_string(&headers_json).unwrap_or_default()),
            body: Some(body_str),
            signature_valid: false,
            run_id: None,
            error: Some("HMAC signature verification failed".into()),
            created_at: chrono::Utc::now().to_rfc3339(),
        };
        let db = state.db.lock().unwrap();
        let _ = db.webhook_deliveries().insert(&delivery);

        return Err((
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "unauthorized", "message": "Invalid signature"})),
        ));
    }

    // Check event_filter if configured
    let event_type = headers
        .get("x-github-event")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown")
        .to_string();

    if let Some(ref filter) = webhook.event_filter {
        let allowed: Vec<&str> = filter.split(',').map(|s| s.trim()).collect();
        if !allowed.iter().any(|a| *a == event_type) {
            // Silently accept but don't trigger a run
            let delivery = WebhookDeliveryRow {
                id: uuid::Uuid::now_v7().to_string(),
                webhook_id: webhook.id.clone(),
                source_ip: Some(source_ip),
                headers_json: Some(serde_json::to_string(&headers_json).unwrap_or_default()),
                body: Some(body_str),
                signature_valid: true,
                run_id: None,
                error: Some(format!("Event type '{}' filtered out", event_type)),
                created_at: chrono::Utc::now().to_rfc3339(),
            };
            let db = state.db.lock().unwrap();
            let _ = db.webhook_deliveries().insert(&delivery);

            return Ok(Json(serde_json::json!({
                "status": "filtered",
                "message": format!("Event type '{}' not in filter", event_type),
            })));
        }
    }

    // Build task for the agent
    let task = format!(
        "Inbound webhook \"{}\".\nEvent: {}\n\n{}",
        webhook.label, event_type, body_str
    );

    // Start agent run
    let run_result = state
        .run_service
        .do_start_run(&webhook.agent_id, &task)
        .await;

    let (run_id, error) = match run_result {
        Ok(rid) => (Some(rid), None),
        Err(e) => (None, Some(e)),
    };

    // Record delivery
    let delivery = WebhookDeliveryRow {
        id: uuid::Uuid::now_v7().to_string(),
        webhook_id: webhook.id.clone(),
        source_ip: Some(source_ip),
        headers_json: Some(serde_json::to_string(&headers_json).unwrap_or_default()),
        body: Some(body_str),
        signature_valid: true,
        run_id: run_id.clone(),
        error: error.clone(),
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    {
        let db = state.db.lock().unwrap();
        let _ = db.webhook_deliveries().insert(&delivery);
    }

    // Emit WebhookReceived event
    state.event_bus.emit(EventEnvelope::new(
        webhook.agent_id.clone(),
        run_id.clone(),
        None,
        0,
        EventType::WebhookReceived,
        serde_json::json!({
            "webhook_id": webhook.id,
            "label": webhook.label,
            "event_type": event_type,
            "run_id": run_id,
            "delivery_id": delivery.id,
        }),
    ));

    if let Some(err) = error {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "run_failed", "message": err})),
        ));
    }

    Ok(Json(serde_json::json!({
        "status": "accepted",
        "run_id": run_id,
        "delivery_id": delivery.id,
    })))
}

fn verify_hmac_signature(secret: &str, body: &[u8], signature_header: &str) -> bool {
    let expected_hex = signature_header
        .strip_prefix("sha256=")
        .unwrap_or(signature_header);

    let Ok(mut mac) = HmacSha256::new_from_slice(secret.as_bytes()) else {
        return false;
    };
    mac.update(body);

    let Ok(expected_bytes) = hex::decode(expected_hex) else {
        return false;
    };

    mac.verify_slice(&expected_bytes).is_ok()
}

pub async fn list_webhooks(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(agent_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsRead)?;

    tracing::debug!(agent_id = %agent_id, "Listing webhooks");
    let db = state.db.lock().unwrap();
    let webhooks = db.webhooks().find_by_agent(&agent_id).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": "Database error"})),
        )
    })?;

    let base = state.base_url.trim_end_matches('/');
    let result: Vec<serde_json::Value> = webhooks
        .iter()
        .map(|w| {
            serde_json::json!({
                "id": w.id,
                "agent_id": w.agent_id,
                "label": w.label,
                "url": format!("{}/v1/hooks/{}", base, w.token),
                "event_filter": w.event_filter,
                "enabled": w.enabled,
                "created_at": w.created_at,
                "updated_at": w.updated_at,
            })
        })
        .collect();

    Ok(Json(serde_json::json!(result)))
}

pub async fn delete_webhook(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path((_agent_id, webhook_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsWrite)?;

    tracing::info!(webhook_id = %webhook_id, "Deleting webhook");

    // Look up webhook to get the secret_ref_id for cleanup
    let webhook = {
        let db = state.db.lock().unwrap();
        db.webhooks().find_by_id(&webhook_id).map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal", "message": "Database error"})),
            )
        })?
    };

    if let Some(ref wh) = webhook {
        // Clean up vault secret
        let secret_ref = {
            let db = state.db.lock().unwrap();
            db.vault_refs().find_by_id(&wh.secret_ref_id).ok().flatten()
        };
        if let Some(ref sr) = secret_ref {
            let _ = state.vault_backend.delete_secret(&sr.backend_key);
        }
    }

    let db = state.db.lock().unwrap();
    db.webhooks().delete(&webhook_id).map_err(|e| match e {
        moxxy_types::StorageError::NotFound => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "not_found", "message": "Webhook not found"})),
        ),
        _ => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": "Database error"})),
        ),
    })?;

    Ok(Json(
        serde_json::json!({"status": "deleted", "id": webhook_id}),
    ))
}

pub async fn list_deliveries(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path((_agent_id, webhook_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsRead)?;

    tracing::debug!(webhook_id = %webhook_id, "Listing webhook deliveries");
    let db = state.db.lock().unwrap();
    let deliveries = db
        .webhook_deliveries()
        .find_by_webhook(&webhook_id)
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal", "message": "Database error"})),
            )
        })?;

    let result: Vec<serde_json::Value> = deliveries
        .iter()
        .map(|d| {
            serde_json::json!({
                "id": d.id,
                "webhook_id": d.webhook_id,
                "source_ip": d.source_ip,
                "signature_valid": d.signature_valid,
                "run_id": d.run_id,
                "error": d.error,
                "created_at": d.created_at,
            })
        })
        .collect();

    Ok(Json(serde_json::json!(result)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verify_valid_hmac() {
        let secret = "test-secret";
        let body = b"hello world";
        let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(body);
        let sig = hex::encode(mac.finalize().into_bytes());
        let header = format!("sha256={}", sig);
        assert!(verify_hmac_signature(secret, body, &header));
    }

    #[test]
    fn verify_invalid_hmac_fails() {
        assert!(!verify_hmac_signature("secret", b"body", "sha256=deadbeef"));
    }

    #[test]
    fn verify_empty_signature_fails() {
        assert!(!verify_hmac_signature("secret", b"body", ""));
    }

    #[test]
    fn verify_wrong_secret_fails() {
        let body = b"test body";
        let mut mac = HmacSha256::new_from_slice(b"correct-secret").unwrap();
        mac.update(body);
        let sig = hex::encode(mac.finalize().into_bytes());
        let header = format!("sha256={}", sig);
        assert!(!verify_hmac_signature("wrong-secret", body, &header));
    }
}
