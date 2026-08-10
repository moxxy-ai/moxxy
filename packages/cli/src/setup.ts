import type { Session } from '@moxxy/core';
import {
  createAllowListResolver,
  createCallbackResolver,
  createLogger,
  defaultProjectSkillsDir,
  defaultUserSkillsDir,
  denyByDefaultResolver,
  discoverSkills,
  silentLogger,
} from '@moxxy/core';
import type { Plugin } from '@moxxy/sdk';
import {
  buildConfigPlugin,
  loadConfig as loadMergedConfig,
  loadDisabledProviders,
  loadPolicyBundles,
} from '@moxxy/config';
import { BUILTIN_SKILLS_DIR_RESOLVED } from './setup/builtin-skills-dir.js';
import { buildVaultPlugin } from '@moxxy/plugin-vault';
import type { MemoryStore } from '@moxxy/plugin-memory';
import {
  findCatalogEntryForContribution,
  installPluginPackagePinned,
} from '@moxxy/plugin-plugins-admin';
import { cliVersion } from './version.js';
import { buildSessionConfigApplier } from './config-applier.js';
import { resolveOsPrincipal } from '@moxxy/sdk/server';
import { loadRawConfig, resolveConfigPlaceholders } from './setup/load-config.js';
import { applyEgressSettings } from './setup/egress.js';
import { buildSecretResolver, vaultSecretProvider } from './setup/secrets.js';
import { interactiveConfigTrustPrompt } from './setup/config-trust-prompt.js';
import { selectEmbedder } from './setup/embedder.js';
import { buildSession } from './setup/build-session.js';
import { buildBuiltinsCore } from './setup/builtins.js';
import { buildSchedulerRunner } from './setup/scheduler-runner.js';
import { buildWebhookRunner } from './setup/webhook-runner.js';
import { registerPlugins } from './setup/register-plugins.js';
import { activateProvider } from './setup/activate-provider.js';
import { buildProviderSetupView } from './setup/provider-setup.js';
import {
  applyPluginsTree,
  assertCriticalFloors,
  markBuiltinFloors,
} from './setup/apply-plugins-tree.js';
import {
  disabledPackageNames,
  embedderSelection,
  providerItem,
} from './setup/resolve-plugins-tree.js';
import { applySessionHeaderPreferences } from './setup/session-header-preferences.js';
import { attachSessionPersistence } from './setup/persistence.js';
import { attachAudit } from './setup/audit.js';
import type { SetupOptions, SetupResult } from './setup/types.js';

export type { BootStep, SetupOptions, SetupResult } from './setup/types.js';

export async function setupSession(opts: SetupOptions): Promise<Session> {
  const result = await setupSessionWithConfig(opts);
  return result.session;
}

