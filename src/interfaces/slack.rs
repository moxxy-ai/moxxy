use anyhow::Result;
use async_trait::async_trait;
use axum::{
    Router,
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Json, Response},
    routing::post,
};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use tracing::{error, info, warn};

use crate::core::brain::AutonomousBrain;
use crate::core::lifecycle::LifecycleComponent;
use crate::core::llm::LlmManager;
use crate::core::memory::MemorySystem;
use crate::skills::SkillManager;

#[derive(Clone)]
struct SlackState {
    agent_name: String,
    memory: Arc<Mutex<MemorySystem>>,
    skills: Arc<Mutex<SkillManager>>,
    llms: Arc<RwLock<LlmManager>>,
    bot_token: String,
    signing_secret: String,
}

#[derive(serde::Deserialize, Debug)]
struct SlackEventPayload {
    #[serde(rename = "type")]
    event_type: String,
    challenge: Option<String>,
    event: Option<SlackEventDetails>,
}

#[derive(serde::Deserialize, Debug)]
struct SlackEventDetails {
    #[serde(rename = "type")]
    inner_type: String,
    text: Option<String>,
    user: Option<String>,
    channel: Option<String>,
    bot_id: Option<String>,
}

/// Verify Slack request signature using the signing secret.
fn verify_slack_signature(headers: &HeaderMap, body: &[u8], signing_secret: &str) -> bool {
    use hmac::Mac;
    use sha2::Sha256;
    type HmacSha256 = hmac::Hmac<Sha256>;

    let timestamp = match headers
        .get("x-slack-request-timestamp")
        .and_then(|v| v.to_str().ok())
    {
        Some(ts) => ts,
        None => return false,
    };

    // Reject requests older than 5 minutes to prevent replay attacks
    if let Ok(ts) = timestamp.parse::<u64>() {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        if now.abs_diff(ts) > 300 {
            return false;
        }
    }

    let sig = match headers
        .get("x-slack-signature")
        .and_then(|v| v.to_str().ok())
    {
        Some(s) => s,
        None => return false,
    };

    let sig_basestring = format!("v0:{}:{}", timestamp, String::from_utf8_lossy(body));

    let mut mac = match HmacSha256::new_from_slice(signing_secret.as_bytes()) {
        Ok(m) => m,
        Err(_) => return false,
    };
    mac.update(sig_basestring.as_bytes());
    let expected = format!("v0={}", hex::encode(mac.finalize().into_bytes()));

    // Constant-time comparison
    if sig.len() != expected.len() {
        return false;
    }
    sig.as_bytes()
        .iter()
        .zip(expected.as_bytes().iter())
        .fold(0u8, |acc, (a, b)| acc | (a ^ b))
        == 0
}

async fn slack_webhook(
    State(state): State<SlackState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    // Verify signature if signing secret is configured
    if !state.signing_secret.is_empty()
        && !verify_slack_signature(&headers, &body, &state.signing_secret)
    {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "Invalid signature" })),
        )
            .into_response();
    }

    let payload: SlackEventPayload = match serde_json::from_slice(&body) {
        Ok(p) => p,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "Invalid JSON" })),
            )
                .into_response();
        }
    };

    // 1. Handle URL Verification Challenge required by Slack
    if payload.event_type == "url_verification"
        && let Some(challenge) = payload.challenge
    {
        return Json(serde_json::json!({ "challenge": challenge })).into_response();
    }

    // 2. Handle actual messages
    if payload.event_type == "event_callback"
        && let Some(event) = payload.event
    {
        // Ignore messages from ourselves or other bots
        if event.bot_id.is_some() {
            return Json(serde_json::json!({ "status": "ignored_bot" })).into_response();
        }

        if (event.inner_type == "message" || event.inner_type == "app_mention")
            && let (Some(text), Some(user), Some(channel)) = (event.text, event.user, event.channel)
        {
            let src_label = format!("SLACK_{}", user);
            info!(
                "[{}] Received Slack message from {}: {}",
                state.agent_name, user, text
            );

            let bot_token = state.bot_token.clone();
            let agent_name = state.agent_name.clone();

            // Fire and forget the ReAct loop so we return 200 OK to Slack immediately
            tokio::spawn(async move {
                match AutonomousBrain::execute_react_loop(
                    &text,
                    &src_label,
                    state.llms,
                    state.memory,
                    state.skills,
                    None,
                    false,
                    &agent_name,
                )
                .await
                {
                    Ok(response) => {
                        // Post the response back to Slack using Reqwest
                        let client = reqwest::Client::new();
                        let req_body = serde_json::json!({
                            "channel": channel,
                            "text": response
                        });

                        let res = client
                            .post("https://slack.com/api/chat.postMessage")
                            .header("Authorization", format!("Bearer {}", bot_token))
                            .header("Content-Type", "application/json")
                            .json(&req_body)
                            .send()
                            .await;

                        match res {
                            Ok(r) if !r.status().is_success() => {
                                error!("[{}] Slack API Error: {:?}", agent_name, r.status())
                            }
                            Err(e) => {
                                error!("[{}] Failed to send Slack reply: {}", agent_name, e)
                            }
                            _ => {}
                        }
                    }
                    Err(e) => {
                        error!("[{}] ReAct loop failed: {}", agent_name, e);
                    }
                }
            });
        }
    }

    Json(serde_json::json!({ "status": "ok" })).into_response()
}

