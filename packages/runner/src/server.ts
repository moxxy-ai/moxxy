import { AsyncLocalStorage } from 'node:async_hooks';
import type { Session } from '@moxxy/core';
import { newTurnId } from '@moxxy/core';
import { asTurnId, createMutex } from '@moxxy/sdk';
import type {
  ApprovalDecision,
  ApprovalRequest,
  ApprovalResolver,
  MoxxyEvent,
  PendingToolCall,
  PermissionContext,
  PermissionDecision,
  PermissionResolver,
  TurnId,
  UserPromptAttachment,
} from '@moxxy/sdk';
import { JsonRpcPeer } from './jsonrpc.js';
import type { Transport, TransportServer } from './transport.js';
import { createUnixSocketServer } from './unix-socket.js';
import { runnerSocketPath } from './socket-path.js';
import {
  MIN_COMPATIBLE_PROTOCOL_VERSION,
  RUNNER_PROTOCOL_VERSION,
  RunnerMethod,
  RunnerNotification,
  abortParamsSchema,
  attachParamsSchema,
  runTurnParamsSchema,
  setResolverParamsSchema,
  type AttachResult,
  type RunTurnResult,
} from './protocol.js';
import {
  handleProviderSetActive,
  handleProviderSetEnabled,
  handleProviderRefreshReady,
  handleProviderConfigure,
  handleTranscribe,
  handleSynthesize,
  handleMcpListServers,
  handleMcpEnableAndAttach,
  handleMcpDetach,
  handleWorkflowList,
  handleWorkflowSetEnabled,
  handleWorkflowRun,
  handleWorkflowValidateDraft,
  handleWorkflowSave,
  handleWorkflowGetRun,
  handleWorkflowResume,
  handleSurfaceList,
  handleSurfaceOpen,
  handleSurfaceInput,
  handleSurfaceResize,
  handleSurfaceClose,
  handleModeSetActive,
  handleSessionSetReasoning,
  handleSessionLoadHistory,
  handlePermissionAddAllow,
  handleCommandRun,
  type HandlerContext,
} from './handlers/index.js';

/**
 * Upper bound on how long the runner waits for a server->client request
 * (permission.check / approval.confirm) before falling through to deny/default.
 * Generous because the human at the client is the one answering — but bounded so
 * a connected-but-unresponsive client can't stall the turn (and the tool gate)
 * indefinitely. The turn's own abort signal also rejects the request early.
 */
const CLIENT_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

/** One attached client and what it has opted into answering. */
interface ConnectedClient {
  readonly peer: JsonRpcPeer;
  role: string;
  attached: boolean;
  handlesPermission: boolean;
  handlesApproval: boolean;
  /** Turns this client started - aborted if it disconnects. */
  readonly turns: Set<TurnId>;
}

/** Carried through the turn's async context so resolvers can find the owner. */
interface TurnScope {
  readonly client: ConnectedClient;
  readonly turnId: TurnId;
}

/** An in-flight turn: its abort controller plus the connection that started it. */
interface TurnEntry {
  readonly controller: AbortController;
  readonly owner: ConnectedClient;
}

/**
 * Exposes a {@link Session} over a transport so thin clients can attach.
 *
 * The server owns the Session and the agentic loop. Clients drive turns via
 * `runTurn`, observe everything through a broadcast event stream, and answer
 * `permission.check` / `approval.confirm` for the turns they started. Per-turn
 * routing rides on an `AsyncLocalStorage` scope established around each turn -
 * so a permission prompt raised deep inside a strategy is delivered back to
 * exactly the client that asked for the turn. Turns run *outside* any scope
 * (e.g. a self-hosting TUI calling `session.runTurn` directly) fall through to
 * the resolvers that were installed before the server wrapped the session.
 */
