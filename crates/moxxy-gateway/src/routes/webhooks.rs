use axum::Json;
use axum::body::Bytes;
use axum::extract::{ConnectInfo, Path, State};
use axum::http::{HeaderMap, StatusCode};
use hmac::{Hmac, Mac};
use moxxy_core::{LoadedWebhook, WebhookCreateInput, WebhookLoader, WebhookStore, render_template};
use moxxy_storage::WebhookDeliveryRow;
use moxxy_types::{EventEnvelope, EventType, TokenScope};
use sha2::Sha256;
use std::net::SocketAddr;
use std::sync::Arc;

use crate::auth_extractor::{AuthToken, check_scope};
use crate::run_service::{QueuedRun, StartRunOutcome};
use crate::state::AppState;

type HmacSha256 = Hmac<Sha256>;

/// Unauthenticated handler for `POST /v1/hooks/{token}`.
/// Three-mode auth: token-only, X-Webhook-Secret, or x-hub-signature-256.
pub async fn receive_webhook(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(token): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    tracing::info!(token = %token, source = %addr, "Inbound webhook received");

    // Look up webhook by token in the in-memory index
    let loaded = {
        let index = state.webhook_index.read().unwrap();
        index.get(&token).cloned()
    };

    let loaded = match loaded {
        Some(w) => w,
        None => {
            tracing::warn!(token = %token, "Webhook token not found in index");
            return Err((
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "not_found", "message": "Unknown webhook token"})),
            ));
        }
    };

    if !loaded.doc.enabled {
        return Err((
            StatusCode::GONE,
            Json(serde_json::json!({"error": "disabled", "message": "Webhook is disabled"})),
        ));
    }

    // Resolve secret from vault if secret_ref is configured
    let secret = match loaded.doc.secret_ref.as_deref() {
        Some(key_name) if !key_name.is_empty() => {
            let db = state.db.lock().unwrap();
            let secret_ref = db
                .vault_refs()
                .find_by_key_name(key_name)
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
            let val = state
                .vault_backend
                .get_secret(&secret_ref.backend_key)
                .map_err(|_| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(serde_json::json!({"error": "internal", "message": "Vault error"})),
                    )
                })?;
            Some(val)
        }
        _ => None,
    };

    // Three-mode auth:
    // 1. No secret configured → token-only, always valid
    // 2. X-Webhook-Secret header → simple string comparison
    // 3. x-hub-signature-256 header → HMAC-SHA256 (GitHub/Stripe compatible)
    let signature_valid = match &secret {
        None => true,
        Some(s) => {
            let simple_match = headers
                .get("x-webhook-secret")
                .and_then(|v| v.to_str().ok())
                .map(|h| h == s.as_str())
                .unwrap_or(false);

            if simple_match {
                true
            } else {
                let hmac_header = headers
                    .get("x-hub-signature-256")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("");
                verify_hmac_signature(s, &body, hmac_header)
            }
        }
    };

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
        tracing::warn!(agent = %loaded.agent_name, label = %loaded.doc.label, "Webhook HMAC signature verification failed");
        // Record failed delivery
        let delivery = WebhookDeliveryRow {
            id: uuid::Uuid::now_v7().to_string(),
            webhook_id: token.clone(),
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

    let event_type = headers
        .get("x-github-event")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown")
        .to_string();

    tracing::info!(
        agent = %loaded.agent_name,
        label = %loaded.doc.label,
        event_type = %event_type,
        signature_valid,
        has_secret = loaded.doc.secret_ref.is_some(),
        has_body = !loaded.doc.body.is_empty(),
        "Webhook validated"
    );

    // Check event_filter if configured.
    // Supports dot-notation: "issues.opened" matches event_type="issues" + body.action="opened".
    // Plain entries like "push" match only the event_type header.
    if let Some(ref filter) = loaded.doc.event_filter {
        let body_action = serde_json::from_str::<serde_json::Value>(&body_str)
            .ok()
            .and_then(|v| v["action"].as_str().map(String::from));

        let allowed: Vec<&str> = filter.split(',').map(|s| s.trim()).collect();
        let matches = allowed.iter().any(|entry| {
            if let Some((evt, act)) = entry.split_once('.') {
                // Dot-notation: match event_type + body.action
                evt == event_type && body_action.as_deref() == Some(act)
            } else {
                // Plain: match event_type only
                *entry == event_type
            }
        });
        if !matches {
            tracing::info!(
                agent = %loaded.agent_name,
                label = %loaded.doc.label,
                event_type = %event_type,
                filter = %filter,
                "Webhook event filtered out"
            );
            // Accept but don't trigger a run
            let delivery = WebhookDeliveryRow {
                id: uuid::Uuid::now_v7().to_string(),
                webhook_id: token.clone(),
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

    // Check if an agent is actively listening for this webhook
    let listener_tx = {
        if let Ok(mut channels) = state.webhook_listen_channels.lock() {
            channels.remove(&token)
        } else {
            None
        }
    };

    if let Some(tx) = listener_tx {
        let body_json: serde_json::Value = serde_json::from_str(&body_str)
            .unwrap_or_else(|_| serde_json::Value::String(body_str.clone()));

        let listener_payload = serde_json::json!({
            "event_type": event_type,
            "headers": headers_json,
            "body": body_json,
            "source_ip": source_ip,
        });

        let delivery = WebhookDeliveryRow {
            id: uuid::Uuid::now_v7().to_string(),
            webhook_id: token.clone(),
            source_ip: Some(source_ip),
            headers_json: Some(serde_json::to_string(&headers_json).unwrap_or_default()),
            body: Some(body_str),
            signature_valid: true,
            run_id: None,
            error: None,
            created_at: chrono::Utc::now().to_rfc3339(),
        };
        {
            let db = state.db.lock().unwrap();
            let _ = db.webhook_deliveries().insert(&delivery);
        }

        state.event_bus.emit(EventEnvelope::new(
            loaded.agent_name.clone(),
            None,
            None,
            0,
            EventType::WebhookReceived,
            serde_json::json!({
                "webhook_token": token,
                "label": loaded.doc.label,
                "event_type": event_type,
                "delivery_id": delivery.id,
                "mode": "listener",
            }),
        ));

        let _ = tx.send(listener_payload);

        return Ok(Json(serde_json::json!({
            "status": "delivered_to_listener",
            "delivery_id": delivery.id,
        })));
    }

    // Build task for the agent from the webhook doc body (with template rendering)
    let body_json: serde_json::Value = serde_json::from_str(&body_str)
        .unwrap_or_else(|_| serde_json::Value::String(body_str.clone()));

    let vars = serde_json::json!({
        "body": body_json,
        "event_type": event_type,
        "headers": headers_json,
        "source_ip": source_ip,
        "label": loaded.doc.label,
    });

    let task = if loaded.doc.body.is_empty() {
        // Fallback: generic format when no body instructions are provided
        format!(
            "Inbound webhook \"{}\".\nEvent: {}\n\n{}",
            loaded.doc.label, event_type, body_str
        )
    } else {
        render_template(&loaded.doc.body, &vars)
    };

    // Start agent run (or queue if busy)
    let delivery_id = uuid::Uuid::now_v7().to_string();
    let outcome = state
        .run_service
        .start_or_queue_run(QueuedRun {
            agent_name: loaded.agent_name.clone(),
            task: task.clone(),
            source: "webhook".into(),
            metadata: serde_json::json!({
                "delivery_id": delivery_id,
                "webhook_token": token,
                "event_type": event_type,
                "label": loaded.doc.label,
            }),
        })
        .await;

    match outcome {
        Ok(StartRunOutcome::Started { run_id }) => {
            let delivery = WebhookDeliveryRow {
                id: delivery_id.clone(),
                webhook_id: token.clone(),
                source_ip: Some(source_ip),
                headers_json: Some(serde_json::to_string(&headers_json).unwrap_or_default()),
                body: Some(body_str),
                signature_valid: true,
                run_id: Some(run_id.clone()),
                error: None,
                created_at: chrono::Utc::now().to_rfc3339(),
            };
            {
                let db = state.db.lock().unwrap();
                let _ = db.webhook_deliveries().insert(&delivery);
            }
            state.event_bus.emit(EventEnvelope::new(
                loaded.agent_name.clone(),
                Some(run_id.clone()),
                None,
                0,
                EventType::WebhookReceived,
                serde_json::json!({
                    "webhook_token": token,
                    "label": loaded.doc.label,
                    "event_type": event_type,
                    "run_id": run_id,
                    "delivery_id": delivery_id,
                }),
            ));
            Ok(Json(serde_json::json!({
                "status": "accepted",
                "run_id": run_id,
                "delivery_id": delivery_id,
            })))
        }
        Ok(StartRunOutcome::Queued { position }) => {
            let delivery = WebhookDeliveryRow {
                id: delivery_id.clone(),
                webhook_id: token.clone(),
                source_ip: Some(source_ip),
                headers_json: Some(serde_json::to_string(&headers_json).unwrap_or_default()),
                body: Some(body_str),
                signature_valid: true,
                run_id: None,
                error: None,
                created_at: chrono::Utc::now().to_rfc3339(),
            };
            {
                let db = state.db.lock().unwrap();
                let _ = db.webhook_deliveries().insert(&delivery);
            }
            state.event_bus.emit(EventEnvelope::new(
                loaded.agent_name.clone(),
                None,
                None,
                0,
                EventType::WebhookReceived,
                serde_json::json!({
                    "webhook_token": token,
                    "label": loaded.doc.label,
                    "event_type": event_type,
                    "delivery_id": delivery_id,
                    "status": "queued",
                    "queue_position": position,
                }),
            ));
            Ok(Json(serde_json::json!({
                "status": "queued",
                "delivery_id": delivery_id,
                "queue_position": position,
            })))
        }
        Ok(StartRunOutcome::QueueFull) => {
            let delivery = WebhookDeliveryRow {
                id: delivery_id.clone(),
                webhook_id: token.clone(),
                source_ip: Some(source_ip),
                headers_json: Some(serde_json::to_string(&headers_json).unwrap_or_default()),
                body: Some(body_str),
                signature_valid: true,
                run_id: None,
                error: Some("Agent busy and run queue full".into()),
                created_at: chrono::Utc::now().to_rfc3339(),
            };
            {
                let db = state.db.lock().unwrap();
                let _ = db.webhook_deliveries().insert(&delivery);
            }
            Err((
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({
                    "error": "queue_full",
                    "message": "Agent is busy and run queue is full",
                    "delivery_id": delivery_id,
                })),
            ))
        }
        Err(e) => {
            let delivery = WebhookDeliveryRow {
                id: delivery_id.clone(),
                webhook_id: token.clone(),
                source_ip: Some(source_ip),
                headers_json: Some(serde_json::to_string(&headers_json).unwrap_or_default()),
                body: Some(body_str),
                signature_valid: true,
                run_id: None,
                error: Some(e.clone()),
                created_at: chrono::Utc::now().to_rfc3339(),
            };
            {
                let db = state.db.lock().unwrap();
                let _ = db.webhook_deliveries().insert(&delivery);
            }
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "run_failed", "message": e})),
            ))
        }
    }
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
    Path(agent_name): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsRead)?;

    tracing::debug!(agent_name = %agent_name, "Listing webhooks");
    let webhooks = WebhookLoader::load_agent(&state.moxxy_home, &agent_name);

    let base = state.base_url.trim_end_matches('/');
    let result: Vec<serde_json::Value> = webhooks
        .iter()
        .map(|w| {
            serde_json::json!({
                "slug": w.doc.slug(),
                "agent_name": w.agent_name,
                "label": w.doc.label,
                "url": format!("{}/v1/hooks/{}", base, w.doc.token),
                "event_filter": w.doc.event_filter,
                "enabled": w.doc.enabled,
                "has_secret": w.doc.secret_ref.is_some(),
                "has_body": !w.doc.body.is_empty(),
            })
        })
        .collect();

    Ok(Json(serde_json::json!(result)))
}

