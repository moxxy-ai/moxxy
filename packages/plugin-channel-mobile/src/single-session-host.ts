/**
 * Backs the IPC contract with a single runner {@link ClientSession}.
 *
 * The desktop serves the same contract from a RunnerPool of desk-bound
 * supervisors; the CLI (`moxxy mobile` / `moxxy serve`) has just ONE session, so
 * this host exposes exactly one synthetic workspace (`session.id`) and registers
 * the subset of `IpcCommands` a mobile client drives. It mirrors the desktop
 * `SessionDriver` + `ask-broker`: stream `session.log` → `runner.event`, run a
 * turn → `runner.turn.complete`, and route permission/approval prompts through
 * `ask.request` / `ask.respond`. The SAME `@moxxy/client-core` hooks work against
 * either backend.
 *
 * Chat history isn't paged server-side here — the live event stream rebuilds the
 * transcript and `chat.loadHistory` returns an empty page.
 */

import { randomUUID } from 'node:crypto';

import type { ClientSession, PermissionResolver, ApprovalResolver } from '@moxxy/sdk';
import type {
  AskRequest,
  AskResponse,
  ConnectionPhase,
  ConnectionSnapshot,
  RunTurnArgs,
  RunTurnResult,
} from '@moxxy/desktop-ipc-contract';
import type { CommandBus, EventSink } from '@moxxy/desktop-ipc-contract/bus';
import { IpcError } from '@moxxy/desktop-ipc-contract/dispatch';

export interface MobileHostOptions {
  /** Workspace id exposed to the client. Defaults to the session id. */
  readonly workspaceId?: string;
  /**
   * Bound on how long a parked permission/approval ask waits for a response
   * before it self-denies. A network client can receive an `ask.request` and
   * never answer (app suspended, backgrounded, connection lost without a clean
   * socket close); without a bound the awaiting runner turn hangs forever and
   * the resolver is retained until channel teardown. Default 5 minutes; `0`
   * disables the timeout (the legacy unbounded behavior).
   */
  readonly askTimeoutMs?: number;
  /** Optional error sink for detached/background failures that have nowhere
   *  else to surface (e.g. a completion broadcast throwing on a bad peer). */
  readonly logErr?: (err: unknown) => void;
}

/** Default per-ask grace before an unanswered permission/approval ask self-denies. */
const DEFAULT_ASK_TIMEOUT_MS = 5 * 60_000;
/** Hard cap on concurrently parked asks — a misbehaving/abusive client cannot
 *  pin unbounded resolver closures by triggering checks faster than it answers. */
const MAX_PENDING_ASKS = 256;

export class MobileSessionHost {
  /** The interactive permission resolver — exposed so the channel can install it
   *  as its `Channel.permissionResolver` (the field `moxxy serve --all` reads). */
  readonly permissionResolver: PermissionResolver = {
    name: 'mobile-ask',
    check: async (call, ctx) => {
      if (this.autoApprove) return { mode: 'allow' };
      const res = await this.openAsk({
        workspaceId: this.workspaceId,
        kind: 'permission',
        tool: {
          name: call.name,
          input: call.input,
          ...(ctx.toolDescription ? { description: ctx.toolDescription } : {}),
        },
      });
      // "Always allow" must persist so the runner skips the prompt next time.
      if (res.mode === 'allow_always') {
        void this.session.permissions.addAllow({ name: call.name });
      }
      return { mode: res.mode ?? 'deny' };
    },
  };

  private readonly approvalResolver: ApprovalResolver = {
    name: 'mobile-ask',
    confirm: async (request) => {
      const res = await this.openAsk({
        workspaceId: this.workspaceId,
        kind: 'approval',
        approval: request,
      });
      // A response without an optionId means the ask was cancelled (teardown).
      // Never fall through to a default "proceed" option — pick danger/abort.
      const optionId =
        res.optionId ??
        request.options.find((o) => o.danger)?.id ??
        request.defaultOptionId ??
        request.options[0]?.id ??
        'cancel';
      return { optionId, ...(res.text ? { text: res.text } : {}) };
    },
  };

