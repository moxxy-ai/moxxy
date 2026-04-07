use super::{
    AgentKindDefinition, AgentPaths, AgentSetup, CleanupActions, KindContext, PreparedRun,
    core_primitives::register_core_primitives,
    prompt::{
        build_base_prompt, build_capabilities_prompt, build_guidelines_prompt,
        build_hive_queen_prompt, build_stm_prompt,
    },
};
use crate::primitives::mcp::register_mcp_tools;
use crate::{
    HiveAggregatePrimitive, HiveAssignPrimitive, HiveBoardReadPrimitive, HiveDisbandPrimitive,
    HiveManifest, HiveMember, HiveProposePrimitive, HiveRecruitPrimitive,
    HiveResolveProposalPrimitive, HiveSignalPrimitive, HiveStore, HiveTaskClaimPrimitive,
    HiveTaskCompletePrimitive, HiveTaskCreatePrimitive, HiveTaskFailPrimitive,
    HiveTaskListPrimitive, HiveTaskReviewPrimitive, HiveVotePrimitive, McpConnectPrimitive,
    McpDisconnectPrimitive, McpListPrimitive, Message, PrimitiveRegistry,
};
use moxxy_mcp::McpManager;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;

/// User-created agent - persisted via YAML, keeps its own directory.
/// Registers core primitives + hive queen primitives. Manages hive manifest setup.
pub struct StandardAgentKind;

#[async_trait::async_trait]
impl AgentKindDefinition for StandardAgentKind {
    fn name(&self) -> &str {
        "standard"
    }

    fn description(&self) -> &str {
        "User-created agent with full capabilities including hive queen"
    }

    fn resolve_paths(
        &self,
        moxxy_home: &Path,
        agent_name: &str,
        _parent_name: Option<&str>,
    ) -> AgentPaths {
        let agent_dir = moxxy_home.join("agents").join(agent_name);
        AgentPaths {
            workspace: agent_dir.join("workspace"),
            memory_dir: agent_dir.join("memory"),
            agent_dir,
        }
    }

