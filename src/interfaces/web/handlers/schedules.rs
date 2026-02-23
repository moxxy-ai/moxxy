use axum::{
    Json,
    extract::{Path, State},
};
use std::collections::HashMap;

use super::super::AppState;

pub async fn get_schedules_endpoint(
    Path(agent): Path<String>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let reg = state.registry.lock().await;
    let mut schedules_list = Vec::new();

    if let Some(mem_mutex) = reg.get(&agent) {
        let mem = mem_mutex.lock().await;
        if let Ok(jobs) = mem.get_all_scheduled_jobs().await {
            for job in jobs {
                schedules_list.push(serde_json::json!({
                    "name": job.name,
                    "cron": job.cron,
                    "prompt": job.prompt,
                    "source": job.source
                }));
            }
        }
    }

    Json(serde_json::json!({
        "success": true,
        "schedules": schedules_list
    }))
}

#[derive(serde::Deserialize)]
pub struct CreateScheduleRequest {
    name: String,
    cron: String,
    prompt: String,
}

pub async fn create_schedule_endpoint(
    Path(agent): Path<String>,
    State(state): State<AppState>,
    Json(payload): Json<CreateScheduleRequest>,
) -> Json<serde_json::Value> {
    let schedule_name = payload.name.trim().to_string();
    let cron_expr = payload.cron.trim().to_string();
    // Sanitize schedule prompt to prevent invoke tag injection
    let prompt_text = crate::core::brain::sanitize_invoke_tags(payload.prompt.trim()).to_string();

    if schedule_name.is_empty() || cron_expr.is_empty() || prompt_text.is_empty() {
        return Json(serde_json::json!({
            "success": false,
            "error": "name, cron, and prompt are required"
        }));
    }

    let mem_arc = {
        let registry = state.registry.lock().await;
        match registry.get(&agent) {
            Some(mem) => mem.clone(),
            None => {
                return Json(serde_json::json!({
                    "success": false,
                    "error": "Agent memory system not found"
                }));
            }
        }
    };

    let llm_arc = {
        let registry = state.llm_registry.lock().await;
        match registry.get(&agent) {
            Some(llm) => llm.clone(),
            None => {
                return Json(serde_json::json!({
                    "success": false,
                    "error": "Agent LLM system not found"
                }));
            }
        }
    };

    let skill_arc = {
        let registry = state.skill_registry.lock().await;
        match registry.get(&agent) {
            Some(skills) => skills.clone(),
            None => {
                return Json(serde_json::json!({
                    "success": false,
                    "error": "Agent skill system not found"
                }));
            }
        }
    };

    let scheduler_arc = {
        let registry = state.scheduler_registry.lock().await;
        match registry.get(&agent) {
            Some(scheduler) => scheduler.clone(),
            None => {
                return Json(serde_json::json!({
                    "success": false,
                    "error": "Agent scheduler not found"
                }));
            }
        }
    };

    // Validate the cron expression before persisting anything.
    let llm_for_job = llm_arc.clone();
    let mem_for_job = mem_arc.clone();
    let skills_for_job = skill_arc.clone();
    let prompt_for_job = prompt_text.clone();
    let agent_for_job = agent.clone();
    let cron_job =
        match tokio_cron_scheduler::Job::new_async(cron_expr.as_str(), move |_uuid, mut _l| {
            let llm = llm_for_job.clone();
            let mem = mem_for_job.clone();
            let skills = skills_for_job.clone();
            let p = prompt_for_job.clone();
            let agent_name = agent_for_job.clone();

            Box::pin(async move {
                let _ = crate::core::brain::AutonomousBrain::execute_react_loop(
                    &p,
                    "SYSTEM_CRON",
                    llm,
                    mem,
                    skills,
                    None,
                    &agent_name,
                )
                .await;
            })
        }) {
            Ok(job) => job,
            Err(e) => {
                return Json(serde_json::json!({
                    "success": false,
                    "error": format!("Invalid cron expression: {}", e)
                }));
            }
        };

    let new_job_id = match scheduler_arc.lock().await.add(cron_job).await {
        Ok(job_id) => job_id,
        Err(e) => {
            return Json(serde_json::json!({
                "success": false,
                "error": format!("Failed to register schedule: {}", e)
            }));
        }
    };

    // Persist only after the runtime scheduler accepted the job.
    if let Err(e) = mem_arc
        .lock()
        .await
        .add_scheduled_job(&schedule_name, &cron_expr, &prompt_text, "api")
        .await
    {
        if let Err(remove_err) = scheduler_arc.lock().await.remove(&new_job_id).await {
            tracing::warn!(
                "Failed to rollback runtime schedule '{}' ({}): {}",
                schedule_name,
                new_job_id,
                remove_err
            );
        }
        return Json(serde_json::json!({
            "success": false,
            "error": format!("Failed to write schedule to DB: {}", e)
        }));
    }

    let previous_job_id = {
        let mut runtime_jobs = state.scheduled_job_registry.lock().await;
        let by_name = runtime_jobs
            .entry(agent.clone())
            .or_insert_with(HashMap::new);
        by_name.insert(schedule_name.clone(), new_job_id)
    };

    let mut warning = None;
    if let Some(old_id) = previous_job_id
        && old_id != new_job_id
        && let Err(e) = scheduler_arc.lock().await.remove(&old_id).await
    {
        warning = Some(format!(
            "replaced DB/runtime mapping but failed to remove previous runtime job {}: {}",
            old_id, e
        ));
    }

    let message = if previous_job_id.is_some() {
        "Schedule updated"
    } else {
        "Schedule added"
    };
    match warning {
        Some(w) => Json(serde_json::json!({ "success": true, "message": message, "warning": w })),
        None => Json(serde_json::json!({ "success": true, "message": message })),
    }
}