  private readonly workspaceId: string;
  private readonly askTimeoutMs: number;
  private readonly logErr: ((err: unknown) => void) | undefined;
  private readonly turns = new Map<string, AbortController>();
  private readonly pendingAsks = new Map<
    string,
    { resolve: (r: AskResponse) => void; timer: ReturnType<typeof setTimeout> | null }
  >();
  private askCounter = 0;
  private autoApprove = false;
  private disposed = false;
  private readonly disposers: Array<() => void> = [];

  constructor(
    private readonly bus: CommandBus & EventSink,
    private readonly session: ClientSession,
    opts: MobileHostOptions = {},
  ) {
    this.workspaceId = opts.workspaceId ?? session.id;
    this.askTimeoutMs = opts.askTimeoutMs ?? DEFAULT_ASK_TIMEOUT_MS;
    this.logErr = opts.logErr;
  }

  /** Register the `IpcCommands` subset the mobile client drives. */
  register(): void {
    const ws = this.workspaceId;
    this.bus.handle('connection.snapshotAll', async () => [{ workspaceId: ws, ...this.snapshot() }]);
    this.bus.handle('connection.activeWorkspace', async () => ws);
    this.bus.handle('connection.retry', async () => {});
    this.bus.handle('session.info', async () => this.session.getInfo());
    this.bus.handle('session.runTurn', async (args) => this.runTurn(args));
    this.bus.handle('session.abortTurn', async ({ turnId }) => {
      this.turns.get(turnId)?.abort();
    });
    this.bus.handle('session.setAutoApprove', async ({ enabled }) => {
      this.autoApprove = enabled;
    });
    this.bus.handle('session.setMode', async ({ mode }) => {
      this.session.modes.setActive(mode);
      // Re-broadcast the phase so connected clients see the new activeMode
      // without a session.info round-trip (mirrors the desktop supervisor's
      // refreshConnectedInfo()).
      this.bus.broadcast('connection.changed', { workspaceId: ws, phase: this.snapshot().phase });
    });
    this.bus.handle('session.newSession', async () => {
      // `/new`: abort in-flight turns, then reset at the source. `reset()` is
      // the authoritative seam (clears persistence too); a session without it
      // degrades to clearing the live log — never silently no-op.
      for (const controller of this.turns.values()) controller.abort();
      // Reset auto-approve to the safe default so a fresh session never
      // silently inherits the previous one's auto-allow (desktop SessionDriver
      // parity). Manual `allow_always` persists via permissions; auto-approve
      // is host-level and ephemeral.
      this.autoApprove = false;
      if (this.session.reset) await this.session.reset();
      else this.session.log.clear();
    });
    this.bus.handle('session.runCommand', async ({ name, args }) => {
      const def = this.session.commands.get(name);
      if (!def) return { kind: 'error', message: `unknown command: /${name}` } as const;
      return await def.handler({
        channel: 'mobile',
        sessionId: this.session.getInfo().sessionId,
        args,
        session: this.session as unknown as Parameters<typeof def.handler>[0]['session'],
      });
    });
    // Voice: served by the runner's active transcriber when one is registered.
    // hasTranscriber is the capability probe (the app gates the mic on it);
    // transcribe without one fails with the coded `not-supported` error so a
    // client that skipped the probe still degrades instead of retrying.
    this.bus.handle('session.hasTranscriber', async () => this.activeTranscriber() != null);
    this.bus.handle('session.transcribe', async ({ audioBase64, mimeType }) => {
      const transcriber = this.activeTranscriber();
      if (!transcriber) {
        throw new IpcError('not-supported', 'no transcriber is active on this session');
      }
      const audio = Buffer.from(audioBase64, 'base64');
      const result = await transcriber.transcribe(audio, mimeType ? { mimeType } : undefined);
      return result.text;
    });
    // Workflows: delegate to the session's optional WorkflowsView (present when
    // @moxxy/plugin-workflows is wired — `moxxy mobile` runs the full CLI setup,
    // so it normally is). Absent ⇒ list degrades to empty / setEnabled no-ops
    // (desktop parity) and run fails coded so the UI can hide the surface.
    this.bus.handle('workflows.list', async () => this.session.workflows?.list() ?? []);
    this.bus.handle('workflows.setEnabled', async ({ name, enabled }) => {
      if (this.session.workflows) await this.session.workflows.setEnabled(name, enabled);
    });
    this.bus.handle('workflows.run', async ({ name }) => {
      if (!this.session.workflows) {
        throw new IpcError('not-supported', 'workflows plugin not loaded on this session');
      }
      return await this.session.workflows.run(name);
    });
    // Visual builder (phase 2) — parity with the desktop host. Optional on the
    // view, so feature-check and surface a coded error when unsupported.
    this.bus.handle('workflows.validateDraft', async ({ yaml }) => {
      if (!this.session.workflows?.validateDraft) {
        throw new IpcError('not-supported', 'workflows builder not supported on this session');
      }
      return await this.session.workflows.validateDraft(yaml);
    });
    this.bus.handle('workflows.save', async ({ yaml }) => {
      if (!this.session.workflows?.save) {
        throw new IpcError('not-supported', 'workflows builder not supported on this session');
      }
      return await this.session.workflows.save(yaml);
    });
    this.bus.handle('workflows.getRun', async ({ name }) => {
      if (!this.session.workflows?.getRun) {
        throw new IpcError('not-supported', 'workflows builder not supported on this session');
      }
      return await this.session.workflows.getRun(name);
    });
    // Human-in-the-loop: a mobile user answers their paused workflow's question.
    // RESPOND-only (like ask.respond) so it's on the remote allow-list; optional
    // on the view, so feature-check and surface a coded error when unsupported.
    this.bus.handle('workflows.resume', async ({ runId, reply }) => {
      if (!this.session.workflows?.resume) {
        throw new IpcError('not-supported', 'workflow resume not supported on this session');
      }
      return await this.session.workflows.resume(runId, reply);
    });
    this.bus.handle('ask.respond', async ({ requestId, response }) => {
      this.answerAsk(requestId, response);
    });
    // No paged history for the mobile channel — the live event stream rebuilds
    // the transcript as it arrives, so history paging returns an empty page.
    this.bus.handle('chat.loadHistory', async () => ({ events: [], prevCursor: null }));
  }