export async function setupSessionWithConfig(opts: SetupOptions): Promise<SetupResult> {
  const logger = opts.verbose ? createLogger({ minLevel: 'debug' }) : silentLogger;
  // No registry import step anymore: the runner writes each session's single
  // metadata file directly, and every surface derives its list from those.
  // When the TUI bootstrap path passes onProgress, it owns raw mode —
  // a vault/key prompt would deadlock. Force skipKeyPrompt to surface
  // missing-credential errors as a visible boot-failure row instead.
  const skipKeyPrompt = opts.skipKeyPrompt || opts.onProgress != null;
  const progress = opts.onProgress ?? ((): void => undefined);

  // Executable project configs need consent before they run. A probe or any
  // other non-interactive boot passes no prompt, and the loader then refuses to
  // execute rather than silently running unreviewed code.
  const { rawConfig, sources } = await loadRawConfig({
    cwd: opts.cwd,
    configPath: opts.configPath,
    skipUser: opts.skipUserConfig,
    trustPrompt: skipKeyPrompt ? undefined : interactiveConfigTrustPrompt(),
  });
  progress({ kind: 'config-loaded', sources: sources.length });

  // `requirePassphrase` comes from the RAW config: the vault is what resolves
  // `${vault:…}` placeholders, so it must exist before they can be resolved.
  const { plugin: vaultPlugin, vault } = buildVaultPlugin({
    disableKeytar: opts.disableKeytar,
    ...(rawConfig.vault?.requirePassphrase ? { requirePassphrase: true } : {}),
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

  // Re-resolve egress now that config is available. `bin.ts` already applied
  // the environment's proxy before any command ran; this second pass is what
  // lets a managed config pin (or forbid) a proxy the environment did not set.
  // A no-op when the resolution is unchanged, which is the common case.
  await applyEgressSettings(config);

  // Single source of truth for "is this package disabled?", seeded from the
  // merged config (project + user `plugins[name].enabled = false`). The
  // PluginHost reads it on every reload so a disabled plugin is never
  // resurrected; the config applier and the plugins-admin enable/disable tools
  // mutate it so a runtime toggle takes effect without a restart.
  const disabledPackages = new Set<string>(disabledPackageNames(config));

  // Late-bound so the resolver can consult the registry the session creates.
  let sessionRef: Session | undefined;
  const secretResolver = buildSecretResolver(() => sessionRef, vault, opts.cwd);

  // Loaded BEFORE the session so a machine that cannot obtain the policy it
  // subscribes to never reaches the point of running a turn. Throws
  // PolicyLoadError, which the caller reports rather than degrading past.
  const policy = await loadPolicyBundles(config.policy?.bundles ?? []);
  const systemManaged = sources.some((source) => source.scope === 'system');
  const governance =
    systemManaged || policy.sources.length > 0
      ? {
          managed: true as const,
          label: policy.sources[0]?.id ?? 'organization policy',
          ...(policy.sources.some((source) => source.staleReason) ? { stale: true } : {}),
        }
      : undefined;

  const session = await buildSession({
    cwd: opts.cwd,
    config,
    bundledRules: { allow: policy.allow, deny: policy.deny },
    ...(governance ? { governance } : {}),
    resolver: opts.resolver,
    resumeSessionId: opts.resumeSessionId,
    sessionId: opts.sessionId,
    logger,
    isPluginDisabled: (pkg) => disabledPackages.has(pkg),
    // Surface vault secrets to tool handlers as `ctx.getSecret(name)`. The
    // value never enters the model's context or `process.env` — only the
    // handler that asks receives it. `vault.get` lazily opens the vault and
    // returns null for unknown names.
    secretResolver,
  });
  sessionRef = session;

  // Register the vault as the protected FLOOR of the secret-provider registry.
  // Done here rather than in core because core never imports a plugin, and the
  // vault is one; making it the floor rather than a hardcoded special case lets
  // an external store sit above it without migrating every secret first.
  session.secretProviders.register(vaultSecretProvider(vault), { protected: true });

  // Attribute everything this session appends to the local OS account. It is
  // the FLOOR identity, worth exactly as much as local account separation,
  // which is why it is issued as `os` rather than dressed up as something
  // stronger. Set before any plugin registers or any hook fires, so no event
  // can be appended unattributed. A channel that actually authenticates its
  // users overrides it via `session.setPrincipal`.
  session.setPrincipal(resolveOsPrincipal());

  // Build the builtin list first WITHOUT the config plugin so we can pass the
  // whole list to the ConfigApplier (used for hot-toggle of plugin enable/disable).
  const schedulerRunner = buildSchedulerRunner(session);
  const webhookRunner = buildWebhookRunner(session);
  const { entries: builtinsCore, scheduler, webhooks, security } = buildBuiltinsCore({
    session,
    rawConfig,
    vault,
    vaultPlugin,
    schedulerRunner,
    webhookRunner,
    disabledPackages,
    logger,
  });

  // ONE applier instance shared by the config_set/config_reload tools AND the
  // session's configAdmin view (the TUI /settings panel) — both surfaces
  // live-apply through identical logic.
  const configApplier = buildSessionConfigApplier(session, config, builtinsCore, disabledPackages);

  const builtins: Array<{ name: string; plugin: Plugin }> = [
    ...builtinsCore,
    {
      name: '@moxxy/plugin-config',
      plugin: buildConfigPlugin({
        cwd: opts.cwd,
        applier: configApplier,
      }),
    },
  ];

  // Re-read + live-apply seam for UI surfaces. A RemoteSession leaves it
  // undefined; the /settings panel then reports "applies on restart".
  session.configAdmin = {
    apply: async () => {
      const { config: fresh } = await loadMergedConfig({ cwd: opts.cwd });
      return configApplier(fresh);
    },
  };

  let pluginRegistration = await registerPlugins(session, config, builtins, opts.cwd, logger);

  // Re-resolve `${vault:…}` now that plugins have registered, this time through
  // the session's resolver rather than the vault directly.
  //
  // The first pass above runs before any plugin exists, so it can only reach
  // the local vault. That made `${vault:KEY}` mean two different things: in
  // config it was always the local vault, while `ctx.getSecret` in a tool went
  // through whatever SecretProvider the machine had active. This second pass is
  // what makes the two uniform; on a machine with no external provider it
  // resolves identically and the extra pass is a no-op walk.
  const resolvedConfig = session.resolveSecret
    ? await resolveConfigPlaceholders(rawConfig, session.resolveSecret, logger)
    : config;

  // Compatibility migration for providers that used to ship inside the CLI.
  // If any configured provider is missing but advertises itself through a
  // provider-owned catalog manifest, install it into the normal user plugin
  // directory and reload before activation. This is generic for every catalog
  // provider (not a special case for the formerly bundled OAuth pair).
  const configuredProviders = [
    config.plugins?.provider?.default,
    ...(config.plugins?.provider?.fallbacks ?? []),
  ].filter((name): name is string => typeof name === 'string' && name.length > 0);
  for (const name of new Set(configuredProviders)) {
    if (session.providers.list().some((provider) => provider.name === name)) continue;
    const entry = findCatalogEntryForContribution('provider', name);
    if (!entry || config.plugins?.packages?.[entry.packageName]?.enabled === false) continue;
    logger.info('installing configured provider on first use', { provider: name, package: entry.packageName });
    await installPluginPackagePinned({
      packageName: entry.installSpec,
      ...(cliVersion() ? { cliVersion: cliVersion()! } : {}),
      onWarn: (message) => logger.warn(message),
    });
    await session.pluginHost.reload();
    pluginRegistration = {
      registered: new Set(session.pluginHost.list().map((plugin) => plugin.name)),
      skipped: session.pluginHost.listSkipped(),
    };
  }
  progress({
    kind: 'plugins-registered',
    count: pluginRegistration.registered.size,
    skipped: pluginRegistration.skipped.length,
  });

  // Kernel-plugin-contributed defaults (compactor/cacheStrategy/workflowExecutor)
  // are registered now — designate them protected floors so a swapped-then-
  // removed alternative reverts here instead of leaving the slot empty.
  markBuiltinFloors(session);

  // Every plugin (incl. discovered embedder plugins) is registered now — pick
  // the configured embedder onto session.embedders; memory reads it lazily.
  await selectEmbedder(session, embedderSelection(config), logger);

  // Bridge plugin-contributed isolators (from discovered `kind: 'isolator'`
  // plugins) into the security layer's registry, BEFORE its onInit wraps tools.
  // Opt-in only: registering an isolator never activates it — the user still
  // selects one by name via `security.isolator`, so a discovered isolator can't
  // silently become the sandbox boundary.
  for (const iso of session.isolators.list()) security.registry.register(iso);

  // Seed user-disabled providers (desktop Settings → Providers toggle) BEFORE
  // the activation walk so a disabled provider is never auto-activated. Read
  // from `plugins.provider.items.<name>.enabled: false` in the unified config.
  // The registry's disabled set is name-based, so seeding works regardless of
  // plugin registration order. Best-effort — never block boot.
  try {
    for (const name of await loadDisabledProviders()) {
      session.providers.setEnabled(name, false);
    }
  } catch {
    // best-effort — never block boot
  }

  const { credentialResolver } = await activateProvider({
    session,
    config: resolvedConfig,
    vault,
    providerConfig: {
      ...(providerItem(resolvedConfig).config ?? {}),
      ...(opts.providerConfig ?? {}),
    },
    skipKeyPrompt,
    skipProviderActivation: opts.skipProviderActivation,
    tolerateNoProvider: opts.tolerateNoProvider,
    onProgress: opts.onProgress,
    progress,
    logger,
  });

  // In-session provider onboarding (install / key entry / OAuth) — backs the
  // TUI's inline connect dialog and shares its implementation with the init
  // wizard. Attached after activation so readyProviders exists to mark into.
  session.providerSetup = buildProviderSetupView({ session, vault, config });

  // Apply the manifest's per-category defaults (mode/compactor/cacheStrategy/
  // workflowExecutor/synthesizer/viewRenderer/tunnelProvider) in one table-driven pass. A
  // default naming an uninstalled plugin warns and keeps the protected floor —
  // never throws at boot. provider/embedder/isolator are applied by their
  // bespoke callers above/below.
  applyPluginsTree(session, config, logger);
  // Fail loud if any non-nullable slot ended up empty (a broken build/seed) —
  // never let the user hit a half-initialized app.
  assertCriticalFloors(session);
  // The web-surface tunnel provider (localhost by default) is applied by the
  // web plugin's onInit from ~/.moxxy/web.json or config.channels.web.tunnel,
  // and auto-selected per primary channel by coAttachWebSurface — no env needed.

  // Elision is on by default (built-in defaults); config only needs to be
  // carried when the user customizes or disables it.
  if (config.context?.elision) session.elisionSettings = config.context.elision;
  if (config.context?.lazyTools) session.lazyTools = true;
  if (config.context?.loopGuard) session.loopGuard = config.context.loopGuard;

  // No separate preferences overlay anymore: the persisted provider/mode IS the
  // manifest default, already applied by activateProvider + applyPluginsTree
  // above. Only the per-session header (resumed session's own provider/model)
  // still overlays here.
  await applySessionHeaderPreferences(session, opts.sessionId, credentialResolver, logger);
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
  // Separate from persistence on purpose: the trail must survive an operator
  // turning session persistence off, and it records a different, smaller thing.
  const audit = attachAudit(session, config, policy.sources);

  // The memory plugin (when installed/enabled) published its store as the
  // 'memory' service during onInit; a slim boot without it leaves this
  // undefined and consumers (doctor) degrade.
  const memory = session.services.get<MemoryStore>('memory');

  return {
    session,
    config,
    configSources: sources,
    policySources: policy.sources,
    vault,
    memory,
    scheduler,
    webhooks,
    persistence,
    audit,
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
