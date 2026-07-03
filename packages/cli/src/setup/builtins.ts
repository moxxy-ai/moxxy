import { runTurn, type Session } from '@moxxy/core';
import { MoxxyError, isSelectableMode, type CategoryView, type Plugin } from '@moxxy/sdk';
import type { MoxxyConfig } from '@moxxy/config';
import {
  buildCapabilityReport,
  diffSnapshot,
  findCatalogEntryForContribution,
  INSTALLABLE_PLUGIN_CATALOG,
  applySetupValues,
  installPluginPackagePinned,
  packageNameFromSpec,
  readPluginSetup,
  resolveCatalogEntry,
  setCategoryDefault as persistCategoryDefault,
  setPluginEnabled as persistPluginEnabled,
} from '@moxxy/plugin-plugins-admin';
import {
  buildSchedulerPlugin,
  type SchedulerPoller,
  type ScheduleStore,
  type SchedulePromptRunner,
} from '@moxxy/plugin-scheduler';
import {
  buildWebhooksPlugin,
  type WebhookPromptRunner,
  type WebhookStore,
  type WebhookConfigStore,
} from '@moxxy/plugin-webhooks';
import {
  buildSecurityPlugin,
  type SecurityPluginHandle,
} from '@moxxy/plugin-security';
import { workerIsolator } from '@moxxy/isolator-worker';
import { subprocessIsolator } from '@moxxy/isolator-subprocess';
import { wasmIsolator } from '@moxxy/isolator-wasm';
import type { VaultStore } from '@moxxy/plugin-vault';
import type { WorkflowStore } from '@moxxy/plugin-workflows';
import {
  buildBuiltinEntries,
  type BuiltinEntry,
  type ViewSurfaceRef,
  type WebControlsRef,
} from './builtin-entries.js';
import { buildSetPluginEnabledLive } from './plugin-toggle.js';
import { CRITICAL_PACKAGES } from './critical-packages.js';
import { buildWorkflowsIntegration } from './workflows.js';
import { buildPluginSnapshot } from './plugin-snapshot.js';
import { cliVersion } from '../version.js';

// Re-exported so existing consumers (register-plugins.ts) keep importing the
// shape from here unchanged.
export type { BuiltinEntry };

export interface BuiltinRequirementDecision {
  readonly hardRequirements: boolean;
  readonly reason: string;
}

