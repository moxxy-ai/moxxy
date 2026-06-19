import { EventLog } from '@moxxy/core';
import type {
  AgentsClientView,
  ApprovalDecision,
  ApprovalRequest,
  ApprovalResolver,
  ClientSession,
  CommandsClientView,
  ModesClientView,
  MoxxyEvent,
  PermissionContext,
  PermissionDecision,
  PendingToolCall,
  PermissionResolver,
  PermissionsClientView,
  ProvidersClientView,
  RequirementsClientView,
  RunTurnOptions,
  SessionId,
  SessionInfo,
  SessionLogReader,
  SkillsClientView,
  OpenSurfaceResult,
  SurfaceDataMessage,
  SurfaceInfo,
  SurfaceInputMessage,
  SurfaceSize,
  ToolsClientView,
  TranscribersClientView,
  SynthesizersClientView,
  TurnId,
} from '@moxxy/sdk';
import { JsonRpcPeer } from './jsonrpc.js';
import {
  makeProvidersView,
  makeModesView,
  makeToolsView,
  makeCommandsView,
  makeSkillsView,
  makeTranscribersView,
  makeSynthesizersView,
  makePermissionsView,
  makeMcpAdminView,
  makeProviderAdminView,
  makeWorkflowsView,
  type ViewContext,
  type McpAdminClientView,
  type ProviderAdminClientView,
  type WorkflowsClientView,
} from './client-views/index.js';
import type { Transport } from './transport.js';
import { connectUnixSocket } from './unix-socket.js';
import { runnerSocketPath } from './socket-path.js';
import {
  RUNNER_PROTOCOL_VERSION,
  RunnerMethod,
  RunnerNotification,
  type ApprovalConfirmParams,
  type AttachReplay,
  type AttachResult,
  type EventNotification,
  type InfoChangedNotification,
  type PermissionCheckParams,
  type ReplayStartNotification,
  type RunTurnResult,
  type SessionLoadHistoryParams,
  type SessionLoadHistoryResult,
  type SurfaceDataNotification,
  type SurfaceListResult,
  type TurnCompleteNotification,
} from './protocol.js';

/**
 * Per-turn event pump. The notification handler feeds it; `runTurn` drains it.
 * De-dupes by seq so the "replay what's already mirrored" priming and the live
 * stream can't double-emit the same event.
 */
class TurnStream {
  private readonly queue: MoxxyEvent[] = [];
  private readonly waiters: Array<() => void> = [];
  private readonly seen = new Set<number>();
  private done = false;
  private error: string | undefined;

  push(event: MoxxyEvent): void {
    if (this.seen.has(event.seq)) return;
    this.seen.add(event.seq);
    this.queue.push(event);
    this.wake();
  }

  finish(error?: string): void {
    if (this.done) return;
    this.done = true;
    this.error = error;
    this.wake();
  }

  private wake(): void {
    this.waiters.shift()?.();
  }

