import type {
  AppContext,
  ClientSession,
  EmittedEvent,
  LoopGuardSettings,
  MoxxyEvent,
  RunTurnOptions,
  SessionId,
  SessionInfo,
} from '@moxxy/sdk';
import { newSessionId, newTurnId } from './events/factory.js';
import { runTurn as runTurnImpl } from './run-turn.js';
import type { SessionRuntime } from './session-runtime.js';
import { EventLog } from './events/log.js';
import { HookDispatcherImpl } from './plugins/lifecycle.js';
import { PluginHost, type PluginLoader } from './plugins/host.js';
import { ProviderRegistry } from './registries/providers.js';
import { ModeRegistry } from './registries/modes.js';
import { CacheStrategyRegistry } from './registries/cache-strategies.js';
import { ViewRendererRegistry } from './registries/view-renderers.js';
import { defaultViewRenderer } from './view/default-renderer.js';
import { TunnelProviderRegistry } from './registries/tunnel-providers.js';
import { localhostTunnel } from './tunnel/localhost.js';
import { CompactorRegistry } from './registries/compactors.js';
import { ChannelRegistryImpl } from './registries/channels.js';
import { SurfaceRegistryImpl } from './registries/surfaces.js';
import { SurfaceHostImpl } from './surfaces/host.js';
import { SkillRegistryImpl } from './registries/skills.js';
import { ToolRegistryImpl, type ToolRegistry } from './registries/tools.js';
import { AgentRegistry } from './registries/agents.js';
import { CommandRegistry } from './registries/commands.js';
import { TranscriberRegistry } from './registries/transcribers.js';
import { SynthesizerRegistry } from './registries/synthesizers.js';
import { EmbedderRegistry } from './registries/embedders.js';
import { IsolatorRegistry } from './registries/isolators.js';
import { WorkflowExecutorRegistry } from './registries/workflow-executors.js';
import { EventStoreRegistry } from './registries/event-stores.js';
import { ServiceRegistryImpl } from './registries/services.js';
import { jsonlEventStore } from './sessions/jsonl-event-store.js';
import { RequirementRegistry } from './requirements.js';
import { PermissionEngine } from './permissions/engine.js';
import { autoAllowResolver } from './permissions/resolvers.js';
import { evaluateToolRule } from '@moxxy/sdk';
import type {
  ApprovalResolver,
  CredentialResolver,
  ElisionSettings,
  McpAdminView,
  ProviderAdminView,
  WorkflowsView,
  PluginsAdminView,
  PendingToolCall,
  PermissionContext,
  PermissionDecision,
  PermissionResolver,
  PermissionRule,
} from '@moxxy/sdk';
import { createLogger, silentLogger, type Logger } from './logger.js';
import { clearRetainedChildren } from './subagents/registry.js';

export interface SessionOptions {
  readonly cwd: string;
  readonly logger?: Logger;
  readonly sessionId?: SessionId;
  readonly permissionEngine?: PermissionEngine;
  readonly permissionResolver?: PermissionResolver;
  readonly hookTimeoutMs?: number;
  readonly silent?: boolean;
  /**
   * Optional plugin loader. When provided, `session.pluginHost.discoverAndLoad()`
   * can dynamic-import discovered plugins; without one, only static plugins
   * registered via `registerStatic()` are wired up.
   */
  readonly pluginLoader?: PluginLoader;
  /**
   * Extra directories to scan for plugins, on top of the cwd-rooted
   * `node_modules` walk. The CLI sets this to `~/.moxxy/plugins` (and its
   * `node_modules` subtree) so runtime-installed / scaffolded plugins are
   * discoverable. Crucially these are remembered by the host and reused on
   * `pluginHost.reload()`, so a hot-reload neither drops user plugins nor
   * fails to pick up freshly written ones.
   */
  readonly pluginDiscoveryPaths?: ReadonlyArray<string>;
  /**
   * Predicate (by package name) for whether a discovered plugin is disabled.
   * Forwarded to the PluginHost so `pluginHost.reload()` never resurrects a
   * plugin the user turned off via config `plugins[name].enabled = false`.
   * Reads live state, so a runtime enable/disable applies on the next reload.
   */
  readonly isPluginDisabled?: (packageName: string) => boolean;
  /**
   * Vault-backed secret resolver. When provided, every tool handler gets
   * `ctx.getSecret(name)` so plugins can read an API key / token at call
   * time. The plaintext never enters the model's context or `process.env`;
   * only the handler that asks receives it. The CLI/runner wires this to
   * the session vault's `get`.
   */
  readonly secretResolver?: (name: string) => Promise<string | null>;
  /**
   * Pre-seeded event log. Used by `moxxy resume` to restore the
   * conversation from a persisted JSONL. Subscribers don't re-fire for
   * seeded events (the constructor pushes them directly), so plugin
   * hooks won't run for historical entries.
   */
  readonly log?: EventLog;
}

