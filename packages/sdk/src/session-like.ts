import type { MoxxyEvent, UserPromptAttachment } from './events.js';
import type { SessionId, TurnId } from './ids.js';
import type { EventLogReader } from './log.js';
import type { ApprovalResolver, ModeBadge } from './mode.js';
import type { PermissionResolver } from './permission.js';
import type { ModelDescriptor } from './provider.js';
import type { ToolCompactPresentation } from './tool.js';

/**
 * Options accepted by `SessionLike.runTurn`. Defined here (rather than in
 * `@moxxy/core`) so the runner client and any consumer can reference it
 * without importing the runtime. `@moxxy/core` re-exports it.
 */
export interface RunTurnOptions {
  readonly model?: string;
  readonly systemPrompt?: string;
  readonly maxIterations?: number;
  /**
   * Per-turn abort signal. Aborting it cancels this turn without tainting
   * the session's own controller (e.g. "user hit Esc on a runaway loop").
   */
  readonly signal?: AbortSignal;
  /** Inline attachments shipped alongside the prompt (images, audio, stdin). */
  readonly attachments?: ReadonlyArray<UserPromptAttachment>;
  /**
   * Pre-minted turn id. When omitted, `runTurn` mints one. The runner passes
   * this so it can return the id to the client *before* the turn starts and
   * associate per-turn permission prompts with the originating client.
   */
  readonly turnId?: TurnId;
}

/**
 * The read side of the event log plus the live subscription a channel needs
 * to render in real time. A `RemoteSession` backs this with a local mirror
 * fed by the runner's event stream; a local `Session` backs it with the real
 * `EventLog`.
 */
export interface SessionLogReader extends EventLogReader {
  subscribe(fn: (event: MoxxyEvent) => void | Promise<void>): () => void;
}

/** How a provider authenticates. UIs use this to decide whether to
 *  show an API-key field or kick off an OAuth flow. */
export type ProviderAuthKind = 'api-key' | 'oauth';

/** Serializable provider metadata (models + context windows + auth)
 *  for display. */
export interface ProviderInfo {
  readonly name: string;
  readonly models: ReadonlyArray<ModelDescriptor>;
  /** 'oauth' when the provider declares an oauth login on its plugin
   *  definition, 'api-key' otherwise. Defaults to 'api-key' for
   *  providers that don't declare. */
  readonly authKind: ProviderAuthKind;
  /** True when the provider's plugin can list its models live (e.g.
   *  via /v1/models). Lets the desktop's model picker show a
   *  "Fetch live" affordance only where it makes sense. */
  readonly supportsLiveModelDiscovery: boolean;
  /**
   * False when the user disabled this provider (it stays registered but can't
   * be activated and is excluded from boot's candidate walk). Optional for
   * wire back-compat — an older runner omits it; treat absent as enabled.
   */
  readonly enabled?: boolean;
}

/** Serializable tool metadata for status lines / slash menus / compact rendering. */
export interface ToolInfo {
  readonly name: string;
  readonly description: string;
  /** Compact presentation hint (plain data - crosses the wire intact). */
  readonly compact?: ToolCompactPresentation;
}

/** Serializable skill metadata. */
export interface SkillInfo {
  readonly id: string;
  readonly name: string;
}

/** Serializable slash-command metadata for the picker / `/help`. */
export interface CommandInfo {
  readonly name: string;
  readonly description: string;
  readonly aliases?: ReadonlyArray<string>;
  readonly channels?: ReadonlyArray<string>;
  readonly pendingNotice?: string;
}

/**
 * A wire-friendly snapshot of a session's registries - everything a channel
 * needs to *render* (status line, pickers, slash suggestions) without
 * reaching into live registry objects (`LLMProvider`, `ModeDef`, `ToolDef`)
 * whose methods can't cross a transport. A local `Session` builds it from its
 * registries; a `RemoteSession` fetches it from the runner and refreshes it
 * when the runner reports `info.changed`.
 */
export interface SessionInfo {
  readonly sessionId: SessionId;
  readonly cwd: string;
  readonly activeProvider: string | null;
  readonly providers: ReadonlyArray<ProviderInfo>;
  readonly activeMode: string | null;
  /**
   * Presentation hint for the active mode, when it advertises one (see
   * {@link ModeBadge}). Lets channels render a persistent accent badge for
   * autonomous modes like goal mode. `null` when no mode is active or the
   * active mode declares no badge.
   */
  readonly activeModeBadge: ModeBadge | null;
  readonly modes: ReadonlyArray<string>;
  readonly tools: ReadonlyArray<ToolInfo>;
  readonly skills: ReadonlyArray<SkillInfo>;
  readonly commands: ReadonlyArray<CommandInfo>;
  /** Provider names the runner has activated (credentials resolved). */
  readonly readyProviders: ReadonlyArray<string>;
  readonly hasTranscriber: boolean;
  /** Name of the active transcriber, or null. Lets a thin client proxy STT. */
  readonly activeTranscriber: string | null;
  /** Whether any text-to-speech backend is registered. */
  readonly hasSynthesizer: boolean;
  /** Name of the active synthesizer, or null. Lets a thin client proxy TTS
   *  (the desktop routes "Read aloud" through it; null → OS voice fallback). */
  readonly activeSynthesizer: string | null;
}

