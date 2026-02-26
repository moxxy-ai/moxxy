use crate::core::orchestrator::{SpawnProfile, WorkerMode, resolve_worker_assignments};

#[test]
fn existing_mode_routes_only_existing_workers() {
    let out = resolve_worker_assignments(
        WorkerMode::Existing,
        &["a".to_string(), "b".to_string()],
        &[],
        3,
    );
    assert_eq!(out.len(), 2);
    assert!(out.iter().all(|w| w.worker_mode == WorkerMode::Existing));
}

#[test]
fn mixed_mode_routes_existing_and_ephemeral() {
    let profiles = vec![SpawnProfile {
        role: "builder".to_string(),
        persona: "persona".to_string(),
        provider: "openai".to_string(),
        model: "gpt-4o".to_string(),
        runtime_type: "native".to_string(),
        image_profile: "base".to_string(),
    }];
    let out =
        resolve_worker_assignments(WorkerMode::Mixed, &["existing-a".to_string()], &profiles, 2);
    assert_eq!(out.len(), 3);
    assert_eq!(
        out.iter()
            .filter(|w| w.worker_mode == WorkerMode::Ephemeral)
            .count(),
        2
    );
}

#[test]
fn ephemeral_assignments_inherit_spawn_profile() {
    let profiles = vec![SpawnProfile {
        role: "reviewer".to_string(),
        persona: "review persona".to_string(),
        provider: "google".to_string(),
        model: "gemini-2.5-flash".to_string(),
        runtime_type: "wasm".to_string(),
        image_profile: "networked".to_string(),
    }];
    let out = resolve_worker_assignments(WorkerMode::Ephemeral, &[], &profiles, 1);
    assert_eq!(out.len(), 1);
    let w = &out[0];
    assert_eq!(w.role, "reviewer");
    assert_eq!(w.persona.as_deref(), Some("review persona"));
    assert_eq!(w.provider.as_deref(), Some("google"));
    assert_eq!(w.model.as_deref(), Some("gemini-2.5-flash"));
    assert_eq!(w.runtime_type.as_deref(), Some("wasm"));
    assert_eq!(w.image_profile.as_deref(), Some("networked"));
}
