import type { PermissionResolver } from './permission.js';
import type { ClientSession } from './client-session.js';
import type { SessionSource } from './event-store.js';

/**
 * A Channel is a bidirectional surface that drives a Session: it feeds user
 * prompts in, renders assistant chunks + tool activity out, and implements a
 * PermissionResolver so it can interrupt tool execution to ask the user.
 *
 * The TUI (Ink) and Telegram are both Channels. Future Slack / Discord / HTTP
 * channels implement this same interface so the moxxy CLI binary (or any
 * embedded consumer) can dispatch to them uniformly.
 *
 * The generic `TStartOpts` is the concrete options shape a given channel
 * accepts.
 */
export interface Channel<TStartOpts = unknown> {
  /** Stable name (lowercase, single word). Used by dispatchers to look up by string. */
  readonly name: string;

  /** The PermissionResolver this channel installs on the session. */
  readonly permissionResolver: PermissionResolver;

  /**
   * Begin running the channel. Returns a handle whose `running` promise
   * resolves when the channel exits gracefully.
   */
  start(opts: TStartOpts): Promise<ChannelHandle>;

  /**
   * The public ingest URL this channel exposes once running — e.g. Slack's
   * Events Request URL after its proxy tunnel opens — or null when it has none
   * (Telegram long-polls). Read by the dedicated-runner host to publish the URL
   * the user must paste into the provider's config. Optional: channels with no
   * inbound endpoint omit it.
   */
  readonly requestUrl?: string | null;
}

export interface ChannelHandle {
  /**
   * Resolves when the channel exits cleanly (user quit, SIGINT caught,
   * upstream disconnected). Rejects on fatal error.
   */
  readonly running: Promise<void>;

  /** Request graceful shutdown. Implementations should abort any in-flight work. */
  stop(reason?: string): Promise<void>;
}

/**
 * Start options accepted by {@link startChannelWith}. The `session` is typed —
 * proving the runner/thin-client seam end-to-end — while the remaining
 * forwarded flags stay loosely typed (a dispatcher merges config + CLI flags it
 * can't know the shape of).
 */
export type ChannelStartArgs = { readonly session: ClientSession } & Record<string, unknown>;

/**
 * The single, audited dispatch boundary between a CLI/runner caller and a
 * channel's `start()`.
 *
 * `ChannelDef` (and therefore the {@link Channel} a dispatcher gets back from
 * `create`) is intentionally NOT generic over its start-options type: a
 * dispatcher looks channels up by string name, so it can only ever hold a
 * `Channel<unknown>` whose `start` takes `unknown`. Making the registry fully
 * generic would ripple through `ChannelRegistry` and every `defineChannel`
 * call, so it stays out of scope. The structural hand-off from a typed
 * `{ session, ...overrides }` bag to `start(opts: unknown)` is therefore erased
 * here — in ONE place — instead of an inline `as never` at each call site.
 *
 * What this helper *proves*, and what each caller now states at the type level
 * by handing in a `ChannelStartArgs`, is the load-bearing half of the
 * runner/thin-client seam: `session` is a real {@link ClientSession}. Every
 * channel's concrete `StartOpts.session` is typed `ClientSession`, and
 * `RemoteSession` (the thin-client proxy) `implements ClientSession`, so a bare
 * `RemoteSession` is provably assignable end-to-end. The only thing the cast
 * drops is the loosely-typed *rest* of the forwarded-flag bag, which channels
 * already read defensively.
 */
export function startChannelWith(channel: Channel, opts: ChannelStartArgs): Promise<ChannelHandle> {
  // Audited erasure: `Channel.start` takes `unknown` (the registry is
  // non-generic, see above). `opts` is a proven { session: ClientSession } bag;
  // the cast only erases its loose extra keys, not the typed session.
  return channel.start(opts as never);
}

/** Common base shape for channel start options. */
export interface ChannelStartOptsBase {
  readonly model?: string;
  readonly systemPrompt?: string;
}

/**
 * Standard dependencies that a channel factory receives. Channels pick what
 * they need from this bag. Production CLI populates all of these; tests may
 * pass only a subset.
 */
export interface ChannelFactoryDeps {
  /** Working directory for the channel (matches the Session's cwd). */
  readonly cwd: string;
  /** Optional encrypted-secret store (typed loosely — plugins import the concrete VaultStore type when needed). */
  readonly vault?: unknown;
  /** Optional structured logger. */
  readonly logger?: {
    debug?(msg: string, meta?: Record<string, unknown>): void;
    info?(msg: string, meta?: Record<string, unknown>): void;
    warn?(msg: string, meta?: Record<string, unknown>): void;
    error?(msg: string, meta?: Record<string, unknown>): void;
  };
  /** Free-form per-channel overrides forwarded from the CLI invocation. */
  readonly options?: Record<string, unknown>;
}

