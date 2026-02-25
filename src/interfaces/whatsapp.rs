use anyhow::Result;
use async_trait::async_trait;
use axum::{
    Router,
    extract::{Form, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
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
struct WhatsAppState {
    agent_name: String,
    memory: Arc<Mutex<MemorySystem>>,
    skills: Arc<Mutex<SkillManager>>,
    llms: Arc<RwLock<LlmManager>>,
    auth_token: String,
    webhook_url: String,
}

// Twilio sends webhooks as application/x-www-form-urlencoded
#[derive(serde::Deserialize, Debug)]
#[allow(dead_code)]
struct TwilioIncomingMessage {
    #[serde(rename = "MessageSid")]
    message_sid: Option<String>,
    #[serde(rename = "From")]
    from: String,
    #[serde(rename = "To")]
    to: String,
    #[serde(rename = "Body")]
    body: String,
}

// TwiML (XML) response format required by Twilio to send a reply immediately
fn build_twiml_response(message: &str) -> Response {
    let escaped_msg = quick_xml::escape::escape(message);
    let xml = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Response><Message>{}</Message></Response>",
        escaped_msg
    );

    (
        StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "application/xml")],
        xml,
    )
        .into_response()
}

/// Verify Twilio request signature (X-Twilio-Signature).
/// Twilio signs requests using HMAC-SHA1 of the full URL + sorted POST params.
fn verify_twilio_signature(
    headers: &HeaderMap,
    webhook_url: &str,
    params: &[(&str, &str)],
    auth_token: &str,
) -> bool {
    use base64::Engine;
    use hmac::Mac;
    use sha1::Sha1;
    type HmacSha1 = hmac::Hmac<Sha1>;

    let sig = match headers
        .get("x-twilio-signature")
        .and_then(|v| v.to_str().ok())
    {
        Some(s) => s,
        None => return false,
    };

    // Build the data string: URL + sorted params key/value concatenated
    let mut data = webhook_url.to_string();
    let mut sorted_params: Vec<(&str, &str)> = params.to_vec();
    sorted_params.sort_by_key(|(k, _)| *k);
    for (k, v) in &sorted_params {
        data.push_str(k);
        data.push_str(v);
    }

    let mut mac = match HmacSha1::new_from_slice(auth_token.as_bytes()) {
        Ok(m) => m,
        Err(_) => return false,
    };
    mac.update(data.as_bytes());
    let expected = base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes());

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

async fn whatsapp_webhook(
    State(state): State<WhatsAppState>,
    headers: HeaderMap,
    Form(payload): Form<TwilioIncomingMessage>,
) -> Response {
    // Verify Twilio signature if auth token is configured
    if !state.auth_token.is_empty() {
        let params: Vec<(&str, &str)> = vec![
            ("MessageSid", payload.message_sid.as_deref().unwrap_or("")),
            ("From", &payload.from),
            ("To", &payload.to),
            ("Body", &payload.body),
        ];
        if !verify_twilio_signature(&headers, &state.webhook_url, &params, &state.auth_token) {
            warn!(
                "[{}] WhatsApp webhook signature verification failed",
                state.agent_name
            );
            return (StatusCode::UNAUTHORIZED, "Invalid signature").into_response();
        }
    }

    let trigger_text = payload.body.trim();
    if trigger_text.is_empty() {
        return build_twiml_response("");
    }

    let src_label = format!("WHATSAPP_{}", payload.from);

    // Store user's WhatsApp number in vault for whatsapp_notify skill
    {
        let mem = state.memory.lock().await;
        let vault = crate::core::vault::SecretsVault::new(mem.get_db());
        let user_number = payload.from.trim().to_string();
        if let Ok(existing) = vault.get_secret("whatsapp_user_number").await {
            if existing.as_deref().unwrap_or("") != user_number {
                let _ = vault.set_secret("whatsapp_user_number", &user_number).await;
            }
        }
    }

    info!(
        "[{}] Received WhatsApp message from {}: {}",
        state.agent_name, payload.from, trigger_text
    );

    // For WhatsApp/Twilio, the easiest way to reply is by literally returning TwiML in the HTTP response.
    // This requires us to AWAIT the ReAct loop synchronously, blocking the webhook until the brain terminates.
    // Note: Twilio webhooks have a 15-second timeout, so if skills take forever, this might time out.
    // A more robust async approach requires storing the Twilio Auth Token and sending a POST request to their REST API.
    // For this implementation, we will use the fast synchronous TwiML response.

    match AutonomousBrain::execute_react_loop(
        trigger_text,
        &src_label,
        state.llms,
        state.memory,
        state.skills,
        None,
        &state.agent_name,
    )
    .await
    {
        Ok(response) => build_twiml_response(&response),
        Err(e) => {
            error!("[{}] ReAct loop failed: {}", state.agent_name, e);
            build_twiml_response(
                "I'm sorry, I encountered an internal error processing your request.",
            )
        }
    }
}

