import { buildSynthesizeSkillPlugin, type Session } from '@moxxy/core';
import { type CategoryView, type Plugin } from '@moxxy/sdk';
import type { MoxxyConfig } from '@moxxy/config';
// The API-key providers (anthropic, openai, google, xai, zai, local) are NOT
// bundled — they install on demand from npm via `moxxy init` / `moxxy provision`
// into ~/.moxxy/plugins and are discovered by the plugin host, keeping the
// kernel slim. The two OAuth/subscription providers stay bundled: they're the
// out-of-box "sign in" default AND the CLI's credential resolver
// (provider-credentials.ts) links their token helpers directly.
import { openaiCodexPlugin } from '@moxxy/plugin-provider-openai-codex';
import { claudeCodePlugin } from '@moxxy/plugin-provider-claude-code';
import { builtinToolsPlugin } from '@moxxy/tools-builtin';
import { defaultModePlugin } from '@moxxy/mode-default';
import { collaborativeModePlugin } from '@moxxy/mode-collaborative';
import { collabPlugin } from '@moxxy/plugin-collab';
import { summarizeCompactorPlugin } from '@moxxy/compactor-summarize';
import { stablePrefixCacheStrategyPlugin } from '@moxxy/cache-strategy-stable-prefix';
import { cliPlugin } from '@moxxy/plugin-cli';
import { mobileChannelPlugin } from '@moxxy/plugin-channel-mobile';
import { buildPluginsAdminPlugin } from '@moxxy/plugin-plugins-admin';
import { commandsPlugin } from '@moxxy/plugin-commands';
import type { VaultStore } from '@moxxy/plugin-vault';
import { BUILTIN_SKILLS_DIR_RESOLVED } from './builtin-skills-dir.js';
import { buildPluginSnapshot } from './plugin-snapshot.js';
import { cliVersion } from '../version.js';

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
  readonly viewSurface: ViewSurfaceRef;
  readonly webControls: WebControlsRef;
  readonly setPluginEnabledLive: (packageName: string, enabled: boolean) => Promise<void>;
  /** Live snapshot + swap of category defaults — shared with the TUI tabs. */
  readonly categoryLive: {
    categories: () => ReadonlyArray<CategoryView>;
    setCategoryDefault: (category: string, name: string) => Promise<void>;
  };
}

/**
 * Build the static slice of the builtin plugin list — everything that does NOT
 * need the scheduler/workflows/webhooks/security sub-builders (those are pushed
 * by the orchestrator afterward). The exact set + order here is the registered
 * builtin set; do not reorder.
 */