pub struct SlackChannel {
    agent_name: String,
    registry: Arc<Mutex<HashMap<String, Arc<Mutex<MemorySystem>>>>>,
    skill_registry: Arc<Mutex<HashMap<String, Arc<Mutex<SkillManager>>>>>,
    llm_registry: Arc<Mutex<HashMap<String, Arc<RwLock<LlmManager>>>>>,
}

impl SlackChannel {
    pub fn new(
        agent_name: String,
        registry: Arc<Mutex<HashMap<String, Arc<Mutex<MemorySystem>>>>>,
        skill_registry: Arc<Mutex<HashMap<String, Arc<Mutex<SkillManager>>>>>,
        llm_registry: Arc<Mutex<HashMap<String, Arc<RwLock<LlmManager>>>>>,
    ) -> Self {
        Self {
            agent_name,
            registry,
            skill_registry,
            llm_registry,
        }
    }
}

#[async_trait]
impl LifecycleComponent for SlackChannel {
    async fn on_init(&mut self) -> Result<()> {
        info!(
            "Slack Channel Interface initializing for [{}]...",
            self.agent_name
        );
        Ok(())
    }

    async fn on_start(&mut self) -> Result<()> {
        let registry = self.registry.lock().await;
        if let Some(mem_mutex) = registry.get(&self.agent_name) {
            let mem = mem_mutex.lock().await;
            let vault = crate::core::vault::SecretsVault::new(mem.get_db());

            if let Ok(Some(token)) = vault.get_secret("slack_bot_token").await {
                info!(
                    "Found slack_bot_token for [{}]. Booting Slack Webhook receiver...",
                    self.agent_name
                );

                // Load signing secret for request signature verification
                let signing_secret = vault
                    .get_secret("slack_signing_secret")
                    .await
                    .ok()
                    .flatten()
                    .unwrap_or_default();
                if signing_secret.is_empty() {
                    warn!(
                        "[{}] No slack_signing_secret in vault. Slack webhook requests will NOT be verified. \
                         Set 'slack_signing_secret' in the vault for security.",
                        self.agent_name
                    );
                }

                let skill_reg = self.skill_registry.lock().await;
                let llm_reg = self.llm_registry.lock().await;

                let skills = skill_reg
                    .get(&self.agent_name)
                    .expect("Skills missing")
                    .clone();
                let llms = llm_reg.get(&self.agent_name).expect("LLMs missing").clone();
                let memory = mem_mutex.clone();

                let state = SlackState {
                    agent_name: self.agent_name.clone(),
                    memory,
                    skills,
                    llms,
                    bot_token: token,
                    signing_secret,
                };

                let app = Router::new()
                    .route("/slack/events", post(slack_webhook))
                    .with_state(state);

                let agent_n = self.agent_name.clone();
                tokio::spawn(async move {
                    if let Ok(listener) = tokio::net::TcpListener::bind("127.0.0.1:3001").await {
                        info!(
                            "[{}] Slack Webhook listening at http://127.0.0.1:3001/slack/events",
                            agent_n
                        );
                        if let Err(e) = axum::serve(listener, app).await {
                            error!("[{}] Slack Webhook crashed: {}", agent_n, e);
                        }
                    }
                });
            } else {
                warn!(
                    "[{}] No slack_bot_token found in vault. Slack Channel disabled.",
                    self.agent_name
                );
            }
        }
        Ok(())
    }

    async fn on_shutdown(&mut self) -> Result<()> {
        info!(
            "Slack Channel Interface shutting down for [{}]...",
            self.agent_name
        );
        Ok(())
    }
}