  async *iterate(): AsyncIterable<MoxxyEvent> {
    while (true) {
      while (this.queue.length > 0) yield this.queue.shift() as MoxxyEvent;
      if (this.done) break;
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    if (this.error) throw new Error(this.error);
  }
}

/**
 * How many buffered fast-turn completions to retain. The server fans
 * `turn.complete` out to every client, so an observer that never runs the turn
 * itself would grow {@link RemoteSession.completedTurns} unbounded without this
 * cap. A real fast-turn completion is drained by `runTurn` within a tick, so the
 * window only ever holds genuine, soon-to-be-consumed entries plus a little
 * slack for observed (foreign) turns; dropping the oldest is always safe.
 */
const MAX_COMPLETED_TURNS = 64;

export interface RemoteSessionOptions {
  readonly socketPath?: string;
  /** Channel role attaching, for the runner's logs. */
  readonly role?: string;
  /** Replay history from this seq (default 0 = full conversation). */
  readonly sinceSeq?: number;
  /**
   * Attach-time replay policy (protocol v6, default 'full'). 'none' / { tail }
   * skip (most of) the history replay — for clients whose UI history comes
   * from somewhere else (the desktop's NDJSON chat log). An older server
   * ignores the option and replays in full, which is still correct.
   */
  readonly replay?: AttachReplay;
  /** Inject a transport (tests). Defaults to a unix-socket connection. */
  readonly transport?: Transport;
  /**
   * Retry the initial connect this many times (default 5) with linear backoff,
   * smoothing over the race where the runner is up per `isRunnerUp()` but the
   * socket isn't quite accepting yet (or is mid-restart).
   */
  readonly connectRetries?: number;
  /**
   * Disable the kill-and-unlink-on-mismatch recovery (defaults to
   * enabled). Tests that drive a fake server typically pass their
   * own transport AND want the mismatch error to surface unchanged.
   */
  readonly skipMismatchRecovery?: boolean;
  /**
   * Extra TCP ports to free during mismatch recovery, in addition
   * to the well-known {@link DEFAULT_RUNNER_PORTS}. The desktop
   * supervisor and per-workspace runners can list whatever ports
   * their channels bind (Telegram, MCP, HTTP) so a stale daemon
   * doesn't leave them locked.
   */
  readonly extraPortsToFree?: ReadonlyArray<number>;
}

/**
 * Client-side proxy implementing {@link SessionLike} against a remote runner.
 * A channel handed a `RemoteSession` behaves exactly as if it held a local
 * `Session` - that interchangeability is the whole point of the split.
 *
 * State lives on the runner; this keeps a local mirror of the event log (fed
 * by the broadcast stream + an attach-time replay) so reads and `subscribe`
 * are instant, and proxies the rest over JSON-RPC. The runner calls *back* for
 * permission/approval decisions, which we answer from the resolvers a channel
 * installs.
 */
export class RemoteSession implements ClientSession {
  private readonly peer: JsonRpcPeer;
  private readonly mirror = new EventLog();
  private readonly turnStreams = new Map<TurnId, TurnStream>();
  // Registry facades - snapshot-backed reads, RPC-backed mutations. Assigned
  // in the constructor so each closes over `this` and re-reads `this.info`.
  readonly providers: ProvidersClientView;
  readonly modes: ModesClientView;
  readonly tools: ToolsClientView;
  readonly commands: CommandsClientView;
  readonly skills: SkillsClientView;
  readonly agents: AgentsClientView;
  readonly transcribers: TranscribersClientView;
  readonly synthesizers: SynthesizersClientView;
  readonly requirements: RequirementsClientView;
  readonly permissions: PermissionsClientView;
  readonly mcpAdmin: McpAdminClientView;
  readonly providerAdmin: ProviderAdminClientView;
  readonly workflows: WorkflowsClientView;
  /**
   * Turns that completed before their `runTurn` stream was registered. A fast
   * turn can finish on the runner before the client processes the `runTurn`
   * reply, so the `turn.complete` notification arrives with no stream to
   * finish. We record it here and apply it the moment the stream registers -
   * otherwise the stream would hang forever. Maps turnId -> error (or
   * undefined for a clean finish).
   *
   * Bounded (insertion-ordered, drop-oldest — same shape as
   * {@link DeliveryDedupeCache} in plugin-webhooks): the server broadcasts
   * `turn.complete` to EVERY attached client, so an observer that never calls
   * `runTurn` for a turn (the desktop watching a TUI-driven session) would
   * otherwise accumulate an entry per turn forever. Only the last
   * {@link MAX_COMPLETED_TURNS} are kept; a legit fast-turn completion is
   * consumed within a tick of arriving, so it is never the one evicted.
   */
  private readonly completedTurns = new Map<TurnId, string | undefined>();
  private permissionResolver: PermissionResolver | null = null;
  private approvalResolver: ApprovalResolver | null = null;
  private info: SessionInfo | null = null;
  /** Subscribers to `info.changed` pushes (see {@link onInfoChanged}). */
  private readonly infoListeners = new Set<(info: SessionInfo) => void>();
  /** Subscribers to `surface.data` frames (see {@link onSurfaceData}). */
  private readonly surfaceDataListeners = new Set<(data: SurfaceDataMessage) => void>();
  /**
   * The protocol version the SERVER reported at attach. Defaults to our own
   * version until the handshake resolves. Version-specific client methods (the
   * v4 workflow *builder* family) gate on this so a newer client attached to an
   * older runner degrades with a clear, actionable error instead of a raw
   * JSON-RPC method-not-found. Null until attached.
   */
  private serverProtocolVersion: number | null = null;