export class Session implements ClientSession, SessionRuntime {
  readonly id: SessionId;
  readonly cwd: string;
  readonly log: EventLog;
  readonly logger: Logger;
  readonly tools: ToolRegistry;
  readonly providers: ProviderRegistry;
  readonly modes: ModeRegistry;
  readonly compactors: CompactorRegistry;
  readonly cacheStrategies: CacheStrategyRegistry;
  readonly viewRenderers: ViewRendererRegistry;
  readonly tunnelProviders: TunnelProviderRegistry;
  readonly channels: ChannelRegistryImpl;
  /** Registry of surface defs (terminal, browser, …) contributed by plugins. */
  readonly surfaceRegistry: SurfaceRegistryImpl;
  /**
   * Manages the live, open surface instances for this session. The runner
   * drives it for thin clients; the agent's tools reach the same resources via
   * plugin module state. See {@link SurfaceHostImpl}.
   */
  readonly surfaces: SurfaceHostImpl;
  readonly skills: SkillRegistryImpl;
  readonly agents: AgentRegistry;
  readonly commands: CommandRegistry;
  readonly transcribers: TranscriberRegistry;
  readonly synthesizers: SynthesizerRegistry;
  readonly embedders: EmbedderRegistry;
  readonly isolators: IsolatorRegistry;
  readonly workflowExecutors: WorkflowExecutorRegistry;
  readonly eventStores: EventStoreRegistry;
  /** Inter-plugin service registry — plugins publish/consume services in onInit. */
  readonly services: ServiceRegistryImpl;
  readonly requirements: RequirementRegistry;
  readonly permissions: PermissionEngine;
  /** Current PermissionResolver. Update via `setPermissionResolver(r)`. */
  resolver: PermissionResolver;
  /**
   * Optional generic approval resolver. Loop strategies use this to ask
   * the user a checkpoint question (plan validation, command preview,
   * diff review, etc.). Null when running headless or before the TUI
   * registers one — strategies that have no resolver simply skip the
   * approval step.
   */
  approvalResolver: ApprovalResolver | null = null;
  /**
   * Elision (context-on-demand) settings, resolved from `config.context.elision`
   * at setup and updated on config reload. Null → built-in defaults apply
   * (elision on). Read into each turn's ModeContext.
   */
  elisionSettings: ElisionSettings | null = null;
  /** Lazy tool loading toggle, from `config.context.lazyTools`. Default off. */
  lazyTools = false;
  /**
   * Reasoning/thinking preference, from `config.context.reasoning`. Forwarded
   * to each turn's ModeContext and on to the provider, which honors it only
   * when the active model advertises `supportsReasoning`. Undefined → off.
   */
  reasoning: { readonly effort?: 'low' | 'medium' | 'high' } | boolean | undefined = undefined;
  /**
   * Stuck-loop guard tuning, from `config.context.loopGuard`. Forwarded to each
   * turn's ModeContext and on to the mode's stuck-loop detector. Undefined →
   * the detector's defaults.
   */
  loopGuard: LoopGuardSettings | undefined = undefined;
  /**
   * Model id resolved by the most recent `runTurn()` (see SessionRuntime).
   * Last-writer-wins for concurrent turns; null until the first turn runs.
   */
  lastResolvedModel: string | null = null;
  /**
   * Live runtime capabilities the host installs on a local Session (see
   * SessionLike). A RemoteSession leaves them undefined. Declared here — rather
   * than monkey-patched on via `as unknown as` — so the host and channels get
   * type-checked access.
   */
  readyProviders?: Set<string>;
  credentialResolver?: CredentialResolver;
  workflows?: WorkflowsView;
  pluginsAdmin?: PluginsAdminView;
  readonly dispatcher: HookDispatcherImpl;
  readonly pluginHost: PluginHost;
  private readonly controller = new AbortController();

