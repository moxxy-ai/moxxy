//! Orchestrator job execution: runs workers and updates job state.
//!
//! Worker execution is split by agent kind:
//! - [native]: delegates to existing agents via registries
//! - [ephemeral]: creates task-scoped agents, runs, cleans up

mod ephemeral;
mod native;

use std::sync::Arc;

use crate::core::orchestrator::{JobState, WorkerAssignment, WorkerMode};
use crate::interfaces::web::AppState;

/// Result of a completed orchestration job for the blocking API.
#[derive(Debug, Clone)]
pub struct JobResult {
    pub job_id: String,
    pub status: String,
    pub workers: Vec<WorkerResult>,
}

#[derive(Debug, Clone)]
pub struct WorkerResult {
    pub worker_agent: String,
    pub role: String,
    pub status: String,
    pub output: Option<String>,
}

/// Convert agent execution result to worker result tuple.
pub(super) fn to_worker_result(
    result: anyhow::Result<String>,
) -> (String, Option<String>, Option<String>) {
    match result {
        Ok(res) => {
            let summary = if res.len() > 500 {
                format!("{}...", &res[..500])
            } else {
                res
            };
            ("succeeded".to_string(), Some(summary), None)
        }
        Err(e) => ("failed".to_string(), None, Some(e.to_string())),
    }
}

/// Runs the orchestration job in the background. Updates job state and worker
/// runs via the orchestrator agent's memory. Optionally signals completion
/// via `done_tx` for the blocking `jobs run` API.
/// Returns true if checker output implies job failure (CHECKS_FAILED gate).
fn checker_output_implies_failure(role: &str, output: Option<&str>) -> bool {
    if !role.eq_ignore_ascii_case("checker") {
        return false;
    }
    output.map(|o| o.contains("CHECKS_FAILED")).unwrap_or(false)
}