/**
 * Resolves a provider's stored credentials (vault tokens / API keys) into the
 * config object `providers.setActive` needs. The host installs one on a local
 * Session at boot; it is undefined across a `RemoteSession` transport (a closure
 * can't cross the wire — the runner side resolves credentials there instead).
 */
export type CredentialResolver = (providerName: string) => Promise<Record<string, unknown>>;

/** One server's status in {@link McpAdminView.listServers}. */
export interface McpServerStatusView {
  readonly name: string;
  readonly enabled: boolean;
  readonly connected: boolean;
}

/**
 * The slice of the MCP admin API a channel needs to drive the MCP picker and
 * status line. Present on a local Session when the MCP admin plugin is wired;
 * a `RemoteSession` leaves {@link SessionLike.mcpAdmin} undefined and the UI
 * degrades gracefully.
 */
export interface McpAdminView {
  enableAndAttach(name: string): Promise<{ toolNames: ReadonlyArray<string> } | null>;
  detach(name: string): Promise<boolean>;
  listServers(): Promise<ReadonlyArray<McpServerStatusView>>;
}

/**
 * Editable fields of a stored (runtime-registered) provider entry. Mirrors
 * the persisted `providers.json` shape owned by `@moxxy/plugin-provider-admin`
 * minus the immutable identity (`name`, `kind`).
 */
export interface ProviderConfigurePatch {
  readonly baseURL?: string;
  readonly defaultModel?: string;
  /** Override the API-key env-var/vault name (`<NAME>_API_KEY` by default). */
  readonly envVar?: string;
  readonly models?: ReadonlyArray<ModelDescriptor>;
}

/**
 * The slice of the provider admin API a channel needs to edit a stored
 * (runtime-registered) provider in place. Present on a local Session when
 * `@moxxy/plugin-provider-admin` is wired (mirrors {@link McpAdminView});
 * a `RemoteSession` proxies it over the runner protocol (v7+). Built-in
 * providers are not configurable through this view — their config is code.
 */
export interface ProviderAdminView {
  /**
   * Patch a stored provider's entry: re-registers the live provider def and
   * persists the merged entry to providers.json. Throws a MoxxyError when no
   * stored provider has that name or the patch is inconsistent (e.g. a
   * defaultModel missing from the models list).
   */
  configure(name: string, patch: ProviderConfigurePatch): Promise<void>;
}

/** One workflow's summary for the `/workflows` modal. */
export interface WorkflowSummaryView {
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly scope: string;
  readonly steps: number;
  /** Human-readable trigger summary, e.g. `cron(0 8 * * *)` or `on-demand`. */
  readonly triggers: string;
}

/** Result of running a workflow from the modal. */
export interface WorkflowRunView {
  readonly ok: boolean;
  readonly output: string;
  readonly error?: string;
  readonly steps: ReadonlyArray<{ readonly id: string; readonly status: string; readonly error?: string }>;
  /**
   * Terminal status of the run. `paused` means it parked on an `awaitInput`
   * step and is awaiting the operator's reply (resume via {@link WorkflowsView.resume}
   * with `runId`). Optional for back-compat — absent from older hosts that
   * never paused. A run/resume that completes or fails reports those.
   */
  readonly status?: 'completed' | 'paused' | 'failed';
  /** Set when `status` is `paused` — pass to {@link WorkflowsView.resume}. */
  readonly runId?: string;
}

/** Validation result for a draft YAML — backs the visual builder (phase 2). */
export interface WorkflowValidateView {
  readonly ok: boolean;
  /** One readable line per issue; empty when `ok`. */
  readonly errors: ReadonlyArray<string>;
}

/** Result of persisting a workflow from the builder. */
export interface WorkflowSaveView {
  readonly name: string;
  readonly scope: string;
  readonly path: string;
}

/**
 * The slice of the workflows API a channel needs to drive the `/workflows`
 * modal (list, enable/disable toggle, run). Present on a local Session when
 * `@moxxy/plugin-workflows` is wired; a `RemoteSession` leaves
 * {@link SessionLike.workflows} undefined and the UI degrades gracefully.
 *
 * `validateDraft` / `save` / `getRun` back the upcoming visual workflow
 * builder (phase 2); they are optional so older hosts and remote sessions
 * stay capability-detectable — a channel must feature-check before calling.
 */
