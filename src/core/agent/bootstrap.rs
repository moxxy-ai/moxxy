use anyhow::Result;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::info;

use crate::core::container::{AgentContainer, ContainerConfig};
use crate::core::lifecycle::LifecycleManager;
use crate::core::llm::LlmManager;
use crate::core::llm::generic_provider::GenericProvider;
use crate::core::llm::registry::ProviderRegistry;
use crate::core::memory::MemorySystem;
use crate::core::vault::SecretsVault;
use crate::skills::native_executor::NativeExecutor;
use crate::skills::{SkillManager, SkillManifest};

use super::ScheduledJobRegistry;

/// Initialize core agent subsystems: memory, vault, container, skills, LLM.
/// Returns Arc-wrapped subsystems and the vault for later use.
pub(super) async fn init_core_subsystems(
    name: &str,
    workspace_dir: &Path,
    api_host: &str,
    api_port: u16,
    internal_token: &str,
) -> Result<(
    Arc<Mutex<MemorySystem>>,
    Arc<Mutex<SkillManager>>,
    Arc<Mutex<LlmManager>>,
    Option<Arc<AgentContainer>>,
    Arc<SecretsVault>,
)> {
    // Ensure workspace directory exists (for agent file operations)
    tokio::fs::create_dir_all(workspace_dir.join("workspace")).await?;

    // Memory & Vault
    let memory_sys = MemorySystem::new(workspace_dir).await?;
    let mem_db_conn = memory_sys.get_db();
    let vault = Arc::new(SecretsVault::new(mem_db_conn));
    vault.initialize().await?;

    // Container Config
    let container_config = ContainerConfig::load(workspace_dir).await?;
    info!(
        "Agent [{}] runtime: {}",
        name, container_config.runtime.r#type
    );

    let wasm_container = if container_config.is_wasm() {
        info!("Agent [{}] will run inside a WASM container", name);
        crate::core::container::ensure_wasm_image().await?;
        Some(Arc::new(AgentContainer::new(
            container_config.clone(),
            name.to_string(),
            workspace_dir.to_path_buf(),
        )))
    } else {
        None
    };

    // Skills
    let skill_executor = Box::new(NativeExecutor::new(
        vault.clone(),
        name.to_string(),
        workspace_dir.to_path_buf(),
        api_host.to_string(),
        api_port,
        internal_token.to_string(),
    ));
    let skill_sys = SkillManager::new(skill_executor, workspace_dir.to_path_buf());

    // LLM - registry-driven provider registration
    let registry = ProviderRegistry::load();
    let mut llm_sys = LlmManager::new();

    for provider_def in &registry.providers {
        let api_key = vault
            .get_secret(&provider_def.auth.vault_key)
            .await
            .unwrap_or(None)
            .unwrap_or_default();
        llm_sys.register_provider(Box::new(GenericProvider::new(
            provider_def.clone(),
            api_key,
        )));
    }

    // Auto-load default LLM provider from Vault
    if let Ok(Some(provider_str)) = vault.get_secret("llm_default_provider").await
        && let Ok(Some(model_id)) = vault.get_secret("llm_default_model").await
    {
        let normalized = provider_str.to_lowercase();
        if registry.get_provider(&normalized).is_some() {
            llm_sys.set_active(&normalized, model_id);
        }
    }

    let llm_sys_arc = Arc::new(Mutex::new(llm_sys));
    let memory_sys_arc = Arc::new(Mutex::new(memory_sys));
    let skill_sys_arc = Arc::new(Mutex::new(skill_sys));

    Ok((
        memory_sys_arc,
        skill_sys_arc,
        llm_sys_arc,
        wasm_container,
        vault,
    ))
}

