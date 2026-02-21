use anyhow::Result;
use async_trait::async_trait;
use axum::{
    Router,
    extract::{Json, State},
    routing::post,
};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
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
    llms: Arc<Mutex<LlmManager>>,
    bot_token: String,
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

async fn slack_webhook(
    State(state): State<SlackState>,
    Json(payload): Json<SlackEventPayload>,
) -> Json<serde_json::Value> {
    // 1. Handle URL Verification Challenge required by Slack
    if payload.event_type == "url_verification"
        && let Some(challenge) = payload.challenge {
            return Json(serde_json::json!({ "challenge": challenge }));
        }

    // 2. Handle actual messages
    if payload.event_type == "event_callback"
        && let Some(event) = payload.event {
            // Ignore messages from ourselves or other bots
            if event.bot_id.is_some() {
                return Json(serde_json::json!({ "status": "ignored_bot" }));
            }

            if (event.inner_type == "message" || event.inner_type == "app_mention")
                && let (Some(text), Some(user), Some(channel)) =
                    (event.text, event.user, event.channel)
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

    Json(serde_json::json!({ "status": "ok" }))
}

pub struct SlackChannel {
    agent_name: String,
    registry: Arc<Mutex<HashMap<String, Arc<Mutex<MemorySystem>>>>>,
    skill_registry: Arc<Mutex<HashMap<String, Arc<Mutex<SkillManager>>>>>,
    llm_registry: Arc<Mutex<HashMap<String, Arc<Mutex<LlmManager>>>>>,
}

impl SlackChannel {
    pub fn new(
        agent_name: String,
        registry: Arc<Mutex<HashMap<String, Arc<Mutex<MemorySystem>>>>>,
        skill_registry: Arc<Mutex<HashMap<String, Arc<Mutex<SkillManager>>>>>,
        llm_registry: Arc<Mutex<HashMap<String, Arc<Mutex<LlmManager>>>>>,
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
                };

                // The slack receiver will run on port 3001 specifically for Webhooks to avoid colliding with the WebDashboard on 3000
                let app = Router::new()
                    .route("/slack/events", post(slack_webhook))
                    .with_state(state);

                let agent_n = self.agent_name.clone();
                tokio::spawn(async move {
                    if let Ok(listener) = tokio::net::TcpListener::bind("0.0.0.0:3001").await {
                        info!(
                            "[{}] Slack Webhook listening at http://0.0.0.0:3001/slack/events",
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