export const BUILTIN_REQUIREMENT_DECISIONS: Readonly<Record<string, BuiltinRequirementDecision>> = {
  '@moxxy/plugin-provider-anthropic': { hardRequirements: false, reason: 'provider is independently activatable' },
  '@moxxy/plugin-provider-openai': { hardRequirements: false, reason: 'provider is independently activatable' },
  '@moxxy/plugin-provider-openai-codex': { hardRequirements: false, reason: 'provider owns its OAuth flow' },
  '@moxxy/plugin-provider-claude-code': { hardRequirements: false, reason: 'provider owns its OAuth flow' },
  '@moxxy/plugin-provider-zai': { hardRequirements: false, reason: 'provider is independently activatable' },
  '@moxxy/plugin-provider-xai': { hardRequirements: false, reason: 'provider is independently activatable' },
  '@moxxy/plugin-provider-google': { hardRequirements: false, reason: 'provider is independently activatable' },
  '@moxxy/plugin-provider-local': { hardRequirements: false, reason: 'local provider needs no credentials; activatable without setup' },
  '@moxxy/tools-builtin': { hardRequirements: false, reason: 'core tool pack has no plugin dependency' },
  '@moxxy/mode-default': { hardRequirements: false, reason: 'default mode has no plugin dependency' },
  '@moxxy/mode-goal': { hardRequirements: false, reason: 'mode ships its own goal_complete/goal_abandon tools; no hard plugin dependency' },
  '@moxxy/mode-deep-research': { hardRequirements: false, reason: 'research mode needs @moxxy/plugin-subagents at runtime; surfaced as fatal error if absent' },
  '@moxxy/mode-collaborative': { hardRequirements: false, reason: 'coordinator spawns separate agent processes; needs @moxxy/plugin-collab at runtime, surfaced if absent' },
  '@moxxy/plugin-collab': { hardRequirements: false, reason: 'collaboration hub + tools; inert outside a collaboration' },
  '@moxxy/compactor-summarize': { hardRequirements: false, reason: 'compactor has no plugin dependency' },
  '@moxxy/cache-strategy-stable-prefix': { hardRequirements: false, reason: 'cache strategy has no plugin dependency' },
  '@moxxy/plugin-vault': { hardRequirements: false, reason: 'vault is the base secret store' },
  '@moxxy/plugin-cli': { hardRequirements: false, reason: 'TUI channel is standalone' },
  '@moxxy/plugin-channel-http': { hardRequirements: false, reason: 'HTTP channel is standalone' },
  '@moxxy/plugin-channel-mobile': { hardRequirements: false, reason: 'mobile WS bridge is standalone; token auto-generated' },
  '@moxxy/plugin-computer-control': { hardRequirements: false, reason: 'platform constraints are handled by tools' },
  '@moxxy/plugin-oauth': { hardRequirements: false, reason: 'vault is injected by bootstrap closure' },
  '@moxxy/plugin-commands': { hardRequirements: false, reason: 'slash commands have no plugin dependency' },
  '@moxxy/plugin-subagents': { hardRequirements: false, reason: 'agent registry is injected by closure' },
  '@moxxy/plugin-plugins-admin': { hardRequirements: false, reason: 'plugin host access is injected by closure' },
  '@moxxy/synthesize-skill': { hardRequirements: false, reason: 'session access is injected by closure' },
  '@moxxy/plugin-scheduler': { hardRequirements: false, reason: 'runner and skills registry are injected by closure' },
  '@moxxy/plugin-webhooks': { hardRequirements: false, reason: 'runner is injected by closure' },
  '@moxxy/plugin-workflows': { hardRequirements: false, reason: 'store, runner, and registries are injected by closure' },
  '@moxxy/plugin-security': { hardRequirements: false, reason: 'disabled by default and configured at runtime' },
  '@moxxy/plugin-config': { hardRequirements: false, reason: 'config applier is injected by bootstrap closure' },
  '@moxxy/plugin-usage-stats': { hardRequirements: false, reason: 'records usage via lifecycle hooks; no plugin dependency' },
};

export interface BuildBuiltinsArgs {
  readonly session: Session;
  readonly rawConfig: MoxxyConfig;
  readonly vault: VaultStore;
  readonly vaultPlugin: Plugin;
  readonly schedulerRunner: SchedulePromptRunner;
  readonly webhookRunner: WebhookPromptRunner;
  /**
   * Live disabled-package set shared with the PluginHost predicate and the
   * config applier; the plugins-admin enable/disable tools mutate it so a
   * runtime toggle survives the subsequent hot-reload.
   */
  readonly disabledPackages: Set<string>;
  readonly logger: { warn(msg: string, meta?: Record<string, unknown>): void };
}

export interface BuiltBuiltinsCore {
  readonly entries: ReadonlyArray<BuiltinEntry>;
  readonly scheduler: { readonly store: ScheduleStore; readonly poller: SchedulerPoller };
  readonly webhooks: {
    readonly store: WebhookStore;
    readonly config: WebhookConfigStore;
    readonly stop: () => Promise<void>;
  };
  readonly security: SecurityPluginHandle;
  readonly workflows: { readonly store: WorkflowStore; readonly stop: () => void };
}

/** Wire the plugin-management slice that backs the TUI `/plugins` picker. */
/** Minimal active-def surface a category registry exposes for the swap UI. */
interface CategoryRegistryLike {
  // `special?` lets the mode registry's special-mode marker flow through to the
  // swap UI filter (isSelectableMode); non-mode defs simply omit it.
  list(): ReadonlyArray<{ name: string; special?: unknown }>;
  getActiveName(): string | null;
  getFloorName?(): string | null;
  setActive(name: string): unknown;
}

/**
 * The registries the category swap surface reads. `isolator`/`channel` are
 * persist-only (their active isn't a live session registry slot) and apply on
 * the next boot, so they're not in this live table.
 */
