use axum::{
    Json,
    extract::{Path, State},
    http::HeaderMap,
};
use tracing::info;

use super::super::AppState;

// === CRUD Handlers ===

pub async fn get_webhooks_endpoint(
    Path(agent): Path<String>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let reg = state.registry.lock().await;
    if let Some(mem_mutex) = reg.get(&agent) {
        let mem = mem_mutex.lock().await;
        match mem.get_all_webhooks().await {
            Ok(webhooks) => Json(serde_json::json!({ "success": true, "webhooks": webhooks })),
            Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
        }
    } else {
        Json(serde_json::json!({ "success": false, "error": "Agent not found" }))
    }
}

#[derive(serde::Deserialize)]
pub struct CreateWebhookRequest {
    name: String,
    source: String,
    #[serde(default)]
    secret: String,
    prompt_template: String,
}

pub async fn create_webhook_endpoint(
    Path(agent): Path<String>,
    State(state): State<AppState>,
    Json(payload): Json<CreateWebhookRequest>,
) -> Json<serde_json::Value> {
    let name = payload.name.trim().to_string();
    let source = payload.source.trim().to_lowercase().to_string();
    let prompt_template = payload.prompt_template.trim().to_string();

    if name.is_empty() || source.is_empty() || prompt_template.is_empty() {
        return Json(serde_json::json!({
            "success": false,
            "error": "name, source, and prompt_template are required"
        }));
    }

    if !source
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        return Json(serde_json::json!({
            "success": false,
            "error": "source must contain only alphanumeric characters, hyphens, and underscores"
        }));
    }

    let mem_arc = {
        let registry = state.registry.lock().await;
        match registry.get(&agent) {
            Some(mem) => mem.clone(),
            None => {
                return Json(serde_json::json!({
                    "success": false,
                    "error": "Agent not found"
                }));
            }
        }
    };

    let mem = mem_arc.lock().await;
    match mem
        .add_webhook(&name, &source, &payload.secret, &prompt_template)
        .await
    {
        Ok(_) => {
            let webhook_url = format!(
                "http://{}:{}/api/webhooks/{}/{}",
                state.api_host, state.web_port, agent, source
            );
            Json(serde_json::json!({
                "success": true,
                "message": "Webhook registered",
                "webhook_url": webhook_url
            }))
        }
        Err(e) => Json(serde_json::json!({
            "success": false,
            "error": format!("Database error: {}", e)
        })),
    }
}

pub async fn delete_webhook_endpoint(
    Path((agent, name)): Path<(String, String)>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Json(serde_json::json!({
            "success": false,
            "error": "webhook name is required"
        }));
    }

    let mem_arc = {
        let registry = state.registry.lock().await;
        match registry.get(&agent) {
            Some(mem) => mem.clone(),
            None => {
                return Json(serde_json::json!({
                    "success": false,
                    "error": "Agent not found"
                }));
            }
        }
    };

    let mem = mem_arc.lock().await;
    match mem.remove_webhook(&name).await {
        Ok(true) => Json(serde_json::json!({ "success": true, "message": "Webhook removed" })),
        Ok(false) => Json(serde_json::json!({ "success": false, "error": "Webhook not found" })),
        Err(e) => Json(serde_json::json!({
            "success": false,
            "error": format!("Database error: {}", e)
        })),
    }
}

#[derive(serde::Deserialize)]
pub struct UpdateWebhookRequest {
    #[serde(default)]
    active: Option<bool>,
}

pub async fn update_webhook_endpoint(
    Path((agent, name)): Path<(String, String)>,
    State(state): State<AppState>,
    Json(payload): Json<UpdateWebhookRequest>,
) -> Json<serde_json::Value> {
    let Some(active) = payload.active else {
        return Json(serde_json::json!({
            "success": false,
            "error": "No fields to update"
        }));
    };

    let mem_arc = {
        let registry = state.registry.lock().await;
        match registry.get(&agent) {
            Some(mem) => mem.clone(),
            None => {
                return Json(serde_json::json!({
                    "success": false,
                    "error": "Agent not found"
                }));
            }
        }
    };

    let mem = mem_arc.lock().await;
    match mem.update_webhook_active(&name, active).await {
        Ok(true) => Json(serde_json::json!({ "success": true, "message": "Webhook updated" })),
        Ok(false) => Json(serde_json::json!({ "success": false, "error": "Webhook not found" })),
        Err(e) => Json(serde_json::json!({
            "success": false,
            "error": format!("Database error: {}", e)
        })),
    }
}

// === Enhanced Incoming Webhook Endpoint ===