export class RunnerServer {
  private readonly clients = new Set<ConnectedClient>();
  private readonly turnControllers = new Map<TurnId, TurnEntry>();
  private readonly scope = new AsyncLocalStorage<TurnScope>();
  private readonly logUnsub: () => void;
  private readonly logClearUnsub: () => void;
  private readonly modesUnsub: () => void;
  private readonly surfacesUnsub: () => void;
  /**
   * Resolvers for unscoped (local) turns - the fall-through path. Seeded from
   * whatever was installed before we wrapped the session, then kept current by
   * intercepting later `setPermissionResolver` / `setApprovalResolver` calls
   * (e.g. a self-hosting TUI mounting) so those don't clobber routing.
   */
  private fallbackPermission: PermissionResolver;
  private fallbackApproval: ApprovalResolver | null;
  private closed = false;
  /**
   * Serializes this runner's preferences read-modify-write handlers
   * ({@link handleProviderSetActive} / {@link handleProviderSetEnabled}).
   *
   * Invariant #5: a whole-file RMW store needs an atomic write PLUS a
   * per-instance promise-mutex. The atomic-write half lives in core's
   * `savePreferences`; the serialization half lives here because the
   * `disabledProviders` toggle reads the current set via `loadPreferences`
   * BEFORE handing the merged patch to `savePreferences` — that load→compute
   * step spans core's own critical section, so two overlapping toggles could
   * otherwise both read the same set and the second clobber the first. Running
   * the whole load→compute→save body under one mutex makes every prefs write
   * issued by this runner serialize. (Core would ideally expose a single
   * mutexed updater covering all callers; until it does, cross-process /
   * cross-runner prefs writes remain best-effort behind the atomic rename.)
   */
  private readonly prefsMutex = createMutex();
  /**
   * The shared context handed to every per-domain handler module under
   * `handlers/`. The handlers used to be private methods on this class closing
   * over `this`; they now take this slice (session + prefs mutex + the
   * broadcast-snapshot helper) so each domain lives in its own file while this
   * class keeps the dispatch wiring + turn/attach/resolver logic.
   */
  private readonly handlerCtx: HandlerContext;

  constructor(
    private readonly session: Session,
    private readonly transport: TransportServer,
  ) {
    this.handlerCtx = {
      session,
      prefsMutex: this.prefsMutex,
      broadcastInfo: () => this.broadcastInfo(),
    };
    this.fallbackPermission = session.resolver;
    this.fallbackApproval = session.approvalResolver;
    this.installRoutingResolvers();
    this.transport.onConnection((t) => this.onConnection(t));
    this.logUnsub = session.log.subscribe((event) => this.broadcastEvent(event));
    // Mirror a log wipe to every attached client. Subscribing to the log's
    // clear listener (rather than broadcasting inside handleSessionReset)
    // covers BOTH reset paths — the session.reset RPC and a self-hosting
    // channel clearing the local log directly — so mirrors can never desync
    // against a wiped log whose next event restarts at seq 0.
    this.logClearUnsub = session.log.onClear(() =>
      this.broadcast(RunnerNotification.SessionReset, {}),
    );
    // Mirror active-mode changes to clients — covers both the SetMode RPC and a
    // mode handing off to another mode post-turn.
    this.modesUnsub = session.modes.onActiveChange(() => this.broadcastInfo());
    // Multiplex every open surface's output to all attached clients (v8). The
    // host emits one SurfaceDataMessage per frame; a client routes it to the
    // matching pane by surfaceId and ignores surfaces it isn't showing.
    this.surfacesUnsub = session.surfaces.onData((data) =>
      this.broadcast(RunnerNotification.SurfaceData, { data }),
    );
  }

  get address(): string {
    return this.transport.address;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.logUnsub();
    this.logClearUnsub();
    this.modesUnsub();
    this.surfacesUnsub();
    void this.session.surfaces.closeAll();
    for (const client of this.clients) client.peer.close();
    this.clients.clear();
    await this.transport.close();
  }

  // --- connection lifecycle ------------------------------------------------

