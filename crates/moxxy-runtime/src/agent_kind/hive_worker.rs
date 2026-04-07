use super::{
    AgentKindDefinition, AgentPaths, AgentSetup, CleanupActions, KindContext, PreparedRun,
    core_primitives::register_core_primitives,
    prompt::{
        build_base_prompt, build_capabilities_prompt, build_guidelines_prompt,
        build_hive_worker_prompt, build_stm_prompt,
    },
    standard::{register_hive_member_primitives, resolve_allowlist},
};
use crate::{HiveStore, PrimitiveRegistry};
use std::path::Path;

/// Recruited via `hive.recruit` - in-memory only, shares queen's workspace + hive dir.
pub struct HiveWorkerAgentKind;

#[async_trait::async_trait]
impl AgentKindDefinition for HiveWorkerAgentKind {
    fn name(&self) -> &str {
        "hive_worker"
    }

    fn description(&self) -> &str {
        "Hive worker agent recruited via hive.recruit"
    }

    fn resolve_paths(
        &self,
        moxxy_home: &Path,
        _agent_name: &str,
        parent_name: Option<&str>,
    ) -> AgentPaths {
        let queen = parent_name.expect("hive worker must have a parent (queen)");
        let queen_dir = moxxy_home.join("agents").join(queen);
        AgentPaths {
            workspace: queen_dir.join("workspace"),
            memory_dir: queen_dir.join("memory"),
            agent_dir: queen_dir.clone(),
        }
    }

    fn init(&self, _paths: &AgentPaths) -> Result<(), String> {
        // Hive workers use the queen's workspace; nothing to create.
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

        // Register hive member primitives only (workers cannot recruit or disband)
        register_hive_member_primitives(
            &registry,
            &setup.name,
            &setup.paths.workspace,
            &ctx.event_bus,
        );

        let allowed_primitives = resolve_allowlist(&registry, setup, ctx);

        let mut system_prompt = build_base_prompt(setup);
        system_prompt.push_str(&build_capabilities_prompt(&allowed_primitives, &[]));

        // Add worker-specific workflow instructions
        let has_task_claim = allowed_primitives.iter().any(|p| p == "hive.task_claim");
        if has_task_claim {
            system_prompt.push_str(&build_hive_worker_prompt());
        }

        system_prompt.push_str(&build_guidelines_prompt());

        // Auto-inject STM content (workers share queen's memory dir)
        system_prompt.push_str(&build_stm_prompt(&setup.paths.memory_dir));

        // Workers don't load history
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

    fn deinit(&self, _success: bool) -> CleanupActions {
        CleanupActions {
            unregister: true,
            decrement_parent_spawned: true,
            persist_conversation: false,
            new_status: None,
            remove_directories: false,
        }
    }

    async fn post_run(
        &self,
        setup: &AgentSetup,
        _ctx: &KindContext,
        result: &Result<String, String>,
    ) -> Result<(), String> {
        // Hive membership cleanup: update queen's manifest
        let hive_path = setup.paths.workspace.join(".hive");
        if hive_path.exists() {
            let store = HiveStore::new(hive_path);
            if let Ok(mut manifest) = store.read_manifest() {
                let new_status = if result.is_ok() {
                    "completed"
                } else {
                    "failed"
                };
                for m in &mut manifest.members {
                    if m.agent_id == setup.name {
                        m.status = new_status.into();
                    }
                }
                let _ = store.write_manifest(&manifest);

                // Handle tasks still assigned to this worker at exit time
                for status_filter in &["in_progress", "assigned"] {
                    if let Ok(tasks) = store.list_tasks(Some(status_filter)) {
                        for mut task in tasks {
                            if task.assigned_agent_id.as_deref() == Some(&setup.name) {
                                task.updated_at = chrono::Utc::now().to_rfc3339();
                                if result.is_ok() {
                                    // Worker exited successfully — auto-complete the task
                                    task.status = "completed".into();
                                    if task.result_summary.is_none() {
                                        task.result_summary = Some(format!(
                                            "auto-completed: worker {} exited successfully",
                                            setup.name
                                        ));
                                    }
                                } else {
                                    // Worker failed — release task for retry or mark failed
                                    task.assigned_agent_id = None;
                                    if task.attempt_count >= task.max_retries {
                                        task.status = "failed".into();
                                        task.failure_reason = Some(format!(
                                            "worker {} exited after {} attempts",
                                            setup.name, task.attempt_count
                                        ));
                                    } else {
                                        task.status = "pending".into();
                                    }
                                }
                                let _ = store.write_task(&task);
                            }
                        }
                    }
                }
            }
        }
        Ok(())
    }

    fn child_name_tag(&self) -> &str {
        "worker"
    }
}
