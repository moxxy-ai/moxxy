use axum::{
    Json,
    extract::{Path, State},
    response::IntoResponse,
    response::sse::{Event, Sse},
};
use std::convert::Infallible;
use tokio_stream::StreamExt;
use tracing::info;

use super::super::AppState;

#[derive(serde::Deserialize)]
pub struct ChatRequest {
    prompt: String,
    #[serde(default)]
    verbose_reasoning: bool,
}

pub async fn chat_endpoint(
    Path(agent): Path<String>,
    State(state): State<AppState>,
    Json(payload): Json<ChatRequest>,
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

        // Release locks
        drop(reg);
        drop(skill_reg);
        drop(llm_reg);

        // Check if this agent has a WASM container
        let container_reg = state.container_registry.lock().await;
        let wasm_container = container_reg.get(&agent).cloned();
        drop(container_reg);

        if let Some(container) = wasm_container {
            // WASM agent -- execute through the container
            info!("Routing chat for agent [{}] through WASM container", agent);
            match container
                .execute(&payload.prompt, llms, mem, skills, None, false)
                .await
            {
                Ok(res) => Json(serde_json::json!({ "success": true, "response": res })),
                Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
            }
        } else {
            // Native agent -- use the ReAct loop directly
            match crate::core::brain::AutonomousBrain::execute_react_loop(
                &payload.prompt,
                "USER",
                llms,
                mem,
                skills,
                None,
                false,
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

pub async fn chat_stream_endpoint(
    Path(agent): Path<String>,
    State(state): State<AppState>,
    Json(payload): Json<ChatRequest>,
) -> axum::response::Response {
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

        let (tx, rx) = tokio::sync::mpsc::channel::<String>(32);
        let prompt = payload.prompt.clone();
        let verbose_reasoning = payload.verbose_reasoning;
        let agent_name = agent.clone();

        tokio::spawn(async move {
            if let Some(container) = wasm_container {
                match container
                    .execute(
                        &prompt,
                        llms,
                        mem,
                        skills,
                        Some(tx.clone()),
                        verbose_reasoning,
                    )
                    .await
                {
                    Ok(res) => {
                        let _ = tx
                            .send(
                                serde_json::json!({ "type": "response", "text": res }).to_string(),
                            )
                            .await;
                    }
                    Err(e) => {
                        let _ = tx
                            .send(
                                serde_json::json!({ "type": "error", "message": e.to_string() })
                                    .to_string(),
                            )
                            .await;
                    }
                }
                let _ = tx
                    .send(serde_json::json!({ "type": "done" }).to_string())
                    .await;
            } else {
                let _ = crate::core::brain::AutonomousBrain::execute_react_loop(
                    &prompt,
                    "USER",
                    llms,
                    mem,
                    skills,
                    Some(tx),
                    verbose_reasoning,
                    &agent_name,
                )
                .await;
            }
        });

        let stream = tokio_stream::wrappers::ReceiverStream::new(rx)
            .map(|msg| Ok::<_, Infallible>(Event::default().data(msg)));

        Sse::new(stream).into_response()
    } else {
        Json(serde_json::json!({ "success": false, "error": "Agent not found" })).into_response()
    }
}