  /** Stream session events to clients + install the ask resolvers. */
  wire(): void {
    const ws = this.workspaceId;
    const off = this.session.log.subscribe((event) => {
      // This callback runs synchronously inside the session's event-emit loop.
      // `broadcast` → `notify` → `JSON.stringify` throws on a non-serializable
      // event (BigInt / circular ref reachable from a tool result or provider
      // event); letting that throw unwind here would break delivery to the
      // session's other subscribers. Log-and-drop the offending frame instead.
      try {
        this.bus.broadcast('runner.event', { workspaceId: ws, event });
      } catch (err) {
        this.logErr?.(err);
      }
    });
    this.disposers.push(off);

    this.session.setPermissionResolver(this.permissionResolver);
    this.session.setApprovalResolver(this.approvalResolver);

    // Tell any already-connected client we're connected (snapshotAll covers a
    // late joiner; this covers one that connected before wire()).
    this.bus.broadcast('connection.changed', { workspaceId: ws, phase: this.snapshot().phase });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.disposers) {
      try {
        off();
      } catch {
        /* ignore */
      }
    }
    this.abortAndDrain();
    this.session.setApprovalResolver(null);
  }

  /**
   * The only paired client dropped (network loss, app killed/backgrounded).
   * Untrusted/unreliable clients are the EXPECTED case for a network channel, so
   * a disconnect must not strand the host: abort every in-flight turn and deny +
   * clear every parked ask, mirroring the dispose path. Unlike `dispose()` this
   * keeps the host wired so a reconnecting client resumes against a clean slate
   * (it never saw the old turnIds, so it could neither abort nor reattach them).
   * Idempotent and a no-op after dispose.
   */
  onAllClientsDisconnected(): void {
    if (this.disposed) return;
    this.abortAndDrain();
  }

  /** Abort all in-flight turns and deny + clear all parked asks (clearing their
   *  timeout timers). Shared by `dispose()` and `onAllClientsDisconnected()`. */
  private abortAndDrain(): void {
    for (const controller of this.turns.values()) controller.abort();
    this.turns.clear();
    // Deny parked asks so the runner never hangs on an unanswerable prompt.
    for (const { resolve, timer } of this.pendingAsks.values()) {
      if (timer) clearTimeout(timer);
      resolve({ mode: 'deny' });
    }
    this.pendingAsks.clear();
  }

  // ---- internals ----------------------------------------------------------

  /** Active transcriber, or null. Guarded access — a thin/remote session may
   *  leave the registry view undefined (capability-absent ≠ crash). */
  private activeTranscriber() {
    try {
      return this.session.transcribers?.tryGetActive() ?? null;
    } catch {
      return null;
    }
  }

  private snapshot(): ConnectionSnapshot {
    const info = this.session.getInfo();
    const phase: ConnectionPhase = {
      phase: 'connected',
      socket: '',
      sessionId: this.session.id,
      activeProvider: info?.activeProvider ?? null,
      activeMode: info?.activeMode ?? null,
    };
    return { phase, cliPath: null, attempts: 0, log: [] };
  }

  private async runTurn(args: RunTurnArgs & { workspaceId?: string }): Promise<RunTurnResult> {
    const turnId = randomUUID();
    const controller = new AbortController();
    this.turns.set(turnId, controller);
    // Drain the iterator in the background — events already flow via
    // log.subscribe; we only need the completion signal.
    void (async () => {
      let error: string | null = null;
      try {
        // Inline attachments (mobile) map straight onto the SDK's
        // UserPromptAttachment shape; path-based desktop attachments have no
        // meaning here (no shared filesystem) and are ignored.
        for await (const _event of this.session.runTurn(args.prompt, {
          signal: controller.signal,
          ...(args.model ? { model: args.model } : {}),
          ...(args.inlineAttachments && args.inlineAttachments.length > 0
            ? { attachments: args.inlineAttachments }
            : {}),
        })) {
          void _event;
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      } finally {
        this.turns.delete(turnId);
        this.bus.broadcast('runner.turn.complete', { workspaceId: this.workspaceId, turnId, error });
      }
    })().catch((err) => {
      // The detached drain has no awaiter; a throw from the finally-broadcast
      // (e.g. a peer whose notify/serialize path throws) would otherwise become
      // an unhandled rejection on the host. Surface it instead of crashing.
      this.logErr?.(err);
    });
    return { turnId };
  }

  private openAsk(req: Omit<AskRequest, 'requestId'>): Promise<AskResponse> {
    // Fail closed after teardown: a permission/approval check that arrives
    // post-dispose (a turn not aborted in time, a re-used session) would
    // otherwise broadcast to a closed bus and park a resolver that nothing
    // ever drains — hanging the awaiting check forever. Deny immediately.
    if (this.disposed) return Promise.resolve({ mode: 'deny' });
    // Bound concurrently parked asks so a misbehaving client that triggers
    // checks faster than it answers can't pin unbounded resolver closures.
    if (this.pendingAsks.size >= MAX_PENDING_ASKS) return Promise.resolve({ mode: 'deny' });
    const requestId = `ask-${++this.askCounter}`;
    return new Promise<AskResponse>((resolve) => {
      // A client can receive an ask and never answer (suspended, backgrounded,
      // connection lost without a clean close). Without a bound the awaiting
      // runner turn hangs forever; self-deny after the grace and drop the entry.
      let timer: ReturnType<typeof setTimeout> | null = null;
      if (this.askTimeoutMs > 0) {
        timer = setTimeout(() => {
          if (this.pendingAsks.delete(requestId)) resolve({ mode: 'deny' });
        }, this.askTimeoutMs);
        // Don't let a parked ask keep the process alive.
        if (typeof timer === 'object' && typeof timer.unref === 'function') timer.unref();
      }
      this.pendingAsks.set(requestId, { resolve, timer });
      this.bus.broadcast('ask.request', { ...req, requestId } as AskRequest);
    });
  }

  private answerAsk(requestId: string, response: AskResponse): void {
    const entry = this.pendingAsks.get(requestId);
    if (!entry) return;
    this.pendingAsks.delete(requestId);
    if (entry.timer) clearTimeout(entry.timer);
    entry.resolve(response);
  }
}
