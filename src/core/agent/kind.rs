//! Agent trait and implementations: NativeAgent (persistent) and EphemeralAgent (task-scoped).

use anyhow::Result;
use async_trait::async_trait;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use tracing::info;

use crate::core::container::AgentContainer;
use crate::core::llm::LlmManager;
use crate::core::memory::MemorySystem;
use crate::core::vault::SecretsVault;
use crate::skills::SkillManager;

use super::bootstrap;

/// An agent that can execute a task via the ReAct loop.
#[async_trait]
pub trait Agent: Send + Sync {
    /// Agent name or identifier.
    fn name(&self) -> &str;

    /// Run a single task. `trigger` is the full prompt (e.g. "ORCHESTRATOR TASK [role]: ...").
    async fn execute(&self, trigger: &str, origin: &str) -> Result<String>;
}

/// Persistent agent: subsystems from registries, may use WASM container.
pub struct NativeAgent {
    name: String,
    memory: Arc<Mutex<MemorySystem>>,
    skills: Arc<Mutex<SkillManager>>,
    llm: Arc<RwLock<LlmManager>>,
    container: Option<Arc<AgentContainer>>,
}

impl NativeAgent {
    /// Create a native agent from subsystems (typically looked up from registries).
    pub fn new(
        name: impl Into<String>,
        memory: Arc<Mutex<MemorySystem>>,
        skills: Arc<Mutex<SkillManager>>,
        llm: Arc<RwLock<LlmManager>>,
        container: Option<Arc<AgentContainer>>,
    ) -> Self {
        Self {
            name: name.into(),
            memory,
            skills,
            llm,
            container,
        }
    }
}

#[async_trait]
impl Agent for NativeAgent {
    fn name(&self) -> &str {
        &self.name
    }

    async fn execute(&self, trigger: &str, origin: &str) -> Result<String> {
        if let Some(ref container) = self.container {
            container
                .execute(
                    trigger,
                    self.llm.clone(),
                    self.memory.clone(),
                    self.skills.clone(),
                    None,
                    false,
                )
                .await
        } else {
            crate::core::brain::AutonomousBrain::execute_react_loop(
                trigger,
                origin,
                self.llm.clone(),
                self.memory.clone(),
                self.skills.clone(),
                None,
                false,
                &self.name,
            )
            .await
        }
    }
}

/// Parameters to spawn an ephemeral agent.
#[derive(Clone)]
pub struct EphemeralAgentParams {
    pub name: String,
    pub workspace_dir: PathBuf,
    pub parent_vault: Arc<SecretsVault>,
    pub api_host: String,
    pub api_port: u16,
    pub internal_token: String,
    /// LLM provider override from template spawn profile; when set, used instead of vault default.
    pub llm_provider: Option<String>,
    /// LLM model override from template spawn profile; when set, used instead of vault default.
    pub llm_model: Option<String>,
}

/// Ephemeral agent: creates subsystems on demand, runs task, cleans up.
pub struct EphemeralAgent {
    params: EphemeralAgentParams,
}

impl EphemeralAgent {
    /// Create an ephemeral agent from spawn parameters.
    pub fn new(params: EphemeralAgentParams) -> Self {
        Self { params }
    }

    /// Execute and cleanup workspace on completion (success or failure).
    async fn run_with_cleanup(&self, trigger: &str, origin: &str) -> Result<String> {
        let (mem_arc, skill_arc, llm_arc) = bootstrap::init_ephemeral_subsystems(
            &self.params.name,
            &self.params.workspace_dir,
            &self.params.parent_vault,
            &self.params.api_host,
            self.params.api_port,
            &self.params.internal_token,
            self.params.llm_provider.as_deref(),
            self.params.llm_model.as_deref(),
        )
        .await?;

        info!(
            "Ephemeral agent [{}] executing at {:?}",
            self.params.name, self.params.workspace_dir
        );

        let result = crate::core::brain::AutonomousBrain::execute_react_loop(
            trigger,
            origin,
            llm_arc,
            mem_arc,
            skill_arc,
            None,
            false,
            &self.params.name,
        )
        .await;

        // Cleanup ephemeral workspace
        let _ = tokio::fs::remove_dir_all(&self.params.workspace_dir).await;

        result
    }
}

#[async_trait]
impl Agent for EphemeralAgent {
    fn name(&self) -> &str {
        &self.params.name
    }

    async fn execute(&self, trigger: &str, origin: &str) -> Result<String> {
        self.run_with_cleanup(trigger, origin).await
    }
}
