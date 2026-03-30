use super::{AgentSetup, KindContext};
use crate::{
    AgentDismissPrimitive, AgentListPrimitive, AgentRespondPrimitive, AgentSelfGetPrimitive,
    AgentSelfPersonaReadPrimitive, AgentSelfPersonaWritePrimitive, AgentSelfUpdatePrimitive,
    AgentSpawnPrimitive, AgentStatusPrimitive, AgentStopPrimitive, AllowlistAddPrimitive,
    AllowlistDenyPrimitive, AllowlistListPrimitive, AllowlistRemovePrimitive,
    AllowlistUndenyPrimitive, BrowseCrawlPrimitive, BrowseExtractPrimitive, BrowseFetchPrimitive,
    BrowseRenderPrimitive,
    ChannelNotifyPrimitive, CliNotifyPrimitive, FsCdPrimitive, FsListPrimitive, FsReadPrimitive,
    FsRemovePrimitive, FsWritePrimitive, GitCheckoutPrimitive, GitClonePrimitive,
    GitCommitPrimitive, GitForkPrimitive, GitInitPrimitive, GitPrCreatePrimitive, GitPushPrimitive,
    GitStatusPrimitive, GitWorktreeAddPrimitive, GitWorktreeListPrimitive,
    GitWorktreeRemovePrimitive, HeartbeatCreatePrimitive, HeartbeatDeletePrimitive,
    HeartbeatDisablePrimitive, HeartbeatListPrimitive, HeartbeatUpdatePrimitive,
    HttpRequestPrimitive, MemoryRecallPrimitive, MemoryStmReadPrimitive,
    MemoryStorePrimitive, PrimitiveContext, PrimitiveRegistry, ShellExecPrimitive,
    SkillCreatePrimitive, SkillExecutePrimitive, SkillFindPrimitive, SkillGetPrimitive,
    SkillListPrimitive, SkillRemovePrimitive, SkillValidatePrimitive, UserAskPrimitive,
    ReplyPrimitive, VaultDeletePrimitive, VaultGetPrimitive, VaultListPrimitive, VaultSetPrimitive,
    WebhookDeletePrimitive, WebhookListPrimitive, WebhookListenPrimitive, WebhookRegisterPrimitive,
    WebhookRotatePrimitive, WebhookUpdatePrimitive,
};