pub async fn delete_webhook(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path((agent_name, slug)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsWrite)?;

    tracing::info!(agent_name = %agent_name, slug = %slug, "Deleting webhook");

    // Load doc to get token (for index cleanup) and secret_ref (for vault cleanup)
    let doc = WebhookStore::load(&state.moxxy_home, &agent_name, &slug).map_err(|e| {
        (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "not_found", "message": e.to_string()})),
        )
    })?;

    // Clean up vault secret if configured
    if let Some(ref key_name) = doc.secret_ref {
        let secret_ref = {
            let db = state.db.lock().unwrap();
            db.vault_refs().find_by_key_name(key_name).ok().flatten()
        };
        if let Some(ref sr) = secret_ref {
            let _ = state.vault_backend.delete_secret(&sr.backend_key);
        }
    }

    // Delete from filesystem
    WebhookStore::delete(&state.moxxy_home, &agent_name, &slug).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": e.to_string()})),
        )
    })?;

    // Remove from in-memory index
    {
        let mut index = state.webhook_index.write().unwrap();
        index.remove(&doc.token);
    }

    Ok(Json(serde_json::json!({"status": "deleted", "slug": slug})))
}

/// Body for `POST /v1/agents/{name}/webhooks`. Mirrors the fields accepted by
/// the `webhook.register` primitive so operators can register webhooks without
/// starting an agent run.
#[derive(Debug, serde::Deserialize)]
pub struct CreateWebhookBody {
    pub label: String,
    #[serde(default)]
    pub secret: Option<String>,
    #[serde(default)]
    pub event_filter: Option<String>,
    #[serde(default)]
    pub body: Option<String>,
}