    fn init(&self, paths: &AgentPaths) -> Result<(), String> {
        std::fs::create_dir_all(&paths.workspace).map_err(|e| format!("create workspace: {e}"))?;
        std::fs::create_dir_all(&paths.memory_dir)
            .map_err(|e| format!("create memory dir: {e}"))?;
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

        // Register hive queen primitives (top-level agent is always queen-capable)
        if let Some(ref starter) = ctx.run_starter {
            let workspace_dir = &setup.paths.workspace;
            let hive_manifest_path = workspace_dir.join(".hive").join("hive.yaml");

            // Create hive manifest if it doesn't exist yet
            if !hive_manifest_path.exists() {
                let hive_dir = workspace_dir.join(".hive");
                std::fs::create_dir_all(&hive_dir)
                    .map_err(|e| format!("Failed to create .hive dir: {e}"))?;
                let store = HiveStore::new(hive_dir);
                let manifest = HiveManifest {
                    id: uuid::Uuid::now_v7().to_string(),
                    queen_agent_id: setup.name.clone(),
                    name: "auto-hive".into(),
                    status: "active".into(),
                    strategy: "task-parallel".into(),
                    members: vec![HiveMember {
                        agent_id: setup.name.clone(),
                        role: "queen".into(),
                        specialty: None,
                        status: "active".into(),
                    }],
                    created_at: chrono::Utc::now().to_rfc3339(),
                };
                store
                    .write_manifest(&manifest)
                    .map_err(|e| format!("Failed to write hive manifest: {e}"))?;
            }

            register_hive_queen_primitives(
                &registry,
                &setup.name,
                workspace_dir,
                starter.clone(),
                &ctx.event_bus,
            );
        }

        // MCP server integration - load mcp.yaml and connect servers
        let mcp_manager = {
            let mut mgr = McpManager::new();

            // Wire vault resolver so ${vault:KEY} env vars are resolved before MCP spawn
            let db_for_vault = ctx.db.clone();
            let vault_for_resolver = ctx.vault_backend.clone();
            let agent_name_for_vault = setup.name.clone();
            mgr.set_vault_resolver(Arc::new(move |key_name: &str| {
                let db = db_for_vault.lock().ok()?;
                let secret_ref = db.vault_refs().find_by_key_name(key_name).ok()??;
                let grants = db.vault_grants().find_by_agent(&agent_name_for_vault).ok()?;
                let has_grant = grants.iter().any(|g| g.secret_ref_id == secret_ref.id && g.revoked_at.is_none());
                if !has_grant {
                    tracing::warn!(agent = %agent_name_for_vault, key_name, "Vault: agent has no active grant");
                    return None;
                }
                match vault_for_resolver.get_secret(&secret_ref.backend_key) {
                    Ok(value) => Some(value),
                    Err(e) => {
                        tracing::warn!(agent = %agent_name_for_vault, key_name, error = %e, "Vault: failed to get secret");
                        None
                    }
                }
            }));

            Arc::new(tokio::sync::Mutex::new(mgr))
        };
        let mut mcp_tool_names = Vec::new();

        match moxxy_mcp::load_mcp_config(&setup.paths.agent_dir) {
            Ok(mcp_config) if !mcp_config.servers.is_empty() => {
                let mut mgr = mcp_manager.lock().await;
                let failures = mgr.connect_all(&mcp_config).await;

                // Emit events for connection results
                for (server_id, err) in &failures {
                    tracing::warn!(
                        agent = %setup.name, server = %server_id, error = %err,
                        "MCP server connection failed (non-fatal)"
                    );
                }

                // Register MCP tools as primitives
                for server_id in mgr.connected_server_ids() {
                    let names = register_mcp_tools(&mgr, &server_id, &registry, &mcp_manager);
                    mcp_tool_names.extend(names);
                }
            }
            Err(e) => {
                tracing::warn!(agent = %setup.name, error = %e, "Failed to load mcp.yaml (non-fatal)");
            }
            _ => {}
        }

        // Shared tools_dirty flag - set by McpConnect/McpDisconnect when tool
        // definitions change mid-run; the executor checks this each iteration.
        let tools_dirty = Arc::new(AtomicBool::new(false));

        // Register mcp.list primitive (always available so agents can discover MCP servers)
        registry.register(Box::new(McpListPrimitive::new(mcp_manager.clone())));

        // Primitive allowlist - resolve before wrapping in Arc so MCP primitives
        // can receive the shared reference.
        let mut allowed_primitives = resolve_allowlist(&registry, setup, ctx);
        // Include MCP tool names in the allowlist
        allowed_primitives.extend(mcp_tool_names.clone());
        // Always allow mcp.list, mcp.connect, mcp.disconnect
        for name in &["mcp.list", "mcp.connect", "mcp.disconnect"] {
            if !allowed_primitives.contains(&name.to_string()) {
                allowed_primitives.push(name.to_string());
            }
        }

        let allowed_primitives = std::sync::Arc::new(std::sync::RwLock::new(allowed_primitives));

        // Register mcp.connect and mcp.disconnect (needs shared Arc refs)
        registry.register(Box::new(McpConnectPrimitive::new(
            mcp_manager.clone(),
            registry.clone(),
            allowed_primitives.clone(),
            tools_dirty.clone(),
            setup.paths.agent_dir.clone(),
        )));
        registry.register(Box::new(McpDisconnectPrimitive::new(
            mcp_manager.clone(),
            registry.clone(),
            allowed_primitives.clone(),
            tools_dirty.clone(),
            setup.paths.agent_dir.clone(),
        )));

        // Build system prompt
        let mut system_prompt = build_base_prompt(setup);
        system_prompt.push_str(&build_capabilities_prompt(
            &allowed_primitives.read().unwrap(),
            &[],
        ));

        // Always include MCP instructions (so agent knows it can connect servers)
        system_prompt.push_str(&super::prompt::build_mcp_prompt(&mcp_manager).await);

        // Add hive workflow instructions if queen primitives are available
        let has_recruit = allowed_primitives
            .read()
            .unwrap()
            .iter()
            .any(|p| p == "hive.recruit");
        if has_recruit {
            system_prompt.push_str(&build_hive_queen_prompt());
        }

        system_prompt.push_str(&build_guidelines_prompt());

        // Auto-inject STM content so the agent has context from previous runs
        system_prompt.push_str(&build_stm_prompt(&setup.paths.memory_dir));

        // Load conversation history for top-level agents
        let history = load_history(&setup.name, ctx);

        Ok(PreparedRun {
            registry,
            allowed_primitives,
            system_prompt,
            history,
            mcp_manager: Some(mcp_manager),
            tools_dirty,
        })
    }

    fn deinit(&self, success: bool) -> CleanupActions {
        CleanupActions {
            unregister: false,
            decrement_parent_spawned: false,
            persist_conversation: true,
            new_status: Some(if success { "idle" } else { "error" }.into()),
            remove_directories: false,
        }
    }
}

