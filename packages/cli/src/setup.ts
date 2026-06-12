import type { Session } from '@moxxy/core';
import {
  createAllowListResolver,
  createCallbackResolver,
  createLogger,
  defaultProjectSkillsDir,
  defaultUserSkillsDir,
  denyByDefaultResolver,
  discoverSkills,
  loadPreferences,
  silentLogger,
} from '@moxxy/core';
import type { Plugin } from '@moxxy/sdk';
import { buildConfigPlugin } from '@moxxy/config';
import { BUILTIN_SKILLS_DIR_RESOLVED } from './setup/builtin-skills-dir.js';
import { buildVaultPlugin } from '@moxxy/plugin-vault';
import { buildMemoryPlugin } from '@moxxy/plugin-memory';
import { buildSessionConfigApplier } from './config-applier.js';
import { loadRawConfig, resolveConfigPlaceholders } from './setup/load-config.js';
import { selectEmbedder } from './setup/embedder.js';
import { buildSession } from './setup/build-session.js';
import { buildBuiltinsCore } from './setup/builtins.js';
import { buildSchedulerRunner } from './setup/scheduler-runner.js';
import { buildWebhookRunner } from './setup/webhook-runner.js';
import { registerPlugins } from './setup/register-plugins.js';
import { activateProvider } from './setup/activate-provider.js';
import { applyPreferences } from './setup/apply-preferences.js';
import { attachSessionPersistence } from './setup/persistence.js';
import type { BootStep, SetupOptions, SetupResult } from './setup/types.js';

export type { BootStep, SetupOptions, SetupResult } from './setup/types.js';

export async function setupSession(opts: SetupOptions): Promise<Session> {
  const result = await setupSessionWithConfig(opts);
  return result.session;
}

