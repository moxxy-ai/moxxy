use std::{convert::Infallible, sync::Arc};

use axum::{
    Json,
    extract::{Path, Query, State},
    response::IntoResponse,
    response::sse::{Event, Sse},
};
use tokio_stream::StreamExt;

use crate::core::{
    llm::registry::ProviderRegistry,
    orchestrator::{
        JobState, OrchestratorAgentConfig, OrchestratorTemplate, WorkerMode, can_transition,
        resolve_job_defaults, resolve_phased_worker_assignments, resolve_worker_assignments,
        run_orchestration_job,
    },
    vault::SecretsVault,
};

use super::super::AppState;

#[derive(serde::Deserialize)]
pub struct StartJobRequest {
    pub prompt: String,
    pub template_id: Option<String>,
    pub worker_mode: Option<WorkerMode>,
    pub existing_agents: Option<Vec<String>>,
    pub ephemeral: Option<EphemeralRequest>,
    pub max_parallelism: Option<usize>,
    /// Phase order: e.g. ["builder", "checker"]. When set, one worker per phase with that role.
    pub phases: Option<Vec<String>>,
    /// After checks pass: merge_direct, merge_and_pr, pr_only, or none. Triggers merger phase.
    pub merge_action: Option<String>,
}

#[derive(serde::Deserialize)]
pub struct EphemeralRequest {
    pub count: Option<usize>,
}

#[derive(serde::Deserialize)]
pub struct EventsQuery {
    pub after: Option<i64>,
    pub limit: Option<usize>,
}

#[derive(serde::Deserialize)]
pub struct JobsQuery {
    pub limit: Option<usize>,
}

async fn get_agent_memory(
    agent: &str,
    state: &AppState,
) -> Option<Arc<tokio::sync::Mutex<crate::core::memory::MemorySystem>>> {
    let registry = state.registry.lock().await;
    registry.get(agent).cloned()
}

async fn get_or_create_agent_vault(
    agent: &str,
    state: &AppState,
    mem: &crate::core::memory::MemorySystem,
) -> Arc<SecretsVault> {
    if let Some(vault) = state.vault_registry.lock().await.get(agent).cloned() {
        return vault;
    }

    let vault = Arc::new(SecretsVault::new(mem.get_db()));
    let _ = vault.initialize().await;
    state
        .vault_registry
        .lock()
        .await
        .insert(agent.to_string(), vault.clone());
    vault
}

fn resolve_template_id(
    payload: &StartJobRequest,
    config: &OrchestratorAgentConfig,
) -> Option<String> {
    payload
        .template_id
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| config.default_template_id.clone())
}

async fn resolve_template(
    mem: &crate::core::memory::MemorySystem,
    template_id: Option<String>,
) -> Result<Option<OrchestratorTemplate>, String> {
    let Some(template_id) = template_id else {
        return Ok(None);
    };

    mem.get_orchestrator_template(&template_id)
        .await
        .map_err(|e| e.to_string())
        .and_then(|opt| {
            opt.ok_or_else(|| format!("Template '{}' not found", template_id))
                .map(Some)
        })
}

async fn validate_spawn_profiles_against_vault(
    template: Option<&OrchestratorTemplate>,
    vault: &SecretsVault,
) -> Result<(), String> {
    let Some(template) = template else {
        return Ok(());
    };

    let registry = ProviderRegistry::load();
    for profile in &template.spawn_profiles {
        let provider = profile.provider.trim().to_lowercase();
        let Some(provider_def) = registry.get_provider(&provider) else {
            return Err(format!("Unknown provider '{}'", profile.provider));
        };

        let model_ok = provider_def
            .models
            .iter()
            .any(|m| m.id == profile.model || m.name == profile.model);
        if !model_ok {
            return Err(format!(
                "Unknown model '{}' for provider '{}'",
                profile.model, provider_def.id
            ));
        }

        let key = provider_def.auth.vault_key.as_str();
        let has_key = vault
            .get_secret(key)
            .await
            .map_err(|e| format!("Failed reading vault key '{}': {}", key, e))?
            .is_some();

        if !has_key {
            return Err(format!(
                "Missing required vault key '{}' for provider '{}'",
                key, provider_def.id
            ));
        }
    }

    Ok(())
}