pub async fn create_webhook(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(agent_name): Path<String>,
    Json(req): Json<CreateWebhookBody>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsWrite)?;

    if req.label.trim().is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "validation", "message": "label must not be empty"})),
        ));
    }

    let agent_dir = state.moxxy_home.join("agents").join(&agent_name);
    if !agent_dir.exists() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "not_found", "message": "Agent not found"})),
        ));
    }

    tracing::info!(
        agent_name = %agent_name,
        label = %req.label,
        has_secret = req.secret.is_some(),
        "Creating webhook via API"
    );

    // Pre-generate the token so we can derive the vault backend key before
    // writing the webhook file - mirrors the primitive's ordering.
    let token = uuid::Uuid::now_v7().to_string();
    let body = req.body.unwrap_or_default();

    // If a secret was provided, store it in the vault first and create the
    // secret_ref + grant so the inbound receiver can verify HMAC signatures.
    let secret_ref = if let Some(ref secret_val) = req.secret {
        let slug_base: String = req
            .label
            .to_lowercase()
            .chars()
            .map(|c| {
                if c.is_alphanumeric() || c == '-' {
                    c
                } else {
                    '-'
                }
            })
            .collect();
        let key_name = format!("webhook_secret_{}", slug_base);
        let backend_key = format!("webhook_secret_{}", token);

        state
            .vault_backend
            .set_secret(&backend_key, secret_val)
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(
                        serde_json::json!({"error": "internal", "message": format!("vault set_secret: {e}")}),
                    ),
                )
            })?;

        let ref_id = {
            let db = state.db.lock().unwrap();
            // Reuse existing ref if one already exists for this key_name
            // (mirrors PrimitiveContext::create_secret_ref behavior).
            let existing = db.vault_refs().find_by_key_name(&key_name).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(
                        serde_json::json!({"error": "internal", "message": format!("vault ref lookup: {e}")}),
                    ),
                )
            })?;

            if let Some(existing_row) = existing {
                existing_row.id
            } else {
                let now = chrono::Utc::now().to_rfc3339();
                let row = moxxy_storage::VaultSecretRefRow {
                    id: uuid::Uuid::now_v7().to_string(),
                    key_name: key_name.clone(),
                    backend_key: backend_key.clone(),
                    policy_label: Some("webhook".to_string()),
                    created_at: now.clone(),
                    updated_at: now,
                };
                db.vault_refs().insert(&row).map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(
                            serde_json::json!({"error": "internal", "message": format!("vault ref insert: {e}")}),
                        ),
                    )
                })?;
                row.id
            }
        };

        // Grant the agent access to the new ref (idempotent).
        {
            let db = state.db.lock().unwrap();
            let existing_grants = db.vault_grants().find_by_agent(&agent_name).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(
                        serde_json::json!({"error": "internal", "message": format!("vault grant lookup: {e}")}),
                    ),
                )
            })?;
            let already = existing_grants
                .iter()
                .any(|g| g.secret_ref_id == ref_id && g.revoked_at.is_none());
            if !already {
                let now = chrono::Utc::now().to_rfc3339();
                let grant = moxxy_storage::VaultGrantRow {
                    id: uuid::Uuid::now_v7().to_string(),
                    agent_id: agent_name.clone(),
                    secret_ref_id: ref_id,
                    created_at: now,
                    revoked_at: None,
                };
                db.vault_grants().insert(&grant).map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(
                            serde_json::json!({"error": "internal", "message": format!("vault grant insert: {e}")}),
                        ),
                    )
                })?;
            }
        }

        Some(key_name)
    } else {
        None
    };

    let output = WebhookStore::create_from_input(
        &state.moxxy_home,
        &agent_name,
        WebhookCreateInput {
            label: req.label.clone(),
            token: Some(token.clone()),
            event_filter: req.event_filter.clone(),
            body: body.clone(),
            secret_ref,
        },
    )
    .map_err(|e| {
        let msg = e.to_string();
        let status = if msg.contains("already exists") {
            StatusCode::CONFLICT
        } else {
            StatusCode::INTERNAL_SERVER_ERROR
        };
        (
            status,
            Json(serde_json::json!({"error": "webhook_create", "message": msg})),
        )
    })?;

    // Add to in-memory index so the inbound receiver can route immediately.
    {
        let mut index = state.webhook_index.write().unwrap();
        index.insert(token.clone(), output.loaded);
    }

    let base = state.base_url.trim_end_matches('/');
    let url = format!("{}/v1/hooks/{}", base, token);
    let doc = &output.doc;
    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "slug": doc.slug(),
            "label": doc.label,
            "url": url,
            "token": token,
            "enabled": doc.enabled,
            "event_filter": doc.event_filter,
            "has_secret": doc.secret_ref.is_some(),
            "has_body": !body.is_empty(),
        })),
    ))
}