  constructor(transport: Transport) {
    this.peer = new JsonRpcPeer(transport);

    // Server->client notifications.
    this.peer.on(RunnerNotification.Event, (params) => {
      const { event } = params as EventNotification;
      this.mirror.ingest(event);
      this.turnStreams.get(event.turnId)?.push(event);
    });
    this.peer.on(RunnerNotification.TurnComplete, (params) => {
      const { turnId, error } = params as TurnCompleteNotification;
      const stream = this.turnStreams.get(turnId as TurnId);
      if (stream) stream.finish(error);
      // Record regardless: the stream may not be registered yet (fast turn).
      else this.recordCompletedTurn(turnId as TurnId, error);
    });
    this.peer.on(RunnerNotification.InfoChanged, (params) => {
      this.info = (params as InfoChangedNotification).info;
      // Fan out to subscribers (the desktop's SessionDriver forwards this to
      // the renderer so Settings panels refresh without polling). Listener
      // errors are swallowed — a bad subscriber must not break the mirror.
      for (const fn of this.infoListeners) {
        try {
          fn(this.info);
        } catch {
          /* ignore */
        }
      }
    });
    this.peer.on(RunnerNotification.SurfaceData, (params) => {
      // A frame from an open surface (v8). Fan out to pane subscribers (the
      // desktop's SessionDriver forwards each to the renderer). Listener errors
      // are swallowed so a bad pane can't break the stream.
      const { data } = params as SurfaceDataNotification;
      for (const fn of this.surfaceDataListeners) {
        try {
          fn(data);
        } catch {
          /* ignore */
        }
      }
    });
    this.peer.on(RunnerNotification.ReplayStart, (params) => {
      // The server announces the first seq it will replay/stream on this
      // connection (v6) before any event arrives. Rebase the (still empty)
      // mirror so a partial replay ('none' / { tail }) ingests contiguously.
      const { fromSeq } = params as ReplayStartNotification;
      this.mirror.rebase(fromSeq);
    });
    this.peer.on(RunnerNotification.SessionReset, () => {
      // The runner wiped its authoritative log (a /new from this client or
      // any other). Clear the mirror in lockstep: `ingest` accepts only
      // seq === mirror.length, so post-reset events restarting at seq 0 are
      // accepted exactly when the mirror is empty again. The mirror's own
      // clear listeners fire, letting channel UIs observe the wipe.
      this.mirror.clear();
    });

    // Server->client requests (the runner asks us to decide).
    this.peer.handle(RunnerMethod.PermissionCheck, (params) => {
      const { call, ctx } = params as PermissionCheckParams;
      if (!this.permissionResolver) {
        return { mode: 'deny', reason: 'no permission resolver on client' } satisfies PermissionDecision;
      }
      return this.permissionResolver.check(call as PendingToolCall, ctx as PermissionContext);
    });
    this.peer.handle(RunnerMethod.ApprovalConfirm, (params) => {
      const { request } = params as ApprovalConfirmParams;
      if (!this.approvalResolver) return defaultApproval(request);
      return this.approvalResolver.confirm(request);
    });

    // If the runner dies, fail any in-flight turns rather than hanging.
    this.peer.onClose(() => {
      for (const stream of this.turnStreams.values()) stream.finish('runner disconnected');
      this.turnStreams.clear();
      // Drop any buffered fast-turn completions too — there is no surviving
      // `runTurn` left to consume them, so retaining them only leaks.
      this.completedTurns.clear();
    });

    // Each sub-surface facade lives in its own module under `client-views/`;
    // they share only this thin context (peer + info mirror + protocol gate).
    const view: ViewContext = {
      peer: this.peer,
      info: () => this.info,
      requireInfo: () => this.requireInfo(),
      requireServerProtocol: (minVersion, feature) =>
        this.requireServerProtocol(minVersion, feature),
    };
    this.providers = makeProvidersView(view);
    this.modes = makeModesView(view);
    this.tools = makeToolsView(view);
    this.commands = makeCommandsView(view);
    this.skills = makeSkillsView(view);
    this.agents = { list: () => [] };
    this.transcribers = makeTranscribersView(view);
    this.synthesizers = makeSynthesizersView(view);
    this.requirements = { check: () => ({ ready: false, issues: [] }) };
    this.permissions = makePermissionsView(view);
    this.mcpAdmin = makeMcpAdminView(view);
    this.providerAdmin = makeProviderAdminView(view);
    this.workflows = makeWorkflowsView(view);
  }