const CATEGORY_REGISTRIES: ReadonlyArray<{
  category: string;
  reg: (s: Session) => CategoryRegistryLike | undefined;
}> = [
  { category: 'provider', reg: (s) => s.providers },
  { category: 'mode', reg: (s) => s.modes },
  { category: 'compactor', reg: (s) => s.compactors },
  { category: 'cacheStrategy', reg: (s) => s.cacheStrategies },
  { category: 'workflowExecutor', reg: (s) => s.workflowExecutors },
  { category: 'transcriber', reg: (s) => s.transcribers },
  { category: 'synthesizer', reg: (s) => s.synthesizers },
  { category: 'embedder', reg: (s) => s.embedders },
  { category: 'viewRenderer', reg: (s) => s.viewRenderers },
  { category: 'tunnelProvider', reg: (s) => s.tunnelProviders },
  { category: 'eventStore', reg: (s) => s.eventStores },
  { category: 'reflector', reg: (s) => s.reflectors },
];

function buildCategoryViews(session: Session): ReadonlyArray<CategoryView> {
  const out: CategoryView[] = [];
  for (const { category, reg } of CATEGORY_REGISTRIES) {
    const r = reg(session);
    if (!r) continue;
    const active = r.getActiveName();
    out.push({
      category,
      active,
      floor: r.getFloorName?.() ?? null,
      // Special modes (e.g. the collaborative system) are not swap-default
      // targets — drop them from the swap axis. Harmless for non-mode kinds
      // (their defs carry no `special`).
      items: r.list().filter(isSelectableMode).map((d) => ({ name: d.name, isDefault: d.name === active })),
    });
  }
  return out;
}

/** Live snapshot + swap of category defaults. Backs both the `set_default`/
 *  `list_defaults` model tools and the TUI `/plugins` category tabs. */
export interface CategoryDefaultLive {
  categories: () => ReadonlyArray<CategoryView>;
  setCategoryDefault: (category: string, name: string) => Promise<void>;
}

export function buildCategoryDefaultLive(session: Session): CategoryDefaultLive {
  return {
    categories: () => buildCategoryViews(session),
    setCategoryDefault: async (category, name) => {
      const entry = CATEGORY_REGISTRIES.find((c) => c.category === category);
      const reg = entry?.reg(session);
      // For a LIVE category, the name must be registered; persist-only kinds
      // (isolator/channel) are validated against the registry on the next boot.
      if (reg && !reg.list().some((d) => d.name === name)) {
        // When the catalog knows which package provides it, surface a typed
        // install affordance instead of a generic error — the TUI turns this
        // into an "install now?" confirm and the model tool gets the package.
        const provider = findCatalogEntryForContribution(category, name);
        if (provider) {
          throw new MoxxyError({
            code: 'PLUGIN_NOT_INSTALLED',
            message: `${category} '${name}' is not installed.`,
            hint: `Install ${provider.packageName} (install_plugin, or \`moxxy plugins install ${provider.id}\`), then retry.`,
            context: { category, contribution: name, package: provider.packageName },
          });
        }
        throw new MoxxyError({
          code: 'TOOL_ERROR',
          message: `${category} '${name}' is not registered.`,
          hint: 'Run list_defaults to see available options, or install a plugin that provides it.',
          context: { category, name },
        });
      }
      // Apply live where we can (provider needs credential resolution); a live
      // failure is non-fatal — the persisted default takes effect next boot.
      try {
        if (category === 'provider') {
          const cfg = session.credentialResolver ? await session.credentialResolver(name) : {};
          session.providers.setActive(name, cfg);
        } else if (reg) {
          reg.setActive(name);
        }
      } catch {
        // persist anyway; the default applies on the next boot
      }
      await persistCategoryDefault(category, name);
    },
  };
}

