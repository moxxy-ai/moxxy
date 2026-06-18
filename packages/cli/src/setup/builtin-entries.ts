import * as os from 'node:os';
import * as path from 'node:path';
import { buildSynthesizeSkillPlugin, type Session } from '@moxxy/core';
import { asPluginId, type Plugin } from '@moxxy/sdk';
import type { MoxxyConfig } from '@moxxy/config';
import { anthropicPlugin } from '@moxxy/plugin-provider-anthropic';
import { openaiPlugin } from '@moxxy/plugin-provider-openai';
import { openaiCodexPlugin } from '@moxxy/plugin-provider-openai-codex';
import { claudeCodePlugin } from '@moxxy/plugin-provider-claude-code';
import { zaiPlugin } from '@moxxy/plugin-provider-zai';
import { xaiPlugin } from '@moxxy/plugin-provider-xai';
import { googlePlugin } from '@moxxy/plugin-provider-google';
import { localPlugin } from '@moxxy/plugin-provider-local';
import { buildWhisperPlugin } from '@moxxy/plugin-stt-whisper';
import { buildWhisperCodexPlugin } from '@moxxy/plugin-stt-whisper-codex';
import { builtinToolsPlugin } from '@moxxy/tools-builtin';
import { defaultModePlugin } from '@moxxy/mode-default';
import { goalModePlugin } from '@moxxy/mode-goal';
import { deepResearchModePlugin } from '@moxxy/mode-deep-research';
import { collaborativeModePlugin } from '@moxxy/mode-collaborative';
import { collabPlugin } from '@moxxy/plugin-collab';
import { summarizeCompactorPlugin } from '@moxxy/compactor-summarize';
import { stablePrefixCacheStrategyPlugin } from '@moxxy/cache-strategy-stable-prefix';
import {
  buildMemoryConsolidatePlugin,
  type MemoryStore,
} from '@moxxy/plugin-memory';
import { buildTelegramPlugin } from '@moxxy/plugin-telegram';
import { buildMcpAdminPluginWithApi } from '@moxxy/plugin-mcp';
import { cliPlugin } from '@moxxy/plugin-cli';
import { httpChannelPlugin } from '@moxxy/plugin-channel-http';
import { buildWebChannelPlugin } from '@moxxy/plugin-channel-web';
import { mobileChannelPlugin } from '@moxxy/plugin-channel-mobile';
import { browserPlugin } from '@moxxy/plugin-browser';
import { terminalPlugin } from '@moxxy/plugin-terminal';
import { buildSubagentsPlugin } from '@moxxy/plugin-subagents';
import { buildPluginsAdminPlugin } from '@moxxy/plugin-plugins-admin';
import { buildSelfUpdatePlugin } from '@moxxy/plugin-self-update';
import { buildProviderAdminPluginWithApi } from '@moxxy/plugin-provider-admin';
import { buildUsageStatsPlugin } from '@moxxy/plugin-usage-stats';
import { commandsPlugin } from '@moxxy/plugin-commands';
import { buildViewPlugin } from '@moxxy/plugin-view';
import { computerControlPlugin } from '@moxxy/plugin-computer-control';
import { buildOauthPlugin } from '@moxxy/plugin-oauth';
import { buildVoiceAdminPlugin } from '@moxxy/plugin-voice-admin';
import { resolveString } from '@moxxy/plugin-vault';
import type { VaultStore } from '@moxxy/plugin-vault';
import { BUILTIN_SKILLS_DIR_RESOLVED } from './builtin-skills-dir.js';

export interface BuiltinEntry {
  readonly name: string;
  readonly plugin: Plugin;
}

/** Shared handle linking the web surface to present_view. */
export interface ViewSurfaceRef {
  current: { url: string; nextViewId: () => string } | null;
}

/** Live web-surface controls (set when the surface starts). */
export interface WebControlsRef {
  current: { retunnel(): Promise<string | null> } | null;
}

export interface BuiltinEntriesArgs {
  readonly session: Session;
  readonly rawConfig: MoxxyConfig;
  readonly vault: VaultStore;
  readonly vaultPlugin: Plugin;
  readonly memory: MemoryStore;
  readonly memoryPlugin: Plugin;
  readonly viewSurface: ViewSurfaceRef;
  readonly webControls: WebControlsRef;
  readonly setPluginEnabledLive: (packageName: string, enabled: boolean) => Promise<void>;
}

/**
 * Build the static slice of the builtin plugin list — everything that does NOT
 * need the scheduler/workflows/webhooks/security sub-builders (those are pushed
 * by the orchestrator afterward). The exact set + order here is the registered
 * builtin set; do not reorder.
 */