  private onConnection(transport: Transport): void {
    const peer = new JsonRpcPeer(transport);
    const client: ConnectedClient = {
      peer,
      role: 'unknown',
      attached: false,
      handlesPermission: false,
      handlesApproval: false,
      turns: new Set(),
    };
    this.clients.add(client);

    const ctx = this.handlerCtx;
    // Turn / attach / resolver routing stay on the class (they touch per-client
    // and per-turn state). Every domain handler delegates to its module.
    peer.handle(RunnerMethod.Attach, (raw) => this.handleAttach(client, raw));
    peer.handle(RunnerMethod.GetInfo, () => this.session.getInfo());
    peer.handle(RunnerMethod.RunTurn, (raw) => this.handleRunTurn(client, raw));
    peer.handle(RunnerMethod.Abort, (raw) => this.handleAbort(client, raw));
    peer.handle(RunnerMethod.SessionReset, () => this.handleSessionReset());
    peer.handle(RunnerMethod.SessionLoadHistory, (raw) => handleSessionLoadHistory(ctx, raw));
    peer.handle(RunnerMethod.SetResolver, (raw) => this.handleSetResolver(client, raw));
    peer.handle(RunnerMethod.ModeSetActive, (raw) => handleModeSetActive(ctx, raw));
    peer.handle(RunnerMethod.SessionSetReasoning, (raw) => handleSessionSetReasoning(ctx, raw));
    peer.handle(RunnerMethod.ProviderSetActive, (raw) => handleProviderSetActive(ctx, raw));
    peer.handle(RunnerMethod.ProviderSetEnabled, (raw) => handleProviderSetEnabled(ctx, raw));
    peer.handle(RunnerMethod.ProviderRefreshReady, () => handleProviderRefreshReady(ctx));
    peer.handle(RunnerMethod.ProviderConfigure, (raw) => handleProviderConfigure(ctx, raw));
    peer.handle(RunnerMethod.PermissionAddAllow, (raw) => handlePermissionAddAllow(ctx, raw));
    peer.handle(RunnerMethod.CommandRun, (raw) => handleCommandRun(ctx, raw));
    peer.handle(RunnerMethod.Transcribe, (raw) => handleTranscribe(ctx, raw));
    peer.handle(RunnerMethod.Synthesize, (raw) => handleSynthesize(ctx, raw));
    peer.handle(RunnerMethod.McpListServers, () => handleMcpListServers(ctx));
    peer.handle(RunnerMethod.McpEnableAndAttach, (raw) => handleMcpEnableAndAttach(ctx, raw));
    peer.handle(RunnerMethod.McpDetach, (raw) => handleMcpDetach(ctx, raw));
    peer.handle(RunnerMethod.WorkflowList, () => handleWorkflowList(ctx));
    peer.handle(RunnerMethod.WorkflowSetEnabled, (raw) => handleWorkflowSetEnabled(ctx, raw));
    peer.handle(RunnerMethod.WorkflowRun, (raw) => handleWorkflowRun(ctx, raw));
    peer.handle(RunnerMethod.WorkflowValidateDraft, (raw) => handleWorkflowValidateDraft(ctx, raw));
    peer.handle(RunnerMethod.WorkflowSave, (raw) => handleWorkflowSave(ctx, raw));
    peer.handle(RunnerMethod.WorkflowGetRun, (raw) => handleWorkflowGetRun(ctx, raw));
    peer.handle(RunnerMethod.WorkflowResume, (raw) => handleWorkflowResume(ctx, raw));
    peer.handle(RunnerMethod.SurfaceList, () => handleSurfaceList(ctx));
    peer.handle(RunnerMethod.SurfaceOpen, (raw) => handleSurfaceOpen(ctx, raw));
    peer.handle(RunnerMethod.SurfaceInput, (raw) => handleSurfaceInput(ctx, raw));
    peer.handle(RunnerMethod.SurfaceResize, (raw) => handleSurfaceResize(ctx, raw));
    peer.handle(RunnerMethod.SurfaceClose, (raw) => handleSurfaceClose(ctx, raw));

    peer.onClose(() => this.onDisconnect(client));
  }

