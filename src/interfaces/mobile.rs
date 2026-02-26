use anyhow::Result;
use async_trait::async_trait;
use axum::{
    Json, Router,
    extract::{
        State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{HeaderMap, StatusCode},
    response::{
        IntoResponse,
        sse::{Event, Sse},
    },
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use tokio_stream::{Stream, StreamExt, wrappers::BroadcastStream};
use tracing::{error, info};

use crate::core::agent::{LlmRegistry, MemoryRegistry, SkillRegistry};
use crate::core::brain::AutonomousBrain;
use crate::core::lifecycle::LifecycleComponent;

#[derive(Clone)]
struct MobileState {
    agent_name: String,
    registry: MemoryRegistry,
    skill_registry: SkillRegistry,
    llm_registry: LlmRegistry,
    log_tx: tokio::sync::broadcast::Sender<String>,
}

#[derive(Deserialize, Serialize, Debug)]
pub struct TelemetryData {
    pub location: Option<LocationData>,
    pub health: Option<HealthData>,
    pub device_state: Option<DeviceState>,
}

#[derive(Deserialize, Serialize, Debug)]
pub struct LocationData {
    pub latitude: f64,
    pub longitude: f64,
    pub speed_mph: Option<f64>,
    pub context: Option<String>,
}

#[derive(Deserialize, Serialize, Debug)]
pub struct HealthData {
    pub heart_rate_bpm: Option<u32>,
    pub state_inferred: Option<String>,
}

#[derive(Deserialize, Serialize, Debug)]
pub struct DeviceState {
    pub battery_percent: Option<u8>,
    pub is_charging: Option<bool>,
    pub active_app: Option<String>,
}

#[derive(Deserialize, Serialize, Debug)]
pub struct TelemetryPayload {
    pub timestamp: String,
    pub device_id: String,
    pub agent_target: String,
    pub data: TelemetryData,
}

#[derive(Deserialize, Debug)]
pub struct ChatPayload {
    pub prompt: String,
    #[allow(dead_code)]
    pub audio_transcript_confidence: Option<f64>,
}

pub struct MobileInterface {
    agent_name: String,
    registry: MemoryRegistry,
    skill_registry: SkillRegistry,
    llm_registry: LlmRegistry,
    log_tx: tokio::sync::broadcast::Sender<String>,
}

impl MobileInterface {
    pub fn new(
        agent_name: String,
        registry: MemoryRegistry,
        skill_registry: SkillRegistry,
        llm_registry: LlmRegistry,
        log_tx: tokio::sync::broadcast::Sender<String>,
    ) -> Self {
        Self {
            agent_name,
            registry,
            skill_registry,
            llm_registry,
            log_tx,
        }
    }
}

#[async_trait]
impl LifecycleComponent for MobileInterface {
    async fn on_start(&mut self) -> Result<()> {
        let registry = self.registry.lock().await;
        if let Some(mem_mutex) = registry.get(&self.agent_name) {
            let mem = mem_mutex.lock().await;
            let vault = crate::core::vault::SecretsVault::new(mem.get_db());

            if let Ok(Some(mobile_key)) = vault.get_secret("mobile_key").await
                && !mobile_key.is_empty()
            {
                info!(
                    "[{}] Mobile Copilot API Enabled. Binding Axum WebSocket & REST...",
                    self.agent_name
                );

                let state = MobileState {
                    agent_name: self.agent_name.clone(),
                    registry: self.registry.clone(),
                    skill_registry: self.skill_registry.clone(),
                    llm_registry: self.llm_registry.clone(),
                    log_tx: self.log_tx.clone(),
                };

                let app = Router::new()
                    .route("/api/v1/mobile/telemetry", get(ws_handler))
                    .route("/api/v1/mobile/chat", post(chat_handler))
                    .route("/api/v1/mobile/stream", get(sse_stream_handler))
                    .route("/api/v1/mobile/notifications", get(notifications_handler))
                    .with_state(state.clone());

                // Spin up Axum strictly for Mobile on 3003
                tokio::spawn(async move {
                    match tokio::net::TcpListener::bind("0.0.0.0:3003").await {
                        Ok(listener) => {
                            info!("Mobile API Copilot listening on 0.0.0.0:3003");
                            if let Err(e) = axum::serve(listener, app).await {
                                error!("Mobile Axum Error: {}", e);
                            }
                        }
                        Err(e) => {
                            error!(
                                "Failed to bind Mobile API to port 3003: {}. Mobile interface disabled.",
                                e
                            );
                        }
                    }
                });
            }
        }
        Ok(())
    }
}

async fn validate_bearer_token(
    agent_name: &str,
    headers: &HeaderMap,
    registry: &MemoryRegistry,
) -> bool {
    // Check Authorization: Bearer <key>
    if let Some(auth_header) = headers.get("authorization")
        && let Ok(auth_str) = auth_header.to_str()
        && let Some(token) = auth_str.strip_prefix("Bearer ")
    {
        // Lookup against Vault
        let reg = registry.lock().await;
        if let Some(mem_mutex) = reg.get(agent_name) {
            let mem = mem_mutex.lock().await;
            let vault = crate::core::vault::SecretsVault::new(mem.get_db());
            if let Ok(Some(saved_token)) = vault.get_secret("mobile_key").await {
                return token == saved_token;
            }
        }
    }
    false
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    headers: HeaderMap,
    State(state): State<MobileState>,
) -> impl IntoResponse {
    if validate_bearer_token(&state.agent_name, &headers, &state.registry).await {
        ws.on_upgrade(move |socket| handle_socket(socket, state))
    } else {
        (StatusCode::UNAUTHORIZED, "Unauthorized Mobile Device").into_response()
    }
}

async fn handle_socket(mut socket: WebSocket, state: MobileState) {
    while let Some(msg) = socket.recv().await {
        if let Ok(Message::Text(text)) = msg {
            // Process Telemetry Payload
            if let Ok(payload) = serde_json::from_str::<TelemetryPayload>(&text) {
                // Formatting payload dump
                let dump = format!(
                    "Live Mobile Telemetry [{}]:\n- Location: {:?}\n- Health: {:?}\n- Device: {:?}",
                    payload.timestamp,
                    payload.data.location,
                    payload.data.health,
                    payload.data.device_state
                );

                // Save to Short-Term Memory context silently
                let reg = state.registry.lock().await;
                if let Some(mem_mutex) = reg.get(&state.agent_name) {
                    let mem = mem_mutex.lock().await;
                    // For the sake of this prototype, we'll actively append a specific string tag into STM
                    // Or we just feed it straight into the React Trigger prompt
                    let _ = mem.append_short_term_memory("TELEMETRY", &dump).await;
                }
                drop(reg);

                // Spin off a ReAct background loop asking if it needs to intervene
                let prompt = format!(
                    "[SYSTEM_CRON MOBILE TELEMETRY UPDATE]\n{}\nAnalyze the data. If the user appears to be in an emergency, or if you can proactively assist them based on their current location/health, take action using your Skills. Otherwise, log it silently and confidently state 'No action required'.",
                    dump
                );

                let skills_arc = state
                    .skill_registry
                    .lock()
                    .await
                    .get(&state.agent_name)
                    .cloned();
                let llm_arc = state
                    .llm_registry
                    .lock()
                    .await
                    .get(&state.agent_name)
                    .cloned();
                let mem_arc = state.registry.lock().await.get(&state.agent_name).cloned();

                if let (Some(skills_arc), Some(llm_arc), Some(mem_arc)) =
                    (skills_arc, llm_arc, mem_arc)
                {
                    let agent_name = state.agent_name.clone();
                    tokio::spawn(async move {
                        let _ = AutonomousBrain::execute_react_loop(
                            &prompt,
                            "MOBILE_POLLER",
                            llm_arc,
                            mem_arc,
                            skills_arc,
                            None,
                            false,
                            &agent_name,
                        )
                        .await;
                    });
                } else {
                    error!(
                        "Mobile telemetry: agent '{}' not found in registries",
                        state.agent_name
                    );
                }
            }
        }
    }
}

async fn chat_handler(
    headers: HeaderMap,
    State(state): State<MobileState>,
    Json(payload): Json<ChatPayload>,
) -> impl IntoResponse {
    if !validate_bearer_token(&state.agent_name, &headers, &state.registry).await {
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    }

    let skills_arc = match state
        .skill_registry
        .lock()
        .await
        .get(&state.agent_name)
        .cloned()
    {
        Some(s) => s,
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Agent skills not found" })),
            )
                .into_response();
        }
    };
    let llm_arc = match state
        .llm_registry
        .lock()
        .await
        .get(&state.agent_name)
        .cloned()
    {
        Some(l) => l,
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Agent LLM not found" })),
            )
                .into_response();
        }
    };
    let mem_arc = match state.registry.lock().await.get(&state.agent_name).cloned() {
        Some(m) => m,
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Agent memory not found" })),
            )
                .into_response();
        }
    };

    let mut final_prompt = payload.prompt.clone();
    if let Some(conf) = payload.audio_transcript_confidence {
        final_prompt.push_str(&format!(
            " (Audio Transcription Confidence: {:.1}%)",
            conf * 100.0
        ));
        if conf < 0.70 {
            final_prompt.push_str("\n[SYSTEM WARNING: Low confidence audio transcript. If the instruction is destructive or unclear, ask the user for confirmation instead of acting blindly.]");
        }
    }

    // The chat from app acts essentially as a direct terminal interaction
    let response = AutonomousBrain::execute_react_loop(
        &final_prompt,
        "MOBILE_APP",
        llm_arc,
        mem_arc,
        skills_arc,
        None,
        false,
        &state.agent_name,
    )
    .await;

    match response {
        Ok(res) => (StatusCode::OK, Json(serde_json::json!({ "response": res }))).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
            .into_response(),
    }
}