/// Register queen-level hive primitives (recruit, task_create, assign, etc.) plus member primitives.
fn register_hive_queen_primitives(
    registry: &PrimitiveRegistry,
    agent_name: &str,
    workspace_dir: &Path,
    starter: std::sync::Arc<dyn moxxy_types::RunStarter>,
    event_bus: &moxxy_core::EventBus,
) {
    registry.register(Box::new(HiveRecruitPrimitive::new(
        agent_name.to_string(),
        workspace_dir.to_path_buf(),
        starter.clone(),
        event_bus.clone(),
    )));
    registry.register(Box::new(HiveTaskCreatePrimitive::new(
        agent_name.to_string(),
        workspace_dir.to_path_buf(),
        event_bus.clone(),
    )));
    registry.register(Box::new(HiveAssignPrimitive::new(
        agent_name.to_string(),
        workspace_dir.to_path_buf(),
    )));
    registry.register(Box::new(HiveAggregatePrimitive::new(
        agent_name.to_string(),
        workspace_dir.to_path_buf(),
    )));
    registry.register(Box::new(HiveResolveProposalPrimitive::new(
        agent_name.to_string(),
        workspace_dir.to_path_buf(),
        event_bus.clone(),
    )));
    registry.register(Box::new(HiveDisbandPrimitive::new(
        agent_name.to_string(),
        workspace_dir.to_path_buf(),
        starter,
        event_bus.clone(),
    )));
    registry.register(Box::new(HiveTaskReviewPrimitive::new(
        agent_name.to_string(),
        workspace_dir.to_path_buf(),
    )));
    register_hive_member_primitives(registry, agent_name, workspace_dir, event_bus);
}

/// Register hive member primitives (shared by queen and worker roles).
pub(crate) fn register_hive_member_primitives(
    registry: &PrimitiveRegistry,
    agent_name: &str,
    workspace_dir: &Path,
    event_bus: &moxxy_core::EventBus,
) {
    registry.register(Box::new(HiveSignalPrimitive::new(
        agent_name.to_string(),
        workspace_dir.to_path_buf(),
        event_bus.clone(),
    )));
    registry.register(Box::new(HiveBoardReadPrimitive::new(
        workspace_dir.to_path_buf(),
    )));
    registry.register(Box::new(HiveTaskListPrimitive::new(
        workspace_dir.to_path_buf(),
    )));
    registry.register(Box::new(HiveTaskClaimPrimitive::new(
        agent_name.to_string(),
        workspace_dir.to_path_buf(),
        event_bus.clone(),
    )));
    registry.register(Box::new(HiveTaskCompletePrimitive::new(
        agent_name.to_string(),
        workspace_dir.to_path_buf(),
        event_bus.clone(),
    )));
    registry.register(Box::new(HiveTaskFailPrimitive::new(
        agent_name.to_string(),
        workspace_dir.to_path_buf(),
        event_bus.clone(),
    )));
    registry.register(Box::new(HiveProposePrimitive::new(
        agent_name.to_string(),
        workspace_dir.to_path_buf(),
        event_bus.clone(),
    )));
    registry.register(Box::new(HiveVotePrimitive::new(
        agent_name.to_string(),
        workspace_dir.to_path_buf(),
        event_bus.clone(),
    )));
}

/// Resolve primitive allowlist from YAML; if empty → all registered (backwards-compatible).
/// The `reply` primitive is always included — it is required for the forced-tool-use
/// loop termination protocol.
pub(crate) fn resolve_allowlist(
    registry: &PrimitiveRegistry,
    setup: &AgentSetup,
    _ctx: &KindContext,
) -> Vec<String> {
    let allowlist_path = moxxy_core::allowlist_path(&setup.paths.agent_dir);
    let file = moxxy_core::AllowlistFile::load(&allowlist_path);
    let entries = file.allows("primitive");
    let mut list = if entries.is_empty() {
        registry.list()
    } else {
        entries
    };
    let reply_name = crate::REPLY_PRIMITIVE_NAME.to_string();
    if !list.contains(&reply_name) {
        list.push(reply_name);
    }
    list
}

/// Load conversation history for top-level agents (sub-agents get empty history).
pub(crate) fn load_history(agent_name: &str, ctx: &KindContext) -> Vec<Message> {
    ctx.db
        .lock()
        .ok()
        .and_then(|db| db.conversations().find_recent_by_agent(agent_name, 20).ok())
        .unwrap_or_default()
        .into_iter()
        .map(|row| match row.role.as_str() {
            "assistant" => Message::assistant(row.content),
            _ => Message::user(row.content),
        })
        .collect()
}