export function buildBuiltinEntries(args: BuiltinEntriesArgs): BuiltinEntry[] {
  const { session, rawConfig, vaultPlugin, viewSurface, webControls, setPluginEnabledLive, categoryLive } = args;

  // Publish the shared web-surface ref so the (discovery-loadable) view plugin
  // can read it in onInit — the same mutable ref the web channel writes via its
  // `publishSurface` closure below. Registered here (before onInit dispatch) so
  // it's available when the view plugin's onInit runs.
  session.services.register('viewSurface', viewSurface);
  // Per-package config options accessor (the host owns the parsed config), so a
  // discovery-loaded plugin (self-update) can read its own options in onInit.
  session.services.register(
    'getPluginOptions',
    (pkg: string): Record<string, unknown> | undefined => rawConfig.plugins?.packages?.[pkg]?.options,
  );
  // The shared web-controls ref (written by the web channel, read by its
  // web_set_tunnel tool) + the configured default tunnel — for the
  // discovery-loadable web channel to resolve in onInit.
  session.services.register('webControls', webControls);
  session.services.register(
    'webDefaultTunnel',
    typeof (rawConfig.channels as { web?: { tunnel?: unknown } } | undefined)?.web?.tunnel === 'string'
      ? (rawConfig.channels as { web?: { tunnel?: string } }).web!.tunnel
      : undefined,
  );

  return [
    // Bundled OAuth providers (out-of-box "sign in"; CLI credential resolver
    // links their token helpers). The API-key providers install on demand.
    { name: '@moxxy/plugin-provider-openai-codex', plugin: openaiCodexPlugin },
    { name: '@moxxy/plugin-provider-claude-code', plugin: claudeCodePlugin },
    { name: '@moxxy/tools-builtin', plugin: builtinToolsPlugin },
    { name: '@moxxy/mode-default', plugin: defaultModePlugin },
    // mode-goal / mode-deep-research / plugin-subagents / plugin-oauth /
    // plugin-computer-control / plugin-channel-http / plugin-usage-stats are
    // NOT bundled — they install on demand from npm (INSTALLABLE_PLUGIN_CATALOG;
    // /goal & /mode offer the install at point of use) and load via discovery.
    // Agentic collaborative: a team of separate agent processes (architect +
    // implementers) work in parallel git worktrees (or sequentially without
    // git), coordinated via the @moxxy/plugin-collab hub.
    { name: '@moxxy/mode-collaborative', plugin: collaborativeModePlugin },
    { name: '@moxxy/plugin-collab', plugin: collabPlugin },
    { name: '@moxxy/compactor-summarize', plugin: summarizeCompactorPlugin },
    { name: '@moxxy/cache-strategy-stable-prefix', plugin: stablePrefixCacheStrategyPlugin },
    { name: '@moxxy/plugin-vault', plugin: vaultPlugin },
    // plugin-stt-whisper(+codex) are NOT bundled — install on demand / seeded
    // by the desktop; both resolve their deps from the service registry.
    // plugin-memory is NOT bundled — one merged plugin (store + tools +
    // tfidf embedder + consolidate) installs on demand / rides the desktop
    // seed, resolving its lazy embedder from the 'embedders' service.
    { name: '@moxxy/plugin-cli', plugin: cliPlugin },
    // plugin-channel-web / plugin-browser / plugin-terminal are NOT bundled —
    // install on demand from npm (or the desktop plugins-seed) and load via
    // discovery: web serves its own dist/public next to its module, browser
    // resolves its own dist/sidecar.js, terminal carries node-pty as its own
    // optional dep (piped-shell fallback without it).
    { name: '@moxxy/plugin-channel-mobile', plugin: mobileChannelPlugin },
    // plugin-telegram / plugin-channel-slack are NOT bundled — install on
    // demand (`moxxy <channel>` prints the install hint when absent) or ride
    // the desktop plugins-seed; the desktop ChannelSupervisor spawns them on
    // their dedicated runners from the seeded install.
    // Universal slash commands (/info, /clear, /new, /exit, /help)
    // shared across every channel via session.commands. Disable to
    // hide them everywhere — channel-local commands keep working.
    { name: '@moxxy/plugin-commands', plugin: commandsPlugin },
    // plugin-view / plugin-self-update / plugin-voice-admin /
    // plugin-provider-admin / plugin-mcp are NOT bundled — install on demand
    // or ride the desktop plugins-seed (the seed is what keeps the desktop's
    // Settings panels working: they reach provider-admin/mcp through the
    // 'providerAdmin'/'mcpAdmin' session services on the spawned runner).
    // Library code some cli commands import from provider-admin/self-update/
    // mcp (key-name helpers, staged-update finalize, mcp.json IO) stays
    // inlined via static imports — only the plugin instances move out.
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
        snapshot: () => buildPluginSnapshot(session),
        setEnabled: setPluginEnabledLive,
        categories: categoryLive.categories,
        setCategoryDefault: categoryLive.setCategoryDefault,
        ...(cliVersion() ? { cliVersion: cliVersion()! } : {}),
        // Lets install_plugin report the just-installed package's combined
        // capability surface (union of its tools' isolation declarations).
        toolIsolation: (name) => session.tools.get(name)?.isolation,
      }),
    },
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
