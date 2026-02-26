use anyhow::Result;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use tracing::info;

use crate::core::container::AgentContainer;
use crate::core::lifecycle::LifecycleManager;
use crate::core::llm::LlmManager;
use crate::core::memory::MemorySystem;
use crate::core::vault::SecretsVault;
use crate::interfaces::desktop::DesktopInterface;
use crate::interfaces::discord::DiscordChannel;
use crate::interfaces::mobile::MobileInterface;
use crate::interfaces::slack::SlackChannel;
use crate::interfaces::telegram::TelegramInterface;
use crate::interfaces::web::{ApiServer, WebServer};
use crate::interfaces::whatsapp::WhatsAppChannel;
use crate::skills::SkillManager;

use super::{
    ContainerRegistry, LlmRegistry, MemoryRegistry, RunMode, ScheduledJobRegistry,
    SchedulerRegistry, SkillRegistry, VaultRegistry,
};

#[allow(clippy::too_many_arguments)]
pub(super) async fn attach_interfaces(
    name: &str,
    run_mode: &RunMode,
    lifecycle: &mut LifecycleManager,
    vault: &Arc<SecretsVault>,
    swarm_registry: &MemoryRegistry,
    skill_registry: &SkillRegistry,
    llm_registry: &LlmRegistry,
    container_registry: &ContainerRegistry,
    vault_registry: &VaultRegistry,
    scheduler_registry: &SchedulerRegistry,
    scheduled_job_registry: &ScheduledJobRegistry,
    llm_sys_arc: &Arc<RwLock<LlmManager>>,
    memory_sys_arc: &Arc<Mutex<MemorySystem>>,
    skill_sys_arc: &Arc<Mutex<SkillManager>>,
    wasm_container: &Option<Arc<AgentContainer>>,
    log_tx: &tokio::sync::broadcast::Sender<String>,
    api_host: &str,
    api_port: u16,
    web_port: u16,
    internal_token: &str,
) {
    // API Server (default agent only, in web/daemon modes)
    if name == "default" && (*run_mode == RunMode::Web || *run_mode == RunMode::Daemon) {
        lifecycle.attach(Arc::new(Mutex::new(ApiServer::new(
            crate::interfaces::web::ApiServerConfig {
                registry: swarm_registry.clone(),
                skill_registry: skill_registry.clone(),
                llm_registry: llm_registry.clone(),
                container_registry: container_registry.clone(),
                vault_registry: vault_registry.clone(),
                scheduler_registry: scheduler_registry.clone(),
                scheduled_job_registry: scheduled_job_registry.clone(),
                log_tx: log_tx.clone(),
                run_mode: run_mode.clone(),
                api_host: api_host.to_string(),
                api_port,
                web_port,
                internal_token: internal_token.to_string(),
            },
        ))));
    }

    // Web Server (frontend UI, only in web mode)
    if name == "default" && *run_mode == RunMode::Web {
        lifecycle.attach(Arc::new(Mutex::new(WebServer::new(
            run_mode.clone(),
            api_host.to_string(),
            api_port,
            web_port,
        ))));
    }

    // Telegram
    let mut tg_token = match vault.get_secret("telegram_token").await {
        Ok(Some(token)) => token,
        _ => String::new(),
    };
    if tg_token.is_empty() && name == "default" {
        tg_token = std::env::var("TELEGRAM_BOT_TOKEN").unwrap_or_default();
    }
    if !tg_token.is_empty() {
        lifecycle.attach(Arc::new(Mutex::new(TelegramInterface::new(
            name.to_string(),
            tg_token,
            llm_sys_arc.clone(),
            memory_sys_arc.clone(),
            skill_sys_arc.clone(),
            wasm_container.clone(),
        ))));
    }

    // Discord
    lifecycle.attach(Arc::new(Mutex::new(DiscordChannel::new(
        name.to_string(),
        swarm_registry.clone(),
        skill_registry.clone(),
        llm_registry.clone(),
    ))));

    // Slack
    lifecycle.attach(Arc::new(Mutex::new(SlackChannel::new(
        name.to_string(),
        swarm_registry.clone(),
        skill_registry.clone(),
        llm_registry.clone(),
    ))));

    // WhatsApp
    lifecycle.attach(Arc::new(Mutex::new(WhatsAppChannel::new(
        name.to_string(),
        swarm_registry.clone(),
        skill_registry.clone(),
        llm_registry.clone(),
    ))));

    // Desktop Global Hotkey (macOS)
    lifecycle.attach(Arc::new(Mutex::new(DesktopInterface::new(
        name.to_string(),
        swarm_registry.clone(),
        skill_registry.clone(),
        llm_registry.clone(),
    ))));

    // Mobile Telemetry Copilot
    lifecycle.attach(Arc::new(Mutex::new(MobileInterface::new(
        name.to_string(),
        swarm_registry.clone(),
        skill_registry.clone(),
        llm_registry.clone(),
        log_tx.clone(),
    ))));
}