  private onDisconnect(client: ConnectedClient): void {
    this.clients.delete(client);
    // Tear down any turns this client was driving - there's no one left to
    // answer their prompts or consume their output.
    for (const turnId of client.turns) {
      this.turnControllers.get(turnId)?.controller.abort('owning client disconnected');
    }
  }

  // --- request handlers ----------------------------------------------------

  private handleAttach(client: ConnectedClient, raw: unknown): AttachResult {
    const params = attachParamsSchema.parse(raw);
    // Tolerant negotiation: accept any client whose version is compatible with
    // our core session protocol (>= MIN_COMPATIBLE). All skew through v4 is
    // additive, so a newer client just won't call methods we lack, and an
    // older-but-compatible client never used the methods we added. Only a
    // client below the compatibility floor is genuinely broken — that is the
    // sole hard "mismatch" (a real stale daemon the desktop should replace).
    // The client gets our own version back in the result and gates
    // version-specific methods on it.
    if (params.protocolVersion < MIN_COMPATIBLE_PROTOCOL_VERSION) {
      throw new Error(
        `runner protocol mismatch: server v${RUNNER_PROTOCOL_VERSION}, client v${params.protocolVersion}`,
      );
    }
    client.role = params.role;
    client.attached = true;
    // Replay per the client's `replay` policy (v6; default 'full'). The start
    // seq is announced via `replay.start` BEFORE the loop so the client can
    // rebase its (empty) mirror — its `ingest` accepts only the next-expected
    // seq, so a partial replay without the rebase would drop every event and
    // permanently desync the mirror. `sinceSeq` predates `replay` and stays on
    // the wire for compatibility but is intentionally ignored (pre-v6 clients
    // can't rebase, so they always need the full replay). This loop is fully
    // synchronous, so no live event can interleave before it finishes - every
    // later event arrives exactly once via broadcast.
    const replay = params.replay ?? 'full';
    // Compute the replay start as a SEQ, not an array index. EventLog.slice is
    // seq-addressed (it subtracts `baseSeq`), and the client rebases its mirror
    // to this exact `fromSeq`. Index === seq only holds while the authoritative
    // log's base is 0; deriving from `baseSeq` keeps it correct if the runner
    // ever serves a tail-seeded log (base > 0).
    const baseSeq = this.session.log.baseSeq;
    const endSeq = baseSeq + this.session.log.length;
    const start =
      replay === 'full'
        ? baseSeq
        : replay === 'none'
          ? endSeq
          : Math.max(baseSeq, endSeq - replay.tail);
    client.peer.notify(RunnerNotification.ReplayStart, { fromSeq: start });
    for (const event of this.session.log.slice(start)) {
      client.peer.notify(RunnerNotification.Event, { event });
    }
    return {
      sessionId: this.session.id,
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      info: this.session.getInfo(),
    };
  }

