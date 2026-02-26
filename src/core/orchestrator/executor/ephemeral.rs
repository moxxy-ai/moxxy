//! Ephemeral agent worker execution: creates task-scoped agents, runs, cleans up.

use std::path::PathBuf;
use tracing::info;

use crate::core::agent::{Agent, EphemeralAgent, EphemeralAgentParams};
use crate::core::orchestrator::WorkerAssignment;
use crate::interfaces::web::AppState;
use crate::platform::{NativePlatform, Platform};

use super::to_worker_result;

/// Sanitize a string for use in a filesystem path (replace non-alphanumeric with underscore).
fn sanitize_path_component(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// Execute an ephemeral agent via EphemeralAgent (create workspace, run, cleanup).
pub async fn execute(
    orchestrator_agent: &str,
    job_id: &str,
    assignment: &WorkerAssignment,
    prompt: &str,
    state: &AppState,
) -> (String, Option<String>, Option<String>) {
    let parent_vault = match state
        .vault_registry
        .lock()
        .await
        .get(orchestrator_agent)
        .cloned()
    {
        Some(v) => v,
        None => {
            return (
                "failed".to_string(),
                None,
                Some(format!(
                    "Orchestrator agent '{}' vault not found",
                    orchestrator_agent
                )),
            );
        }
    };

    let safe_job = sanitize_path_component(job_id);
    let safe_worker = sanitize_path_component(&assignment.worker_agent);
    let ephemeral_name = format!("ephemeral-{}-{}", safe_job, safe_worker);
    let workspace_dir: PathBuf = NativePlatform::data_dir()
        .join("agents")
        .join(&ephemeral_name);

    if let Err(e) = tokio::fs::create_dir_all(&workspace_dir).await {
        return (
            "failed".to_string(),
            None,
            Some(format!("Failed to create ephemeral workspace: {}", e)),
        );
    }

    let persona = assignment.persona.as_ref().cloned().unwrap_or_else(|| {
        format!(
            "You are a {} agent. Execute the assigned task using available skills.",
            assignment.role
        )
    });
    if let Err(e) = tokio::fs::write(workspace_dir.join("persona.md"), &persona).await {
        let _ = tokio::fs::remove_dir_all(&workspace_dir).await;
        return (
            "failed".to_string(),
            None,
            Some(format!("Failed to write persona: {}", e)),
        );
    }

    let agent = EphemeralAgent::new(EphemeralAgentParams {
        name: ephemeral_name.clone(),
        workspace_dir: workspace_dir.clone(),
        parent_vault,
        api_host: state.api_host.clone(),
        api_port: state.api_port,
        internal_token: state.internal_token.clone(),
        llm_provider: assignment.provider.clone(),
        llm_model: assignment.model.clone(),
    });

    let trigger = format!(
        "ORCHESTRATOR TASK [{}]: {}",
        assignment.role,
        crate::core::brain::sanitize_invoke_tags(prompt)
    );

    info!(
        "Orchestrator spawning ephemeral agent [{}] at {:?}",
        agent.name(),
        workspace_dir
    );

    to_worker_result(agent.execute(&trigger, "ORCHESTRATOR_EPHEMERAL").await)
}