function wirePluginsAdminView(
  session: Session,
  disabledPackages: Set<string>,
  setPluginEnabledLive: (packageName: string, enabled: boolean) => Promise<void>,
  categoryLive: CategoryDefaultLive,
  logger: BuildBuiltinsArgs['logger'],
  vault: BuildBuiltinsArgs['vault'],
): void {
  // The live disabled-set, the installable catalog, and the same plug/unplug +
  // swap-default closures the model tools use. A RemoteSession leaves this
  // undefined; the picker guards.
  session.pluginsAdmin = {
    loaded: () =>
      session.pluginHost.list().map((p) => ({
        name: p.name,
        version: p.version,
        kinds: p.kinds,
        installed: p.installed,
      })),
    disabled: () => [...disabledPackages],
    protectedPackages: () => [...CRITICAL_PACKAGES],
    catalog: () =>
      INSTALLABLE_PLUGIN_CATALOG.map((e) => ({
        id: e.id,
        label: e.label,
        packageName: e.packageName,
        installSpec: e.installSpec,
        ...(e.kind ? { kind: e.kind } : {}),
        ...(e.startCommand ? { startCommand: e.startCommand } : {}),
        ...(e.provides ? { provides: e.provides } : {}),
      })),
    setEnabled: setPluginEnabledLive,
    categories: categoryLive.categories,
    setCategoryDefault: categoryLive.setCategoryDefault,
    // Real install from the picker: npm into ~/.moxxy/plugins (pinned to the
    // CLI version for first-party packages, 404 → retry latest), persist the
    // enable, hot-reload, and report which contributions arrived. Same
    // building blocks as the install_plugin model tool.
    install: async (idOrSpec) => {
      const entry = resolveCatalogEntry(idOrSpec);
      const spec = entry?.installSpec ?? idOrSpec;
      // Package name is derivable pre-install for catalog/npm specs but not
      // for git/path specs (the enable write is skipped — absent means
      // enabled anyway).
      const packageName = entry?.packageName ?? packageNameFromSpec(spec);
      const before = buildPluginSnapshot(session);
      const { installed } = await installPluginPackagePinned({
        packageName: spec,
        ...(cliVersion() ? { cliVersion: cliVersion()! } : {}),
        onWarn: (msg) => logger.warn(msg),
      });
      if (packageName) await persistPluginEnabled(packageName, true);
      await session.pluginHost.reload();
      const setup = packageName ? await readPluginSetup(packageName) : null;
      const registered = diffSnapshot(before, buildPluginSnapshot(session));
      // The just-registered tools' combined capability surface — what the
      // TUI renders for post-install consent (third-party) or as an info
      // line (first-party). Same helper the install_plugin model tool uses.
      const capabilities = buildCapabilityReport(
        registered.tools ?? [],
        (name) => session.tools.get(name)?.isolation,
      );
      return {
        installed,
        registered,
        ...(capabilities ? { capabilities } : {}),
        ...(setup
          ? { needsSetup: { title: setup.title, required: setup.required === true } }
          : {}),
      };
    },
    // Declarative setup step (moxxy.setup) — plain data for any renderer.
    setupSpec: (packageName) => readPluginSetup(packageName),
    // Persist collected values through the ONE shared writer (secrets → vault
    // + ${vault:NAME} ref); completeness drives enable/disable exactly like
    // the init wizard, so /setup can also RE-ENABLE a package a skipped
    // required setup left disabled.
    applySetup: async (packageName, values) => {
      const setup = await readPluginSetup(packageName);
      if (!setup) return { complete: true, missing: [] };
      const result = await applySetupValues({
        vault,
        cwd: process.cwd(),
        packageName,
        setup,
        values,
      });
      if (setup.required === true) {
        await persistPluginEnabled(packageName, result.complete);
        if (result.complete) await session.pluginHost.reload();
      }
      return result;
    },
  };
}

