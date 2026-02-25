use anyhow::Result;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use tracing::info;

use crate::core::lifecycle::LifecycleManager;
use crate::core::llm::LlmManager;
use crate::core::memory::MemorySystem;
use crate::skills::SkillManager;

/// Attach the built-in self-check heartbeat.
/// Runs once at boot (5s delay) and every 30 minutes.
/// The agent introspects its own health: LLM, skills, persona, memory.
pub(super) async fn attach_self_check(
    name: &str,
    workspace_dir: &Path,
    lifecycle: &mut LifecycleManager,
    llm_sys_arc: &Arc<RwLock<LlmManager>>,
    memory_sys_arc: &Arc<Mutex<MemorySystem>>,
    skill_sys_arc: &Arc<Mutex<SkillManager>>,
) -> Result<()> {
    let agent_name = name.to_string();
    let ws_dir = workspace_dir.to_path_buf();
    let llm_check = llm_sys_arc.clone();
    let mem_check = memory_sys_arc.clone();
    let skill_check = skill_sys_arc.clone();

    let run_self_check = move || {
        let agent_name = agent_name.clone();
        let ws_dir = ws_dir.clone();
        let llm_check = llm_check.clone();
        let mem_check = mem_check.clone();
        let skill_check = skill_check.clone();

        async move {
            let mut report = Vec::new();
            report.push(format!(
                "[SELF-CHECK] Agent '{}' health report:",
                agent_name
            ));

            // Persona loaded?
            let persona_path = ws_dir.join("persona.md");
            match tokio::fs::read_to_string(&persona_path).await {
                Ok(text) if !text.trim().is_empty() => {
                    report.push(format!("  Persona: loaded ({} chars)", text.len()));
                }
                _ => {
                    report.push("  Persona: NOT FOUND - agent using generic prompt".to_string());
                }
            }

            // LLM configured?
            {
                let llm = llm_check.read().await;
                let test_msgs = vec![crate::core::llm::ChatMessage {
                    role: "user".to_string(),
                    content: "Reply with OK".to_string(),
                }];
                match llm.generate_with_selected(&test_msgs).await {
                    Ok(_) => report.push("  LLM: connected and responding".to_string()),
                    Err(e) => report.push(format!("  LLM: ERROR - {}", e)),
                }
            }

            // Skills count
            {
                let skills = skill_check.lock().await;
                let count = skills.get_all_skills().len();
                report.push(format!("  Skills: {} loaded", count));
            }

            // Memory DB accessible?
            {
                let mem = mem_check.lock().await;
                match mem.read_stm_structured(1, true).await {
                    Ok(_) => report.push("  Memory DB: accessible".to_string()),
                    Err(e) => report.push(format!("  Memory DB: ERROR - {}", e)),
                }
            }

            // Heartbeats / schedules
            {
                let mem = mem_check.lock().await;
                match mem.get_all_scheduled_jobs().await {
                    Ok(jobs) => report.push(format!(
                        "  Heartbeats: {} DB schedule(s) active",
                        jobs.len()
                    )),
                    Err(e) => {
                        report.push(format!("  Heartbeats: ERROR reading DB schedules - {}", e))
                    }
                }
            }
            let intervals_path = ws_dir.join("intervals.toml");
            if intervals_path.exists() {
                report.push(
                    "  Legacy Config: intervals.toml detected (migrate to scheduler API)"
                        .to_string(),
                );
            }

            let full_report = report.join("\n");
            info!("{}", full_report);
        }
    };

    // Fire once at boot (after a short delay for initialization)
    let boot_check = run_self_check.clone();
    tokio::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
        boot_check().await;
    });

    // Schedule periodic self-check every 30 minutes
    let periodic_check = run_self_check;
    match tokio_cron_scheduler::Job::new_async("0 0/30 * * * *", move |_uuid, mut _l| {
        let check = periodic_check.clone();
        Box::pin(async move {
            check().await;
        })
    }) {
        Ok(job) => {
            lifecycle.scheduler.add(job).await?;
        }
        Err(e) => {
            tracing::error!(
                "Failed to create self-check cron for agent [{}]: {}",
                name,
                e
            );
        }
    }

    Ok(())
}
