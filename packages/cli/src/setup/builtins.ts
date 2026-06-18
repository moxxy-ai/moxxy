import { runTurn, type Session } from '@moxxy/core';
import { type Plugin } from '@moxxy/sdk';
import type { MoxxyConfig } from '@moxxy/config';
import { INSTALLABLE_PLUGIN_CATALOG } from '@moxxy/plugin-plugins-admin';
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
import type { MemoryStore } from '@moxxy/plugin-memory';
import type { WorkflowStore } from '@moxxy/plugin-workflows';
import {
  buildBuiltinEntries,
  type BuiltinEntry,
  type ViewSurfaceRef,
  type WebControlsRef,
} from './builtin-entries.js';
import { buildSetPluginEnabledLive } from './plugin-toggle.js';
import { buildWorkflowsIntegration } from './workflows.js';

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
  '@moxxy/plugin-provider-admin': { hardRequirements: false, reason: 'provider registry access is injected by bootstrap closure' },
  '@moxxy/tools-builtin': { hardRequirements: false, reason: 'core tool pack has no plugin dependency' },
  '@moxxy/mode-default': { hardRequirements: false, reason: 'default mode has no plugin dependency' },
  '@moxxy/mode-goal': { hardRequirements: false, reason: 'mode ships its own goal_complete/goal_abandon tools; no hard plugin dependency' },
  '@moxxy/mode-deep-research': { hardRequirements: false, reason: 'research mode needs @moxxy/plugin-subagents at runtime; surfaced as fatal error if absent' },
  '@moxxy/compactor-summarize': { hardRequirements: false, reason: 'compactor has no plugin dependency' },
  '@moxxy/cache-strategy-stable-prefix': { hardRequirements: false, reason: 'cache strategy has no plugin dependency' },
  '@moxxy/plugin-vault': { hardRequirements: false, reason: 'vault is the base secret store' },
  '@moxxy/plugin-stt-whisper': { hardRequirements: false, reason: 'generic Whisper backend; harmless without a configured provider' },
  '@moxxy/plugin-stt-whisper-codex': { hardRequirements: true, reason: 'requires Codex provider and OAuth readiness' },
  '@moxxy/plugin-memory': { hardRequirements: false, reason: 'memory store is created by bootstrap' },
  '@moxxy/memory-consolidate': { hardRequirements: true, reason: 'requires @moxxy/plugin-memory contributions' },
  '@moxxy/plugin-cli': { hardRequirements: false, reason: 'TUI channel is standalone' },
  '@moxxy/plugin-channel-http': { hardRequirements: false, reason: 'HTTP channel is standalone' },
  '@moxxy/plugin-channel-web': { hardRequirements: false, reason: 'web surface is standalone; token auto-generated' },
  '@moxxy/plugin-channel-mobile': { hardRequirements: false, reason: 'mobile WS bridge is standalone; token auto-generated' },
  '@moxxy/plugin-telegram': { hardRequirements: false, reason: 'vault is injected by bootstrap closure' },
  '@moxxy/plugin-browser': { hardRequirements: false, reason: 'browser runtime is diagnosed at tool/runtime level' },
  '@moxxy/plugin-terminal': { hardRequirements: false, reason: 'node-pty is optional; falls back to a piped shell' },
  '@moxxy/plugin-computer-control': { hardRequirements: false, reason: 'platform constraints are handled by tools' },
  '@moxxy/plugin-oauth': { hardRequirements: false, reason: 'vault is injected by bootstrap closure' },
  '@moxxy/plugin-commands': { hardRequirements: false, reason: 'slash commands have no plugin dependency' },
  '@moxxy/plugin-view': { hardRequirements: false, reason: 'view renderer is seeded by core; the tool defers to the active renderer via closure' },
  '@moxxy/plugin-subagents': { hardRequirements: false, reason: 'agent registry is injected by closure' },
  '@moxxy/plugin-plugins-admin': { hardRequirements: false, reason: 'plugin host access is injected by closure' },
  '@moxxy/plugin-self-update': { hardRequirements: false, reason: 'plugin host / log access is injected by closure' },
  '@moxxy/plugin-mcp-admin': { hardRequirements: false, reason: 'tool and skill registries are injected by closure' },
  '@moxxy/voice-admin': { hardRequirements: false, reason: 'synthesizer registry is injected by closure' },
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
  readonly memory: MemoryStore;
  readonly memoryPlugin: Plugin;
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
function wirePluginsAdminView(
  session: Session,
  disabledPackages: Set<string>,
  setPluginEnabledLive: (packageName: string, enabled: boolean) => Promise<void>,
): void {
  // The live disabled-set, the installable catalog, and the same plug/unplug
  // closure the model tools use. A RemoteSession leaves this undefined; the
  // picker guards.
  session.pluginsAdmin = {
    loaded: () =>
      session.pluginHost.list().map((p) => ({
        name: p.name,
        version: p.version,
        kinds: p.kinds,
      })),
    disabled: () => [...disabledPackages],
    catalog: () =>
      INSTALLABLE_PLUGIN_CATALOG.map((e) => ({
        id: e.id,
        label: e.label,
        packageName: e.packageName,
        installSpec: e.installSpec,
        ...(e.kind ? { kind: e.kind } : {}),
        ...(e.startCommand ? { startCommand: e.startCommand } : {}),
      })),
    setEnabled: setPluginEnabledLive,
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
  const { plugin, store, poller } = buildSchedulerPlugin({
    runner: schedulerRunner,
    skills: session.skills,
    logger,
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
  const { plugin, store, config, stop } = buildWebhooksPlugin({
    runner: webhookRunner,
    logger,
  });
  return { entry: { name: '@moxxy/plugin-webhooks', plugin }, store, config, stop };
}

/** Security plugin — always registered, no-op unless `security.enabled`. */
function buildSecuritySlice(
  session: Session,
  rawConfig: MoxxyConfig,
): { entry: BuiltinEntry; security: SecurityPluginHandle } {
  // Its onInit hook fires AFTER every other plugin has registered, so it sees
  // the fully-populated tool registry when wrapping declared-isolation tools.
  // Tools without an `isolation` declaration pass through untouched (unless
  // `security.requireDeclaration` is set).
  const security = buildSecurityPlugin({
    config: {
      enabled: rawConfig.security?.enabled ?? false,
      ...(rawConfig.security?.isolator ? { isolator: rawConfig.security.isolator } : {}),
      ...(rawConfig.security?.perTool ? { perTool: rawConfig.security.perTool } : {}),
      ...(rawConfig.security?.perPlugin ? { perPlugin: rawConfig.security.perPlugin } : {}),
      ...(rawConfig.security?.requireDeclaration !== undefined
        ? { requireDeclaration: rawConfig.security.requireDeclaration }
        : {}),
    },
    toolRegistry: session.tools,
    resolvePluginForTool: null,
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
  const { session, rawConfig, vault, vaultPlugin, memory, memoryPlugin, schedulerRunner, webhookRunner, disabledPackages, logger } = args;

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

  const entries: BuiltinEntry[] = buildBuiltinEntries({
    session,
    rawConfig,
    vault,
    vaultPlugin,
    memory,
    memoryPlugin,
    viewSurface,
    webControls,
    setPluginEnabledLive,
  });

  wirePluginsAdminView(session, disabledPackages, setPluginEnabledLive);

  const scheduler = buildSchedulerSlice(session, schedulerRunner, logger);
  entries.push(scheduler.entry);

  // Workflows — saved DAGs of skills/prompts/tools. Reuses the scheduler store
  // for time triggers (no new timer), the EventLog for afterWorkflow, and the
  // subagent spawner for step execution. Stashes a `WorkflowsView` on the
  // session (in onReady) backing the `/workflows` modal.
  const workflows = buildWorkflowsIntegration({ session, scheduleStore: scheduler.store, logger });
  entries.push({ name: '@moxxy/plugin-workflows', plugin: workflows.plugin });

  const webhooks = buildWebhooksSlice(webhookRunner, logger);
  entries.push(webhooks.entry);

  const security = buildSecuritySlice(session, rawConfig);
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