  constructor(opts: SessionOptions) {
    this.id = opts.sessionId ?? newSessionId();
    this.cwd = opts.cwd;
    this.logger = opts.logger ?? (opts.silent ? silentLogger : createLogger());
    this.log = opts.log ?? new EventLog();
    this.tools = new ToolRegistryImpl({
      logger: this.logger,
      cwd: this.cwd,
      ...(opts.secretResolver ? { secretResolver: opts.secretResolver } : {}),
    });
    this.providers = new ProviderRegistry();
    this.modes = new ModeRegistry();
    this.compactors = new CompactorRegistry();
    this.cacheStrategies = new CacheStrategyRegistry();
    this.viewRenderers = new ViewRendererRegistry();
    // Seed the built-in renderer as the protected floor so `present_view`
    // always has one to parse with; plugins can register/replace and
    // `setActive` an alternative, but it can never be removed (reverts here).
    this.viewRenderers.register(defaultViewRenderer, { protected: true });
    this.tunnelProviders = new TunnelProviderRegistry();
    // Seed the no-op localhost provider as the protected floor so the web
    // surface always resolves a URL; plugins (the proxy relay) register/
    // setActive a real tunnel, reverting here if it's removed.
    this.tunnelProviders.register(localhostTunnel, { protected: true });
    this.channels = new ChannelRegistryImpl();
    this.surfaceRegistry = new SurfaceRegistryImpl();
    this.surfaces = new SurfaceHostImpl(this.surfaceRegistry, { cwd: this.cwd, logger: this.logger }, this.logger);
    this.skills = new SkillRegistryImpl();
    this.agents = new AgentRegistry();
    this.commands = new CommandRegistry();
    this.transcribers = new TranscriberRegistry();
    this.synthesizers = new SynthesizerRegistry({
      ...(opts.secretResolver ? { secretResolver: opts.secretResolver } : {}),
    });
    this.embedders = new EmbedderRegistry();
    this.isolators = new IsolatorRegistry();
    this.workflowExecutors = new WorkflowExecutorRegistry();
    this.services = new ServiceRegistryImpl();
    // Publish the core registries on the inter-plugin service registry under
    // well-known names, so a discovery-loaded plugin can resolve one in its
    // onInit (typed as the SDK's minimal NamedRegistry) instead of being
    // hand-built with a `() => session.<registry>` closure. The registry
    // objects are stable; their contents grow as plugins register — consumers
    // read them lazily at tool-call time, after all registration has run.
    this.services.register('agents', this.agents);
    this.services.register('tools', this.tools);
    this.services.register('providers', this.providers);
    this.services.register('viewRenderers', this.viewRenderers);
    this.services.register('synthesizers', this.synthesizers);
    this.services.register('skills', this.skills);
    this.services.register('tunnelProviders', this.tunnelProviders);
    // A stable accessor for the active provider's stored credentials. The
    // resolver itself is installed late (by activateProvider, after plugins are
    // built), so close over `this` and read it lazily at call time — lets
    // provider-admin rebuild a reconfigured provider's instance without a
    // host-injected `resolveActiveConfig` closure.
    this.services.register(
      'resolveCredentials',
      (name: string): Promise<Record<string, unknown>> | Record<string, unknown> =>
        this.credentialResolver ? this.credentialResolver(name) : {},
    );
    // A live registry-name snapshot (per kind) + a writable event-append fn, for
    // plugins (self-update) that need them in onInit without a host closure.
    // appendEvent is the writable counterpart to the read-only `ctx.log`.
    this.services.register('registrySnapshot', () => ({
      tools: this.tools.list().map((t) => t.name),
      agents: this.agents.list().map((a) => a.name),
      providers: this.providers.list().map((p) => p.name),
      modes: this.modes.list().map((m) => m.name),
      compactors: this.compactors.list().map((c) => c.name),
      channels: this.channels.list().map((c) => c.name),
    }));
    this.services.register(
      'appendEvent',
      (event: EmittedEvent): Promise<void> => this.log.append(event).then(() => undefined),
    );
    this.eventStores = new EventStoreRegistry();
    // Seed the built-in JSONL store as the protected floor — the storage backend
    // behind the event log always exists and can be swapped but never removed.
    this.eventStores.register(jsonlEventStore, { protected: true });
    this.requirements = new RequirementRegistry({
      tools: this.tools,
      providers: this.providers,
      modes: this.modes,
      compactors: this.compactors,
      channels: this.channels,
      agents: this.agents,
      commands: this.commands,
      transcribers: this.transcribers,
      synthesizers: this.synthesizers,
    });
    this.permissions = opts.permissionEngine ?? new PermissionEngine();
    // Always wrap the user-supplied resolver with the persistent
    // policy engine, so saved `allow_always` / `deny` rules from
    // ~/.moxxy/permissions.json short-circuit the resolver's prompt
    // path. Without this wrap the engine is dead weight — the
    // permissions JSON updates on every "allow always" click but no
    // future turn ever consults it.
    this.resolver = wrapWithPolicy(
      opts.permissionResolver ?? autoAllowResolver,
      this.permissions,
      (name) => this.tools.get(name)?.permission,
    );
    this.dispatcher = new HookDispatcherImpl({
      logger: this.logger,
      hookTimeoutMs: opts.hookTimeoutMs,
    });
    this.pluginHost = new PluginHost({
      cwd: this.cwd,
      logger: this.logger,
      tools: this.tools,
      providers: this.providers,
      modes: this.modes,
      compactors: this.compactors,
      cacheStrategies: this.cacheStrategies,
      viewRenderers: this.viewRenderers,
      tunnelProviders: this.tunnelProviders,
      channels: this.channels,
      surfaces: this.surfaceRegistry,
      agents: this.agents,
      commands: this.commands,
      transcribers: this.transcribers,
      synthesizers: this.synthesizers,
      embedders: this.embedders,
      isolators: this.isolators,
      workflowExecutors: this.workflowExecutors,
      eventStores: this.eventStores,
      requirements: this.requirements,
      dispatcher: this.dispatcher,
      loader: opts.pluginLoader,
      ...(opts.pluginDiscoveryPaths ? { userPaths: opts.pluginDiscoveryPaths } : {}),
      ...(opts.isPluginDisabled ? { isDisabled: opts.isPluginDisabled } : {}),
    });
    // Published after construction (the host is built late) so a discovery-loaded
    // plugin (self-update) can reach reload/unload/listSkipped in its onInit.
    this.services.register('pluginHost', this.pluginHost);

    // Fan every appended event out to plugin `onEvent` hooks. Without this
    // wiring the hook is dead code — declared on the SDK, dispatched by
    // HookDispatcherImpl, but nothing ever calls dispatchEvent.
    this.log.subscribe((event) => {
      // appContext() clones the whole process.env; only pay that per-event cost
      // when a plugin actually has an onEvent hook to receive it. With none,
      // dispatchEvent would iterate an empty hook list anyway.
      if (!this.dispatcher.hasEventHooks()) return;
      return this.dispatcher.dispatchEvent(event, this.appContext());
    });
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  abort(reason = 'user-requested abort'): void {
    this.controller.abort(reason);
  }

  /**
   * Swap the active PermissionResolver. Channels call this after they're
   * constructed so the session uses the channel's interactive resolver
   * (TUI prompt, Telegram inline keyboard, HTTP allow-list, etc.).
   * Replaces the previous monkey-patching of the private `resolver` field
   * from CLI command code.
   */
  setPermissionResolver(resolver: PermissionResolver): void {
    // Re-wrap so policy rules continue to short-circuit prompts when a
    // channel installs its own resolver mid-session.
    this.resolver = wrapWithPolicy(
      resolver,
      this.permissions,
      (name) => this.tools.get(name)?.permission,
    );
  }

  /** Install/replace the generic approval resolver. Pass null to clear. */
  setApprovalResolver(resolver: ApprovalResolver | null): void {
    this.approvalResolver = resolver;
  }

  /**
   * `SessionLike.reset` — the authoritative `/new`. Clears the event log;
   * the log's clear listeners propagate the wipe to whatever observes it
   * (the persistence sidecar truncates its JSONL so `--resume` sees an
   * empty session; a wrapping RunnerServer broadcasts a reset so attached
   * mirrors clear in lockstep). Registries, resolvers, and the active
   * provider survive — only the conversation context vanishes. Callers
   * must abort any in-flight turn first (same contract as `log.clear()`).
   */
  async reset(): Promise<void> {
    this.log.clear();
  }

  /**
   * Graceful shutdown: fire every plugin's `onShutdown` hook, then abort
   * the session. Idempotent — safe to call multiple times (subsequent
   * calls are no-ops once `closed` is set).
   *
   * Channels' SIGINT handlers should call this before exiting so plugins
   * can flush state (memory journal, vault, audit logs, etc.).
   */
  async close(reason = 'shutdown'): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      // Tear down any open surfaces (PTYs, browser screencasts) before the
      // plugin shutdown hooks dispose their underlying resources. Isolated in
      // its own try/catch: a flaky native surface throwing during teardown must
      // not pre-empt the plugin shutdown hooks below, which are how plugins
      // flush state (memory journal, vault, audit logs).
      try {
        await this.surfaces.closeAll();
      } catch (err) {
        this.logger.warn('surface teardown failed during close', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      await this.dispatcher.dispatchShutdown(this.appContext());
    } finally {
      // Drop THIS session's retained child sessions (the workflow `awaitInput`
      // flow keeps them in a process-local registry until a
      // `continue()`/`release()`). A paused run that never resumes would
      // otherwise pin them for the whole process lifetime — release them on
      // shutdown so they don't leak. Scoped to this session's id so closing one
      // session never wipes another live session's paused children.
      clearRetainedChildren(this.id);
      this.abort(reason);
    }
  }

  private closed = false;
  /**
   * Memoized one-time snapshot of `process.env`. `appContext()` is called per
   * dispatched event (hundreds per turn during a streaming reply), per turn,
   * and on every shutdown — eagerly spreading the whole env each time is
   * thousands of O(envVars) clones of GC pressure for a value that does not
   * change over a session's life. Frozen so a plugin can't mutate the shared
   * snapshot out from under another.
   */
  private envSnapshot: Readonly<NodeJS.ProcessEnv> | null = null;

  /**
   * The provider-admin capability (configure/refresh stored providers), read by
   * the runner's provider handlers + the desktop. The @moxxy/plugin-provider-admin
   * plugin publishes it on the service registry in its onInit, so discovery-loading
   * it needs no host stash. (RemoteSession sets its own field for thin clients.)
   */
  get providerAdmin(): ProviderAdminView | undefined {
    return this.services.get<ProviderAdminView>('providerAdmin');
  }

  /**
   * The MCP-admin capability (enable/detach/list MCP servers), read by the
   * runner's mcp handlers + the desktop. @moxxy/plugin-mcp publishes it on the
   * service registry in its onInit. (RemoteSession sets its own field.)
   */
  get mcpAdmin(): McpAdminView | undefined {
    return this.services.get<McpAdminView>('mcpAdmin');
  }

  appContext(): AppContext {
    if (!this.envSnapshot) {
      this.envSnapshot = Object.freeze({ ...process.env });
    }
    return {
      sessionId: this.id,
      cwd: this.cwd,
      log: this.log.asReader(),
      env: this.envSnapshot,
      services: this.services,
    };
  }

  startTurn(): { turnId: ReturnType<typeof newTurnId> } {
    return { turnId: newTurnId() };
  }

  subscribe(fn: (e: MoxxyEvent) => void | Promise<void>): () => void {
    return this.log.subscribe(fn);
  }

  /**
   * Drive one turn against this session. Method form of the `runTurn` free
   * function so a local `Session` satisfies `SessionLike` (the channel-facing
   * contract a `RemoteSession` proxy also implements).
   */
  runTurn(prompt: string, opts: RunTurnOptions = {}): AsyncIterable<MoxxyEvent> {
    return runTurnImpl(this, prompt, opts);
  }

  /**
   * Wire-friendly snapshot of the registries for channels to render. Mirrors
   * what a `RemoteSession` fetches from the runner over RPC - keep the two in
   * sync.
   */
  getInfo(): SessionInfo {
    let activeMode: string | null = null;
    let activeModeBadge: SessionInfo['activeModeBadge'] = null;
    try {
      const mode = this.modes.getActive();
      activeMode = mode.name;
      // Surface the active mode's presentation hint so channels can render a
      // persistent badge (e.g. goal mode) without hard-coding mode names.
      activeModeBadge = mode.badge ? { label: mode.badge.label, ...(mode.badge.tone ? { tone: mode.badge.tone } : {}) } : null;
    } catch {
      // No mode active yet (registry empty pre-boot) - report null.
    }
    const active = this.providers.getActiveName();
    const ready = this.readyProviders;
    return {
      sessionId: this.id,
      cwd: this.cwd,
      activeProvider: active,
      providers: this.providers.list().map((p) => ({
        name: p.name,
        models: p.models,
        authKind: p.auth?.kind === 'oauth' ? 'oauth' : 'api-key',
        // Built-in providers ship hard-coded model lists, so live
        // discovery on /v1/models isn't required from the host. Admin-
        // registered providers (kind: 'apiKey' without a builtin def)
        // are the ones the desktop's "Fetch live" affordance targets;
        // they advertise this via the provider-admin factory by
        // setting `supportsLiveModelDiscovery: true` on their def.
        supportsLiveModelDiscovery:
          (p as { supportsLiveModelDiscovery?: boolean }).supportsLiveModelDiscovery === true,
        enabled: this.providers.isEnabled(p.name),
      })),
      activeMode,
      activeModeBadge,
      modes: this.modes.list().map((m) => m.name),
      tools: this.tools.list().map((t) => ({
        name: t.name,
        description: t.description,
        ...(t.compact ? { compact: t.compact } : {}),
      })),
      skills: this.skills.list().map((s) => ({ id: s.id, name: s.frontmatter.name })),
      commands: this.commands.list().map((c) => ({
        name: c.name,
        description: c.description,
        ...(c.aliases ? { aliases: c.aliases } : {}),
        ...(c.channels ? { channels: c.channels } : {}),
        ...(c.pendingNotice ? { pendingNotice: c.pendingNotice } : {}),
      })),
      readyProviders: ready ? [...ready] : active ? [active] : [],
      // hasTranscriber reports whether any backend is *registered*,
      // not whether one is active. The active selection is per-flow
      // (the TUI activates Codex on its first voice toggle; the
      // desktop relies on handleTranscribe's candidate fallback).
      // For UI affordance gating (showing / hiding a mic button),
      // any registered transcriber means "voice is wired."
      hasTranscriber: this.transcribers.list().length > 0,
      activeTranscriber: this.transcribers.getActiveName(),
      hasSynthesizer: this.synthesizers.list().length > 0,
      activeSynthesizer: this.synthesizers.getActiveName(),
    };
  }
}

/**
 * Wrap a `PermissionResolver` so the persistent `PermissionEngine` runs
 * first. If the engine has a matching allow/deny rule from
 * `~/.moxxy/permissions.json`, that decision short-circuits the
 * resolver's prompt path. Otherwise the resolver runs as usual.
 *
 * The wrapper is a Proxy that intercepts only `check` (and provides the
 * prompt-free `policyCheck` probe); every other property (e.g. `abortAll`
 * and any channel-specific helpers) passes straight through to the
 * underlying resolver, so callers reach those methods exactly as before.
 */
function wrapWithPolicy(
  inner: PermissionResolver,
  engine: PermissionEngine,
  getToolRule: (name: string) => PermissionRule | undefined,
): PermissionResolver {
  // The policy-only decision: user policy (permissions.json) wins, then the
  // tool's own declared rule (so a tool marked `allow` is never blocked in
  // headless runs). Returns null when neither decides — `check` then falls
  // through to the channel resolver's prompt / deny-by-default path, while
  // `policyCheck` callers (auto-approving modes) supply their own fallback
  // so no prompt can ever fire.
  const policyDecision = (call: PendingToolCall): PermissionDecision | null => {
    const policy = engine.check(call);
    if (policy) return policy;
    return evaluateToolRule(getToolRule(call.name), call);
  };
  // Use a Proxy so any extra methods on the underlying resolver
  // (`abortAll`, channel-specific helpers) remain accessible — only
  // `check`/`policyCheck` are intercepted.
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === 'check') {
        return async (call: PendingToolCall, ctx: PermissionContext) => {
          const decided = policyDecision(call);
          if (decided) return decided;
          return target.check(call, ctx);
        };
      }
      if (prop === 'policyCheck') {
        return async (call: PendingToolCall) => policyDecision(call);
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}
