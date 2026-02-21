use axum::{
    Json,
    extract::{Path, State},
};
use tracing::info;

use super::super::AppState;

pub async fn webhook_endpoint(
    Path((agent, source)): Path<(String, String)>,
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

        // Release locks before spawning
        drop(reg);
        drop(skill_reg);
        drop(llm_reg);

        // Check if this agent has a WASM container
        let container_reg = state.container_registry.lock().await;
        let wasm_container = container_reg.get(&agent).cloned();
        drop(container_reg);

        // Fire and forget the ReAct loop
        let trigger_text = format!("Webhook Event from [{}]: {}", source, body);
        let src_label = format!("WEBHOOK_{}", source.to_uppercase());

        info!("Dispatching Webhook from {} to Agent [{}]", source, agent);

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