async fn notifications_handler(
    headers: HeaderMap,
    State(state): State<MobileState>,
) -> impl IntoResponse {
    if !validate_bearer_token(&state.agent_name, &headers, &state.registry).await {
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    }

    // Pull recent ASSISTANT messages from STM as notification feed
    let reg = state.registry.lock().await;
    if let Some(mem_mutex) = reg.get(&state.agent_name) {
        let mem = mem_mutex.lock().await;
        let stm = mem.read_short_term_memory().await.unwrap_or_default();
        let notifications: Vec<&str> = stm
            .lines()
            .filter(|line| line.starts_with("**ASSISTANT**: "))
            .map(|line| line.trim_start_matches("**ASSISTANT**: "))
            .collect();
        // Return last 10 notifications
        let recent: Vec<&str> = notifications.into_iter().rev().take(10).collect();
        (
            StatusCode::OK,
            Json(serde_json::json!({ "notifications": recent })),
        )
            .into_response()
    } else {
        (
            StatusCode::OK,
            Json(serde_json::json!({ "notifications": [] })),
        )
            .into_response()
    }
}

async fn sse_stream_handler(
    headers: HeaderMap,
    State(state): State<MobileState>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, StatusCode> {
    if !validate_bearer_token(&state.agent_name, &headers, &state.registry).await {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let receiver = state.log_tx.subscribe();
    let stream = BroadcastStream::new(receiver).filter_map(|msg| {
        match msg {
            Ok(log) => Some(Ok(Event::default().data(log))), // SSE properly encodes this
            Err(_) => None,
        }
    });

    Ok(Sse::new(stream))
}