/// Body for `PATCH /v1/agents/{name}/webhooks/{slug}`. All fields are
/// optional; only supplied fields are updated.
#[derive(Debug, serde::Deserialize)]
pub struct UpdateWebhookBody {
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub event_filter: Option<String>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub body: Option<String>,
}

pub async fn update_webhook(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path((agent_name, slug)): Path<(String, String)>,
    Json(req): Json<UpdateWebhookBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsWrite)?;

    tracing::info!(agent_name = %agent_name, slug = %slug, "Updating webhook via API");

    let updated = WebhookStore::update(&state.moxxy_home, &agent_name, &slug, |doc| {
        if let Some(label) = req.label.clone() {
            doc.label = label;
        }
        if let Some(ef) = req.event_filter.clone() {
            doc.event_filter = if ef.is_empty() { None } else { Some(ef) };
        }
        if let Some(enabled) = req.enabled {
            doc.enabled = enabled;
        }
        if let Some(body) = req.body.clone() {
            doc.body = body;
        }
    })
    .map_err(|e| {
        (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "not_found", "message": e.to_string()})),
        )
    })?;

    // Refresh the in-memory index: the token is unchanged, but the label
    // (and therefore the slug/path) may have changed.
    let new_slug = updated.slug();
    {
        let mut index = state.webhook_index.write().unwrap();
        let loaded = LoadedWebhook {
            doc: updated.clone(),
            agent_name: agent_name.clone(),
            path: state
                .moxxy_home
                .join("agents")
                .join(&agent_name)
                .join("webhooks")
                .join(&new_slug)
                .join("WEBHOOK.md"),
        };
        index.insert(updated.token.clone(), loaded);
    }

    let base = state.base_url.trim_end_matches('/');
    Ok(Json(serde_json::json!({
        "slug": new_slug,
        "label": updated.label,
        "url": format!("{}/v1/hooks/{}", base, updated.token),
        "event_filter": updated.event_filter,
        "enabled": updated.enabled,
        "has_secret": updated.secret_ref.is_some(),
        "has_body": !updated.body.is_empty(),
    })))
}

pub async fn list_deliveries(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path((_agent_name, webhook_id)): Path<(String, String)>,
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

/// Rebuild the in-memory webhook index from filesystem.
pub async fn reload_webhooks(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsWrite)?;

    let all_webhooks = WebhookLoader::load_all(&state.moxxy_home);
    let count = all_webhooks.len();
    let mut index = state.webhook_index.write().unwrap();
    index.clear();
    for wh in all_webhooks {
        index.insert(wh.doc.token.clone(), wh);
    }

    tracing::info!(count, "Reloaded webhook index from filesystem");
    Ok(Json(
        serde_json::json!({"status": "reloaded", "count": count}),
    ))
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
