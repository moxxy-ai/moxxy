//! Native agent worker execution: delegates to existing agents via registries.

use tracing::info;

use crate::core::agent::{Agent, NativeAgent};
use crate::core::orchestrator::WorkerAssignment;
use crate::interfaces::web::AppState;

use super::to_worker_result;

/// Execute an existing agent via NativeAgent (subsystems from registries).
pub async fn execute(
    assignment: &WorkerAssignment,
    prompt: &str,
    state: &AppState,
) -> (String, Option<String>, Option<String>) {
    let agent_name = &assignment.worker_agent;
    let reg = state.registry.lock().await;
    let skill_reg = state.skill_registry.lock().await;
    let llm_reg = state.llm_registry.lock().await;

    let (mem_sys, skill_sys, llm_sys) = match (
        reg.get(agent_name).cloned(),
        skill_reg.get(agent_name).cloned(),
        llm_reg.get(agent_name).cloned(),
    ) {
        (Some(m), Some(s), Some(l)) => (m, s, l),
        _ => {
            return (
                "failed".to_string(),
                None,
                Some(format!(
                    "Agent '{}' not found (missing memory, skills, or LLM)",
                    agent_name
                )),
            );
        }
    };

    drop(reg);
    drop(skill_reg);
    drop(llm_reg);

    let container_reg = state.container_registry.lock().await;
    let wasm_container = container_reg.get(agent_name).cloned();
    drop(container_reg);

    let agent: Box<dyn Agent> = Box::new(NativeAgent::new(
        agent_name,
        mem_sys,
        skill_sys,
        llm_sys,
        wasm_container,
    ));

    let trigger = format!(
        "ORCHESTRATOR TASK [{}]: {}",
        assignment.role,
        crate::core::brain::sanitize_invoke_tags(prompt)
    );

    info!(
        "Orchestrator dispatching to native agent [{}]",
        agent.name()
    );

    to_worker_result(agent.execute(&trigger, "ORCHESTRATOR").await)
}
