mod bootstrap;
mod interfaces;
mod selfcheck;

use anyhow::Result;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use tracing::info;

use std::collections::HashMap;

use crate::core::container::AgentContainer;
use crate::core::lifecycle::LifecycleManager;
use crate::core::llm::LlmManager;
use crate::core::memory::MemorySystem;
use crate::skills::SkillManager;

pub type SchedulerRegistry =
    Arc<Mutex<HashMap<String, Arc<Mutex<tokio_cron_scheduler::JobScheduler>>>>>;
pub type ScheduledJobRegistry = Arc<Mutex<HashMap<String, HashMap<String, uuid::Uuid>>>>;
pub type MemoryRegistry = Arc<Mutex<HashMap<String, Arc<Mutex<MemorySystem>>>>>;
pub type SkillRegistry = Arc<Mutex<HashMap<String, Arc<Mutex<SkillManager>>>>>;
pub type LlmRegistry = Arc<Mutex<HashMap<String, Arc<RwLock<LlmManager>>>>>;
pub type ContainerRegistry = Arc<Mutex<HashMap<String, Arc<AgentContainer>>>>;
pub type VaultRegistry = Arc<Mutex<HashMap<String, Arc<crate::core::vault::SecretsVault>>>>;

#[derive(Clone, Debug, PartialEq)]
pub enum RunMode {
    Web,
    Tui,
    Daemon,
    Dev,
    Headless(String),
}

/// Represents a single Agent in the moxxy Swarm
pub struct AgentInstance {
    pub name: String,
    pub workspace_dir: PathBuf,
    pub lifecycle: LifecycleManager,
    pub headless_job:
        Option<std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + 'static>>>,
}

impl AgentInstance {
    #[allow(clippy::too_many_arguments)]
    pub async fn boot(
        name: String,
        workspace_dir: PathBuf,
        run_mode: RunMode,
        api_host: String,
        api_port: u16,
        web_port: u16,
        swarm_registry: MemoryRegistry,
        skill_registry: SkillRegistry,
        llm_registry: LlmRegistry,
        container_registry: ContainerRegistry,
        vault_registry: VaultRegistry,
        scheduler_registry: SchedulerRegistry,
        scheduled_job_registry: ScheduledJobRegistry,
        log_tx: tokio::sync::broadcast::Sender<String>,
        internal_token: String,
    ) -> Result<Self> {
        info!("Booting Agent Instance: [{}]", name);

        let mut lifecycle = LifecycleManager::new().await?;

        // 1. Core subsystems: memory, vault, container, skills, LLM
        let (memory_sys_arc, skill_sys_arc, llm_sys_arc, wasm_container, vault) =
            bootstrap::init_core_subsystems(
                &name,
                &workspace_dir,
                &api_host,
                api_port,
                &internal_token,
            )
            .await?;

        // 2. Spawn MCP Server initialization
        bootstrap::spawn_mcp_servers(&memory_sys_arc, &skill_sys_arc).await;

        // 3. Register in global registries
        swarm_registry
            .lock()
            .await
            .insert(name.clone(), memory_sys_arc.clone());
        skill_registry
            .lock()
            .await
            .insert(name.clone(), skill_sys_arc.clone());
        llm_registry
            .lock()
            .await
            .insert(name.clone(), llm_sys_arc.clone());

        vault_registry
            .lock()
            .await
            .insert(name.clone(), vault.clone());

        if let Some(ref container) = wasm_container {
            container_registry
                .lock()
                .await
                .insert(name.clone(), container.clone());
            info!("Agent [{}] WASM container registered", name);
        }

        // 4. Register scheduler
        let scheduler_arc = Arc::new(Mutex::new(lifecycle.scheduler.clone()));
        scheduler_registry
            .lock()
            .await
            .insert(name.clone(), scheduler_arc);
        scheduled_job_registry
            .lock()
            .await
            .entry(name.clone())
            .or_insert_with(HashMap::new);

        // 5. Attach core lifecycle components
        lifecycle.attach(memory_sys_arc.clone());
        lifecycle.attach(skill_sys_arc.clone());

        // 6. Schedule persisted cron jobs
        bootstrap::schedule_persisted_jobs(
            &name,
            &mut lifecycle,
            &llm_sys_arc,
            &memory_sys_arc,
            &skill_sys_arc,
            &scheduled_job_registry,
        )
        .await?;

        // 7. Attach interfaces
        interfaces::attach_interfaces(
            &name,
            &run_mode,
            &mut lifecycle,
            &vault,
            &swarm_registry,
            &skill_registry,
            &llm_registry,
            &container_registry,
            &vault_registry,
            &scheduler_registry,
            &scheduled_job_registry,
            &llm_sys_arc,
            &memory_sys_arc,
            &skill_sys_arc,
            &wasm_container,
            &log_tx,
            &api_host,
            api_port,
            web_port,
            &internal_token,
        )
        .await;

        // 8. Desktop mail poller (macOS)
        interfaces::attach_desktop_poller(
            &name,
            &mut lifecycle,
            &vault,
            &llm_sys_arc,
            &memory_sys_arc,
            &skill_sys_arc,
        )
        .await?;

        // 9. Self-check heartbeat
        selfcheck::attach_self_check(
            &name,
            &workspace_dir,
            &mut lifecycle,
            &llm_sys_arc,
            &memory_sys_arc,
            &skill_sys_arc,
        )
        .await?;

        // 10. Headless mode job
        let mut headless_job = None;
        if let RunMode::Headless(prompt) = run_mode.clone() {
            let llm = llm_sys_arc.clone();
            let mem = memory_sys_arc.clone();
            let skills = skill_sys_arc.clone();
            let agent_name = name.clone();
            headless_job = Some(Box::pin(async move {
                let _ = crate::core::brain::AutonomousBrain::execute_react_loop(
                    &prompt,
                    "CLI_HEADLESS",
                    llm,
                    mem,
                    skills,
                    None,
                    &agent_name,
                )
                .await;
            })
                as std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + 'static>>);
        }

        Ok(Self {
            name,
            workspace_dir,
            lifecycle,
            headless_job,
        })
    }

    pub async fn run(mut self) -> Result<()> {
        info!(
            "Agent [{}] entering RUN state at {:?}",
            self.name, self.workspace_dir
        );
        self.lifecycle.start().await?;

        if let Some(job) = self.headless_job {
            info!(
                "Running Headless prompt execution for Agent [{}]...",
                self.name
            );
            job.await;
        } else {
            tokio::signal::ctrl_c().await?;
        }

        info!("Agent [{}] shutting down.", self.name);
        self.lifecycle.shutdown().await?;
        Ok(())
    }
}