async fn transition_job_state(
    mem: &crate::core::memory::MemorySystem,
    job_id: &str,
    to: JobState,
    summary: Option<&str>,
    error: Option<&str>,
) -> Result<(), String> {
    let current = mem
        .get_orchestrator_job(job_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Job not found".to_string())?;

    if let Some(from) = JobState::from_status(&current.status)
        && !can_transition(from, to)
    {
        return Err(format!(
            "Invalid orchestrator state transition: {:?} -> {:?}",
            from, to
        ));
    }

    mem.update_orchestrator_job_status(job_id, to.as_str(), summary, error)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn list_orchestration_jobs(
    Path(agent): Path<String>,
    State(state): State<AppState>,
    Query(query): Query<JobsQuery>,
) -> Json<serde_json::Value> {
    let Some(mem_arc) = get_agent_memory(&agent, &state).await else {
        return Json(serde_json::json!({ "success": false, "error": "Agent not found" }));
    };

    let limit = query.limit.unwrap_or(50).clamp(1, 500);
    let mem = mem_arc.lock().await;
    match mem.list_orchestrator_jobs(limit).await {
        Ok(jobs) => Json(serde_json::json!({ "success": true, "jobs": jobs })),
        Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
    }
}

pub async fn start_orchestration_job(
    Path(agent): Path<String>,
    State(state): State<AppState>,
    Json(payload): Json<StartJobRequest>,
) -> Json<serde_json::Value> {
    let start_res = start_orchestration_job_inner(&agent, &state, &payload).await;
    let (job, worker_assignments, mem_arc) = match start_res {
        Ok(x) => x,
        Err(json) => return json,
    };

    let job_id = job.job_id.clone();
    let prompt = payload.prompt.trim().to_string();
    let merge_action = payload.merge_action.clone();
    let agent_clone = agent.clone();
    let state_clone = state.clone();

    let worker_count = worker_assignments.len();
    tokio::spawn(async move {
        run_orchestration_job(
            agent_clone,
            job_id,
            prompt,
            worker_assignments,
            merge_action,
            mem_arc,
            state_clone,
            None,
        )
        .await;
    });

    Json(serde_json::json!({
        "success": true,
        "job_id": job.job_id,
        "worker_count": worker_count
    }))
}

/// Blocking variant: starts job and awaits completion, returns workers.
pub async fn start_orchestration_job_run(
    Path(agent): Path<String>,
    State(state): State<AppState>,
    Json(payload): Json<StartJobRequest>,
) -> Json<serde_json::Value> {
    let start_res = start_orchestration_job_inner(&agent, &state, &payload).await;
    let (job, worker_assignments, mem_arc) = match start_res {
        Ok(x) => x,
        Err(json) => return json,
    };

    let (done_tx, done_rx) = tokio::sync::oneshot::channel();
    let job_id = job.job_id.clone();
    let prompt = payload.prompt.trim().to_string();
    let merge_action = payload.merge_action.clone();
    let agent_clone = agent.clone();
    let state_clone = state.clone();

    tokio::spawn(async move {
        run_orchestration_job(
            agent_clone,
            job_id,
            prompt,
            worker_assignments,
            merge_action,
            mem_arc,
            state_clone,
            Some(done_tx),
        )
        .await;
    });

    match done_rx.await {
        Ok(result) => Json(serde_json::json!({
            "success": result.status == "completed",
            "job_id": result.job_id,
            "status": result.status,
            "workers": result.workers.iter().map(|w| serde_json::json!({
                "worker_agent": w.worker_agent,
                "role": w.role,
                "status": w.status,
                "output": w.output
            })).collect::<Vec<_>>()
        })),
        Err(_) => Json(serde_json::json!({
            "success": false,
            "error": "Job runner closed unexpectedly"
        })),
    }
}

/// Inner setup for start_orchestration_job and start_orchestration_job_run.
/// Returns (job, worker_assignments, mem_arc) or error JSON.
async fn start_orchestration_job_inner(
    agent: &str,
    state: &AppState,
    payload: &StartJobRequest,
) -> Result<
    (
        crate::core::memory::types::OrchestratorJobRecord,
        Vec<crate::core::orchestrator::WorkerAssignment>,
        Arc<tokio::sync::Mutex<crate::core::memory::MemorySystem>>,
    ),
    Json<serde_json::Value>,
> {
    let prompt = crate::core::brain::sanitize_invoke_tags(payload.prompt.trim()).to_string();
    if prompt.is_empty() {
        return Err(Json(
            serde_json::json!({ "success": false, "error": "prompt is required" }),
        ));
    }

    let Some(mem_arc) = get_agent_memory(agent, state).await else {
        return Err(Json(
            serde_json::json!({ "success": false, "error": "Agent not found" }),
        ));
    };

    let mem = mem_arc.lock().await;
    let vault = get_or_create_agent_vault(agent, state, &mem).await;

    let config = match mem.get_orchestrator_config().await {
        Ok(Some(c)) => c,
        Ok(None) => OrchestratorAgentConfig::default(),
        Err(e) => {
            return Err(Json(
                serde_json::json!({ "success": false, "error": e.to_string() }),
            ));
        }
    };

    let template_id = resolve_template_id(payload, &config);
    let template = match resolve_template(&mem, template_id).await {
        Ok(value) => value,
        Err(e) => return Err(Json(serde_json::json!({ "success": false, "error": e }))),
    };

    let (resolved_mode, resolved_parallelism, advisory) = resolve_job_defaults(
        &config,
        template.as_ref(),
        payload.worker_mode,
        payload.max_parallelism,
    );

    let worker_mode = resolved_mode;
    let mut existing_agents = payload.existing_agents.clone().unwrap_or_default();
    let mut ephemeral_count = payload
        .ephemeral
        .as_ref()
        .and_then(|e| e.count)
        .unwrap_or(0);

    if matches!(worker_mode, WorkerMode::Existing | WorkerMode::Mixed) && existing_agents.is_empty()
    {
        existing_agents.push(agent.to_string());
    }
    if matches!(worker_mode, WorkerMode::Ephemeral | WorkerMode::Mixed) && ephemeral_count == 0 {
        ephemeral_count = 1;
    }

    let spawn_profiles = template
        .as_ref()
        .map(|t| t.spawn_profiles.clone())
        .unwrap_or_default();

    let worker_assignments = if let Some(ref phases) = payload.phases {
        if phases.is_empty() {
            resolve_worker_assignments(
                worker_mode,
                &existing_agents,
                &spawn_profiles,
                ephemeral_count,
            )
        } else {
            resolve_phased_worker_assignments(WorkerMode::Ephemeral, phases, &spawn_profiles)
        }
    } else {
        resolve_worker_assignments(
            worker_mode,
            &existing_agents,
            &spawn_profiles,
            ephemeral_count,
        )
    };

    let job = match mem
        .create_orchestrator_job(agent, &prompt, &format!("{:?}", worker_mode).to_lowercase())
        .await
    {
        Ok(job) => job,
        Err(e) => {
            return Err(Json(
                serde_json::json!({ "success": false, "error": e.to_string() }),
            ));
        }
    };

    let _ = mem
        .add_orchestrator_event(
            &job.job_id,
            "job_started",
            &serde_json::json!({
                "state": "queued",
                "template_id": template.as_ref().map(|t| t.template_id.clone()),
                "worker_mode": worker_mode,
                "max_parallelism": resolved_parallelism,
            })
            .to_string(),
        )
        .await;

    let _ = transition_job_state(&mem, &job.job_id, JobState::Planning, None, None).await;

    if let Some(text) = advisory {
        let _ = mem
            .add_orchestrator_event(
                &job.job_id,
                "advisory",
                &serde_json::json!({ "text": text }).to_string(),
            )
            .await;
    }

    if let Err(reason) = validate_spawn_profiles_against_vault(template.as_ref(), &vault).await {
        let _ =
            transition_job_state(&mem, &job.job_id, JobState::Failed, None, Some(&reason)).await;
        let _ = mem
            .add_orchestrator_event(
                &job.job_id,
                "failed",
                &serde_json::json!({ "error": reason }).to_string(),
            )
            .await;
        let _ = mem
            .add_orchestrator_event(&job.job_id, "done", r#"{"status":"failed"}"#)
            .await;

        return Err(Json(serde_json::json!({
            "success": false,
            "job_id": job.job_id,
            "error": "orchestration failed"
        })));
    }

    let _ = transition_job_state(&mem, &job.job_id, JobState::Dispatching, None, None).await;
    let _ = transition_job_state(&mem, &job.job_id, JobState::Executing, None, None).await;

    Ok((job, worker_assignments, mem_arc.clone()))
}

pub async fn get_orchestration_job(
    Path((_agent, job_id)): Path<(String, String)>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let Some(mem_arc) = get_agent_memory(&_agent, &state).await else {
        return Json(serde_json::json!({ "success": false, "error": "Agent not found" }));
    };

    let mem = mem_arc.lock().await;
    match mem.get_orchestrator_job(&job_id).await {
        Ok(Some(job)) => Json(serde_json::json!({ "success": true, "job": job })),
        Ok(None) => Json(serde_json::json!({ "success": false, "error": "Job not found" })),
        Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
    }
}

pub async fn list_orchestration_workers(
    Path((agent, job_id)): Path<(String, String)>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let Some(mem_arc) = get_agent_memory(&agent, &state).await else {
        return Json(serde_json::json!({ "success": false, "error": "Agent not found" }));
    };

    let mem = mem_arc.lock().await;
    match mem.list_orchestrator_worker_runs(&job_id).await {
        Ok(workers) => Json(serde_json::json!({ "success": true, "workers": workers })),
        Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
    }
}

pub async fn list_orchestration_events(
    Path((agent, job_id)): Path<(String, String)>,
    State(state): State<AppState>,
    Query(query): Query<EventsQuery>,
) -> Json<serde_json::Value> {
    let Some(mem_arc) = get_agent_memory(&agent, &state).await else {
        return Json(serde_json::json!({ "success": false, "error": "Agent not found" }));
    };

    let after = query.after.unwrap_or(0).max(0);
    let limit = query.limit.unwrap_or(200).clamp(1, 1000);

    let mem = mem_arc.lock().await;
    match mem.list_orchestrator_events(&job_id, after, limit).await {
        Ok(events) => Json(serde_json::json!({ "success": true, "events": events })),
        Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
    }
}

pub async fn stream_orchestration_events(
    Path((agent, job_id)): Path<(String, String)>,
    State(state): State<AppState>,
) -> axum::response::Response {
    let Some(mem_arc) = get_agent_memory(&agent, &state).await else {
        return Json(serde_json::json!({ "success": false, "error": "Agent not found" }))
            .into_response();
    };

    let mem = mem_arc.lock().await;
    let events = match mem.list_orchestrator_events(&job_id, 0, 10_000).await {
        Ok(e) => e,
        Err(err) => {
            return Json(serde_json::json!({ "success": false, "error": err.to_string() }))
                .into_response();
        }
    };
    drop(mem);

    let mut stream_payloads = Vec::new();
    for event in events {
        let payload = serde_json::from_str::<serde_json::Value>(&event.payload_json)
            .unwrap_or(serde_json::json!({ "raw": event.payload_json }));

        let json = match payload {
            serde_json::Value::Object(mut map) => {
                map.insert(
                    "type".to_string(),
                    serde_json::Value::String(event.event_type.clone()),
                );
                map.insert("event_id".to_string(), serde_json::json!(event.id));
                serde_json::Value::Object(map)
            }
            other => serde_json::json!({
                "type": event.event_type,
                "event_id": event.id,
                "payload": other
            }),
        };
        stream_payloads.push(json.to_string());
    }

    if !stream_payloads
        .iter()
        .any(|line| line.contains("\"type\":\"done\""))
    {
        stream_payloads.push(serde_json::json!({ "type": "done" }).to_string());
    }

    let stream = tokio_stream::iter(stream_payloads)
        .map(|msg| Ok::<_, Infallible>(Event::default().data(msg)));

    Sse::new(stream).into_response()
}

pub async fn cancel_orchestration_job(
    Path((agent, job_id)): Path<(String, String)>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let Some(mem_arc) = get_agent_memory(&agent, &state).await else {
        return Json(serde_json::json!({ "success": false, "error": "Agent not found" }));
    };

    let mem = mem_arc.lock().await;
    match mem.get_orchestrator_job(&job_id).await {
        Ok(Some(job)) => {
            if let Some(from) = JobState::from_status(&job.status) {
                if matches!(
                    from,
                    JobState::Completed | JobState::Failed | JobState::Canceled
                ) {
                    return Json(serde_json::json!({ "success": true, "job_id": job_id }));
                }
                if !can_transition(from, JobState::Canceled) {
                    return Json(
                        serde_json::json!({ "success": false, "error": "cancel transition denied" }),
                    );
                }
            }

            let _ = mem
                .update_orchestrator_job_status(&job_id, JobState::Canceled.as_str(), None, None)
                .await;
            let _ = mem
                .add_orchestrator_event(
                    &job_id,
                    "canceled",
                    &serde_json::json!({ "status": "canceled" }).to_string(),
                )
                .await;
            let _ = mem
                .add_orchestrator_event(&job_id, "done", r#"{"status":"canceled"}"#)
                .await;
            Json(serde_json::json!({ "success": true }))
        }
        Ok(None) => Json(serde_json::json!({ "success": false, "error": "Job not found" })),
        Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
    }
}

pub async fn approve_orchestration_merge(
    Path((agent, job_id)): Path<(String, String)>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let Some(mem_arc) = get_agent_memory(&agent, &state).await else {
        return Json(serde_json::json!({ "success": false, "error": "Agent not found" }));
    };

    let mem = mem_arc.lock().await;
    if let Ok(Some(job)) = mem.get_orchestrator_job(&job_id).await
        && job.status == "completed"
    {
        return Json(serde_json::json!({ "success": true, "job_id": job_id }));
    }

    let _ = transition_job_state(&mem, &job_id, JobState::Reviewing, None, None).await;
    let _ = transition_job_state(&mem, &job_id, JobState::MergePending, None, None).await;
    let _ = transition_job_state(&mem, &job_id, JobState::Merging, None, None).await;
    let _ = mem
        .add_orchestrator_event(
            &job_id,
            "merge_approved",
            &serde_json::json!({ "approved": true }).to_string(),
        )
        .await;
    let _ = transition_job_state(
        &mem,
        &job_id,
        JobState::Completed,
        Some("Merge approved"),
        None,
    )
    .await;
    let _ = mem
        .add_orchestrator_event(
            &job_id,
            "done",
            &serde_json::json!({ "status": "completed" }).to_string(),
        )
        .await;

    Json(serde_json::json!({ "success": true, "job_id": job_id }))
}