pub struct WhatsAppChannel {
    agent_name: String,
    registry: Arc<Mutex<HashMap<String, Arc<Mutex<MemorySystem>>>>>,
    skill_registry: Arc<Mutex<HashMap<String, Arc<Mutex<SkillManager>>>>>,
    llm_registry: Arc<Mutex<HashMap<String, Arc<RwLock<LlmManager>>>>>,
}

impl WhatsAppChannel {
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
impl LifecycleComponent for WhatsAppChannel {
    async fn on_init(&mut self) -> Result<()> {
        info!(
            "WhatsApp Channel Interface initializing for [{}]...",
            self.agent_name
        );
        Ok(())
    }

    async fn on_start(&mut self) -> Result<()> {
        let registry = self.registry.lock().await;
        if let Some(mem_mutex) = registry.get(&self.agent_name) {
            let mem = mem_mutex.lock().await;
            let vault = crate::core::vault::SecretsVault::new(mem.get_db());

            // To activate WhatsApp, the user just needs to set a `whatsapp_enabled` flag
            // since Twilio TwiML doesn't strictly require outbound auth tokens for simple replies.
            if let Ok(Some(enabled)) = vault.get_secret("whatsapp_enabled").await {
                if enabled == "true" {
                    info!(
                        "WhatsApp is enabled for [{}]. Booting Twilio Webhook receiver...",
                        self.agent_name
                    );

                    let skill_reg = self.skill_registry.lock().await;
                    let llm_reg = self.llm_registry.lock().await;

                    let skills = skill_reg
                        .get(&self.agent_name)
                        .expect("Skills missing")
                        .clone();
                    let llms = llm_reg.get(&self.agent_name).expect("LLMs missing").clone();
                    let memory = mem_mutex.clone();

                    // Load Twilio auth token for signature verification
                    let auth_token = vault
                        .get_secret("whatsapp_auth_token")
                        .await
                        .ok()
                        .flatten()
                        .unwrap_or_default();
                    if auth_token.is_empty() {
                        warn!(
                            "[{}] No whatsapp_auth_token in vault. Twilio webhook requests will NOT be verified. \
                             Set 'whatsapp_auth_token' in the vault for security.",
                            self.agent_name
                        );
                    }

                    let state = WhatsAppState {
                        agent_name: self.agent_name.clone(),
                        memory,
                        skills,
                        llms,
                        auth_token,
                        webhook_url: "http://127.0.0.1:3002/whatsapp/events".to_string(),
                    };

                    let app = Router::new()
                        .route("/whatsapp/events", post(whatsapp_webhook))
                        .with_state(state);

                    let agent_n = self.agent_name.clone();
                    tokio::spawn(async move {
                        if let Ok(listener) = tokio::net::TcpListener::bind("127.0.0.1:3002").await
                        {
                            info!(
                                "[{}] WhatsApp (Twilio) Webhook listening at http://127.0.0.1:3002/whatsapp/events",
                                agent_n
                            );
                            if let Err(e) = axum::serve(listener, app).await {
                                error!("[{}] WhatsApp Webhook crashed: {}", agent_n, e);
                            }
                        }
                    });
                }
            } else {
                warn!(
                    "[{}] No whatsapp_enabled flag found in vault. WhatsApp Channel disabled.",
                    self.agent_name
                );
            }
        }
        Ok(())
    }

    async fn on_shutdown(&mut self) -> Result<()> {
        info!(
            "WhatsApp Channel Interface shutting down for [{}]...",
            self.agent_name
        );
        Ok(())
    }
}
