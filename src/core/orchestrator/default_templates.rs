//! Default orchestrator templates seeded on init.

use anyhow::Result;

use crate::core::memory::MemorySystem;
use crate::core::orchestrator::{
    JobFailurePolicy, JobMergePolicy, OrchestratorTemplate, SpawnProfile, WorkerMode,
};

/// Default provider/model for spawn profiles. Users can edit templates to use their preferred provider.
const DEFAULT_PROVIDER: &str = "openai";
const DEFAULT_MODEL: &str = "gpt-4o";

fn simple_template() -> OrchestratorTemplate {
    OrchestratorTemplate {
        template_id: "simple".to_string(),
        name: "Simple".to_string(),
        description: "Single ephemeral worker for quick tasks. Good for exploring, one-off coding, or small workflows.".to_string(),
        default_worker_mode: Some(WorkerMode::Ephemeral),
        default_max_parallelism: Some(1),
        default_retry_limit: Some(1),
        default_failure_policy: Some(JobFailurePolicy::FailFast),
        default_merge_policy: None,
        spawn_profiles: vec![SpawnProfile {
            role: "worker".to_string(),
            persona: "You are a capable assistant. Execute the assigned task using available skills.".to_string(),
            provider: DEFAULT_PROVIDER.to_string(),
            model: DEFAULT_MODEL.to_string(),
            runtime_type: "native".to_string(),
            image_profile: "base".to_string(),
        }],
    }
}

fn builder_checker_merger_template() -> OrchestratorTemplate {
    OrchestratorTemplate {
        template_id: "builder-checker-merger".to_string(),
        name: "Builder–Checker–Merger".to_string(),
        description: "Three-phase flow: builder produces code, checker validates (CHECKS_FAILED stops the job), merger opens PRs. Use with merge_action for full automation.".to_string(),
        default_worker_mode: Some(WorkerMode::Ephemeral),
        default_max_parallelism: Some(3),
        default_retry_limit: Some(1),
        default_failure_policy: Some(JobFailurePolicy::FailFast),
        default_merge_policy: Some(JobMergePolicy::ManualApproval),
        spawn_profiles: vec![
            SpawnProfile {
                role: "builder".to_string(),
                persona: "You are a builder agent. Implement code, write files, and produce artifacts. Output fork URL, branch name, and upstream repo when done.".to_string(),
                provider: DEFAULT_PROVIDER.to_string(),
                model: DEFAULT_MODEL.to_string(),
                runtime_type: "native".to_string(),
                image_profile: "base".to_string(),
            },
            SpawnProfile {
                role: "checker".to_string(),
                persona: "You are a checker agent. Validate the builder output (tests, lint, correctness). Reply with exactly CHECKS_FAILED if validation fails, otherwise summarize what passed.".to_string(),
                provider: DEFAULT_PROVIDER.to_string(),
                model: DEFAULT_MODEL.to_string(),
                runtime_type: "native".to_string(),
                image_profile: "base".to_string(),
            },
            SpawnProfile {
                role: "merger".to_string(),
                persona: "You are a merger agent. Use the github skill to open a PR or merge based on prior phase outputs. Extract fork URL, branch, and upstream from outputs.".to_string(),
                provider: DEFAULT_PROVIDER.to_string(),
                model: DEFAULT_MODEL.to_string(),
                runtime_type: "native".to_string(),
                image_profile: "base".to_string(),
            },
        ],
    }
}

/// Seed default orchestrator templates if none exist. Returns the number of templates added.
pub async fn seed_default_templates(memory: &MemorySystem) -> Result<usize> {
    let existing = memory.list_orchestrator_templates().await?;
    if !existing.is_empty() {
        return Ok(0);
    }

    let tpl_simple = simple_template();
    let tpl_bcm = builder_checker_merger_template();

    memory.upsert_orchestrator_template(&tpl_simple).await?;
    memory.upsert_orchestrator_template(&tpl_bcm).await?;

    Ok(2)
}
