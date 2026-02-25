use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
};
use tracing::{error, info, warn};

use super::super::AppState;

fn vault_key_for_webhook(name: &str) -> String {
    format!("webhook_secret:{}", name)
}

// === CRUD Handlers ===

pub async fn get_webhooks_endpoint(
    Path(agent): Path<String>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let reg = state.registry.lock().await;
    let vault_reg = state.vault_registry.lock().await;

    let (mem_arc, vault_arc) = match (reg.get(&agent), vault_reg.get(&agent)) {
        (Some(m), Some(v)) => (m.clone(), v.clone()),
        _ => {
            return Json(serde_json::json!({ "success": false, "error": "Agent not found" }));
        }
    };
    drop(reg);
    drop(vault_reg);

    let mem = mem_arc.lock().await;
    match mem.get_all_webhooks().await {
        Ok(webhooks) => {
            let mut results = Vec::new();
            for wh in webhooks {
                let has_secret = vault_arc
                    .get_secret(&vault_key_for_webhook(&wh.name))
                    .await
                    .ok()
                    .flatten()
                    .map(|s| !s.is_empty())
                    .unwrap_or(false);
                results.push(serde_json::json!({
                    "name": wh.name,
                    "source": wh.source,
                    "prompt_template": wh.prompt_template,
                    "active": wh.active,
                    "has_secret": has_secret,
                    "created_at": wh.created_at,
                }));
            }
            Json(serde_json::json!({ "success": true, "webhooks": results }))
        }
        Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
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

    let vault_arc = {
        let vault_reg = state.vault_registry.lock().await;
        match vault_reg.get(&agent) {
            Some(v) => v.clone(),
            None => {
                return Json(serde_json::json!({
                    "success": false,
                    "error": "Agent vault not found"
                }));
            }
        }
    };

    let mem = mem_arc.lock().await;
    match mem.add_webhook(&name, &source, &prompt_template).await {
        Ok(_) => {
            if !payload.secret.is_empty() {
                if let Err(e) = vault_arc
                    .set_secret(&vault_key_for_webhook(&name), &payload.secret)
                    .await
                {
                    error!("Failed to store webhook secret in vault: {}", e);
                    return Json(serde_json::json!({
                        "success": false,
                        "error": format!("Failed to store secret: {}", e)
                    }));
                }
            }
            let webhook_url = format!(
                "http://{}:{}/api/webhooks/{}/{}",
                state.api_host, state.api_port, agent, source
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

    let vault_arc = {
        let vault_reg = state.vault_registry.lock().await;
        vault_reg.get(&agent).cloned()
    };

    let mem = mem_arc.lock().await;
    match mem.remove_webhook(&name).await {
        Ok(true) => {
            if let Some(vault) = vault_arc {
                let _ = vault.remove_secret(&vault_key_for_webhook(&name)).await;
            }
            Json(serde_json::json!({ "success": true, "message": "Webhook removed" }))
        }
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
) -> impl IntoResponse {
    info!(
        "Incoming webhook request: agent='{}', source='{}', body_len={}",
        agent,
        source,
        body.len()
    );

    let reg = state.registry.lock().await;
    let skill_reg = state.skill_registry.lock().await;
    let llm_reg = state.llm_registry.lock().await;
    let vault_reg = state.vault_registry.lock().await;

    let (mem, skills, llms, vault) = match (
        reg.get(&agent),
        skill_reg.get(&agent),
        llm_reg.get(&agent),
        vault_reg.get(&agent),
    ) {
        (Some(m), Some(s), Some(l), Some(v)) => (m.clone(), s.clone(), l.clone(), v.clone()),
        _ => {
            warn!(
                "Webhook rejected: agent '{}' not found in registries (source: {})",
                agent, source
            );
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "success": false, "error": "Agent not found" })),
            );
        }
    };

    drop(reg);
    drop(skill_reg);
    drop(llm_reg);
    drop(vault_reg);

    let webhook = {
        let mem_lock = mem.lock().await;
        match mem_lock.get_webhook_by_source(&source).await {
            Ok(Some(wh)) => wh,
            Ok(None) => {
                warn!(
                    "Webhook rejected: no webhook registered for source '{}' on agent '{}'",
                    source, agent
                );
                return (
                    StatusCode::NOT_FOUND,
                    Json(serde_json::json!({
                        "success": false,
                        "error": "No webhook registered for this source"
                    })),
                );
            }
            Err(e) => {
                error!(
                    "Webhook database error for agent '{}', source '{}': {}",
                    agent, source, e
                );
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({
                        "success": false,
                        "error": format!("Database error: {}", e)
                    })),
                );
            }
        }
    };

    if !webhook.active {
        warn!(
            "Webhook rejected: webhook '{}' on agent '{}' is disabled",
            webhook.name, agent
        );
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "success": false,
                "error": "Webhook is currently disabled"
            })),
        );
    }

    // Retrieve secret from vault
    let secret = match vault
        .get_secret(&vault_key_for_webhook(&webhook.name))
        .await
    {
        Ok(Some(s)) if !s.is_empty() => s,
        _ => {
            warn!(
                "Webhook rejected: webhook '{}' on agent '{}' has no secret in vault",
                webhook.name, agent
            );
            return (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({
                    "success": false,
                    "error": "Webhook has no secret configured. Set a secret to enable signature verification."
                })),
            );
        }
    };

    if !verify_webhook_signature(&headers, &body, &secret) {
        warn!(
            "Webhook rejected: signature verification failed for '{}' on agent '{}' (source: {})",
            webhook.name, agent, source
        );
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({
                "success": false,
                "error": "Signature verification failed"
            })),
        );
    }

    let container_reg = state.container_registry.lock().await;
    let wasm_container = container_reg.get(&agent).cloned();
    drop(container_reg);

    let safe_body = crate::core::brain::sanitize_invoke_tags(&body);
    let trigger_text = format!(
        "{}\n\n--- Webhook Payload from [{}] ---\n{}",
        webhook.prompt_template, source, safe_body
    );
    let src_label = format!("WEBHOOK_{}", source.to_uppercase());

    info!(
        "Dispatching verified webhook '{}' ({}) to Agent [{}]",
        webhook.name, source, agent
    );

    let agent_name = agent.clone();
    let webhook_name = webhook.name.clone();
    tokio::spawn(async move {
        let result = if let Some(container) = wasm_container {
            container
                .execute(&trigger_text, llms, mem, skills, None)
                .await
        } else {
            crate::core::brain::AutonomousBrain::execute_react_loop(
                &trigger_text,
                &src_label,
                llms,
                mem,
                skills,
                None,
                &agent_name,
            )
            .await
        };

        match result {
            Ok(response) => {
                let preview: String = response.chars().take(200).collect();
                info!(
                    "Webhook '{}' processing completed for agent '{}': {}",
                    webhook_name, agent_name, preview
                );
            }
            Err(e) => error!(
                "Webhook '{}' processing FAILED for agent '{}': {}",
                webhook_name, agent_name, e
            ),
        }
    });

    (
        StatusCode::OK,
        Json(
            serde_json::json!({ "success": true, "message": "Webhook received and agent loop triggered." }),
        ),
    )
}