  /**
   * Buffer a completion whose `runTurn` stream isn't registered yet (fast turn)
   * or that belongs to a turn this client only observes. Bounded, insertion-
   * ordered drop-oldest — mirrors {@link DeliveryDedupeCache}: re-insert on
   * update so a refreshed entry is the youngest, then evict the oldest once over
   * {@link MAX_COMPLETED_TURNS}. A pending fast-turn entry is drained by
   * `runTurn` within a tick, so it can't be the one evicted under normal load.
   */
  private recordCompletedTurn(turnId: TurnId, error: string | undefined): void {
    // Map preserves insertion order; delete-then-set keeps recency accurate.
    this.completedTurns.delete(turnId);
    this.completedTurns.set(turnId, error);
    if (this.completedTurns.size > MAX_COMPLETED_TURNS) {
      const oldest = this.completedTurns.keys().next();
      if (!oldest.done) this.completedTurns.delete(oldest.value);
    }
  }

  /**
   * Providers the runner has activated. Exposed as a plain field (the TUI
   * model-picker reads it via a structural cast, same as it does on a local
   * Session) so switching models isn't blocked by an empty "ready" set.
   */
  get readyProviders(): Set<string> {
    return new Set(this.info?.readyProviders ?? []);
  }

  /** Handshake. Resolves once history has been replayed into the mirror. */
  async attach(role: string, sinceSeq: number, replay?: AttachReplay): Promise<void> {
    const result = await this.peer.request<AttachResult>(RunnerMethod.Attach, {
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      role,
      sinceSeq,
      ...(replay ? { replay } : {}),
    });
    this.info = result.info;
    // Record the server's protocol so version-gated methods can degrade
    // cleanly against an older runner (tolerant negotiation, Part A). A server
    // that predates this field reports nothing → assume it matches us.
    this.serverProtocolVersion =
      typeof result.protocolVersion === 'number'
        ? result.protocolVersion
        : RUNNER_PROTOCOL_VERSION;
  }

  /**
   * The protocol version the attached runner speaks (its own, from the
   * handshake). Lets a capability-detecting caller (e.g. the desktop's visual
   * builder, see #146) decide whether a version-gated feature is available on
   * THIS runner before invoking it. Null until attached.
   */
  get runnerProtocolVersion(): number | null {
    return this.serverProtocolVersion;
  }

  /**
   * Guard a method that only exists on a server at/after `minVersion`. Throws a
   * clear, actionable error (not a raw JSON-RPC method-not-found) when the
   * attached runner is older — the desktop case after a JS hot-update outran
   * its bundled CLI.
   */
  private requireServerProtocol(minVersion: number, feature: string): void {
    const server = this.serverProtocolVersion;
    if (server !== null && server < minVersion) {
      throw new Error(
        `${feature} is not supported by this runner ` +
          `(runner protocol v${server}, needs v${minVersion}) — update the moxxy CLI to continue.`,
      );
    }
  }

  get id(): SessionId {
    return this.requireInfo().sessionId;
  }

  get cwd(): string {
    return this.requireInfo().cwd;
  }

  get log(): SessionLogReader & { clear(): void } {
    // The mirror is a local EventLog. NOTE: `clear()` here resets THIS
    // client's view only — it desyncs the mirror against the runner's live
    // seq stream. For `/new`, call {@link reset} instead: the runner clears
    // its authoritative log and notifies every mirror (including this one).
    return this.mirror;
  }

  /**
   * `SessionLike.reset` — server-authoritative `/new`. The runner aborts
   * in-flight turns, clears its log + persisted JSONL, and broadcasts
   * `session.reset`; our mirror clears when that notification lands (it is
   * sent before this RPC's reply on the same ordered socket, so the mirror
   * is already empty by the time this resolves). Rejects when the runner is
   * unreachable — callers must surface that instead of claiming success.
   */
  async reset(): Promise<void> {
    await this.peer.request(RunnerMethod.SessionReset, {});
  }

