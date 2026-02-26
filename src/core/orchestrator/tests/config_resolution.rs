use crate::core::orchestrator::{
    JobFailurePolicy, JobMergePolicy, OrchestratorAgentConfig, OrchestratorTemplate, WorkerMode,
    parallelism_advisory, resolve_job_defaults,
};

fn sample_template() -> OrchestratorTemplate {
    OrchestratorTemplate {
        template_id: "tpl1".to_string(),
        name: "T1".to_string(),
        description: "d".to_string(),
        default_worker_mode: Some(WorkerMode::Ephemeral),
        default_max_parallelism: Some(7),
        default_retry_limit: Some(3),
        default_failure_policy: Some(JobFailurePolicy::FailFast),
        default_merge_policy: Some(JobMergePolicy::AutoOnReviewPass),
        spawn_profiles: vec![],
    }
}

#[test]
fn precedence_is_agent_then_template_then_request_override() {
    let cfg = OrchestratorAgentConfig {
        default_worker_mode: WorkerMode::Existing,
        default_max_parallelism: Some(2),
        parallelism_warn_threshold: 5,
        ..Default::default()
    };
    let tpl = sample_template();

    let (mode, max_parallelism, advisory) =
        resolve_job_defaults(&cfg, Some(&tpl), Some(WorkerMode::Mixed), Some(11));
    assert_eq!(mode, WorkerMode::Mixed);
    assert_eq!(max_parallelism, Some(11));
    assert!(advisory.is_some());
}

#[test]
fn default_parallelism_has_no_hard_cap() {
    let cfg = OrchestratorAgentConfig {
        default_max_parallelism: Some(1000),
        parallelism_warn_threshold: 5,
        ..Default::default()
    };
    let (_, max_parallelism, advisory) = resolve_job_defaults(&cfg, None, None, None);
    assert_eq!(max_parallelism, Some(1000));
    assert!(advisory.is_some());
}

#[test]
fn advisory_only_triggers_above_threshold() {
    assert!(parallelism_advisory(Some(6), 5).is_some());
    assert!(parallelism_advisory(Some(5), 5).is_none());
    assert!(parallelism_advisory(None, 5).is_none());
}
