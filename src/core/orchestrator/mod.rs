mod default_templates;
mod executor;
pub mod types;

pub use default_templates::seed_default_templates;

pub use executor::run_orchestration_job;
pub use types::{
    JobFailurePolicy, JobMergePolicy, JobState, OrchestratorAgentConfig, OrchestratorTemplate,
    SpawnProfile, TaskGraph, TaskNode, TaskStatus, WorkerAssignment, WorkerMode,
};

pub fn can_transition(_from: JobState, _to: JobState) -> bool {
    let from = _from;
    let to = _to;
    if from == to {
        return true;
    }
    match from {
        JobState::Queued => matches!(to, JobState::Planning | JobState::Canceled),
        JobState::Planning => matches!(
            to,
            JobState::PluginPreDispatch
                | JobState::Dispatching
                | JobState::Failed
                | JobState::Canceled
        ),
        JobState::PluginPreDispatch => {
            matches!(
                to,
                JobState::Dispatching | JobState::Failed | JobState::Canceled
            )
        }
        JobState::Dispatching => {
            matches!(
                to,
                JobState::Executing | JobState::Failed | JobState::Canceled
            )
        }
        JobState::Executing => matches!(
            to,
            JobState::Replanning
                | JobState::Reviewing
                | JobState::Failed
                | JobState::Canceled
                | JobState::Completed
        ),
        JobState::Replanning => matches!(
            to,
            JobState::Dispatching | JobState::Failed | JobState::Canceled
        ),
        JobState::Reviewing => matches!(
            to,
            JobState::MergePending
                | JobState::Merging
                | JobState::Completed
                | JobState::Failed
                | JobState::Canceled
        ),
        JobState::MergePending => {
            matches!(
                to,
                JobState::Merging | JobState::Failed | JobState::Canceled
            )
        }
        JobState::Merging => matches!(
            to,
            JobState::Completed | JobState::Failed | JobState::Canceled
        ),
        JobState::Completed | JobState::Failed | JobState::Canceled => false,
    }
}

pub fn parallelism_advisory(
    max_parallelism: Option<usize>,
    warn_threshold: usize,
) -> Option<String> {
    match max_parallelism {
        Some(v) if v > warn_threshold => Some(format!(
            "Configured parallelism {} is above recommended threshold {}",
            v, warn_threshold
        )),
        _ => None,
    }
}

pub fn resolve_effective_mode(
    requested: Option<WorkerMode>,
    agent_default: WorkerMode,
    template_default: Option<WorkerMode>,
) -> WorkerMode {
    requested.or(template_default).unwrap_or(agent_default)
}

pub fn resolve_worker_assignments(
    mode: WorkerMode,
    existing_agents: &[String],
    spawn_profiles: &[SpawnProfile],
    ephemeral_count: usize,
) -> Vec<WorkerAssignment> {
    let mut out = Vec::new();

    if mode == WorkerMode::Existing || mode == WorkerMode::Mixed {
        for name in existing_agents {
            out.push(WorkerAssignment {
                worker_mode: WorkerMode::Existing,
                worker_agent: name.clone(),
                role: "existing".to_string(),
                persona: None,
                provider: None,
                model: None,
                runtime_type: None,
                image_profile: None,
            });
        }
    }

    if mode == WorkerMode::Ephemeral || mode == WorkerMode::Mixed {
        for i in 0..ephemeral_count {
            let profile = if spawn_profiles.is_empty() {
                None
            } else {
                spawn_profiles.get(i % spawn_profiles.len())
            };
            let role = profile
                .map(|p| p.role.clone())
                .unwrap_or_else(|| "worker".to_string());
            out.push(WorkerAssignment {
                worker_mode: WorkerMode::Ephemeral,
                worker_agent: format!("ephemeral-{}", i + 1),
                role,
                persona: profile.map(|p| p.persona.clone()),
                provider: profile.map(|p| p.provider.clone()),
                model: profile.map(|p| p.model.clone()),
                runtime_type: profile.map(|p| p.runtime_type.clone()),
                image_profile: profile.map(|p| p.image_profile.clone()),
            });
        }
    }

    out
}

/// Resolve worker assignments for phased execution. One worker per phase with role from phase name.
/// Spawn profiles are matched by role (case-insensitive); falls back to index when no role match.
pub fn resolve_phased_worker_assignments(
    _mode: WorkerMode,
    phases: &[String],
    spawn_profiles: &[SpawnProfile],
) -> Vec<WorkerAssignment> {
    if phases.is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();
    for (i, role) in phases.iter().enumerate() {
        let profile = if spawn_profiles.is_empty() {
            None
        } else {
            spawn_profiles
                .iter()
                .find(|p| p.role.eq_ignore_ascii_case(role))
                .or_else(|| spawn_profiles.get(i % spawn_profiles.len()))
        };
        out.push(WorkerAssignment {
            worker_mode: WorkerMode::Ephemeral,
            worker_agent: format!("ephemeral-{}", i + 1),
            role: role.clone(),
            persona: profile.map(|p| p.persona.clone()),
            provider: profile.map(|p| p.provider.clone()),
            model: profile.map(|p| p.model.clone()),
            runtime_type: profile.map(|p| p.runtime_type.clone()),
            image_profile: profile.map(|p| p.image_profile.clone()),
        });
    }
    out
}

/// Look up a spawn profile by role (case-insensitive). Used for merger phase.
pub fn find_spawn_profile_by_role<'a>(
    spawn_profiles: &'a [SpawnProfile],
    role: &str,
) -> Option<&'a SpawnProfile> {
    spawn_profiles
        .iter()
        .find(|p| p.role.eq_ignore_ascii_case(role))
}

pub fn resolve_job_defaults(
    agent_cfg: &OrchestratorAgentConfig,
    template: Option<&OrchestratorTemplate>,
    requested_mode: Option<WorkerMode>,
    requested_max_parallelism: Option<usize>,
) -> (WorkerMode, Option<usize>, Option<String>) {
    let mode = resolve_effective_mode(
        requested_mode,
        agent_cfg.default_worker_mode,
        template.and_then(|t| t.default_worker_mode),
    );
    let max_parallelism = requested_max_parallelism
        .or_else(|| template.and_then(|t| t.default_max_parallelism))
        .or(agent_cfg.default_max_parallelism);
    let advisory = parallelism_advisory(max_parallelism, agent_cfg.parallelism_warn_threshold);
    (mode, max_parallelism, advisory)
}

#[cfg(test)]
mod tests;