  /**
   * Page the runner's AUTHORITATIVE event history (protocol v10). Backs the
   * desktop's dual-history retirement — the renderer reads transcript history
   * from the runner instead of its own NDJSON chat store. Newest-first paging:
   * pass `before: null` for the newest page, then feed each result's
   * `prevCursor` back as `before` to walk older pages until `prevCursor` is
   * `null` (start of history).
   *
   * GATED on the server reporting protocol v10+. Against an OLDER runner this
   * throws a clear, actionable error (not a raw method-not-found) — the desktop
   * CATCHES it and falls back to its existing NDJSON path, so no transcript
   * ever goes blank when the runner predates this method.
   */
  async loadHistory(
    before: number | null,
    limit: number,
  ): Promise<SessionLoadHistoryResult> {
    this.requireServerProtocol(10, 'Loading session history from the runner');
    return this.peer.request<SessionLoadHistoryResult>(RunnerMethod.SessionLoadHistory, {
      before,
      limit,
    } satisfies SessionLoadHistoryParams);
  }

  getInfo(): SessionInfo {
    return this.requireInfo();
  }

  /**
   * Subscribe to runner `info.changed` pushes (registry snapshot changes —
   * provider/mode/MCP/workflow mutations, including ones made by tools inside
   * a turn). Fires after the local `getInfo()` mirror has been updated, so a
   * listener can re-read it synchronously. Returns an unsubscribe fn.
   */
  onInfoChanged(fn: (info: SessionInfo) => void): () => void {
    this.infoListeners.add(fn);
    return () => this.infoListeners.delete(fn);
  }

  // --- Surfaces (protocol v8) ----------------------------------------------
  // Backs the desktop's agentic panes (shared terminal, in-window browser).
  // Gated on the SERVER's reported version so a v8 client attached to an older
  // runner (a desktop whose JS hot-update outran its bundled CLI) gets a clear
  // "update the CLI" error instead of a raw method-not-found.

  /** Subscribe to `surface.data` frames from every open surface. Returns an
   *  unsubscribe fn. */
  onSurfaceData(fn: (data: SurfaceDataMessage) => void): () => void {
    this.surfaceDataListeners.add(fn);
    return () => this.surfaceDataListeners.delete(fn);
  }

  /** Available surface kinds + availability. Empty when no surface plugin is
   *  loaded (or the runner predates v8). */
  async listSurfaces(): Promise<ReadonlyArray<SurfaceInfo>> {
    if (this.serverProtocolVersion !== null && this.serverProtocolVersion < 8) return [];
    return this.peer.request<SurfaceListResult>(RunnerMethod.SurfaceList, {});
  }

  /** Open (or attach to the shared) surface instance for a kind. */
  async openSurface(kind: string): Promise<OpenSurfaceResult> {
    this.requireServerProtocol(8, 'Opening a surface');
    return this.peer.request<OpenSurfaceResult>(RunnerMethod.SurfaceOpen, { kind });
  }

  /** Relay a viewer input message (keystroke, mouse, navigate) to a surface. */
  async inputSurface(surfaceId: string, message: SurfaceInputMessage): Promise<void> {
    this.requireServerProtocol(8, 'Driving a surface');
    await this.peer.request(RunnerMethod.SurfaceInput, { surfaceId, message });
  }

  /** Resize an open surface's viewport. */
  async resizeSurface(surfaceId: string, size: SurfaceSize): Promise<void> {
    this.requireServerProtocol(8, 'Resizing a surface');
    await this.peer.request(RunnerMethod.SurfaceResize, { surfaceId, size });
  }

  /** Detach an open surface instance. */
  async closeSurface(surfaceId: string): Promise<void> {
    this.requireServerProtocol(8, 'Closing a surface');
    await this.peer.request(RunnerMethod.SurfaceClose, { surfaceId });
  }