// === Delegation Endpoint ===

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

        drop(reg);
        drop(skill_reg);
        drop(llm_reg);

        let container_reg = state.container_registry.lock().await;
        let wasm_container = container_reg.get(&agent).cloned();
        drop(container_reg);

        let safe_body = crate::core::brain::sanitize_invoke_tags(&body);
        let trigger_text = format!("DELEGATED TASK: {}", safe_body);

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
                &agent,
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
            if let Ok(ts) = timestamp.parse::<u64>() {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();
                if now.abs_diff(ts) > 300 {
                    return false;
                }
            }
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

    false
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter()
        .zip(b.iter())
        .fold(0u8, |acc, (x, y)| acc | (x ^ y))
        == 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::agent::{
        ContainerRegistry, LlmRegistry, MemoryRegistry, RunMode, ScheduledJobRegistry,
        SchedulerRegistry, SkillRegistry, VaultRegistry,
    };
    use std::sync::Arc;
    use tokio::sync::Mutex;

    fn empty_state() -> AppState {
        let registry: MemoryRegistry = Arc::new(Mutex::new(std::collections::HashMap::new()));
        let skill_registry: SkillRegistry = Arc::new(Mutex::new(std::collections::HashMap::new()));
        let llm_registry: LlmRegistry = Arc::new(Mutex::new(std::collections::HashMap::new()));
        let container_registry: ContainerRegistry =
            Arc::new(Mutex::new(std::collections::HashMap::new()));
        let vault_registry: VaultRegistry = Arc::new(Mutex::new(std::collections::HashMap::new()));
        let scheduler_registry: SchedulerRegistry =
            Arc::new(Mutex::new(std::collections::HashMap::new()));
        let scheduled_job_registry: ScheduledJobRegistry =
            Arc::new(Mutex::new(std::collections::HashMap::new()));
        let (log_tx, _) = tokio::sync::broadcast::channel(8);

        AppState {
            registry,
            skill_registry,
            llm_registry,
            container_registry,
            vault_registry,
            scheduler_registry,
            scheduled_job_registry,
            log_tx,
            run_mode: RunMode::Daemon,
            api_host: "127.0.0.1".to_string(),
            api_port: 17890,
            web_port: 3001,
            internal_token: "test-internal".to_string(),
        }
    }

    #[tokio::test]
    async fn create_webhook_rejects_invalid_source_format() {
        let payload = CreateWebhookRequest {
            name: "alerts".to_string(),
            source: "bad source!".to_string(),
            secret: "".to_string(),
            prompt_template: "Do work".to_string(),
        };

        let Json(out) = create_webhook_endpoint(
            Path("default".to_string()),
            State(empty_state()),
            Json(payload),
        )
        .await;

        assert_eq!(
            out.get("success").and_then(serde_json::Value::as_bool),
            Some(false)
        );
        assert!(
            out.get("error")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default()
                .contains("alphanumeric")
        );
    }

    fn compute_hmac(secret: &str, data: &str) -> String {
        use hmac::{Hmac, Mac};
        use sha2::Sha256;
        type HmacSha256 = Hmac<Sha256>;
        let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).expect("hmac");
        mac.update(data.as_bytes());
        hex::encode(mac.finalize().into_bytes())
    }

    #[test]
    fn verify_webhook_signature_accepts_generic_hmac_header() {
        let body = "{\"hello\":\"world\"}";
        let secret = "test-secret";
        let signature = compute_hmac(secret, body);
        let mut headers = HeaderMap::new();
        headers.insert("x-signature", signature.parse().unwrap());
        assert!(verify_webhook_signature(&headers, body, secret));
    }

    #[test]
    fn verify_webhook_signature_accepts_github_header() {
        let body = "{\"action\":\"opened\"}";
        let secret = "gh-secret";
        let sig = compute_hmac(secret, body);
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-hub-signature-256",
            format!("sha256={}", sig).parse().unwrap(),
        );
        assert!(verify_webhook_signature(&headers, body, secret));
    }

    #[test]
    fn verify_webhook_signature_rejects_github_bad_signature() {
        let body = "{\"data\":1}";
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-hub-signature-256",
            "sha256=deadbeefdeadbeef".parse().unwrap(),
        );
        assert!(!verify_webhook_signature(&headers, body, "real-secret"));
    }

    #[test]
    fn verify_webhook_signature_accepts_stripe_header() {
        let body = "{\"id\":\"evt_123\"}";
        let secret = "whsec_test";
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let signed_payload = format!("{}.{}", now, body);
        let v1_sig = compute_hmac(secret, &signed_payload);
        let stripe_header = format!("t={},v1={}", now, v1_sig);
        let mut headers = HeaderMap::new();
        headers.insert("stripe-signature", stripe_header.parse().unwrap());
        assert!(verify_webhook_signature(&headers, body, secret));
    }

    #[test]
    fn verify_webhook_signature_rejects_stripe_stale_timestamp() {
        let body = "{}";
        let secret = "whsec_test";
        let stale = 1_000_000u64;
        let signed_payload = format!("{}.{}", stale, body);
        let v1_sig = compute_hmac(secret, &signed_payload);
        let stripe_header = format!("t={},v1={}", stale, v1_sig);
        let mut headers = HeaderMap::new();
        headers.insert("stripe-signature", stripe_header.parse().unwrap());
        assert!(!verify_webhook_signature(&headers, body, secret));
    }

    #[test]
    fn verify_webhook_signature_rejects_no_signature_headers() {
        let headers = HeaderMap::new();
        assert!(!verify_webhook_signature(&headers, "body", "secret"));
    }

    #[test]
    fn verify_webhook_signature_rejects_wrong_generic_signature() {
        let mut headers = HeaderMap::new();
        headers.insert("x-signature", "badsignature".parse().unwrap());
        assert!(!verify_webhook_signature(&headers, "body", "secret"));
    }

    // --- constant_time_eq ---

    #[test]
    fn constant_time_eq_equal_slices() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(constant_time_eq(b"", b""));
    }

    #[test]
    fn constant_time_eq_different_lengths() {
        assert!(!constant_time_eq(b"abc", b"abcd"));
        assert!(!constant_time_eq(b"abcd", b"abc"));
    }

    #[test]
    fn constant_time_eq_same_length_different_content() {
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"aaa", b"bbb"));
    }

    // --- vault_key_for_webhook ---

    #[test]
    fn vault_key_for_webhook_generates_correct_key() {
        assert_eq!(
            vault_key_for_webhook("github_alerts"),
            "webhook_secret:github_alerts"
        );
        assert_eq!(vault_key_for_webhook(""), "webhook_secret:");
    }

    // --- create_webhook_endpoint validation ---

    #[tokio::test]
    async fn create_webhook_rejects_empty_fields() {
        let payload = CreateWebhookRequest {
            name: "".to_string(),
            source: "github".to_string(),
            secret: "".to_string(),
            prompt_template: "do work".to_string(),
        };
        let Json(out) = create_webhook_endpoint(
            Path("default".to_string()),
            State(empty_state()),
            Json(payload),
        )
        .await;
        assert_eq!(out["success"], false);
        assert!(out["error"].as_str().unwrap().contains("required"));
    }

    #[tokio::test]
    async fn delete_webhook_rejects_blank_name() {
        let Json(out) = delete_webhook_endpoint(
            Path(("default".to_string(), "   ".to_string())),
            State(empty_state()),
        )
        .await;
        assert_eq!(out["success"], false);
        assert!(out["error"].as_str().unwrap().contains("required"));
    }

    #[tokio::test]
    async fn update_webhook_rejects_no_fields() {
        let payload = UpdateWebhookRequest { active: None };
        let Json(out) = update_webhook_endpoint(
            Path(("default".to_string(), "wh1".to_string())),
            State(empty_state()),
            Json(payload),
        )
        .await;
        assert_eq!(out["success"], false);
        assert!(out["error"].as_str().unwrap().contains("No fields"));
    }
}
