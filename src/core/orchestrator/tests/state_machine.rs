use crate::core::orchestrator::{JobState, can_transition};

#[test]
fn lifecycle_happy_path_transitions_are_allowed() {
    let path = [
        (JobState::Queued, JobState::Planning),
        (JobState::Planning, JobState::Dispatching),
        (JobState::Dispatching, JobState::Executing),
        (JobState::Executing, JobState::Reviewing),
        (JobState::Reviewing, JobState::MergePending),
        (JobState::MergePending, JobState::Merging),
        (JobState::Merging, JobState::Completed),
    ];
    for (from, to) in path {
        assert!(
            can_transition(from, to),
            "expected transition {:?} -> {:?} to be allowed",
            from,
            to
        );
    }
}

#[test]
fn retry_then_replan_transition_is_allowed() {
    assert!(can_transition(JobState::Executing, JobState::Replanning));
    assert!(can_transition(JobState::Replanning, JobState::Dispatching));
}

#[test]
fn merge_gate_enforces_review_before_merge() {
    assert!(!can_transition(JobState::Executing, JobState::Merging));
    assert!(can_transition(JobState::Reviewing, JobState::MergePending));
    assert!(can_transition(JobState::MergePending, JobState::Merging));
}

#[test]
fn cancel_is_allowed_from_active_states() {
    let active = [
        JobState::Queued,
        JobState::Planning,
        JobState::Dispatching,
        JobState::Executing,
        JobState::Replanning,
        JobState::Reviewing,
        JobState::MergePending,
        JobState::Merging,
    ];
    for from in active {
        assert!(
            can_transition(from, JobState::Canceled),
            "expected cancel from {:?}",
            from
        );
    }
}