/** Scheduler — fires recurring/one-shot prompts at user-defined times. */
function buildSchedulerSlice(
  session: Session,
  schedulerRunner: SchedulePromptRunner,
  logger: BuildBuiltinsArgs['logger'],
): { entry: BuiltinEntry; store: ScheduleStore; poller: SchedulerPoller } {
  // The runner reuses the active session for v1; scheduled prompts appear in
  // conversation history so the user sees what fired. An isolated child-session
  // runner is the obvious follow-up to avoid context pollution.
  //
  // ownerSessionId binds schedules created here to THIS runner so a multi-runner
  // desktop (one `moxxy serve` per workspace, all polling the same shared
  // schedules.json) fires each schedule on the workspace that created it — not
  // whichever poller ticks first. The desktop sets MOXXY_SESSION_ID to the desk
  // id; a single-process CLI/TUI leaves it unset (schedules stay owner-less and
  // fire-once via the cross-process lock).
  const ownerSessionId = process.env.MOXXY_SESSION_ID?.trim() || undefined;
  const { plugin, store, poller } = buildSchedulerPlugin({
    runner: schedulerRunner,
    skills: session.skills,
    logger,
    ...(ownerSessionId ? { ownerSessionId } : {}),
  });
  return { entry: { name: '@moxxy/plugin-scheduler', plugin }, store, poller };
}

/** Webhooks — generic external-event triggers on their own port. */
function buildWebhooksSlice(
  webhookRunner: WebhookPromptRunner,
  logger: BuildBuiltinsArgs['logger'],
): {
  entry: BuiltinEntry;
  store: WebhookStore;
  config: WebhookConfigStore;
  stop: () => Promise<void>;
} {
  // Listens on its own port (default 3738) and dispatches verified deliveries
  // to runTurn via the supplied runner. Agent-facing tools (webhook_create,
  // webhook_tunnel_start, webhook_setup_guide, …) let a non-technical user walk
  // through tunnel + provider setup in conversation.
  //
  // ownerSessionId binds triggers created here to THIS runner. With several
  // runners (one `moxxy serve` per desktop workspace), only one wins the shared
  // listener port, so it receives every delivery and hands off the ones owned by
  // other runners through the shared queue; each runner drains and fires its own.
  // The desktop sets MOXXY_SESSION_ID per workspace; a single-process CLI/TUI
  // leaves it unset and fires every delivery in-process (no queue/drain).
  const ownerSessionId = process.env.MOXXY_SESSION_ID?.trim() || undefined;
  const { plugin, store, config, stop } = buildWebhooksPlugin({
    runner: webhookRunner,
    logger,
    ...(ownerSessionId ? { ownerSessionId } : {}),
  });
  return { entry: { name: '@moxxy/plugin-webhooks', plugin }, store, config, stop };
}

/** Security plugin — always registered, no-op unless `security.enabled`. */
function buildSecuritySlice(
  session: Session,
  rawConfig: MoxxyConfig,
  logger: BuildBuiltinsArgs['logger'],
): { entry: BuiltinEntry; security: SecurityPluginHandle } {
  // Its onInit hook fires AFTER every other plugin has registered, so it sees
  // the fully-populated tool registry when wrapping declared-isolation tools.
  // Tools without an `isolation` declaration pass through untouched (unless
  // `security.requireDeclaration` is set, or — for third-party packages —
  // `security.thirdPartyRequireDeclaration` warns/denies).
  const security = buildSecurityPlugin({
    config: {
      enabled: rawConfig.security?.enabled ?? false,
      // The default isolator now lives in the unified tree at
      // `plugins.isolator.default` (a registry kind like any other).
      ...(rawConfig.plugins?.isolator?.default
        ? { isolator: rawConfig.plugins.isolator.default }
        : {}),
      ...(rawConfig.security?.perTool ? { perTool: rawConfig.security.perTool } : {}),
      ...(rawConfig.security?.perPlugin ? { perPlugin: rawConfig.security.perPlugin } : {}),
      ...(rawConfig.security?.requireDeclaration !== undefined
        ? { requireDeclaration: rawConfig.security.requireDeclaration }
        : {}),
      ...(rawConfig.security?.thirdPartyRequireDeclaration !== undefined
        ? { thirdPartyRequireDeclaration: rawConfig.security.thirdPartyRequireDeclaration }
        : {}),
    },
    toolRegistry: session.tools,
    // Sink for the third-party grace-mode warnings; the hook context carries
    // no logger, so the plugin needs the host's.
    logger,
    // Tool → contributing-plugin attribution from the plugin host's loaded
    // records. Called lazily (post-boot), so the registries are populated by
    // the time the security plugin or an audit view asks. This is what makes
    // `security.perPlugin` overrides and `security audit --package` work.
    resolvePluginForTool: (toolName) => session.pluginHost.ownerOfTool?.(toolName),
    // Register the worker_threads isolator so users can opt in via
    // `security: { isolator: 'worker' }`. It coexists with the built-in
    // `none` + `inproc` isolators; unused isolators have no runtime cost.
    isolators: [workerIsolator, subprocessIsolator, wasmIsolator],
  });
  return { entry: { name: '@moxxy/plugin-security', plugin: security.plugin }, security };
}