export async function setupSessionWithConfig(opts: SetupOptions): Promise<SetupResult> {
  const logger = opts.verbose ? createLogger({ minLevel: 'debug' }) : silentLogger;
  // When the TUI bootstrap path passes onProgress, it owns raw mode —
  // a vault/key prompt would deadlock. Force skipKeyPrompt to surface
  // missing-credential errors as a visible boot-failure row instead.
  const skipKeyPrompt = opts.skipKeyPrompt || opts.onProgress != null;
  const progress = opts.onProgress ?? ((): void => undefined);

  const { rawConfig, sources } = await loadRawConfig({
    cwd: opts.cwd,
    configPath: opts.configPath,
    skipUser: opts.skipUserConfig,
  });
  progress({ kind: 'config-loaded', sources: sources.length });

  const { plugin: vaultPlugin, vault } = buildVaultPlugin({
    disableKeytar: opts.disableKeytar,
    ...(opts.passphrasePrompt ? { passphrasePrompt: opts.passphrasePrompt } : {}),
  });

  // MCP servers are now lazy-loaded: the admin plugin's onInit hook
  // reads ~/.moxxy/mcp.json and registers stub tools using each
  // server's cached descriptors WITHOUT connecting. The actual MCP
  // connection happens on the first invocation of a tool from that
  // server. Boot stays instant even with many servers configured.
  //
  // Servers that have never been added before lack the descriptor
  // cache; for those the user re-runs mcp_add_server (or
  // mcp_test_server) and the cache populates.

  const config = await resolveConfigPlaceholders(rawConfig, vault, logger);

  // Single source of truth for "is this package disabled?", seeded from the
  // merged config (project + user `plugins[name].enabled = false`). The
  // PluginHost reads it on every reload so a disabled plugin is never
  // resurrected; the config applier and the plugins-admin enable/disable tools
  // mutate it so a runtime toggle takes effect without a restart.
  const disabledPackages = new Set<string>(
    Object.entries(config.plugins ?? {})
      .filter(([, settings]) => settings?.enabled === false)
      .map(([name]) => name),
  );

  const session = await buildSession({
    cwd: opts.cwd,
    config,
    resolver: opts.resolver,
    resumeSessionId: opts.resumeSessionId,
    sessionId: opts.sessionId,
    logger,
    isPluginDisabled: (pkg) => disabledPackages.has(pkg),
    // Surface vault secrets to tool handlers as `ctx.getSecret(name)`. The
    // value never enters the model's context or `process.env` — only the
    // handler that asks receives it. `vault.get` lazily opens the vault and
    // returns null for unknown names.
    secretResolver: (name) => vault.get(name),
  });

  // Built AFTER the session so it can pull the registry-selected embedder
  // lazily — the embedder isn't chosen until plugins have registered (see
  // selectEmbedder below). A null active embedder → keyword recall.
  const { plugin: memoryPlugin, store: memory } = buildMemoryPlugin({
    embedder: () => session.embedders.tryGetActive(),
  });

  // Build the builtin list first WITHOUT the config plugin so we can pass the
  // whole list to the ConfigApplier (used for hot-toggle of plugin enable/disable).
  const schedulerRunner = buildSchedulerRunner(session);
  const webhookRunner = buildWebhookRunner(session);
  const { entries: builtinsCore, scheduler, webhooks, security } = buildBuiltinsCore({
    session,
    rawConfig,
    vault,
    vaultPlugin,
    memory,
    memoryPlugin,
    schedulerRunner,
    webhookRunner,
    disabledPackages,
    logger,
  });

  const builtins: Array<{ name: string; plugin: Plugin }> = [
    ...builtinsCore,
    {
      name: '@moxxy/plugin-config',
      plugin: buildConfigPlugin({
        cwd: opts.cwd,
        applier: buildSessionConfigApplier(session, config, builtinsCore, disabledPackages),
      }),
    },
  ];

  const pluginRegistration = await registerPlugins(session, config, builtins, opts.cwd, logger);
  progress({
    kind: 'plugins-registered',
    count: pluginRegistration.registered.size,
    skipped: pluginRegistration.skipped.length,
  });

  // Every plugin (incl. discovered embedder plugins) is registered now — pick
  // the configured embedder onto session.embedders; memory reads it lazily.
  await selectEmbedder(session, rawConfig.embeddings, logger);

  // Bridge plugin-contributed isolators (from discovered `kind: 'isolator'`
  // plugins) into the security layer's registry, BEFORE its onInit wraps tools.
  // Opt-in only: registering an isolator never activates it — the user still
  // selects one by name via `security.isolator`, so a discovered isolator can't
  // silently become the sandbox boundary.
  for (const iso of session.isolators.list()) security.registry.register(iso);

  // Seed user-disabled providers (desktop Settings → Providers toggle) BEFORE
  // the activation walk so a disabled provider is never auto-activated. The
  // registry's disabled set is name-based, so seeding works regardless of
  // plugin registration order. Best-effort, like every preferences read.
  try {
    const bootPrefs = await loadPreferences();
    for (const name of bootPrefs.disabledProviders ?? []) {
      session.providers.setEnabled(name, false);
    }
  } catch {
    // preferences are optional — never block boot
  }

  const { credentialResolver } = await activateProvider({
    session,
    config,
    vault,
    providerConfig: { ...(config.provider?.config ?? {}), ...(opts.providerConfig ?? {}) },
    skipKeyPrompt,
    skipProviderActivation: opts.skipProviderActivation,
    tolerateNoProvider: opts.tolerateNoProvider,
    onProgress: opts.onProgress,
    progress,
    logger,
  });

  if (config.mode) session.modes.setActive(config.mode);
  if (config.compactor) session.compactors.setActive(config.compactor);
  if (config.workflowExecutor) session.workflowExecutors.setActive(config.workflowExecutor);
  // Caching is on by default (stable-prefix auto-activates). `caching: false`
  // selects the no-op strategy; an explicit name overrides the default.
  if (config.context?.caching === false) {
    session.cacheStrategies.setActive('none');
  } else if (config.context?.cacheStrategy) {
    session.cacheStrategies.setActive(config.context.cacheStrategy);
  }
  // The web-surface tunnel provider (localhost by default) is applied by the
  // web plugin's onInit from ~/.moxxy/web.json or config.channels.web.tunnel,
  // and auto-selected per primary channel by coAttachWebSurface — no env needed.

  // Elision is on by default (built-in defaults); config only needs to be
  // carried when the user customizes or disables it.
  if (config.context?.elision) session.elisionSettings = config.context.elision;
  if (config.context?.lazyTools) session.lazyTools = true;

  await applyPreferences(session, credentialResolver, logger);
  progress({ kind: 'prefs-applied' });

  const discovered = await discoverSkills({
    projectDir: config.skills?.projectDir ?? defaultProjectSkillsDir(opts.cwd),
    userDir: config.skills?.userDir ?? defaultUserSkillsDir(),
    pluginDirs: config.skills?.extraDirs,
    builtinDir: BUILTIN_SKILLS_DIR_RESOLVED,
    logger,
  });
  for (const skill of discovered) session.skills.register(skill);
  progress({ kind: 'skills-loaded', count: discovered.length });

  // Fire onInit lifecycle hooks now that every plugin is registered and
  // every skill is loaded. Hooks observe the fully-populated session
  // and can do session-level setup (e.g. the MCP admin plugin registers
  // lazy stubs for saved servers here). Failures are non-fatal — the
  // dispatcher records them as ErrorEvents but startup proceeds.
  //
  // `skipInitHooks` suppresses this: an attach client wants the populated
  // registries (channel factories) but not the init side effects (daemons),
  // which the runner it attaches to already owns.
  if (!opts.skipInitHooks) {
    await session.dispatcher.dispatchInit(session.appContext());
  }
  progress({ kind: 'init-hooks-done' });
  progress({ kind: 'ready' });

  const persistence = attachSessionPersistence(session, opts.cwd, opts.disableSessionPersistence);

  return {
    session,
    config,
    configSources: sources,
    vault,
    memory,
    scheduler,
    webhooks,
    persistence,
    security,
    pluginRegistration,
  };
}

/**
 * Boot a throwaway session purely to answer a question about the populated
 * registries/config (does a channel exist? did a provider activate?), hand
 * the answer back, and GUARANTEE the session is closed before returning.
 *
 * Probes always force:
 *   - `skipInitHooks: true` — a probe must never start the init-time daemons
 *     (scheduler poller, webhooks listener). Those belong to the REAL session
 *     the caller boots afterwards; an orphaned probe winning the webhooks
 *     port bind would silently starve the real session and route incoming
 *     webhooks to an abandoned session.
 *   - `disableSessionPersistence: true` — a probe never runs a turn, so it
 *     must not litter `~/.moxxy/sessions` with empty logs.
 *
 * The session is closed (onShutdown hooks fire, then abort) in a `finally`,
 * so closure holds even when `read` throws. Closing is best-effort: a
 * cleanup failure never masks the probe's answer (or `read`'s own error).
 *
 * `boot` is injectable for tests only; production callers use the default.
 */
export async function probeSession<T>(
  opts: SetupOptions,
  read: (result: SetupResult) => T | Promise<T>,
  boot: (opts: SetupOptions) => Promise<SetupResult> = setupSessionWithConfig,
): Promise<T> {
  const result = await boot({
    ...opts,
    skipInitHooks: true,
    disableSessionPersistence: true,
  });
  try {
    return await read(result);
  } finally {
    await result.session.close('probe-complete').catch(() => undefined);
  }
}

export { createAllowListResolver, createCallbackResolver, denyByDefaultResolver };