  async *runTurn(prompt: string, opts: RunTurnOptions = {}): AsyncIterable<MoxxyEvent> {
    const result = await this.peer.request<RunTurnResult>(RunnerMethod.RunTurn, {
      prompt,
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.systemPrompt ? { systemPrompt: opts.systemPrompt } : {}),
      ...(opts.maxIterations ? { maxIterations: opts.maxIterations } : {}),
      ...(opts.attachments && opts.attachments.length > 0 ? { attachments: opts.attachments } : {}),
      // Pre-minted client turn id (v6) so per-turn event filters match. The
      // reply's turnId stays authoritative: an older server ignores ours and
      // mints its own.
      ...(opts.turnId ? { turnId: opts.turnId } : {}),
    });
    const turnId = result.turnId as TurnId;

    const stream = new TurnStream();
    this.turnStreams.set(turnId, stream);
    // Prime with anything already mirrored for this turn - a fast turn can land
    // events (and even complete) before this reply was processed.
    for (const event of this.mirror.byTurn(turnId)) stream.push(event);
    if (this.completedTurns.has(turnId)) {
      stream.finish(this.completedTurns.get(turnId));
      this.completedTurns.delete(turnId);
    }

    const onAbort = (): void => {
      void this.peer.request(RunnerMethod.Abort, { turnId }).catch(() => undefined);
    };
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      yield* stream.iterate();
    } finally {
      this.turnStreams.delete(turnId);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }

  setPermissionResolver(resolver: PermissionResolver): void {
    this.permissionResolver = resolver;
    void this.peer.request(RunnerMethod.SetResolver, { permission: true }).catch(() => undefined);
  }

  setApprovalResolver(resolver: ApprovalResolver | null): void {
    this.approvalResolver = resolver;
    void this.peer
      .request(RunnerMethod.SetResolver, { approval: resolver != null })
      .catch(() => undefined);
  }

  async close(_reason?: string): Promise<void> {
    this.peer.close();
  }

  /**
   * Register a callback for when the link to the runner drops (runner stopped,
   * crashed, or socket closed). Channels use this to surface a disconnect and
   * exit cleanly rather than hang on a dead session. Fires at most once.
   */
  onClose(handler: () => void): void {
    this.peer.onClose(() => handler());
  }

  /** False once the runner link has dropped. */
  get connected(): boolean {
    return !this.peer.isClosed;
  }

  private requireInfo(): SessionInfo {
    if (!this.info) throw new Error('RemoteSession not attached yet - call connectRemoteSession()');
    return this.info;
  }
}

function defaultApproval(request: ApprovalRequest): ApprovalDecision {
  return { optionId: request.defaultOptionId ?? request.options[0]?.id ?? '' };
}

/**
 * Connect to a running runner and return an attached {@link RemoteSession}.
 * Throws if no runner is listening (callers decide whether to self-host).
 *
 * Protocol-mismatch recovery: with tolerant negotiation (Part A) a server
 * only ever throws "protocol mismatch" for a GENUINELY INCOMPATIBLE client
 * (one below the server's MIN_COMPATIBLE floor) — additive skew (a newer
 * client on an older server, e.g. v4-client/v3-runner) attaches cleanly and
 * degrades per-method instead. A thrown mismatch is therefore a real stale
 * daemon: an older `moxxy serve` left running after the user upgraded moxxy,
 * which a fresh spawn fixes. We proactively kill it + unlink the socket so the
 * caller's next attempt (CLI self-host fallback, desktop supervisor retry)
 * finds a clean slate.
 *
 * IMPORTANT: a fresh spawn only fixes this when the new runner is genuinely
 * newer. If respawning yields the SAME incompatible version (the desktop case:
 * the bundled CLI is pinned), the caller MUST NOT retry forever — it has to
 * surface a terminal, actionable error. {@link connectRemoteSession} re-throws
 * the original mismatch so the caller (supervisor) can detect a persistent
 * incompatibility across attempts and stop; recovery here is best-effort
 * cleanup, not a guarantee the next attempt succeeds.
 *
 * Default ports also cleared: 4040 (web surface — locks out a fresh
 * `moxxy serve` even after the daemon is dead).
 */
const DEFAULT_RUNNER_PORTS: ReadonlyArray<number> = [4040];