  private handleRunTurn(client: ConnectedClient, raw: unknown): RunTurnResult {
    const params = runTurnParamsSchema.parse(raw);
    // Honour a client-supplied id (v6) so the client's per-turn event filters
    // match the events the runner emits. A collision with an in-flight turn is
    // a client bug (or a cross-client hijack attempt) — reject it loudly
    // rather than letting two turns share one controller/owner entry.
    const turnId = params.turnId ? asTurnId(params.turnId) : newTurnId();
    if (this.turnControllers.has(turnId)) {
      throw new Error(
        `turn id ${turnId} is already in flight — client-supplied turn ids must be unique`,
      );
    }
    const controller = new AbortController();
    this.turnControllers.set(turnId, { controller, owner: client });
    client.turns.add(turnId);

    const opts = {
      turnId,
      signal: controller.signal,
      ...(params.model ? { model: params.model } : {}),
      ...(params.systemPrompt ? { systemPrompt: params.systemPrompt } : {}),
      ...(params.maxIterations ? { maxIterations: params.maxIterations } : {}),
      ...(params.attachments
        ? { attachments: params.attachments as ReadonlyArray<UserPromptAttachment> }
        : {}),
    };

    // Drive the turn in the background inside the per-turn scope. Events reach
    // clients via the log broadcast, so we only consume the iterable to run it
    // to completion and learn when it's done.
    void this.scope.run({ client, turnId }, async () => {
      let error: string | undefined;
      try {
        for await (const _event of this.session.runTurn(params.prompt, opts)) {
          void _event;
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      } finally {
        this.turnControllers.delete(turnId);
        client.turns.delete(turnId);
        // The whole post-turn body runs in a guard: this turn is driven by a
        // DETACHED promise (`void this.scope.run`), so anything that throws
        // synchronously here — e.g. session.getInfo() inside broadcastInfo()
        // throwing on a half-torn-down session — would reject the detached
        // promise as an UNHANDLED rejection (process-crashing under Node's
        // default policy), after the controllers map was already cleaned. The
        // turn.complete is recoverable; a crash isn't. Log and move on.
        try {
          // LOG COMPLETENESS: a turn can stream assistant text (assistant_chunk
          // events) yet never SEAL it with an assistant_message — e.g. the
          // provider errors or the turn aborts mid-stream after some text landed.
          // The renderer used to paper over this by SYNTHESIZING the missing
          // assistant_message on turn-complete, so that reply existed in NO runner
          // log. Persist a REAL one here (before turn.complete) so the runner log
          // is the complete authoritative history — and it streams to every mirror
          // as a normal event. No-op on the normal sealed path. Awaited so the
          // event is on the wire/disk before clients learn the turn finished.
          await this.sealUnsealedStreamedText(turnId);
          this.broadcast(RunnerNotification.TurnComplete, {
            turnId,
            ...(error ? { error } : {}),
          });
          // A turn may have run registry-mutating tools (provider_add, mcp_add,
          // workflow_create, skill writes, …). Push the fresh snapshot so
          // attached clients (the desktop Settings panel) re-render without an
          // app restart. Once per turn — cheap relative to the turn itself.
          this.broadcastInfo();
        } catch (postErr) {
          this.session.logger.error('runner: post-turn finalization failed', {
            turnId,
            error: postErr instanceof Error ? postErr.message : String(postErr),
          });
        }
      }
    });

    return { turnId };
  }

  private handleAbort(client: ConnectedClient, raw: unknown): Record<string, never> {
    const params = abortParamsSchema.parse(raw);
    const entry = this.turnControllers.get(params.turnId as TurnId);
    if (!entry) return {};
    if (entry.owner !== client) {
      // Cross-client abort is ALLOWED by design: multiple clients (TUI +
      // desktop) deliberately attach to the SAME shared session, so a user
      // aborting their own session's turn from another client is legitimate.
      // The audit's underlying concern - an unauthenticated local process
      // attaching at all - is addressed at the transport layer (0700 socket
      // directory, see unix-socket.ts), not by denying aborts here. We keep
      // an audit trail instead; MOXXY_RUNNER_STRICT_ABORT=1 opts into denial
      // for single-client deployments.
      this.session.logger.warn('cross-client abort', {
        turnId: params.turnId,
        ownerRole: entry.owner.role,
        abortingRole: client.role,
      });
      if (process.env.MOXXY_RUNNER_STRICT_ABORT === '1') {
        throw new Error(
          `turn ${params.turnId} was started by '${entry.owner.role}'; cross-client abort denied (MOXXY_RUNNER_STRICT_ABORT=1)`,
        );
      }
    }
    entry.controller.abort('client requested abort');
    return {};
  }

  /**
   * `/new` from any attached client. Aborts every in-flight turn (whoever
   * started it — the wipe is session-global), then clears the authoritative
   * log. The clear cascades: the log's clear listeners broadcast the
   * `session.reset` notification to all attached mirrors (wired in the
   * ctor) and truncate the persistence sidecar's JSONL. An aborted turn may
   * still flush a final event after the wipe; it lands in the fresh log at
   * seq 0+ and is broadcast AFTER the reset notification (single ordered
   * socket), so mirrors stay contiguous either way.
   */
  private handleSessionReset(): Record<string, never> {
    for (const entry of this.turnControllers.values()) {
      entry.controller.abort('session reset');
    }
    this.session.log.clear();
    return {};
  }

  /**
   * If this turn streamed assistant text (`assistant_chunk`) that no
   * `assistant_message` ever sealed, append a REAL `assistant_message` to the
   * authoritative log so it persists + replays like any other reply. It
   * accumulates chunk deltas and seals whatever text remains at turn end — so a
   * cleanly sealed reply (the normal path) leaves an empty remainder and this is
   * a no-op.
   *
   * The accumulator resets on BOTH per-iteration boundaries — an
   * `assistant_message` (a reply was sealed) AND a `provider_request` (a fresh
   * provider iteration begins). Resetting on `provider_request` is what scopes
   * the seal to the FINAL iteration: a retryable provider error can abandon a
   * partially-streamed iteration WITHOUT sealing it (the mode loop emits the
   * error and `continue`s), and a later iteration then streams fresh text and
   * may itself end unsealed (a fatal error / abort / max-iterations). Without
   * the `provider_request` reset, the abandoned attempt's chunks would be
   * concatenated INTO the sealed reply ("ABANDONED-final" instead of "final"),
   * durably corrupting authoritative/replayed history. (This is a deliberate
   * improvement over the desktop renderer's old turn-complete synthesis, which
   * accumulated across iterations and had exactly that defect — and which this
   * seal retires.)
   *
   * The append flows through `session.log` → persistence + the broadcast stream,
   * so mirrors ingest it as a normal event and never need to synthesize their
   * own.
   */
  private async sealUnsealedStreamedText(turnId: TurnId): Promise<void> {
    const events = this.session.log.byTurn(turnId);
    if (events.length === 0) return;
    let unsealed = '';
    for (const event of events) {
      if (event.type === 'assistant_message' || event.type === 'provider_request') unsealed = '';
      else if (event.type === 'assistant_chunk') unsealed += event.delta;
    }
    if (!unsealed.trim()) return; // normal sealed path (or no text) — nothing to do
    try {
      await this.session.log.append({
        type: 'assistant_message',
        sessionId: this.session.id,
        turnId,
        source: 'model',
        content: unsealed,
        // The turn ended without the provider sealing the message (error/abort
        // after partial text); record it as a normal completed reply.
        stopReason: 'end_turn',
      });
    } catch {
      // Sealing is best-effort completeness, not correctness-critical: a failed
      // append must not break turn-complete fan-out or abort handling.
    }
  }

  private handleSetResolver(client: ConnectedClient, raw: unknown): Record<string, never> {
    const params = setResolverParamsSchema.parse(raw);
    if (params.permission !== undefined) client.handlesPermission = params.permission;
    if (params.approval !== undefined) client.handlesApproval = params.approval;
    return {};
  }

  private broadcastInfo(): void {
    this.broadcast(RunnerNotification.InfoChanged, { info: this.session.getInfo() });
  }

  // --- resolver routing ----------------------------------------------------

  private installRoutingResolvers(): void {
    const permission: PermissionResolver = {
      name: 'runner-routing',
      check: (call, ctx) => this.resolvePermission(call, ctx),
    };
    this.session.setPermissionResolver(permission);

    const approval: ApprovalResolver = {
      name: 'runner-routing',
      confirm: (req) => this.resolveApproval(req),
    };
    this.session.setApprovalResolver(approval);

    // Redirect any later resolver installs into the fallback slots rather than
    // letting them replace the routing resolver. Without this, a self-hosting
    // TUI mounting after the runner started would overwrite routing, so an
    // attached client's approval prompt would surface on the host TUI.
    this.session.setApprovalResolver = (resolver: ApprovalResolver | null) => {
      this.fallbackApproval = resolver;
    };
    this.session.setPermissionResolver = (resolver: PermissionResolver) => {
      this.fallbackPermission = resolver;
    };
  }

  private async resolvePermission(
    call: PendingToolCall,
    ctx: PermissionContext,
  ): Promise<PermissionDecision> {
    const scope = this.scope.getStore();
    if (scope && scope.client.handlesPermission && !scope.client.peer.isClosed) {
      try {
        return await scope.client.peer.request<PermissionDecision>(
          RunnerMethod.PermissionCheck,
          { turnId: scope.turnId, call, ctx },
          // A client can stay socket-connected yet never answer (hung renderer
          // that doesn't drop the link); the turn's signal + a bounded timeout
          // make this fall through to deny instead of stalling the turn forever.
          { signal: this.turnControllers.get(scope.turnId)?.controller.signal, timeoutMs: CLIENT_REQUEST_TIMEOUT_MS },
        );
      } catch {
        return { mode: 'deny', reason: 'permission client unavailable' };
      }
    }
    return this.fallbackPermission.check(call, ctx);
  }

  private async resolveApproval(request: ApprovalRequest): Promise<ApprovalDecision> {
    const scope = this.scope.getStore();
    if (scope) {
      if (scope.client.handlesApproval && !scope.client.peer.isClosed) {
        try {
          return await scope.client.peer.request<ApprovalDecision>(
            RunnerMethod.ApprovalConfirm,
            { turnId: scope.turnId, request },
            { signal: this.turnControllers.get(scope.turnId)?.controller.signal, timeoutMs: CLIENT_REQUEST_TIMEOUT_MS },
          );
        } catch {
          return defaultApproval(request);
        }
      }
      // A scoped turn whose client doesn't handle approvals: don't pester an
      // unrelated fallback; take the default option (headless semantics).
      return defaultApproval(request);
    }
    // Unscoped turn (e.g. self-hosting TUI driving the session directly):
    // honour whatever resolver was installed before we wrapped the session.
    if (this.fallbackApproval) return this.fallbackApproval.confirm(request);
    return defaultApproval(request);
  }

  // --- fan-out -------------------------------------------------------------

  private broadcastEvent(event: MoxxyEvent): void {
    this.broadcast(RunnerNotification.Event, { event });
  }

  private broadcast(method: string, params: unknown): void {
    for (const client of this.clients) {
      if (client.attached && !client.peer.isClosed) client.peer.notify(method, params);
    }
  }
}

function defaultApproval(request: ApprovalRequest): ApprovalDecision {
  return { optionId: request.defaultOptionId ?? request.options[0]?.id ?? '' };
}

/**
 * Start a {@link RunnerServer} for `session`. Binds a unix-socket transport by
 * default (override with `socketPath`, or inject a `transport` for tests).
 */
export async function startRunnerServer(
  session: Session,
  opts: { readonly socketPath?: string; readonly transport?: TransportServer } = {},
): Promise<RunnerServer> {
  const transport =
    opts.transport ??
    (await createUnixSocketServer(opts.socketPath ?? runnerSocketPath(), session.logger));
  // DO NOT auto-activate any transcriber at boot. The TUI's
  // useVoiceInput depends on Codex specifically and would throw
  // "another transcriber is active" if we promoted something else
  // first. Active-transcriber selection is a per-client / per-flow
  // concern; the runner's handleTranscribe handles fallback at
  // request time instead.
  return new RunnerServer(session, transport);
}