export function buildBuiltinEntries(args: BuiltinEntriesArgs): BuiltinEntry[] {
  const { session, rawConfig, vault, vaultPlugin, memory, memoryPlugin, viewSurface, webControls, setPluginEnabledLive } = args;

  return [
    { name: '@moxxy/plugin-provider-anthropic', plugin: anthropicPlugin },
    { name: '@moxxy/plugin-provider-openai', plugin: openaiPlugin },
    { name: '@moxxy/plugin-provider-openai-codex', plugin: openaiCodexPlugin },
    { name: '@moxxy/plugin-provider-claude-code', plugin: claudeCodePlugin },
    // OpenAI-compatible vendors (z.ai api-key mode, xAI, Google Gemini, local
    // servers) + z.ai's GLM Coding Plan (Anthropic-compatible). Each reuses the
    // shared OpenAIProvider/AnthropicProvider with its own slug + base URL +
    // model catalog; see the respective plugin packages.
    { name: '@moxxy/plugin-provider-zai', plugin: zaiPlugin },
    { name: '@moxxy/plugin-provider-xai', plugin: xaiPlugin },
    { name: '@moxxy/plugin-provider-google', plugin: googlePlugin },
    { name: '@moxxy/plugin-provider-local', plugin: localPlugin },
    { name: '@moxxy/tools-builtin', plugin: builtinToolsPlugin },
    { name: '@moxxy/mode-default', plugin: defaultModePlugin },
    { name: '@moxxy/mode-goal', plugin: goalModePlugin },
    { name: '@moxxy/mode-deep-research', plugin: deepResearchModePlugin },
    // Agentic collaborative: a team of separate agent processes (architect +
    // implementers) work in parallel git worktrees (or sequentially without
    // git), coordinated via the @moxxy/plugin-collab hub.
    { name: '@moxxy/mode-collaborative', plugin: collaborativeModePlugin },
    { name: '@moxxy/plugin-collab', plugin: collabPlugin },
    { name: '@moxxy/compactor-summarize', plugin: summarizeCompactorPlugin },
    { name: '@moxxy/cache-strategy-stable-prefix', plugin: stablePrefixCacheStrategyPlugin },
    { name: '@moxxy/plugin-vault', plugin: vaultPlugin },
    { name: '@moxxy/plugin-stt-whisper', plugin: buildWhisperPlugin() },
    {
      name: '@moxxy/plugin-stt-whisper-codex',
      plugin: buildWhisperCodexPlugin({ vault }),
    },
    { name: '@moxxy/plugin-memory', plugin: memoryPlugin },
    {
      name: '@moxxy/memory-consolidate',
      plugin: buildMemoryConsolidatePlugin(memory, () => session.providers.getActive()),
    },
    { name: '@moxxy/plugin-cli', plugin: cliPlugin },
    // Cross-session token usage. onShutdown folds this run's provider_response
    // usage by provider/model into ~/.moxxy/usage.json (a forward-going
    // aggregate). Surfaced in the /usage panel; reset via /usage clear.
    { name: '@moxxy/plugin-usage-stats', plugin: buildUsageStatsPlugin() },
    { name: '@moxxy/plugin-channel-http', plugin: httpChannelPlugin },
    {
      name: '@moxxy/plugin-channel-web',
      plugin: buildWebChannelPlugin({
        getTunnel: () => session.tunnelProviders.getActive(),
        publishSurface: (s) => {
          viewSurface.current = s;
        },
        publishControls: (c) => {
          webControls.current = c;
        },
        getControls: () => webControls.current,
        tunnels: {
          list: () => session.tunnelProviders.list().map((p) => p.name),
          active: () => session.tunnelProviders.getActive()?.name ?? null,
          setActive: (n) => session.tunnelProviders.setActive(n),
          isAvailable: async (n) => {
            const p = session.tunnelProviders.list().find((x) => x.name === n);
            return p?.isAvailable ? p.isAvailable() : true;
          },
        },
        ...(typeof (rawConfig.channels as { web?: { tunnel?: unknown } } | undefined)?.web?.tunnel === 'string'
          ? { defaultTunnel: (rawConfig.channels as { web?: { tunnel?: string } }).web!.tunnel }
          : {}),
      }),
    },
    { name: '@moxxy/plugin-channel-mobile', plugin: mobileChannelPlugin },
    { name: '@moxxy/plugin-telegram', plugin: buildTelegramPlugin({ vault }) },
    { name: '@moxxy/plugin-browser', plugin: browserPlugin },
    // Shared terminal surface + `terminal` tool. node-pty is an optional native
    // peer dep, so the surface availability (real PTY vs piped fallback) is
    // diagnosed at runtime — the tool always registers for a stable tool list.
    { name: '@moxxy/plugin-terminal', plugin: terminalPlugin },
    // macOS-only computer control: screenshot, click, type, key,
    // open, clipboard, applescript. Plugin always registers (so the
    // model's tool list is stable across hosts); handlers throw a
    // clear "macOS only" error on Linux/Windows.
    { name: '@moxxy/plugin-computer-control', plugin: computerControlPlugin },
    // Generic OAuth 2.0 + PKCE client. Adds oauth_authorize /
    // oauth_get_token / oauth_clear_token tools that any skill can
    // chain (Google OAuth → MCP env, GitHub OAuth → API calls, …).
    { name: '@moxxy/plugin-oauth', plugin: buildOauthPlugin({ vault }) },
    // Universal slash commands (/info, /clear, /new, /exit, /help)
    // shared across every channel via session.commands. Disable to
    // hide them everywhere — channel-local commands keep working.
    { name: '@moxxy/plugin-commands', plugin: commandsPlugin },
    // Agent-authored UIs: present_view parses the model's JSX-like view-spec
    // (via the session's active, swappable view renderer) into a validated AST
    // that the web surface renders as interactive UI. The renderer is reached
    // through a closure since ToolContext exposes no session handle.
    {
      name: '@moxxy/plugin-view',
      plugin: buildViewPlugin({
        getRenderer: () => session.viewRenderers.getActive(),
        getSurface: () => viewSurface.current,
      }),
    },
    // Subagents are a swappable block: this plugin owns the
    // dispatch_agent tool and the auto-detection skill. Drop it
    // (`config.plugins['@moxxy/plugin-subagents'].enabled = false`) and
    // the model can't spawn children — the normal single-loop flow runs.
    // Agent kinds (researcher, code-reviewer, ...) come from OTHER plugins
    // via `PluginSpec.agents`; the closure here reads the live registry.
    {
      name: '@moxxy/plugin-subagents',
      plugin: buildSubagentsPlugin({
        getAgent: (name) => session.agents.get(name),
      }),
    },
    // Runtime plugin management — exposes install_plugin / uninstall_plugin
    // (npm into ~/.moxxy/plugins) and enable_plugin / disable_plugin (config-
    // backed plug/unplug of any registered plugin). Hot-reloads via
    // session.pluginHost.reload() so changes drop into the active registries
    // without restart. Drop this plugin to lock the plugin set (e.g. for
    // production deployments).
    {
      name: '@moxxy/plugin-plugins-admin',
      plugin: buildPluginsAdminPlugin({
        reload: () => session.pluginHost.reload(),
        snapshot: () => ({
          tools: session.tools.list().map((t) => t.name),
          agents: session.agents.list().map((a) => a.name),
          providers: session.providers.list().map((p) => p.name),
          modes: session.modes.list().map((l) => l.name),
          compactors: session.compactors.list().map((c) => c.name),
          channels: session.channels.list().map((c) => c.name),
        }),
        setEnabled: setPluginEnabledLive,
      }),
    },
    // Self-update — exposes self_update_* tools so the model can author
    // and apply guardrailed, transactional changes to its OWN plugins /
    // skills (Tier 1, hot-reloaded) under ~/.moxxy. Every code write is
    // permission-gated; verify builds+tests+loads the change and a failed
    // modify auto-restores the previous version. Disable this plugin
    // (`config.plugins['@moxxy/plugin-self-update'].enabled = false`) to
    // lock the code base.
    {
      name: '@moxxy/plugin-self-update',
      plugin: buildSelfUpdatePlugin({
        moxxyDir: path.join(os.homedir(), '.moxxy'),
        reload: () => session.pluginHost.reload(),
        unload: (name) => session.pluginHost.unload(name),
        snapshot: () => ({
          tools: session.tools.list().map((t) => t.name),
          agents: session.agents.list().map((a) => a.name),
          providers: session.providers.list().map((p) => p.name),
          modes: session.modes.list().map((l) => l.name),
          compactors: session.compactors.list().map((c) => c.name),
          channels: session.channels.list().map((c) => c.name),
        }),
        skipped: () =>
          session.pluginHost.listSkipped().map((s) => ({
            pluginName: s.pluginName,
            ...(s.packageName ? { packageName: s.packageName } : {}),
            message: s.message,
          })),
        emit: (e) =>
          session.log
            .append({
              type: 'plugin_event',
              pluginId: asPluginId('@moxxy/plugin-self-update'),
              subtype: e.subtype,
              payload: e.payload,
              sessionId: e.sessionId,
              turnId: e.turnId,
              source: 'plugin',
            })
            .then(() => undefined),
        ...(typeof rawConfig.plugins?.['@moxxy/plugin-self-update']?.options?.maxTxnRetained === 'number'
          ? {
              maxTxnRetained: rawConfig.plugins['@moxxy/plugin-self-update'].options
                .maxTxnRetained as number,
            }
          : {}),
        // Tier-2 core-patching is on by default; set
        // options.allowCoreUpdate = false to hide the self_update_core_* tools.
        // options.repoUrl overrides the git source (needed if @moxxy/core's
        // published package.json lacks a `repository` field).
        //
        // MOXXY_NO_CORE_UPDATE=1 hard-disables Tier-2 regardless of config —
        // the desktop sets this on the runner spawn because core patches
        // (git clone + build + dist overlay + restart) can't work inside a
        // read-only, packaged .app and would only confuse the model.
        coreUpdate: {
          enabled:
            process.env.MOXXY_NO_CORE_UPDATE !== '1' &&
            rawConfig.plugins?.['@moxxy/plugin-self-update']?.options?.allowCoreUpdate !== false,
          ...(typeof rawConfig.plugins?.['@moxxy/plugin-self-update']?.options?.repoUrl === 'string'
            ? { repoUrlOverride: rawConfig.plugins['@moxxy/plugin-self-update'].options.repoUrl as string }
            : {}),
        },
      }),
    },
    // Voice/TTS control — lets the agent switch which text-to-speech backend
    // read-aloud surfaces (the desktop's speaker button) use, without a
    // settings UI. `set_voice` activates a registered synthesizer by name, or
    // 'system' to deactivate (fall back to the OS voice). `list_voices` reports
    // what's available + which is active. A synthesizer authored via
    // self-update auto-activates on load, so this is for switching afterwards.
    {
      name: '@moxxy/voice-admin',
      plugin: buildVoiceAdminPlugin(session),
    },
    // Provider admin tools (provider_add, provider_list, provider_remove,
    // provider_test). Persists OpenAI-compatible vendor registrations to
    // ~/.moxxy/providers.json; the plugin's onInit re-registers them on
    // every boot. Pairs with the `add-provider` skill which walks the
    // model through gathering baseURL + models + key.
    (() => {
      const { plugin, api } = buildProviderAdminPluginWithApi({ providerRegistry: session.providers });
      // Stash the api on the session so the desktop (via the runner's
      // `provider.configure`) can edit a stored provider without going
      // through the model. Mirrors the mcpAdmin stash below.
      session.providerAdmin = api;
      return { name: '@moxxy/plugin-provider-admin', plugin };
    })(),
    // Admin tools (mcp_add_server, mcp_list_servers, mcp_remove_server,
    // mcp_test_server) plus the boot-time lazy attach. Passing the
    // session's live tool registry enables both hot-attach for runtime
    // adds AND lazy stub registration in onInit for saved servers.
    (() => {
      const { plugin, api } = buildMcpAdminPluginWithApi({
        toolRegistry: session.tools,
        skillRegistry: session.skills,
        userSkillsDir: rawConfig.skills?.userDir,
        // Resolve `${vault:NAME}` placeholders in MCP env/header values at
        // connect time. The persisted catalog (and tool args the model sees)
        // keep the placeholder; the plaintext never leaves the connect path.
        secretResolver: (value) => resolveString(value, vault),
      });
      // Stash the api on the session so the TUI / CLI can call
      // enableAndAttach + detach without going through the model. `mcpAdmin` is
      // a typed optional capability on Session (McpAdminView); McpAdminApi
      // structurally satisfies it.
      session.mcpAdmin = api;
      return { name: '@moxxy/plugin-mcp-admin', plugin };
    })(),
    {
      name: '@moxxy/synthesize-skill',
      // Thread the SAME directory set the boot scan uses so reload_skills
      // doesn't drop builtin/plugin skills when invoked at runtime.
      plugin: buildSynthesizeSkillPlugin(session, {
        builtinDir: BUILTIN_SKILLS_DIR_RESOLVED,
        ...(rawConfig.skills?.extraDirs ? { pluginDirs: rawConfig.skills.extraDirs } : {}),
        ...(rawConfig.skills?.projectDir ? { projectDir: rawConfig.skills.projectDir } : {}),
        ...(rawConfig.skills?.userDir ? { userDir: rawConfig.skills.userDir } : {}),
      }),
    },
  ];
}