pub async fn delete_schedule_endpoint(
    Path((agent, schedule_name)): Path<(String, String)>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let schedule_name = schedule_name.trim().to_string();
    if schedule_name.is_empty() {
        return Json(serde_json::json!({
            "success": false,
            "error": "schedule name is required"
        }));
    }

    let mem_arc = {
        let registry = state.registry.lock().await;
        match registry.get(&agent) {
            Some(mem) => mem.clone(),
            None => {
                return Json(serde_json::json!({
                    "success": false,
                    "error": "Agent memory system not found"
                }));
            }
        }
    };

    match mem_arc
        .lock()
        .await
        .remove_scheduled_job(&schedule_name)
        .await
    {
        Ok(true) => {}
        Ok(false) => {
            return Json(serde_json::json!({ "success": false, "error": "Schedule not found" }));
        }
        Err(e) => {
            return Json(serde_json::json!({
                "success": false,
                "error": format!("Database error: {}", e)
            }));
        }
    }

    let runtime_job_id = {
        let mut runtime_jobs = state.scheduled_job_registry.lock().await;
        let mut remove_agent_entry = false;
        let removed = if let Some(by_name) = runtime_jobs.get_mut(&agent) {
            let removed = by_name.remove(&schedule_name);
            if by_name.is_empty() {
                remove_agent_entry = true;
            }
            removed
        } else {
            None
        };
        if remove_agent_entry {
            runtime_jobs.remove(&agent);
        }
        removed
    };

    let scheduler_arc = {
        let registry = state.scheduler_registry.lock().await;
        registry.get(&agent).cloned()
    };

    let warning = if let Some(job_id) = runtime_job_id {
        if let Some(scheduler) = scheduler_arc {
            match scheduler.lock().await.remove(&job_id).await {
                Ok(()) => None,
                Err(e) => Some(format!(
                    "schedule was removed from DB, but runtime unschedule failed for {}: {}",
                    job_id, e
                )),
            }
        } else {
            Some("schedule was removed from DB, but runtime scheduler is unavailable".to_string())
        }
    } else {
        None
    };

    match warning {
        Some(w) => Json(serde_json::json!({
            "success": true,
            "message": "Schedule removed",
            "warning": w
        })),
        None => Json(serde_json::json!({ "success": true, "message": "Schedule removed" })),
    }
}

pub async fn delete_all_schedules_endpoint(
    Path(agent): Path<String>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let mem_arc = {
        let registry = state.registry.lock().await;
        match registry.get(&agent) {
            Some(mem) => mem.clone(),
            None => {
                return Json(serde_json::json!({
                    "success": false,
                    "error": "Agent memory system not found"
                }));
            }
        }
    };

    let removed_count = match mem_arc.lock().await.remove_all_scheduled_jobs().await {
        Ok(count) => count,
        Err(e) => {
            return Json(serde_json::json!({
                "success": false,
                "error": format!("Database error: {}", e)
            }));
        }
    };

    let runtime_jobs_to_remove = {
        let mut runtime_jobs = state.scheduled_job_registry.lock().await;
        runtime_jobs.remove(&agent).unwrap_or_default()
    };

    let scheduler_arc = {
        let registry = state.scheduler_registry.lock().await;
        registry.get(&agent).cloned()
    };

    let mut warnings = Vec::new();
    if let Some(scheduler_mutex) = scheduler_arc {
        let scheduler = scheduler_mutex.lock().await;
        for (name, job_id) in runtime_jobs_to_remove {
            if let Err(e) = scheduler.remove(&job_id).await {
                warnings.push(format!(
                    "failed to unschedule '{}' ({}): {}",
                    name, job_id, e
                ));
            }
        }
    } else if !runtime_jobs_to_remove.is_empty() {
        warnings.push("runtime scheduler is unavailable to process unscheduling".to_string());
    }

    if !warnings.is_empty() {
        Json(serde_json::json!({
            "success": true,
            "message": format!("Removed {} schedules", removed_count),
            "warning": warnings.join("; ")
        }))
    } else {
        Json(
            serde_json::json!({ "success": true, "message": format!("Removed {} schedules", removed_count) }),
        )
    }
}