pub async fn webhook_endpoint(
    Path((agent, source)): Path<(String, String)>,
    State(state): State<AppState>,
    headers: HeaderMap,
    body: String,
) -> Json<serde_json::Value> {
    let reg = state.registry.lock().await;
    let skill_reg = state.skill_registry.lock().await;
    let llm_reg = state.llm_registry.lock().await;

    if let (Some(mem_sys), Some(skill_sys), Some(llm_sys)) =
        (reg.get(&agent), skill_reg.get(&agent), llm_reg.get(&agent))
    {
        let mem = mem_sys.clone();
        let skills = skill_sys.clone();
        let llms = llm_sys.clone();

        // Release locks before doing work
        drop(reg);
        drop(skill_reg);
        drop(llm_reg);

        // Look up webhook registration
        let webhook = {
            let mem_lock = mem.lock().await;
            match mem_lock.get_webhook_by_source(&source).await {
                Ok(Some(wh)) => wh,
                Ok(None) => {
                    return Json(serde_json::json!({
                        "success": false,
                        "error": "No webhook registered for this source"
                    }));
                }
                Err(e) => {
                    return Json(serde_json::json!({
                        "success": false,
                        "error": format!("Database error: {}", e)
                    }));
                }
            }
        };

        // Check if active
        if !webhook.active {
            return Json(serde_json::json!({
                "success": false,
                "error": "Webhook is currently disabled"
            }));
        }

        // Verify signature if secret is set
        if !webhook.secret.is_empty() && !verify_webhook_signature(&headers, &body, &webhook.secret)
        {
            return Json(serde_json::json!({
                "success": false,
                "error": "Signature verification failed"
            }));
        }

        // Check if this agent has a WASM container
        let container_reg = state.container_registry.lock().await;
        let wasm_container = container_reg.get(&agent).cloned();
        drop(container_reg);

        // Build trigger text using the prompt_template
        let trigger_text = format!(
            "{}\n\n--- Webhook Payload from [{}] ---\n{}",
            webhook.prompt_template, source, body
        );
        let src_label = format!("WEBHOOK_{}", source.to_uppercase());

        info!(
            "Dispatching verified webhook '{}' ({}) to Agent [{}]",
            webhook.name, source, agent
        );

        // Fire and forget the ReAct loop
        tokio::spawn(async move {
            if let Some(container) = wasm_container {
                let _ = container
                    .execute(&trigger_text, llms, mem, skills, None)
                    .await;
            } else {
                let _ = crate::core::brain::AutonomousBrain::execute_react_loop(
                    &trigger_text,
                    &src_label,
                    llms,
                    mem,
                    skills,
                    None,
                )
                .await;
            }
        });

        Json(
            serde_json::json!({ "success": true, "message": "Webhook received and agent loop triggered." }),
        )
    } else {
        Json(serde_json::json!({ "success": false, "error": "Agent not found" }))
    }
}

// === Delegation Endpoint (unchanged) ===

pub async fn delegate_endpoint(
    Path(agent): Path<String>,
    State(state): State<AppState>,
    body: String,
) -> Json<serde_json::Value> {
    let reg = state.registry.lock().await;
    let skill_reg = state.skill_registry.lock().await;
    let llm_reg = state.llm_registry.lock().await;

    if let (Some(mem_sys), Some(skill_sys), Some(llm_sys)) =
        (reg.get(&agent), skill_reg.get(&agent), llm_reg.get(&agent))
    {
        let mem = mem_sys.clone();
        let skills = skill_sys.clone();
        let llms = llm_sys.clone();

        // Release locks before heavily blocking on the ReAct loop
        drop(reg);
        drop(skill_reg);
        drop(llm_reg);

        // Check if this agent has a WASM container
        let container_reg = state.container_registry.lock().await;
        let wasm_container = container_reg.get(&agent).cloned();
        drop(container_reg);

        let trigger_text = format!("DELEGATED TASK: {}", body);

        info!("Dispatching Delegation to Agent [{}]", agent);

        if let Some(container) = wasm_container {
            match container
                .execute(&trigger_text, llms, mem, skills, None)
                .await
            {
                Ok(res) => Json(serde_json::json!({ "success": true, "response": res })),
                Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
            }
        } else {
            let src_label = "SWARM_DELEGATION".to_string();
            match crate::core::brain::AutonomousBrain::execute_react_loop(
                &trigger_text,
                &src_label,
                llms,
                mem,
                skills,
                None,
            )
            .await
            {
                Ok(res) => Json(serde_json::json!({ "success": true, "response": res })),
                Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
            }
        }
    } else {
        Json(serde_json::json!({ "success": false, "error": "Agent not found" }))
    }
}

// === Signature Verification ===

/// Verify webhook signature against common patterns.
/// Supports: GitHub (X-Hub-Signature-256), Stripe (Stripe-Signature), generic (X-Signature).
fn verify_webhook_signature(headers: &HeaderMap, body: &str, secret: &str) -> bool {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    type HmacSha256 = Hmac<Sha256>;

    // GitHub: X-Hub-Signature-256: sha256=<hex>
    if let Some(sig) = headers
        .get("x-hub-signature-256")
        .and_then(|v| v.to_str().ok())
    {
        if let Some(hex_sig) = sig.strip_prefix("sha256=") {
            let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
            mac.update(body.as_bytes());
            let expected = hex::encode(mac.finalize().into_bytes());
            return constant_time_eq(hex_sig.as_bytes(), expected.as_bytes());
        }
    }

    // Stripe: Stripe-Signature: t=<timestamp>,v1=<hex>
    if let Some(sig) = headers
        .get("stripe-signature")
        .and_then(|v| v.to_str().ok())
    {
        let parts: std::collections::HashMap<&str, &str> =
            sig.split(',').filter_map(|p| p.split_once('=')).collect();
        if let (Some(timestamp), Some(v1_sig)) = (parts.get("t"), parts.get("v1")) {
            let signed_payload = format!("{}.{}", timestamp, body);
            let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
            mac.update(signed_payload.as_bytes());
            let expected = hex::encode(mac.finalize().into_bytes());
            return constant_time_eq(v1_sig.as_bytes(), expected.as_bytes());
        }
    }

    // Generic fallback: X-Signature header as raw HMAC-SHA256 hex
    if let Some(sig) = headers.get("x-signature").and_then(|v| v.to_str().ok()) {
        let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(body.as_bytes());
        let expected = hex::encode(mac.finalize().into_bytes());
        return constant_time_eq(sig.as_bytes(), expected.as_bytes());
    }

    // No recognized signature header found - fail closed
    false
}

/// Constant-time comparison to prevent timing attacks.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter()
        .zip(b.iter())
        .fold(0u8, |acc, (x, y)| acc | (x ^ y))
        == 0
}