/// Attach the macOS Desktop Mail/Calendar Poller (runs every 5 minutes).
#[cfg(target_os = "macos")]
pub(super) async fn attach_desktop_poller(
    name: &str,
    lifecycle: &mut LifecycleManager,
    vault: &Arc<SecretsVault>,
    llm_sys_arc: &Arc<RwLock<LlmManager>>,
    memory_sys_arc: &Arc<Mutex<MemorySystem>>,
    skill_sys_arc: &Arc<Mutex<SkillManager>>,
) -> Result<()> {
    if name == "default"
        && let Ok(Some(enabled)) = vault.get_secret("desktop_hotkey_enabled").await
        && enabled == "true"
    {
        info!(
            "[{}] Booting Autonomous Desktop Mail/Calendar Poller...",
            name
        );
        let llm_clone = llm_sys_arc.clone();
        let mem_clone = memory_sys_arc.clone();
        let skill_clone = skill_sys_arc.clone();
        let agent_name_clone = name.to_string();

        match tokio_cron_scheduler::Job::new_async("0 0/5 * * * *", move |_uuid, mut _l| {
            let llm = llm_clone.clone();
            let mem = mem_clone.clone();
            let skills = skill_clone.clone();
            let agent_name = agent_name_clone.clone();

            Box::pin(async move {
                let script = r#"
                    tell application "Mail"
                        set unreadMsgs to (messages of inbox whose read status is false)
                        set output to ""
                        repeat with msg in unreadMsgs
                            set output to output & "From: " & (get sender of msg) & " | Subject: " & (get subject of msg) & "\n"
                        end repeat
                        return output
                    end tell
                "#;

                if let Ok(output) = tokio::process::Command::new("osascript")
                    .arg("-e")
                    .arg(script)
                    .output()
                    .await
                {
                    let unread_dump = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if !unread_dump.is_empty() {
                        let prompt = format!(
                            "SYSTEM_CRON: I have passively polled my native macOS Mail app. Here are my current unread messages:\n{}\n\nAnalyze these. If any seem URGENT, highly important, or time-sensitive, use your Telegram/WhatsApp/Slack interfaces to ping the user immediately with a summary. If they are just newsletters or spam, silently ignore them and take no action.",
                            unread_dump
                        );
                        let _ = crate::core::brain::AutonomousBrain::execute_react_loop(
                            &prompt,
                            "MAC_POLLER",
                            llm,
                            mem,
                            skills,
                            None,
                            &agent_name,
                        )
                        .await;
                    }
                }
            })
        }) {
            Ok(job) => {
                lifecycle.scheduler.add(job).await?;
            }
            Err(e) => {
                tracing::error!(
                    "Failed to create desktop mail poller job for agent [{}]: {}",
                    name,
                    e
                );
            }
        }
    }
    Ok(())
}
