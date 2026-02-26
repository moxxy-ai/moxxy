use crate::core::orchestrator::{SpawnProfile, WorkerMode, resolve_phased_worker_assignments};

#[test]
fn phased_assignments_match_profile_by_role() {
    let profiles = vec![
        SpawnProfile {
            role: "builder".to_string(),
            persona: "build persona".to_string(),
            provider: "openai".to_string(),
            model: "gpt-4o".to_string(),
            runtime_type: "native".to_string(),
            image_profile: "base".to_string(),
        },
        SpawnProfile {
            role: "checker".to_string(),
            persona: "check persona".to_string(),
            provider: "google".to_string(),
            model: "gemini-2.5-flash".to_string(),
            runtime_type: "native".to_string(),
            image_profile: "base".to_string(),
        },
        SpawnProfile {
            role: "merger".to_string(),
            persona: "merge persona".to_string(),
            provider: "anthropic".to_string(),
            model: "claude-sonnet-4-20250514".to_string(),
            runtime_type: "native".to_string(),
            image_profile: "base".to_string(),
        },
    ];

    let phases = ["builder", "checker", "merger"]
        .iter()
        .map(|s| s.to_string())
        .collect::<Vec<_>>();

    let out = resolve_phased_worker_assignments(WorkerMode::Ephemeral, &phases, &profiles);

    assert_eq!(out.len(), 3);

    // builder gets builder profile (openai/gpt-4o)
    assert_eq!(out[0].role, "builder");
    assert_eq!(out[0].provider.as_deref(), Some("openai"));
    assert_eq!(out[0].model.as_deref(), Some("gpt-4o"));

    // checker gets checker profile (google/gemini)
    assert_eq!(out[1].role, "checker");
    assert_eq!(out[1].provider.as_deref(), Some("google"));
    assert_eq!(out[1].model.as_deref(), Some("gemini-2.5-flash"));

    // merger gets merger profile (anthropic/claude)
    assert_eq!(out[2].role, "merger");
    assert_eq!(out[2].provider.as_deref(), Some("anthropic"));
    assert_eq!(out[2].model.as_deref(), Some("claude-sonnet-4-20250514"));
}

#[test]
fn phased_assignments_fallback_to_index_when_no_role_match() {
    let profiles = vec![SpawnProfile {
        role: "worker".to_string(),
        persona: "generic".to_string(),
        provider: "openai".to_string(),
        model: "gpt-4o".to_string(),
        runtime_type: "native".to_string(),
        image_profile: "base".to_string(),
    }];

    let phases = ["builder", "checker"]
        .iter()
        .map(|s| s.to_string())
        .collect::<Vec<_>>();

    let out = resolve_phased_worker_assignments(WorkerMode::Ephemeral, &phases, &profiles);

    assert_eq!(out.len(), 2);
    assert_eq!(out[0].role, "builder");
    assert_eq!(out[0].provider.as_deref(), Some("openai"));
    assert_eq!(out[1].role, "checker");
    assert_eq!(out[1].provider.as_deref(), Some("openai"));
}
