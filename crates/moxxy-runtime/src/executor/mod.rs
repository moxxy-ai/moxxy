pub mod agent_listener;
pub mod hive_listener;
pub mod listener;
pub mod run_executor;
pub mod stuck_detector;

pub use agent_listener::AgentEventListener;
pub use hive_listener::HiveEventListener;
pub use listener::{EventAction, EventListener};
pub use run_executor::RunExecutor;

use crate::provider::ModelConfig;
use async_trait::async_trait;

/// Trait abstracting the executor loop.
///
/// `RunExecutor` is the canonical implementation. The trait exists so callers
/// can swap in stubs for testing without pulling in the full event-bus and
/// provider machinery.
#[async_trait]
pub trait Executor: Send {
    async fn execute(
        &mut self,
        agent_id: &str,
        run_id: &str,
        task: &str,
        model_config: &ModelConfig,
    ) -> Result<String, String>;
}

#[async_trait]
impl Executor for RunExecutor {
    async fn execute(
        &mut self,
        agent_id: &str,
        run_id: &str,
        task: &str,
        model_config: &ModelConfig,
    ) -> Result<String, String> {
        self.execute(agent_id, run_id, task, model_config).await
    }
}
