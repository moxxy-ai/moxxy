use super::{
    AgentKindDefinition, AgentPaths, AgentSetup, CleanupActions, KindContext, PreparedRun,
    core_primitives::register_core_primitives,
    prompt::{
        build_base_prompt, build_capabilities_prompt, build_guidelines_prompt, build_stm_prompt,
    },
    standard::resolve_allowlist,
};
use crate::PrimitiveRegistry;
use std::path::Path;

/// Spawned via `agent.spawn` - in-memory only, shares parent's workspace.
pub struct EphemeralAgentKind;

#[async_trait::async_trait]
impl AgentKindDefinition for EphemeralAgentKind {
    fn name(&self) -> &str {
        "ephemeral"
    }

    fn description(&self) -> &str {
        "Sub-agent spawned via agent.spawn, shares parent workspace"
    }

    fn resolve_paths(
        &self,
        moxxy_home: &Path,
        _agent_name: &str,
        parent_name: Option<&str>,
    ) -> AgentPaths {
        let parent = parent_name.expect("ephemeral agent must have a parent");
        let parent_dir = moxxy_home.join("agents").join(parent);
        AgentPaths {
            workspace: parent_dir.join("workspace"),
            memory_dir: parent_dir.join("memory"),
            agent_dir: parent_dir.clone(),
        }
    }

    fn init(&self, _paths: &AgentPaths) -> Result<(), String> {
        // Ephemeral agents use the parent's workspace; nothing to create.
        Ok(())
    }

    async fn call(&self, setup: &AgentSetup, ctx: &KindContext) -> Result<PreparedRun, String> {
        let agents_dir = ctx.moxxy_home.join("agents");
        let policy = moxxy_core::PathPolicy::new(
            setup.paths.workspace.clone(),
            Some(ctx.moxxy_home.clone()),
            Some(agents_dir),
        );

        let registry = PrimitiveRegistry::new();
        register_core_primitives(&registry, setup, ctx, policy);

        // No hive primitives for ephemeral sub-agents

        let allowed_primitives = resolve_allowlist(&registry, setup, ctx);

        let mut system_prompt = build_base_prompt(setup);
        system_prompt.push_str(&build_capabilities_prompt(&allowed_primitives, &[]));
        system_prompt.push_str(&build_guidelines_prompt());

        // Auto-inject STM content (ephemeral agents share parent's memory dir)
        system_prompt.push_str(&build_stm_prompt(&setup.paths.memory_dir));

        // Ephemeral agents don't load history
        let history = Vec::new();

        Ok(PreparedRun {
            registry,
            allowed_primitives: std::sync::Arc::new(std::sync::RwLock::new(allowed_primitives)),
            system_prompt,
            history,
            mcp_manager: None,
            tools_dirty: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        })
    }

    fn deinit(&self, success: bool) -> CleanupActions {
        CleanupActions {
            // Keep the child registered so the parent can call agent.status / agent.dismiss.
            // The parent (or system) will unregister it explicitly via agent.dismiss.
            unregister: false,
            decrement_parent_spawned: false,
            persist_conversation: false,
            new_status: Some(if success { "idle" } else { "error" }.into()),
            remove_directories: false,
        }
    }
}