/**
 * Assemble the static builtin plugin list (everything except the
 * config plugin, which needs the rest as input). The returned `scheduler`
 * handle is surfaced upstream so the `moxxy schedule …` subcommands
 * can drive the store/poller without going through a model turn.
 */
export function buildBuiltinsCore(args: BuildBuiltinsArgs): BuiltBuiltinsCore {
  const { session, rawConfig, vault, vaultPlugin, schedulerRunner, webhookRunner, disabledPackages, logger } = args;

  // Shared handle linking the web surface to present_view: the web channel
  // publishes its live URL + view-id minter here on start; the view tool reads
  // it so it can return the public URL for the agent to relay on any channel.
  const viewSurface: ViewSurfaceRef = { current: null };
  // Live web-surface controls (set when the surface starts) so the web_set_tunnel
  // tool can switch the tunnel without a restart.
  const webControls: WebControlsRef = { current: null };

  // Plug/unplug a plugin from the live session AND persist it. Backs both the
  // model tools and the TUI `/plugins` picker. Resolves `entries` lazily (it is
  // defined below) so the `entries.find` lookup is safe at call time.
  const setPluginEnabledLive = buildSetPluginEnabledLive({
    session,
    disabledPackages,
    getEntries: () => entries,
  });

  // Live snapshot + swap of category defaults — same closures the model tools
  // and the TUI category tabs share.
  const categoryLive = buildCategoryDefaultLive(session);

  const entries: BuiltinEntry[] = buildBuiltinEntries({
    session,
    rawConfig,
    vault,
    vaultPlugin,
    viewSurface,
    webControls,
    setPluginEnabledLive,
    categoryLive,
  });

  wirePluginsAdminView(session, disabledPackages, setPluginEnabledLive, categoryLive, logger, vault);

  const scheduler = buildSchedulerSlice(session, schedulerRunner, logger);
  entries.push(scheduler.entry);

  // Workflows — saved DAGs of skills/prompts/tools. Reuses the scheduler store
  // for time triggers (no new timer), the EventLog for afterWorkflow, and the
  // subagent spawner for step execution. Stashes a `WorkflowsView` on the
  // session (in onReady) backing the `/workflows` modal.
  const workflows = buildWorkflowsIntegration({
    session,
    scheduleStore: scheduler.store,
    // Multi-runner desktops set MOXXY_SESSION_ID per workspace; pass it so
    // fileChanged triggers fire once across runners (not once per runner).
    ...(process.env.MOXXY_SESSION_ID?.trim()
      ? { ownerSessionId: process.env.MOXXY_SESSION_ID.trim() }
      : {}),
    logger,
  });
  entries.push({ name: '@moxxy/plugin-workflows', plugin: workflows.plugin });

  const webhooks = buildWebhooksSlice(webhookRunner, logger);
  entries.push(webhooks.entry);

  const security = buildSecuritySlice(session, rawConfig, logger);
  entries.push(security.entry);

  return {
    entries,
    scheduler: { store: scheduler.store, poller: scheduler.poller },
    webhooks: { store: webhooks.store, config: webhooks.config, stop: webhooks.stop },
    security: security.security,
    workflows: { store: workflows.store, stop: workflows.stop },
  };
}

// runTurn is re-exported so scheduler-runner.ts and any other consumer
// can share the same dependency surface as the builtins.
export { runTurn };