/// Register all core primitives shared by all agent kinds.
///
/// Returns the `PrimitiveContext` for reuse by kind-specific primitives.
pub fn register_core_primitives(
    registry: &PrimitiveRegistry,
    setup: &AgentSetup,
    ctx: &KindContext,
    policy: moxxy_core::PathPolicy,
) -> PrimitiveContext {
    // Reply primitive (always registered — required for forced tool use)
    registry.register(Box::new(ReplyPrimitive));

    // Filesystem primitives
    registry.register(Box::new(FsReadPrimitive::new(policy.clone())));
    registry.register(Box::new(FsWritePrimitive::new(policy.clone())));
    registry.register(Box::new(FsListPrimitive::new(policy.clone())));
    registry.register(Box::new(FsRemovePrimitive::new(policy.clone())));
    registry.register(Box::new(FsCdPrimitive::new(policy.clone())));

    // Memory primitives (LTM: DB-backed with embeddings, STM: file-based YAML)
    registry.register(Box::new(MemoryStorePrimitive::new(
        ctx.db.clone(),
        setup.name.clone(),
        ctx.embedding_svc.clone(),
    )));
    registry.register(Box::new(MemoryRecallPrimitive::new(
        ctx.db.clone(),
        setup.name.clone(),
        ctx.embedding_svc.clone(),
    )));
    let stm_path = setup.paths.memory_dir.join("stm.yaml");
    registry.register(Box::new(MemoryStmReadPrimitive::new(stm_path)));
    // NOTE: memory.stm_write is NOT registered as a tool. STM is auto-persisted
    // by the executor at the end of each run to prevent models from spamming writes.

    // Allowlist path (YAML-backed, per-agent)
    let allowlist_path = moxxy_core::allowlist_path(&setup.paths.agent_dir);

    // Shell primitive (YAML-backed allowlist, 300s max timeout, 1MB output cap)
    let sandbox_config = crate::sandbox::SandboxConfig::from_policy_profile(
        setup.policy_profile.as_deref(),
        setup.paths.workspace.clone(),
    );
    if sandbox_config.profile != crate::sandbox::SandboxProfile::None
        && !crate::sandbox::is_sandbox_available()
    {
        tracing::warn!(
            "Shell sandboxing requested but sandbox binary not found on this platform"
        );
    }
    let shell_prim = ShellExecPrimitive::new(
        allowlist_path.clone(),
        std::time::Duration::from_secs(300),
        1024 * 1024,
    )
    .with_sandbox(sandbox_config)
    .with_working_dir(policy.cwd());
    registry.register(Box::new(shell_prim));

    // Load system settings for network mode
    let system_settings = moxxy_core::SystemSettings::load(
        &moxxy_core::settings_path(&ctx.moxxy_home),
    );

    // HTTP primitive (YAML-backed domain allowlist)
    registry.register(Box::new(HttpRequestPrimitive::new(
        allowlist_path.clone(),
        std::time::Duration::from_secs(30),
        5 * 1024 * 1024,
        system_settings.network_mode,
    )));

    // Skill primitives
    let agent_skills_dir = setup.paths.agent_dir.join("skills");
    registry.register(Box::new(SkillCreatePrimitive::new(
        agent_skills_dir.clone(),
        ctx.moxxy_home.clone(),
        setup.paths.agent_dir.clone(),
    )));
    registry.register(Box::new(SkillValidatePrimitive::new()));
    registry.register(Box::new(SkillListPrimitive::new(
        setup.paths.agent_dir.clone(),
    )));
    registry.register(Box::new(SkillFindPrimitive::new(
        ctx.moxxy_home.clone(),
        setup.paths.agent_dir.clone(),
    )));
    registry.register(Box::new(SkillGetPrimitive::new(
        ctx.moxxy_home.clone(),
        setup.paths.agent_dir.clone(),
    )));
    registry.register(Box::new(SkillExecutePrimitive::new(
        ctx.moxxy_home.clone(),
        setup.paths.agent_dir.clone(),
    )));
    registry.register(Box::new(SkillRemovePrimitive::new(agent_skills_dir)));

    // Notification primitives
    registry.register(Box::new(CliNotifyPrimitive::new(ctx.event_bus.clone())));

    // Channel notification primitive (if channel bridge is available)
    if let Some(ref sender) = ctx.channel_sender {
        registry.register(Box::new(ChannelNotifyPrimitive::new(
            setup.name.clone(),
            sender.clone(),
        )));
    }

    // Browse primitives (YAML-backed domain allowlist)
    registry.register(Box::new(BrowseFetchPrimitive::new(
        allowlist_path.clone(),
        std::time::Duration::from_secs(30),
        10 * 1024 * 1024,
        system_settings.network_mode,
    )));
    registry.register(Box::new(BrowseExtractPrimitive::new()));
    registry.register(Box::new(BrowseCrawlPrimitive::new(
        allowlist_path.clone(),
        std::time::Duration::from_secs(30),
        10 * 1024 * 1024,
        system_settings.network_mode,
    )));

    // Browser rendering (headless Chrome — only if enabled in settings)
    if system_settings.browser_rendering {
        if let Some(manager) = crate::chromium::ChromiumManager::detect(&ctx.moxxy_home) {
            registry.register(Box::new(BrowseRenderPrimitive::new(
                allowlist_path.clone(),
                std::time::Duration::from_secs(30),
                10 * 1024 * 1024,
                system_settings.network_mode,
                std::sync::Arc::new(manager),
            )));
        } else {
            tracing::warn!("Browser rendering enabled but Chrome/Chromium not found");
        }
    }

    // Git primitives (vault-aware via PrimitiveContext, with ask support for token resolution)
    let prim_ctx = PrimitiveContext::new(
        ctx.db.clone(),
        setup.host_agent_name.clone(),
        ctx.vault_backend.clone(),
    )
    .with_ask_support(ctx.event_bus.clone(), ctx.ask_channels.clone());
    registry.register(Box::new(GitInitPrimitive::new(
        setup.paths.workspace.clone(),
    )));
    registry.register(Box::new(GitClonePrimitive::new(
        prim_ctx.clone(),
        setup.paths.workspace.clone(),
    )));
    registry.register(Box::new(GitStatusPrimitive::new(
        setup.paths.workspace.clone(),
    )));
    registry.register(Box::new(GitCommitPrimitive::new(
        prim_ctx.clone(),
        setup.paths.workspace.clone(),
    )));
    registry.register(Box::new(GitPushPrimitive::new(
        prim_ctx.clone(),
        setup.paths.workspace.clone(),
    )));
    registry.register(Box::new(GitCheckoutPrimitive::new(
        setup.paths.workspace.clone(),
    )));
    registry.register(Box::new(GitPrCreatePrimitive::new(
        prim_ctx.clone(),
        setup.paths.workspace.clone(),
    )));
    registry.register(Box::new(GitForkPrimitive::new(prim_ctx.clone())));

    // Vault primitives (agents can manage their own secrets)
    registry.register(Box::new(VaultSetPrimitive::new(prim_ctx.clone())));
    registry.register(Box::new(VaultGetPrimitive::new(prim_ctx.clone())));
    registry.register(Box::new(VaultDeletePrimitive::new(prim_ctx.clone())));
    registry.register(Box::new(VaultListPrimitive::new(prim_ctx.clone())));

    // Webhook management primitives (filesystem-backed)
    registry.register(Box::new(WebhookRegisterPrimitive::new(
        prim_ctx.clone(),
        setup.host_agent_name.clone(),
        ctx.moxxy_home.clone(),
        ctx.base_url.clone(),
        ctx.webhook_index.clone(),
    )));
    registry.register(Box::new(WebhookListPrimitive::new(
        setup.host_agent_name.clone(),
        ctx.moxxy_home.clone(),
        ctx.base_url.clone(),
    )));
    registry.register(Box::new(WebhookDeletePrimitive::new(
        prim_ctx.clone(),
        setup.host_agent_name.clone(),
        ctx.moxxy_home.clone(),
        ctx.webhook_index.clone(),
    )));
    registry.register(Box::new(WebhookUpdatePrimitive::new(
        setup.host_agent_name.clone(),
        ctx.moxxy_home.clone(),
        ctx.webhook_index.clone(),
    )));
    registry.register(Box::new(WebhookRotatePrimitive::new(
        prim_ctx.clone(),
        setup.host_agent_name.clone(),
        ctx.moxxy_home.clone(),
        ctx.base_url.clone(),
        ctx.webhook_index.clone(),
    )));
    registry.register(Box::new(WebhookListenPrimitive::new(
        setup.host_agent_name.clone(),
        ctx.moxxy_home.clone(),
        ctx.webhook_index.clone(),
        ctx.webhook_listen_channels.clone(),
    )));

    // Git worktree primitives
    registry.register(Box::new(GitWorktreeAddPrimitive::new(
        setup.paths.workspace.clone(),
    )));
    registry.register(Box::new(GitWorktreeListPrimitive::new(
        setup.paths.workspace.clone(),
    )));
    registry.register(Box::new(GitWorktreeRemovePrimitive::new(
        setup.paths.workspace.clone(),
    )));

    // Heartbeat management primitives (file-based, agents can self-schedule)
    let heartbeat_path = moxxy_core::heartbeat_path(&ctx.moxxy_home, &setup.host_agent_name);
    registry.register(Box::new(HeartbeatCreatePrimitive::new(
        heartbeat_path.clone(),
        setup.host_agent_name.clone(),
    )));
    registry.register(Box::new(HeartbeatListPrimitive::new(
        heartbeat_path.clone(),
        setup.host_agent_name.clone(),
    )));
    registry.register(Box::new(HeartbeatDisablePrimitive::new(
        heartbeat_path.clone(),
        setup.host_agent_name.clone(),
    )));
    registry.register(Box::new(HeartbeatDeletePrimitive::new(
        heartbeat_path.clone(),
        setup.host_agent_name.clone(),
    )));
    registry.register(Box::new(HeartbeatUpdatePrimitive::new(
        heartbeat_path,
        setup.host_agent_name.clone(),
    )));

    // Ask primitives (user.ask + agent.respond for interactive input)
    registry.register(Box::new(UserAskPrimitive::new(
        ctx.event_bus.clone(),
        ctx.ask_channels.clone(),
        setup.name.clone(),
    )));
    registry.register(Box::new(AgentRespondPrimitive::new(
        ctx.ask_channels.clone(),
    )));

    // Agent self-management primitives
    registry.register(Box::new(AgentSelfGetPrimitive::new(
        setup.paths.agent_dir.clone(),
    )));
    registry.register(Box::new(AgentSelfUpdatePrimitive::new(
        setup.paths.agent_dir.clone(),
        ctx.moxxy_home.clone(),
    )));
    registry.register(Box::new(AgentSelfPersonaReadPrimitive::new(
        setup.paths.agent_dir.clone(),
    )));
    registry.register(Box::new(AgentSelfPersonaWritePrimitive::new(
        setup.paths.agent_dir.clone(),
    )));

    // Agent management primitives (using RunStarter trait)
    if let Some(ref starter) = ctx.run_starter {
        registry.register(Box::new(AgentSpawnPrimitive::new(
            setup.name.clone(),
            starter.clone(),
            ctx.event_bus.clone(),
        )));
        registry.register(Box::new(AgentListPrimitive::new(
            setup.name.clone(),
            starter.clone(),
        )));
        registry.register(Box::new(AgentStatusPrimitive::new(
            setup.name.clone(),
            starter.clone(),
            ctx.ask_channels.clone(),
        )));
        registry.register(Box::new(AgentStopPrimitive::new(
            setup.name.clone(),
            starter.clone(),
        )));
        registry.register(Box::new(AgentDismissPrimitive::new(
            setup.name.clone(),
            starter.clone(),
        )));

        // Allowlist management primitives (YAML-backed)
        registry.register(Box::new(AllowlistListPrimitive::new(
            allowlist_path.clone(),
        )));
        registry.register(Box::new(AllowlistAddPrimitive::new(
            allowlist_path.clone(),
        )));
        registry.register(Box::new(AllowlistRemovePrimitive::new(
            allowlist_path.clone(),
        )));
        registry.register(Box::new(AllowlistDenyPrimitive::new(
            allowlist_path.clone(),
        )));
        registry.register(Box::new(AllowlistUndenyPrimitive::new(
            allowlist_path.clone(),
        )));
    }

    prim_ctx
}
