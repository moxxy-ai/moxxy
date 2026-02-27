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

    // Resolve LLM provider/model: prefer the orchestrator agent's active LLM
    // (what the user selected), then fall back to the spawn profile override.
    // This ensures ephemeral workers always inherit the agent's current model
    // rather than stale values baked into template profiles.
    // Resolve LLM: prefer orchestrator agent's active LLM, fall back to spawn profile.
    let (resolved_provider, resolved_model) = {
        let agent_llm = {
            let llm_reg = state.llm_registry.lock().await;
            let registry_keys: Vec<_> = llm_reg.keys().cloned().collect();
            if let Some(llm_arc) = llm_reg.get(orchestrator_agent) {
                let llm = llm_arc.read().await;
                let (prov, model) = llm.get_active_info();
                info!(
                    "LLM registry lookup OK for [{}]: active=({:?}, {:?}), keys={:?}",
                    orchestrator_agent, prov, model, registry_keys
                );
                match (prov, model) {
                    (Some(p), Some(m)) if !p.is_empty() && !m.is_empty() => {
                        Some((p.to_string(), m.to_string()))
                    }
                    _ => None,
                }
            } else {
                info!(
                    "LLM registry lookup MISS for [{}], keys={:?}, falling back to profile ({:?}/{:?})",
                    orchestrator_agent, registry_keys, assignment.provider, assignment.model
                );
                None
            }
        };

        if let Some((p, m)) = agent_llm {
            (Some(p), Some(m))
        } else {
            (assignment.provider.clone(), assignment.model.clone())
        }
    };

    info!(
        "Ephemeral worker [{}] LLM: {:?}/{:?}",
        assignment.worker_agent, resolved_provider, resolved_model,
    );

    let agent = EphemeralAgent::new(EphemeralAgentParams {
        name: ephemeral_name.clone(),
        workspace_dir: workspace_dir.clone(),
        parent_vault,
        api_host: state.api_host.clone(),
        api_port: state.api_port,
        internal_token: state.internal_token.clone(),
        llm_provider: resolved_provider,
        llm_model: resolved_model,
    });

    let role_lower = assignment.role.to_lowercase();
    let workflow = match role_lower.as_str() {
        "builder" => {
            "\
WORKFLOW (builder):\n\
1. Use the `git` skill: `git ws init owner/repo branch task-name` to set up an isolated worktree\n\
   - If the repo is empty (no branches), git ws init creates an orphan branch automatically\n\
2. Use `file_ops` to create/edit files within the worktree\n\
3. Use `workspace_shell` with subdir \".\" to run build/install/test commands\n\
4. Use the `git` skill to commit and push (git identity is auto-configured):\n\
   - `git add .`\n\
   - `git commit -m \"feat: description\"`\n\
   - `git push origin HEAD` (or `git push --set-upstream origin HEAD` for new repos)\n\
5. Report: branch name, repo, list of files created/modified\n\
IMPORTANT: Always use the `git` skill for git operations (not workspace_shell). You MUST commit and push. Do not stop after creating files."
        }
        "checker" => {
            "\
WORKFLOW (checker):\n\
1. Use `git ws init` to set up the repo worktree\n\
2. Check out the branch from prior builder output\n\
3. Use `workspace_shell` to run tests, lint, build commands\n\
4. Report: what passed, what failed. Output CHECKS_FAILED if validation fails."
        }
        "merger" => {
            "\
WORKFLOW (merger):\n\
1. Extract branch names and repo from prior builder/checker outputs\n\
2. Use `github pr` to create pull request(s) from the builder branches\n\
3. Report: PR URL(s), branch names, merge status"
        }
        _ => {
            "\
WORKFLOW:\n\
1. Use available skills to complete your assigned task\n\
2. Report your results clearly when done"
        }
    };

    let trigger = format!(
        "You are an orchestrator worker (role: {role}). Execute the task described below.\n\n\
         {workflow}\n\n\
         {prompt}",
        role = assignment.role,
        workflow = workflow,
        prompt = crate::core::brain::sanitize_invoke_tags(prompt)
    );

    info!(
        "Orchestrator spawning ephemeral agent [{}] at {:?}",
        agent.name(),
        workspace_dir
    );

    to_worker_result(agent.execute(&trigger, "ORCHESTRATOR_EPHEMERAL").await)
}