export interface WorkflowsView {
  list(): Promise<ReadonlyArray<WorkflowSummaryView>>;
  setEnabled(name: string, enabled: boolean): Promise<void>;
  run(name: string): Promise<WorkflowRunView>;
  /** Parse + validate a draft YAML without saving it. */
  validateDraft?(yaml: string): Promise<WorkflowValidateView>;
  /**
   * Persist a workflow from full YAML (create or overwrite). `previousName`
   * (the name the builder loaded) supports rename: when it differs from the
   * YAML's name, the old file + registry entry are removed so a rename doesn't
   * leave an orphaned duplicate.
   */
  save?(yaml: string, previousName?: string): Promise<WorkflowSaveView>;
  /** Fetch one saved workflow's canonical YAML + on-disk metadata. */
  getRun?(name: string): Promise<{ readonly name: string; readonly scope: string; readonly path: string; readonly yaml: string } | null>;
  /**
   * Answer a paused workflow's `awaitInput` question and resume the run (the
   * human-in-the-loop flow). `runId` comes from the `workflow_paused` event;
   * `reply` is the operator's answer, fed into the paused step's child agent.
   * Resolves with the (now usually completed) run result. Optional so older
   * hosts / remote sessions stay capability-detectable — a channel must
   * feature-check before calling.
   */
  resume?(runId: string, reply: string): Promise<WorkflowRunView>;
}

/** One installable plugin in {@link PluginsAdminView.catalog}. */
export interface InstallablePluginView {
  readonly id: string;
  readonly label: string;
  readonly packageName: string;
  readonly installSpec: string;
  readonly kind?: string;
  readonly startCommand?: string;
}

/** One loaded plugin in {@link PluginsAdminView.loaded}, grouped by `kinds`. */
export interface LoadedPluginView {
  readonly name: string;
  readonly version: string;
  /** Contribution categories (e.g. `['provider']`, `['tool','command']`). */
  readonly kinds: ReadonlyArray<string>;
}

/**
 * The slice of plugin management a channel needs to drive the `/plugins`
 * picker: which plugins are disabled, what's installable, and a persist+
 * hot-apply enable/disable toggle (plug/unplug). Present on a local Session
 * when `@moxxy/plugin-plugins-admin` is wired; a `RemoteSession` leaves
 * {@link SessionLike.pluginsAdmin} undefined and the UI degrades gracefully.
 */
export interface PluginsAdminView {
  /** Currently-loaded plugins with their contribution kinds (for kind tabs). */
  loaded(): ReadonlyArray<LoadedPluginView>;
  /** Package names currently disabled (config `plugins[name].enabled=false`). */
  disabled(): ReadonlyArray<string>;
  /** Curated installable-plugin catalog for the picker's "Installable" tab. */
  catalog(): ReadonlyArray<InstallablePluginView>;
  /** Persist `plugins[name].enabled` AND apply it to the live session. */
  setEnabled(packageName: string, enabled: boolean): Promise<void>;
}

/**
 * The session surface a `Channel` depends on, decoupled from whether the
 * session runs in-process (`@moxxy/core`'s `Session`) or is a thin-client
 * proxy (`RemoteSession` from `@moxxy/runner`). The same channel code drives
 * both - the runner/thin-client split hinges on this interface.
 *
 * Behavioral methods (`runTurn`, resolvers, `close`) and the live event log
 * are the contract; richer registry *behavior* (executing a tool, streaming a
 * provider) stays server-side and is never exposed here. For display, use the
 * serializable `getInfo()` snapshot instead of live registry objects.
 */
export interface SessionLike {
  readonly id: SessionId;
  readonly cwd: string;
  readonly log: SessionLogReader;
  runTurn(prompt: string, opts?: RunTurnOptions): AsyncIterable<MoxxyEvent>;
  setPermissionResolver(resolver: PermissionResolver): void;
  setApprovalResolver(resolver: ApprovalResolver | null): void;
  /** Wire-friendly registry snapshot for rendering. */
  getInfo(): SessionInfo;
  close(reason?: string): Promise<void>;

  /**
   * Authoritative session reset (`/new`): wipe the conversation history at
   * its source so it cannot resurrect. On an in-process `Session` this clears
   * the real `EventLog` (and, via the log's clear listeners, truncates the
   * persistence sidecar so `--resume` sees an empty session). On a
   * `RemoteSession` it invokes the runner's `session.reset` RPC — the runner
   * aborts in-flight turns, clears ITS log, and broadcasts a reset
   * notification so every attached mirror clears in lockstep. Optional
   * capability per the seam convention: callers MUST guard and fall back to
   * `log.clear()` when absent, and MUST surface a rejection instead of
   * claiming the history was cleared.
   */
  reset?(): Promise<void>;

  /**
   * Live runtime capabilities present only on an in-process Session; a
   * `RemoteSession` thin client leaves them undefined, so callers MUST guard.
   * For plain display prefer the serializable {@link getInfo} snapshot — these
   * are for the mutate/guard paths a channel drives (provider switch, MCP picker).
   */
  /** Providers whose credentials resolved this session (live, mutable). */
  readyProviders?: Set<string>;
  /** Re-resolves a provider's credentials before `providers.setActive`. */
  credentialResolver?: CredentialResolver;
  /** MCP admin slice backing the MCP picker / status line. */
  mcpAdmin?: McpAdminView;
  /** Provider admin slice — edit stored (runtime-registered) providers. */
  providerAdmin?: ProviderAdminView;
  /** Workflows slice backing the `/workflows` modal. */
  workflows?: WorkflowsView;
  /** Plugin-management slice backing the `/plugins` picker. */
  pluginsAdmin?: PluginsAdminView;
}