/**
 * A registered, named factory for a Channel. Plugins contribute these via
 * `definePlugin({ channels: [defineChannel(...)] })`. The CLI looks up by name
 * and dispatches: `moxxy <name>` calls `def.create(deps).start({session,...})`.
 */
export interface ChannelDef<TStartOpts = unknown> {
  readonly name: string;
  readonly description: string;
  create(deps: ChannelFactoryDeps): Channel<TStartOpts>;
  /**
   * Optional runtime gate. Lets a channel declare "I can only run if these
   * preconditions are met" (e.g., Telegram needs a token in the vault; TUI
   * needs a TTY). The dispatcher uses this to filter the visible channel list
   * and to give the user a helpful error before construction.
   *
   * Default: always available.
   */
  isAvailable?(deps: ChannelFactoryDeps): Promise<ChannelAvailability>;
  /**
   * One-shot subcommands the channel exposes. Routed as
   * `moxxy channels <name> <subcommand>` by the CLI. Use this for
   * channel-specific maintenance commands that don't need to run the channel
   * (e.g., Telegram's `unpair`, `status`) — or that want to nudge a start with
   * a flag (e.g., `pair` -> start with options.pair=true).
   */
  readonly subcommands?: Readonly<Record<string, ChannelSubcommand>>;
  /**
   * Name of a subcommand to run for a bare `moxxy <name>` invocation on a TTY -
   * e.g. an interactive setup wizard. When absent, a bare invocation just
   * starts the channel.
   */
  readonly interactiveCommand?: string;
  /**
   * Declare that this channel runs on its OWN dedicated, isolated runner: a
   * distinct runner socket (`channel-<name>.sock`) + a stable sticky session id
   * (`moxxy-channel-<name>`), so the channel acts as its own agent thread,
   * separate from whatever runner serves the desktop/TUI. NO runner-protocol
   * change — one dedicated runner is still one Session. Channels that should
   * operate autonomously (slack, telegram) set this; the CLI reads it generically
   * (see `applyDedicatedRunnerEnv`) so no per-channel name list is needed. Any
   * channel can also opt in at runtime via `--dedicated` / `MOXXY_DEDICATED_RUNNER=1`.
   */
  readonly dedicatedRunner?: boolean;
  /**
   * The {@link SessionSource} to stamp on this channel's sessions when it runs
   * dedicated (persisted into the meta sidecar; surfaces filter history by it).
   * Only honored alongside `dedicatedRunner`. When unset, the source falls back
   * to the usual env/default resolution.
   */
  readonly sessionSource?: SessionSource;
}

export interface ChannelAvailability {
  readonly ok: boolean;
  /** Human-readable explanation when ok=false. Shown by `moxxy channels list`. */
  readonly reason?: string;
}

/** Positional + flag args handed to a channel subcommand by the CLI. */
export interface ChannelCommandArgs {
  readonly positional: ReadonlyArray<string>;
  readonly flags: Readonly<Record<string, string | boolean | undefined>>;
}

/**
 * Context handed to a channel subcommand. The CLI builds `deps` exactly like
 * it does for `Channel.create()` so subcommands can:
 *  - inspect `deps.vault` for one-shot ops (unpair, status)
 *  - mutate `deps.options` and call `startChannel()` to launch the channel
 *    with extra start opts (e.g., pair=true)
 */
export interface ChannelSubcommandContext {
  readonly deps: ChannelFactoryDeps;
  readonly args: ChannelCommandArgs;
  /**
   * Boot a session and run the channel by name. Returns the process exit code
   * (0 on clean shutdown). Subcommands that want to "start with twist" call
   * this with overrides instead of duplicating the start-loop themselves.
   */
  startChannel(options?: Readonly<Record<string, unknown>>): Promise<number>;
  /**
   * The booted session, so a subcommand can do channel-instance work like
   * pairing.
   */
  readonly session: ClientSession;
}

export interface ChannelSubcommand {
  readonly description: string;
  run(ctx: ChannelSubcommandContext): Promise<number>;
}

/**
 * Read-only registry of channels available in a Session. Implementation lives
 * in @moxxy/core.
 */
export interface ChannelRegistry {
  list(): ReadonlyArray<ChannelDef>;
  get(name: string): ChannelDef | undefined;
  has(name: string): boolean;
  /**
   * Returns every channel paired with its current availability. Channels
   * without an `isAvailable` hook are treated as `{ok: true}`.
   */
  listWithAvailability(deps: ChannelFactoryDeps): Promise<ReadonlyArray<{
    readonly def: ChannelDef;
    readonly availability: ChannelAvailability;
  }>>;
}