pub async fn run_orchestration_job(
    orchestrator_agent: String,
    job_id: String,
    prompt: String,
    worker_assignments: Vec<WorkerAssignment>,
    merge_action: Option<String>,
    mem_arc: Arc<tokio::sync::Mutex<crate::core::memory::MemorySystem>>,
    state: AppState,
    done_tx: Option<tokio::sync::oneshot::Sender<JobResult>>,
) {
    let mut workers_result = Vec::new();
    let mut phase_outputs = Vec::<String>::new();

    for assignment in worker_assignments {
        // Build prompt for this phase: base + prior phase outputs
        let phase_prompt = if phase_outputs.is_empty() {
            prompt.clone()
        } else {
            let prior = phase_outputs
                .iter()
                .enumerate()
                .map(|(i, o)| format!("[Phase {}] {}", i + 1, o))
                .collect::<Vec<_>>()
                .join("\n\n");
            format!("{}\n\nPrior phase outputs:\n{}", prompt, prior)
        };

        let worker_run = match mem_arc
            .lock()
            .await
            .add_orchestrator_worker_run(
                &job_id,
                &assignment.worker_agent,
                &format!("{:?}", assignment.worker_mode).to_lowercase(),
                &format!("{} :: {}", assignment.role, phase_prompt),
                "running",
                1,
            )
            .await
        {
            Ok(w) => w,
            Err(_) => continue,
        };

        let _ = mem_arc
            .lock()
            .await
            .add_orchestrator_event(
                &job_id,
                "worker_started",
                &serde_json::json!({
                    "worker_run_id": worker_run.worker_run_id,
                    "worker_agent": worker_run.worker_agent,
                    "worker_mode": worker_run.worker_mode,
                })
                .to_string(),
            )
            .await;

        let (status, output, error) = match assignment.worker_mode {
            WorkerMode::Existing => native::execute(&assignment, &phase_prompt, &state).await,
            WorkerMode::Ephemeral => {
                ephemeral::execute(
                    &orchestrator_agent,
                    &job_id,
                    &assignment,
                    &phase_prompt,
                    &state,
                )
                .await
            }
            WorkerMode::Mixed => {
                if assignment.worker_agent.starts_with("ephemeral-") {
                    ephemeral::execute(
                        &orchestrator_agent,
                        &job_id,
                        &assignment,
                        &phase_prompt,
                        &state,
                    )
                    .await
                } else {
                    native::execute(&assignment, &phase_prompt, &state).await
                }
            }
        };

        let output_str = output.as_deref().or(error.as_deref());
        let _ = mem_arc
            .lock()
            .await
            .update_orchestrator_worker_run(
                &worker_run.worker_run_id,
                &status,
                output_str,
                error.as_deref(),
            )
            .await;

        let _ = mem_arc
            .lock()
            .await
            .add_orchestrator_event(
                &job_id,
                "worker_completed",
                &serde_json::json!({
                    "worker_run_id": worker_run.worker_run_id,
                    "worker_agent": worker_run.worker_agent,
                    "status": status,
                })
                .to_string(),
            )
            .await;

        let out = output
            .as_deref()
            .or(error.as_deref())
            .unwrap_or("")
            .to_string();
        phase_outputs.push(out.clone());

        let output_opt = output.or(error);
        workers_result.push(WorkerResult {
            worker_agent: assignment.worker_agent.clone(),
            role: assignment.role.clone(),
            status: status.clone(),
            output: output_opt.clone(),
        });

        // CHECKS_FAILED gate: if checker returned CHECKS_FAILED, stop and fail job
        if checker_output_implies_failure(&assignment.role, output_opt.as_deref()) {
            break;
        }
    }

    // Merger phase: when merge_action is set and all prior phases succeeded
    let should_run_merger = !workers_result
        .iter()
        .any(|w| checker_output_implies_failure(&w.role, w.output.as_deref()))
        && workers_result.iter().all(|w| w.status == "succeeded")
        && merge_action.as_ref().map_or(false, |a| {
            let lower = a.to_lowercase();
            !lower.is_empty() && lower != "none"
        });

    if should_run_merger {
        let merger_assignment = WorkerAssignment {
            worker_mode: WorkerMode::Ephemeral,
            worker_agent: format!("ephemeral-{}", workers_result.len() + 1),
            role: "merger".to_string(),
            persona: Some(format!(
                "You are a merger agent. Use the github skill to open a PR or merge based on the prior phase outputs. \
                 Merge action: {}. Prior outputs contain fork URL, branch, and upstream repo. \
                 Extract them and use github pr to open a PR, or merge as instructed.",
                merge_action.as_deref().unwrap_or("pr_only")
            )),
            provider: None,
            model: None,
            runtime_type: None,
            image_profile: None,
        };

        let prior = phase_outputs
            .iter()
            .enumerate()
            .map(|(i, o)| format!("[Phase {}] {}", i + 1, o))
            .collect::<Vec<_>>()
            .join("\n\n");
        let merger_prompt = format!(
            "{}\n\nMerge action: {}\n\nPrior phase outputs:\n{}",
            prompt,
            merge_action.as_deref().unwrap_or("pr_only"),
            prior
        );

        if let Ok(wr) = mem_arc
            .lock()
            .await
            .add_orchestrator_worker_run(
                &job_id,
                &merger_assignment.worker_agent,
                "ephemeral",
                &format!("merger :: {}", merger_prompt),
                "running",
                1,
            )
            .await
        {
            let _ = mem_arc
                .lock()
                .await
                .add_orchestrator_event(
                    &job_id,
                    "worker_started",
                    &serde_json::json!({
                        "worker_run_id": wr.worker_run_id,
                        "worker_agent": wr.worker_agent,
                        "worker_mode": "ephemeral",
                    })
                    .to_string(),
                )
                .await;

            let (status, output, error) = ephemeral::execute(
                &orchestrator_agent,
                &job_id,
                &merger_assignment,
                &merger_prompt,
                &state,
            )
            .await;

            let output_str = output.as_deref().or(error.as_deref());
            let _ = mem_arc
                .lock()
                .await
                .update_orchestrator_worker_run(
                    &wr.worker_run_id,
                    &status,
                    output_str,
                    error.as_deref(),
                )
                .await;

            let _ = mem_arc
                .lock()
                .await
                .add_orchestrator_event(
                    &job_id,
                    "worker_completed",
                    &serde_json::json!({
                        "worker_run_id": wr.worker_run_id,
                        "worker_agent": wr.worker_agent,
                        "status": status,
                    })
                    .to_string(),
                )
                .await;

            workers_result.push(WorkerResult {
                worker_agent: merger_assignment.worker_agent.clone(),
                role: "merger".to_string(),
                status: status.clone(),
                output: output.or(error),
            });
        }
    }

    let checker_failed = workers_result
        .iter()
        .any(|w| checker_output_implies_failure(&w.role, w.output.as_deref()));

    let all_succeeded = workers_result.iter().all(|w| w.status == "succeeded");

    let (final_status, summary) = if checker_failed {
        (
            "failed".to_string(),
            Some("Checker reported CHECKS_FAILED".to_string()),
        )
    } else if all_succeeded {
        (
            "completed".to_string(),
            Some("Orchestration completed".to_string()),
        )
    } else {
        (
            "failed".to_string(),
            Some("One or more workers failed".to_string()),
        )
    };

    {
        let mem = mem_arc.lock().await;
        if let Ok(Some(current)) = mem.get_orchestrator_job(&job_id).await {
            let to = JobState::from_status(&final_status).unwrap_or(JobState::Failed);
            if let Some(from) = JobState::from_status(&current.status)
                && crate::core::orchestrator::can_transition(from, to)
            {
                let _ = mem
                    .update_orchestrator_job_status(&job_id, to.as_str(), summary.as_deref(), None)
                    .await;
            }
        }
    }

    let _ = mem_arc
        .lock()
        .await
        .add_orchestrator_event(
            &job_id,
            "done",
            &serde_json::json!({ "status": final_status }).to_string(),
        )
        .await;

    let result = JobResult {
        job_id: job_id.clone(),
        status: final_status,
        workers: workers_result,
    };

    if let Some(tx) = done_tx {
        let _ = tx.send(result);
    }
}