export async function connectRemoteSession(
  opts: RemoteSessionOptions = {},
): Promise<RemoteSession> {
  const socketPath = opts.socketPath ?? runnerSocketPath();
  const transport =
    opts.transport ??
    (await connectWithRetry(socketPath, opts.connectRetries ?? 5));
  const session = new RemoteSession(transport);
  try {
    await session.attach(opts.role ?? 'client', opts.sinceSeq ?? 0, opts.replay);
    return session;
  } catch (err) {
    await maybeRecoverFromMismatch(err, socketPath, opts);
    throw err;
  }
}

/**
 * True iff `err` is the runner's hard protocol-mismatch error (a client below
 * the server's compatibility floor — a real stale daemon). Exported so callers
 * that supervise reconnects (the desktop supervisor) can distinguish a
 * genuinely-incompatible runner — which a respawn from the SAME binary will NOT
 * fix, so they must stop retrying — from a transient disconnect.
 */
export function isProtocolMismatchError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /protocol mismatch/i.test(msg);
}

/** Run recovery if (a) the error is a protocol mismatch, (b) the
 *  caller didn't inject a fake transport, and (c) the caller didn't
 *  opt out. Swallows recovery errors — the original attach error is
 *  what the caller needs to see. */
async function maybeRecoverFromMismatch(
  err: unknown,
  socketPath: string,
  opts: RemoteSessionOptions,
): Promise<void> {
  if (opts.transport || opts.skipMismatchRecovery) return;
  if (!isProtocolMismatchError(err)) return;
  try {
    await killAndUnlinkRunner(socketPath, [...DEFAULT_RUNNER_PORTS, ...(opts.extraPortsToFree ?? [])]);
  } catch {
    /* best-effort — every step is already swallowed individually */
  }
}

/** Kill the process holding `socketPath` (and any processes listening
 *  on the given TCP ports), then unlink the socket file so the next
 *  bind succeeds. Best-effort throughout — every individual step is
 *  swallowed so a partial environment (no `lsof`, no permission to
 *  kill, etc.) still progresses through the rest of the recovery.
 */
async function killAndUnlinkRunner(
  socketPath: string,
  ports: ReadonlyArray<number> = DEFAULT_RUNNER_PORTS,
): Promise<void> {
  await killProcessOwning(socketPath);
  for (const port of ports) {
    await killProcessOnPort(port);
  }
  await unlinkSocket(socketPath);
}

// ---- internals: process hunting -----------------------------------------

/** Kill the moxxy process bound to a unix-domain socket file. */
async function killProcessOwning(socketPath: string): Promise<void> {
  const pids = await pidsListeningOnSocket(socketPath);
  for (const pid of pids) {
    if (await isMoxxyProcess(pid)) await terminate(pid);
  }
}

/** Kill the moxxy process listening on a TCP port (non-moxxy holders are
 *  left alone — 4040 is also ngrok's local-UI default, and the web surface
 *  falls back to an ephemeral port when its default is taken). */
async function killProcessOnPort(port: number): Promise<void> {
  const pids = await pidsListeningOnPort(port);
  for (const pid of pids) {
    if (await isMoxxyProcess(pid)) await terminate(pid);
  }
}

/** Identity gate before any signal: the recovery's intent is to clear a
 *  STALE MOXXY daemon, never an unrelated process that happens to hold a
 *  default port/socket. A PID whose command line we cannot read fails the
 *  gate — never kill what we can't name. (The CLI sets `process.title`
 *  to `moxxy …`, so even dev-checkout daemons match.) */
async function isMoxxyProcess(pid: number): Promise<boolean> {
  if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) return false;
  const command = await pidCommand(pid);
  return command.length > 0 && isMoxxyCommandLine(command);
}

/**
 * Decide whether a `ps -o command=` line names a moxxy DAEMON — not merely any
 * process whose argv happens to contain "moxxy" somewhere. A loose substring
 * (`/moxxy/i` over the whole line) would SIGKILL an unrelated same-user process
 * that just references a moxxy path: an editor open on `~/moxxy/foo`, a `grep
 * moxxy`, a shell that `cd`'d into `~/moxxy`. We only want the executable's own
 * identity, so we look at the FIRST token's basename: the moxxy CLI sets
 * `process.title` to `moxxy …` (so the line starts with `moxxy`), and a binary
 * launched directly is `…/moxxy` / `…/moxxy-serve`. An arg three tokens in that
 * mentions moxxy never matches.
 */