/// Spawn MCP Server initialization tasks (non-blocking).
pub(super) async fn spawn_mcp_servers(
    memory_sys_arc: &Arc<Mutex<MemorySystem>>,
    skill_sys_arc: &Arc<Mutex<SkillManager>>,
) {
    let mcp_servers = {
        let mem = memory_sys_arc.lock().await;
        mem.get_all_mcp_servers().await.unwrap_or_default()
    };

    for server in mcp_servers {
        let args: Vec<String> = match serde_json::from_str::<Vec<String>>(&server.args) {
            Ok(parsed) => parsed,
            Err(_) => server.args.split_whitespace().map(String::from).collect(),
        };

        let env: HashMap<String, String> = match serde_json::from_str(&server.env) {
            Ok(parsed) => parsed,
            Err(_) => HashMap::new(),
        };

        let skill_sys_clone = skill_sys_arc.clone();
        let server_name = server.name.clone();
        let server_command = server.command.clone();

        tokio::spawn(async move {
            match crate::core::mcp::McpClient::new(&server_name, &server_command, args, env).await {
                Ok(client) => match client.list_tools().await {
                    Ok(tools) => {
                        let mut skill_sys = skill_sys_clone.lock().await;
                        for tool in tools {
                            let skill_name = format!("{}_{}", server_name, tool.name);
                            let schema_str =
                                serde_json::to_string(&tool.input_schema).unwrap_or_default();
                            let description = format!(
                                "[MCP: {}] {}\nArguments: Pass a single JSON object string matching this schema: {}",
                                server_name,
                                tool.description.unwrap_or_else(|| tool.name.clone()),
                                schema_str
                            );

                            let manifest = SkillManifest {
                                name: skill_name.clone(),
                                description,
                                version: "mcp".to_string(),
                                executor_type: "mcp".to_string(),
                                needs_network: true,
                                needs_fs_read: false,
                                needs_fs_write: false,
                                needs_env: false,
                                entrypoint: tool.name.clone(),
                                run_command: "mcp".to_string(),
                                triggers: Vec::new(),
                                homepage: None,
                                doc_files: Vec::new(),
                                skill_dir: PathBuf::new(),
                                privileged: false,
                            };

                            skill_sys.register_skill(manifest);
                            info!("Registered MCP Tool as Skill: {}", skill_name);
                        }
                        skill_sys.register_mcp_client(server_name, client);
                    }
                    Err(e) => {
                        tracing::error!(
                            "Failed to list tools for MCP Server [{}]: {}",
                            server_name,
                            e
                        );
                    }
                },
                Err(e) => {
                    tracing::error!("Failed to start MCP Server [{}]: {}", server_name, e);
                }
            }
        });
    }
}

/// Register persisted cron jobs from the database into the scheduler.
pub(super) async fn schedule_persisted_jobs(
    name: &str,
    lifecycle: &mut LifecycleManager,
    llm_sys_arc: &Arc<Mutex<LlmManager>>,
    memory_sys_arc: &Arc<Mutex<MemorySystem>>,
    skill_sys_arc: &Arc<Mutex<SkillManager>>,
    scheduled_job_registry: &ScheduledJobRegistry,
) -> Result<()> {
    let persisted_jobs = {
        let mem = memory_sys_arc.lock().await;
        mem.get_all_scheduled_jobs().await.unwrap_or_default()
    };
    let mut boot_registered_ids = HashMap::new();
    for scheduled in persisted_jobs {
        info!(
            "Agent [{}] scheduling heartbeat '{}': {}",
            name, scheduled.name, scheduled.cron
        );

        let llm_clone = llm_sys_arc.clone();
        let mem_clone = memory_sys_arc.clone();
        let skill_clone = skill_sys_arc.clone();
        let prompt_str = scheduled.prompt.clone();
        let scheduled_name = scheduled.name.clone();

        match tokio_cron_scheduler::Job::new_async(scheduled.cron.as_str(), move |_uuid, mut _l| {
            let llm = llm_clone.clone();
            let mem = mem_clone.clone();
            let skills = skill_clone.clone();
            let p = prompt_str.clone();

            Box::pin(async move {
                let _ = crate::core::brain::AutonomousBrain::execute_react_loop(
                    &p,
                    "SYSTEM_CRON",
                    llm,
                    mem,
                    skills,
                    None,
                )
                .await;
            })
        }) {
            Ok(job) => match lifecycle.scheduler.add(job).await {
                Ok(job_id) => {
                    boot_registered_ids.insert(scheduled_name, job_id);
                }
                Err(e) => {
                    tracing::error!(
                        "Failed to register cron job '{}' for agent [{}]: {}",
                        scheduled_name,
                        name,
                        e
                    );
                }
            },
            Err(e) => {
                tracing::error!(
                    "Failed to create cron job '{}' for agent [{}]: {}",
                    scheduled_name,
                    name,
                    e
                );
            }
        }
    }
    if !boot_registered_ids.is_empty() {
        let mut schedule_ids = scheduled_job_registry.lock().await;
        let by_name = schedule_ids
            .entry(name.to_string())
            .or_insert_with(HashMap::new);
        by_name.extend(boot_registered_ids);
    }
    Ok(())
}
