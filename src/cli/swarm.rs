use anyhow::Result;
use std::fs;
use tracing::{Level, info};
use tracing_subscriber::FmtSubscriber;

use crate::core::agent::{
    AgentInstance, ContainerRegistry, LlmRegistry, MemoryRegistry, RunMode, ScheduledJobRegistry,
    SchedulerRegistry, SkillRegistry,
};
use crate::logging::SseMakeWriter;

pub async fn run_swarm_engine(
    run_mode: RunMode,
    target_agent: Option<String>,
    api_host: String,
    api_port: u16,
    web_port: u16,
) -> Result<()> {
    let (log_tx, _) = tokio::sync::broadcast::channel::<String>(500);
    let make_writer = SseMakeWriter {
        sender: log_tx.clone(),
        suppress_stdout: run_mode == RunMode::Tui,
    };

    // Initialize standard structured logging
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .with_writer(make_writer)
        .finish();
    tracing::subscriber::set_global_default(subscriber).ok(); // Ignore err in restart loop

    info!(
        "Starting moxxy Swarm Engine (Mode: {:?})...",
        run_mode != RunMode::Daemon
    );

    use crate::platform::{NativePlatform, Platform};
    let agents_dir = NativePlatform::data_dir().join("agents");

    // Ensure at least the default agent directory exists
    if !agents_dir.join("default").exists() {
        fs::create_dir_all(agents_dir.join("default").join("skills"))?;
    }

    // Scan the agents directory
    let mut tasks = Vec::new();
    let mut entries = tokio::fs::read_dir(&agents_dir).await?;

    let swarm_registry: MemoryRegistry =
        std::sync::Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));
    let skill_registry: SkillRegistry =
        std::sync::Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));
    let llm_registry: LlmRegistry =
        std::sync::Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));
    let container_registry: ContainerRegistry =
        std::sync::Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));
    let scheduler_registry: SchedulerRegistry =
        std::sync::Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));
    let scheduled_job_registry: ScheduledJobRegistry =
        std::sync::Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));

    let internal_token = uuid::Uuid::new_v4().to_string();

    while let Some(entry) = entries.next_entry().await? {
        if entry.file_type().await?.is_dir() {
            let agent_name = entry.file_name().to_string_lossy().to_string();

            if let Some(ref target) = target_agent
                && agent_name != *target
            {
                continue;
            }

            let agent_workspace = entry.path();
            let registry_clone = swarm_registry.clone();
            let skill_registry_clone = skill_registry.clone();
            let llm_registry_clone = llm_registry.clone();
            let container_registry_clone = container_registry.clone();
            let scheduler_registry_clone = scheduler_registry.clone();
            let scheduled_job_registry_clone = scheduled_job_registry.clone();
            let log_tx_clone = log_tx.clone();

            let rm_clone = run_mode.clone();
            let api_host_clone = api_host.clone();
            let api_port_val = api_port;
            let web_port_val = web_port;
            let token_clone = internal_token.clone();

            info!("Discovered Agent: {}", agent_name);

            // Spawn a new independent agent task for every workspace folder
            let handle = tokio::spawn(async move {
                match AgentInstance::boot(
                    agent_name.clone(),
                    agent_workspace,
                    rm_clone,
                    api_host_clone,
                    api_port_val,
                    web_port_val,
                    registry_clone,
                    skill_registry_clone,
                    llm_registry_clone,
                    container_registry_clone,
                    scheduler_registry_clone,
                    scheduled_job_registry_clone,
                    log_tx_clone,
                    token_clone,
                )
                .await
                {
                    Ok(agent) => {
                        if let Err(e) = agent.run().await {
                            tracing::error!("Agent {} crashed: {}", agent_name, e);
                        }
                    }
                    Err(e) => tracing::error!("Failed to boot Agent {}: {}", agent_name, e),
                }
            });

            tasks.push(handle);
        }
    }

    info!(
        "Swarm Engine is now running {} parallel agent(s). Press Ctrl+C to stop.",
        tasks.len()
    );

    if matches!(run_mode, RunMode::Headless(_)) {
        for task in tasks {
            let _ = task.await;
        }
        info!("Headless mode execution completed.");
        return Ok(());
    }

    // Wait for shutdown signals
    tokio::signal::ctrl_c().await?;
    info!("Shutting down Swarm Engine...");

    // The individual Agent Instances handle their own graceful shutdown via their lifecycle block
    // when they capture the tokio::signal ctrl_c individually. We just give it a brief moment.
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    Ok(())
}