export function isMoxxyCommandLine(command: string): boolean {
  const trimmed = command.trim();
  if (trimmed.length === 0) return false;
  // The first whitespace-delimited token is the executable (or process.title's
  // leading word). Its basename (after the last path separator) is the identity.
  const first = trimmed.split(/\s+/)[0] ?? '';
  const base = first.split(/[\\/]/).pop() ?? first;
  // Match `moxxy`, `moxxy-serve`, `moxxy.js`, etc. — the binary's own name (or
  // the leading word of the CLI's `process.title`) — but never an arbitrary
  // token that merely embeds "moxxy" (e.g. `bigmoxxy`, `moxxyish`).
  return /^moxxy([-_.]|$)/i.test(base);
}

/** A PID's command line via `ps`. Empty when the process is gone / unknowable. */
async function pidCommand(pid: number): Promise<string> {
  const { spawn } = await import('node:child_process');
  return await new Promise<string>((resolve) => {
    let out = '';
    try {
      const child = spawn('ps', ['-p', String(pid), '-o', 'command='], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      child.stdout.on('data', (b) => {
        out += b.toString();
      });
      child.on('error', () => resolve(''));
      child.on('close', () => resolve(out.trim()));
    } catch {
      resolve('');
    }
  });
}

/** SIGTERM, grace, SIGKILL. Skips self. Swallows EPERM / ESRCH. */
async function terminate(pid: number): Promise<void> {
  if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) return;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    /* may already be dead, or we lack permission */
  }
  await new Promise((r) => setTimeout(r, 400));
  try {
    process.kill(pid, 0); // 0 = liveness probe
    process.kill(pid, 'SIGKILL');
  } catch {
    /* dead → good */
  }
}

/** Find every PID with an open file descriptor for a unix socket. */
async function pidsListeningOnSocket(socketPath: string): Promise<ReadonlyArray<number>> {
  if (process.platform === 'win32') return [];
  return await runLsof(['-t', socketPath]);
}

/** Find every PID listening on a TCP port. */
async function pidsListeningOnPort(port: number): Promise<ReadonlyArray<number>> {
  if (process.platform === 'win32') return [];
  // `-iTCP:PORT -sTCP:LISTEN` only catches actively listening sockets,
  // not transient client connections to that port.
  return await runLsof(['-t', `-iTCP:${port}`, '-sTCP:LISTEN']);
}

/** Run lsof with the given args and return the PIDs it prints (one per
 *  line). Returns empty on error / missing binary. */
async function runLsof(args: ReadonlyArray<string>): Promise<ReadonlyArray<number>> {
  const { spawn } = await import('node:child_process');
  return await new Promise<ReadonlyArray<number>>((resolve) => {
    let out = '';
    try {
      const child = spawn('lsof', [...args], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      child.stdout.on('data', (b) => {
        out += b.toString();
      });
      child.on('error', () => resolve([]));
      child.on('close', () => resolve(parsePids(out)));
    } catch {
      resolve([]);
    }
  });
}

function parsePids(out: string): ReadonlyArray<number> {
  const seen = new Set<number>();
  for (const line of out.split('\n')) {
    const n = parseInt(line.trim(), 10);
    if (Number.isFinite(n) && n > 0) seen.add(n);
  }
  return [...seen];
}

/** Remove a unix-socket file. No-op if it's already gone. */
async function unlinkSocket(socketPath: string): Promise<void> {
  try {
    const fs = await import('node:fs');
    fs.unlinkSync(socketPath);
  } catch {
    /* fine — already removed, or never existed */
  }
}

/** Connect, retrying with linear backoff to ride over a brief runner hiccup. */
async function connectWithRetry(socketPath: string, retries: number): Promise<Transport> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await connectUnixSocket(socketPath);
    } catch (err) {
      lastErr = err;
      if (i < retries) await new Promise((r) => setTimeout(r, 100 * (i + 1)));
    }
  }
  throw lastErr;
}
