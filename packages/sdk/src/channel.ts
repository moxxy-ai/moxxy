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
   * The channel's runtime "connect value" — published once running and surfaced
   * by control surfaces per the channel's declared {@link ChannelConnectStep}.
   * Its meaning depends on `connect.kind`: for Slack it is the Events Request URL
   * the user pastes into the app (after its proxy tunnel opens); for Telegram it
   * is the `https://t.me/<botname>` link of the resolved bot. Null when the
   * channel has no connect value yet (still resolving) or none at all. Read by
   * the dedicated-runner host and written to the channel's status file.
   */
  readonly requestUrl?: string | null;

  /**
   * Whether the channel's "connect the other side" step is satisfied — e.g.
   * Telegram has paired a chat. A control surface shows a "✓ Connected"
   * affordance instead of the connect QR/URL once this is true. `undefined` for
   * channels with no discrete connected state (e.g. Slack, whose Request URL
   * stays relevant for the channel's lifetime). Written to the status file and
   * mirrored by the dedicated-runner host. Pair with {@link ChannelHandle.onConnectChange}
   * to learn when it flips after start.
   */
  readonly connected?: boolean;
}

export interface ChannelHandle {
  /**
   * Resolves when the channel exits cleanly (user quit, SIGINT caught,
   * upstream disconnected). Rejects on fatal error.
   */
  readonly running: Promise<void>;

  /** Request graceful shutdown. Implementations should abort any in-flight work. */
  stop(reason?: string): Promise<void>;

  /**
   * Subscribe to post-start changes in the channel's connect-state
   * ({@link Channel.requestUrl} / {@link Channel.connected}) — e.g. a chat
   * pairing. The dedicated-runner host uses this to re-publish the channel's
   * status file so a watching panel updates live (swap the QR for "Connected")
   * without polling the channel object. Optional: channels whose connect-state
   * is fixed at start (Slack) omit it. Returns an unsubscribe function.
   */
  onConnectChange?(listener: () => void): () => void;
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
  /**
   * Declarative config the channel needs to run (its secret fields + where they
   * live in the vault, plus pairing hints). This is what a control surface — the
   * TUI `/channels` panel, `moxxy channels start`, the desktop "Channels" panel —
   * renders to let the user configure + start the channel WITHOUT hardcoding a
   * per-channel table. The channel self-describes here; the vault keys named are
   * the same ones the channel actually reads at boot (its `keys.ts`). Channels
   * with no setup (web/http) omit this.
   */
  readonly config?: ChannelConfigDescriptor;
}

/** One secret/config input a channel exposes for a control surface to collect. */
export interface ChannelConfigField {
  /** Option key (e.g. `botToken`). Stable identifier within the channel. */
  readonly name: string;
  /** Short human label (e.g. `Bot token`). */
  readonly label: string;
  /** The vault key the channel reads this value from (e.g. `slack_bot_token`). */
  readonly vaultKey: string;
  /** Must be present for the channel to count as "configured". */
  readonly required?: boolean;
  /** Treat as a secret — mask the input and never echo the stored value. */
  readonly secret?: boolean;
  /** Placeholder shown in an empty input (e.g. `xoxb-…`). */
  readonly placeholder?: string;
  /** One-line guidance on where to obtain the value. */
  readonly help?: string;
}

/** What a channel declares about being configured + run from a control surface. */
export interface ChannelConfigDescriptor {
  /** The fields to collect, in display order. */
  readonly fields: ReadonlyArray<ChannelConfigField>;
  /** The channel exposes a public ingest URL (Slack's Request URL) once started,
   *  so a control surface should poll for + surface it. */
  readonly hasRequestUrl?: boolean;
  /** Post-start pairing/setup instructions to show the user. */
  readonly runHint?: string;
  /** How a control surface should present the "now connect the other side" step
   *  once the channel is running — declaratively, so each channel renders the
   *  same way without per-channel UI code. See {@link ChannelConnectStep}. */
  readonly connect?: ChannelConnectStep;
}

/**
 * Declares how a control surface (TUI `/channels`, the desktop Channels panel)
 * presents a channel's post-start "connect" step. The runtime VALUE this step
 * renders is the channel's {@link Channel.requestUrl} (Slack's Request URL,
 * Telegram's `t.me/<bot>` link); this descriptor only says how to render it, so
 * a new channel plugs in by declaring a `kind` rather than shipping bespoke UI.
 */
export interface ChannelConnectStep {
  /**
   * Presentation of the channel's runtime connect value:
   * - `qr`: render a QR of the value plus the value itself (e.g. scan/open a
   *   `t.me/<bot>` link, or a mobile pairing URL).
   * - `url`: show the value as a copyable URL the user pastes elsewhere
   *   (Slack's Events Request URL).
   * - `instructions`: static `steps`, no runtime value.
   */
  readonly kind: 'qr' | 'url' | 'instructions';
  /** Heading for the step, e.g. "Connect your Telegram". */
  readonly title?: string;
  /** One-line helper under the value, e.g. "Scan, or open the link and send /start". */
  readonly hint?: string;
  /** When true and the value is an https URL the user should OPEN (not paste),
   *  a control surface may show an "open externally" affordance. */
  readonly openable?: boolean;
  /** Label for the open affordance, e.g. "Open in Telegram". */
  readonly openLabel?: string;
  /** For `kind: 'instructions'` — static steps shown verbatim (no runtime value). */
  readonly steps?: ReadonlyArray<string>;
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
 * Flag an orchestrator (e.g. `moxxy onboard`) passes to a channel's `pair`
 * subcommand to say "hand control back once pairing succeeds". Every pair
 * flow's default is to keep the just-paired channel running until Ctrl+C —
 * right for a human running `moxxy <name> pair` standalone, wrong for a
 * caller that pairs as one step of a longer flow (its SIGINT handlers call
 * `process.exit`, which would kill the orchestrator). Pair flows check this
 * via {@link exitAfterPairRequested} after a successful pairing and stop the
 * channel + return 0 instead of blocking forever.
 */
export const EXIT_AFTER_PAIR_FLAG = 'exit-after-pair';

/** Whether the subcommand invocation asked for the pair-then-return contract. */
export function exitAfterPairRequested(
  ctx: Pick<ChannelSubcommandContext, 'args' | 'deps'>,
): boolean {
  // The CLI forwards subcommand argv flags both as `args.flags` and merged
  // into `deps.options`; accept either carrier so programmatic callers that
  // only build one of the two still opt in.
  return (
    ctx.args.flags[EXIT_AFTER_PAIR_FLAG] === true ||
    ctx.deps.options?.[EXIT_AFTER_PAIR_FLAG] === true
  );
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
