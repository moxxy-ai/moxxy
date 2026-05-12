import type { AppContext, LifecycleHooks, MoxxyEvent, SessionId } from '@moxxy/sdk';
import { newSessionId, newTurnId } from './events/factory.js';
import { EventLog } from './events/log.js';
import { HookDispatcherImpl } from './plugins/lifecycle.js';
import { PluginHost, type PluginLoader } from './plugins/host.js';
import { ProviderRegistry } from './registries/providers.js';
import { LoopRegistry } from './registries/loops.js';
import { CompactorRegistry } from './registries/compactors.js';
import { ChannelRegistryImpl } from './registries/channels.js';
import { SkillRegistryImpl } from './registries/skills.js';
import { ToolRegistryImpl, type ToolRegistry } from './registries/tools.js';
import { PermissionEngine } from './permissions/engine.js';
import { autoAllowResolver } from './permissions/resolvers.js';
import type { PermissionResolver } from '@moxxy/sdk';
import { createLogger, silentLogger, type Logger } from './logger.js';

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
}

export class Session {
  readonly id: SessionId;
  readonly cwd: string;
  readonly log: EventLog;
  readonly logger: Logger;
  readonly tools: ToolRegistry;
  readonly providers: ProviderRegistry;
  readonly loops: LoopRegistry;
  readonly compactors: CompactorRegistry;
  readonly channels: ChannelRegistryImpl;
  readonly skills: SkillRegistryImpl;
  readonly permissions: PermissionEngine;
  /** Current PermissionResolver. Update via `setPermissionResolver(r)`. */
  resolver: PermissionResolver;
  readonly dispatcher: HookDispatcherImpl;
  readonly pluginHost: PluginHost;
  private readonly controller = new AbortController();

  constructor(opts: SessionOptions) {
    this.id = opts.sessionId ?? newSessionId();
    this.cwd = opts.cwd;
    this.logger = opts.logger ?? (opts.silent ? silentLogger : createLogger());
    this.log = new EventLog();
    this.tools = new ToolRegistryImpl({ logger: this.logger, cwd: this.cwd });
    this.providers = new ProviderRegistry();
    this.loops = new LoopRegistry();
    this.compactors = new CompactorRegistry();
    this.channels = new ChannelRegistryImpl();
    this.skills = new SkillRegistryImpl();
    this.permissions = opts.permissionEngine ?? new PermissionEngine();
    this.resolver = opts.permissionResolver ?? autoAllowResolver;
    this.dispatcher = new HookDispatcherImpl({
      logger: this.logger,
      hookTimeoutMs: opts.hookTimeoutMs,
    });
    this.pluginHost = new PluginHost({
      cwd: this.cwd,
      logger: this.logger,
      tools: this.tools,
      providers: this.providers,
      loops: this.loops,
      compactors: this.compactors,
      channels: this.channels,
      dispatcher: this.dispatcher,
      loader: opts.pluginLoader,
    });

    // Fan every appended event out to plugin `onEvent` hooks. Without this
    // wiring the hook is dead code — declared on the SDK, dispatched by
    // HookDispatcherImpl, but nothing ever calls dispatchEvent.
    this.log.subscribe((event) => this.dispatcher.dispatchEvent(event, this.appContext()));
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
    this.resolver = resolver;
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
      await this.dispatcher.dispatchShutdown(this.appContext());
    } finally {
      this.abort(reason);
    }
  }

  private closed = false;

  appContext(): AppContext {
    return {
      sessionId: this.id,
      cwd: this.cwd,
      log: this.log.asReader(),
      env: { ...process.env },
    };
  }

  startTurn(): { turnId: ReturnType<typeof newTurnId> } {
    return { turnId: newTurnId() };
  }

  subscribe(fn: (e: MoxxyEvent) => void | Promise<void>): () => void {
    return this.log.subscribe(fn);
  }

  registerHookOptions(_hooks: LifecycleHooks): void {
    // For tests: allows attaching a one-off hook bundle through a synthetic plugin if needed.
    // Implementation-detail helper, intentionally minimal.
  }
}
