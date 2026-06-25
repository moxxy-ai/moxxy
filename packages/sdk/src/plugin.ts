import type { AgentDef } from './agent.js';
import type { CacheStrategyDef } from './cache-strategy.js';
import type { ChannelDef } from './channel.js';
import type { CommandDef } from './command.js';
import type { CompactorDef } from './compactor.js';
import type { EmbedderDef } from './embedding.js';
import type { Isolator } from './isolation.js';
import type { LifecycleHooks } from './hooks.js';
import type { ModeDef } from './mode.js';
import type { ProviderDef } from './provider.js';
import type { MoxxyRequirement } from './requirements.js';
import type { SurfaceDef } from './surface.js';
import type { ToolDef } from './tool.js';
import type { TranscriberDef } from './transcriber.js';
import type { SynthesizerDef } from './synthesizer.js';
import type { ViewRendererDef } from './view-renderer.js';
import type { TunnelProviderDef } from './tunnel.js';
import type { WorkflowExecutorDef } from './workflow.js';
import type { EventStoreDef } from './event-store.js';

export type PluginKind = 'tools' | 'provider' | 'mode' | 'compactor' | 'cache-strategy' | 'view-renderer' | 'tunnel-provider' | 'mcp' | 'cli' | 'channel' | 'surface' | 'hooks' | 'agent' | 'command' | 'transcriber' | 'synthesizer' | 'embedder' | 'isolator' | 'workflow-executor' | 'event-store';

export interface PluginSpec {
  readonly name: string;
  readonly version?: string;
  readonly tools?: ReadonlyArray<ToolDef>;
  readonly providers?: ReadonlyArray<ProviderDef>;
  readonly modes?: ReadonlyArray<ModeDef>;
  readonly compactors?: ReadonlyArray<CompactorDef>;
  /**
   * Prompt-caching strategies contributed by the plugin. One is active per
   * session (selected via `session.cacheStrategies.setActive(name)`); the
   * active strategy decides where cache breakpoints go for each provider call.
   */
  readonly cacheStrategies?: ReadonlyArray<CacheStrategyDef>;
  /**
   * View-spec renderers contributed by the plugin. One is active per session
   * (selected via `session.viewRenderers.setActive(name)`); the active renderer
   * parses the agent's view-spec into a validated AST for `present_view`. A
   * default renderer ships with core, so this is only for replacing it.
   */
  readonly viewRenderers?: ReadonlyArray<ViewRendererDef>;
  /**
   * Tunnel providers that expose the local web surface publicly (e.g.
   * the proxy relay). One active per session; core seeds a `localhost` no-op.
   */
  readonly tunnelProviders?: ReadonlyArray<TunnelProviderDef>;
  /**
   * Event-store backends — the storage behind a session's event log. Core seeds
   * a protected JSONL default; a plugin can contribute an alternative (SQLite,
   * remote, encrypted), activated only by explicit `plugins.eventStore.default`
   * (a discovered store is registered but never auto-active — the trust
   * boundary, since the store sees every event). See {@link EventStoreDef}.
   */
  readonly eventStores?: ReadonlyArray<EventStoreDef>;
  readonly channels?: ReadonlyArray<ChannelDef>;
  /**
   * Interactive surfaces contributed by the plugin — long-lived panes a human
   * and the agent drive together (an embedded terminal, an in-window browser).
   * Registered into the session's `SurfaceRegistry`; the runner exposes them to
   * thin clients over the `surface.*` protocol family. The plugin's own tools
   * reach the same underlying resource through module state. See {@link SurfaceDef}.
   */
  readonly surfaces?: ReadonlyArray<SurfaceDef>;
  /**
   * Speech-to-text backends contributed by the plugin. Selected by name via
   * `session.transcribers.setActive(name)`; channels with audio input use
   * `session.transcribers.getActive()` to convert bytes → transcript when
   * the active provider does not advertise `supportsAudio`.
   */
  readonly transcribers?: ReadonlyArray<TranscriberDef>;
  /**
   * Text-to-speech backends contributed by the plugin. Selected by name via
   * `session.synthesizers.setActive(name)`; read-aloud surfaces (the desktop's
   * "Read aloud" button) call `session.synthesizers.getActive()` to turn text
   * into audio. One active at a time; absent → the surface falls back to the
   * OS voice.
   */
  readonly synthesizers?: ReadonlyArray<SynthesizerDef>;
  /**
   * Text-embedding backends contributed by the plugin. Selected by name via
   * `session.embedders.setActive(name, config)`; @moxxy/plugin-memory uses the
   * active embedder for semantic recall. `createClient` is lazy so a discovered
   * embedder plugin never pulls its (often heavy) runtime in until selected.
   */
  readonly embedders?: ReadonlyArray<EmbedderDef>;
  /**
   * Capability isolators contributed by the plugin (worker_threads, subprocess,
   * wasm, …). Registered into the active security layer's `IsolatorRegistry`
   * and selected by name via `security.isolator` config. Registration alone is
   * inert — a contributed isolator is NEVER auto-activated as the sandbox
   * boundary; the user must opt in by name (so a rogue plugin can't silently
   * weaken isolation).
   */
  readonly isolators?: ReadonlyArray<Isolator>;
  /**
   * Typed subagent kinds the plugin contributes. Each becomes
   * dispatchable as `dispatch_agent({ agentType: <name>, ... })`.
   * When NO plugin registers any agents (and no plugin registers the
   * dispatch tool itself), the model has no subagent capability and
   * the system degrades to the normal single-loop flow.
   */
  readonly agents?: ReadonlyArray<AgentDef>;
  /**
   * Slash commands contributed to every channel — the TUI's slash
   * menu, the Telegram bot's command list, and any future channel
   * that consumes `session.commands`. Use this for actions that make
   * sense regardless of UI (`/info`, `/clear`, custom domain commands
   * like `/deploy`); leave channel-specific UI commands (overlay
   * pickers, raw-mode toggles) inside the channel itself.
   */
  readonly commands?: ReadonlyArray<CommandDef>;
  /**
   * Workflow-execution strategies contributed by the plugin. One is active per
   * session (selected via `session.workflowExecutors.setActive(name)`); the
   * active executor runs a workflow DAG. `@moxxy/plugin-workflows` ships the
   * default `dag` executor.
   */
  readonly workflowExecutors?: ReadonlyArray<WorkflowExecutorDef>;
  readonly hooks?: LifecycleHooks;
  readonly skillsDir?: string;
}

export interface Plugin extends PluginSpec {
  readonly __moxxy: 'plugin';
  readonly version: string;
}

export interface PluginManifest {
  readonly entry: string;
  readonly kind?: PluginKind | ReadonlyArray<PluginKind>;
  readonly skills?: string;
}

export interface ResolvedPluginManifest extends PluginManifest {
  readonly packageName: string;
  readonly packageVersion: string;
  readonly packagePath: string;
  /**
   * Requirements declared at `package.json#moxxy.requirements`. Statically
   * authored — never derived from code. Drives plugin toposort and the
   * pre-load readiness gate.
   */
  readonly requirements?: ReadonlyArray<MoxxyRequirement>;
}
