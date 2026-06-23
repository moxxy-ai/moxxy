/**
 * Backs the IPC contract with a single runner {@link ClientSession}.
 *
 * The desktop serves the same contract from a RunnerPool of desk-bound
 * supervisors. The CLI (`moxxy mobile` / `moxxy serve`) has just ONE live
 * session, but exposes the shared workspace registry so remote clients can see
 * the same workspace/session index as the desktop. It mirrors the desktop
 * `SessionDriver` + `ask-broker`: stream `session.log` → `runner.event`, run a
 * turn → `runner.turn.complete`, and route permission/approval prompts through
 * `ask.request` / `ask.respond`. The SAME `@moxxy/client-core` hooks work against
 * either backend.
 *
 * Chat history is loaded from the shared persisted session log for archived
 * registry sessions; the live event stream still rebuilds active-turn updates.
 */

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { restoreSessionEvents, seedSessionMeta } from '@moxxy/core';
import {
  denyByDefaultResolver,
  type ClientSession,
  type PermissionResolver,
  type ApprovalResolver,
  type MoxxyEvent,
} from '@moxxy/sdk';
import { moxxyPath } from '@moxxy/sdk/server';
import type {
  AskRequest,
  AskResponse,
  ConnectionPhase,
  ConnectionSnapshot,
  DesksOverview,
  RunTurnArgs,
  RunTurnResult,
  SessionsOverview,
} from '@moxxy/desktop-ipc-contract';
import type { CommandBus, EventSink } from '@moxxy/desktop-ipc-contract/bus';
import { IpcError } from '@moxxy/desktop-ipc-contract/dispatch';
import { WorkspaceRegistry } from '@moxxy/workspace-registry';

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
        workspaceId: this.selectedSessionId,
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
        workspaceId: this.selectedSessionId,
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
  private sessionName = 'Current session';
  private disposed = false;
  private hasExplicitSelection = false;
  private selectedSessionId: string;
  private readonly disposers: Array<() => void> = [];
  private readonly registry = new WorkspaceRegistry();

  constructor(
    private readonly bus: CommandBus & EventSink,
    private readonly session: ClientSession,
    opts: MobileHostOptions = {},
  ) {
    this.workspaceId = opts.workspaceId ?? session.id;
    this.selectedSessionId = this.workspaceId;
    this.askTimeoutMs = opts.askTimeoutMs ?? DEFAULT_ASK_TIMEOUT_MS;
    this.logErr = opts.logErr;
  }

  /** Register the `IpcCommands` subset the mobile client drives. */
  register(): void {
    this.bus.handle('connection.snapshotAll', async () => this.connectionSnapshots());
    this.bus.handle('connection.activeWorkspace', async () => this.activeWorkspaceId());
    this.bus.handle('connection.retry', async () => {});
    this.bus.handle('desks.list', async () => this.desksOverview());
    this.bus.handle('desks.setActive', async ({ id }) => {
      await this.syncCurrentSession();
      await this.registry.setActive(id);
      const activeDesk = await this.registry.getActive();
      if (activeDesk?.activeSessionId) this.selectedSessionId = activeDesk.activeSessionId;
      this.hasExplicitSelection = true;
      await this.broadcastActiveConnectionChanged();
      await this.broadcastDesksChanged();
    });
    this.bus.handle('sessions.list', async (args) => this.sessionsOverview(args?.deskId));
    this.bus.handle('sessions.create', async ({ name } = {}) => {
      await this.syncCurrentSession();
      const activeDesk = await this.registry.deskForSession(this.workspaceId);
      const { session } = await this.registry.createSession(
        activeDesk?.id,
        typeof name === 'string' ? name : undefined,
        { source: 'mobile' },
      );
      await this.broadcastDesksChanged();
      return session;
    });
    this.bus.handle('sessions.setActive', async ({ id }) => {
      await this.syncCurrentSession();
      await this.registry.setActiveSession(id);
      this.selectedSessionId = id;
      this.hasExplicitSelection = true;
      this.bus.broadcast('connection.changed', { workspaceId: id, phase: this.snapshot(id).phase });
      await this.broadcastDesksChanged();
    });
    this.bus.handle('sessions.remove', async ({ id }) => {
      await this.registry.removeSession(id);
      await this.broadcastDesksChanged();
    });
    this.bus.handle('sessions.rename', async ({ id, name }) => {
      await this.syncCurrentSession();
      const renamed = await this.registry.renameSession(id, name);
      if (id === this.workspaceId) {
        this.sessionName = typeof name === 'string' && name.trim().length > 0 ? name.trim() : this.sessionName;
      }
      await this.broadcastDesksChanged();
      return renamed;
    });
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
      this.bus.broadcast('connection.changed', {
        workspaceId: this.selectedSessionId,
        phase: this.snapshot(this.selectedSessionId).phase,
      });
    });
    this.bus.handle('session.newSession', async () => {
      // `/new`: abort in-flight turns, then reset at the source. `reset()` is
      // the authoritative seam (clears persistence too); a session without it
      // degrades to clearing the live log — never silently no-op.
      await this.resetCurrentSession();
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
    // History paging for the mobile channel. The desktop's NDJSON mirror — and
    // its `chat.append` / `chat.clearLog` / `chat.migrate` IPCs — were retired
    // (the runner log is the sole chat history there); the only surviving
    // history IPC is `chat.loadHistory`. Here the session's persisted log plays
    // the runner's role, so serve the page straight from it.
    this.bus.handle('chat.loadHistory', async (args) => this.loadChatSegment(args));
  }

  /** Stream session events to clients + install the ask resolvers. */
  wire(): void {
    const off = this.session.log.subscribe((event) => {
      // This callback runs synchronously inside the session's event-emit loop.
      // `broadcast` → `notify` → `JSON.stringify` throws on a non-serializable
      // event (BigInt / circular ref reachable from a tool result or provider
      // event); letting that throw unwind here would break delivery to the
      // session's other subscribers. Log-and-drop the offending frame instead.
      try {
        this.bus.broadcast('runner.event', { workspaceId: this.selectedSessionId, event });
      } catch (err) {
        this.logErr?.(err);
      }
    });
    this.disposers.push(off);

    this.session.setPermissionResolver(this.permissionResolver);
    this.session.setApprovalResolver(this.approvalResolver);

    // Tell any already-connected client we're connected (snapshotAll covers a
    // late joiner; this covers one that connected before wire()).
    this.bus.broadcast('connection.changed', {
      workspaceId: this.selectedSessionId,
      phase: this.snapshot(this.selectedSessionId).phase,
    });
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
    // Full teardown (unlike onAllClientsDisconnected, which keeps the host wired
    // for a reconnecting client): detach this host's resolvers from the session.
    this.session.setApprovalResolver(null);
    this.session.setPermissionResolver(denyByDefaultResolver);
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

  private snapshot(sessionId = this.workspaceId): ConnectionSnapshot {
    const info = this.session.getInfo();
    const phase: ConnectionPhase = {
      phase: 'connected',
      socket: '',
      sessionId,
      activeProvider: info?.activeProvider ?? null,
      activeMode: info?.activeMode ?? null,
    };
    return { phase, cliPath: null, attempts: 0, log: [] };
  }

  private async activeWorkspaceId(): Promise<string> {
    await this.syncCurrentSession({ activate: !this.hasExplicitSelection });
    return this.selectedSessionId;
  }

  private async connectionSnapshots(): Promise<Array<ConnectionSnapshot & { workspaceId: string }>> {
    await this.syncCurrentSession({ activate: !this.hasExplicitSelection });
    return [{ workspaceId: this.selectedSessionId, ...this.snapshot(this.selectedSessionId) }];
  }

  private async desksOverview(): Promise<DesksOverview> {
    await this.syncCurrentSession({ activate: this.selectedSessionId === this.workspaceId });
    const desks = await this.registry.list();
    const selectedDesk = deskForSession(desks, this.selectedSessionId);
    const activeDesk = await this.registry.getActive();
    return {
      desks,
      activeId: selectedDesk?.id ?? activeDesk?.id ?? null,
    };
  }

  private async sessionsOverview(deskId?: string): Promise<SessionsOverview> {
    await this.syncCurrentSession({ activate: this.selectedSessionId === this.workspaceId });
    const desks = await this.registry.list();
    const selectedDesk = deskForSession(desks, this.selectedSessionId);
    const activeDesk = await this.registry.getActive();
    return this.registry.listSessions(deskId ?? selectedDesk?.id ?? activeDesk?.id);
  }

  private async syncCurrentSession(options: { readonly activate?: boolean } = {}): Promise<void> {
    // Ensure the live session has its single metadata file so it surfaces in the
    // derived workspace list (a `mobile` session shows even before its first
    // prompt). Idempotent: once the runner's persistence has written the file
    // this is a no-op and never clobbers its content. Then foreground it when
    // asked.
    await seedSessionMeta(this.workspaceId, this.session.cwd, 'mobile').catch(() => undefined);
    if (!options.activate) return;
    try {
      await this.registry.setActiveSession(this.workspaceId);
    } catch {
      /* not derivable yet — nothing to foreground */
    }
  }

  private async broadcastDesksChanged(): Promise<void> {
    this.bus.broadcast('desks.changed', await this.desksOverview());
  }

  private async broadcastActiveConnectionChanged(): Promise<void> {
    const id = await this.activeWorkspaceId();
    this.bus.broadcast('connection.changed', { workspaceId: id, phase: this.snapshot(id).phase });
  }

  private async resetCurrentSession(): Promise<void> {
    for (const controller of this.turns.values()) controller.abort();
    // Reset auto-approve to the safe default so a fresh session never silently
    // inherits the previous one's auto-allow (desktop SessionDriver parity).
    this.autoApprove = false;
    if (this.session.reset) await this.session.reset();
    else this.session.log.clear();
  }

  private async runTurn(args: RunTurnArgs & { workspaceId?: string }): Promise<RunTurnResult> {
    const targetWorkspaceId = args.workspaceId ?? this.selectedSessionId;
    await this.selectRuntimeTarget(targetWorkspaceId);
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
        this.bus.broadcast('runner.turn.complete', { workspaceId: targetWorkspaceId, turnId, error });
      }
    })().catch((err) => {
      // The detached drain has no awaiter; a throw from the finally-broadcast
      // (e.g. a peer whose notify/serialize path throws) would otherwise become
      // an unhandled rejection on the host. Surface it instead of crashing.
      this.logErr?.(err);
    });
    return { turnId };
  }

  private async selectRuntimeTarget(sessionId: string): Promise<void> {
    if (sessionId === this.selectedSessionId) return;
    await this.syncCurrentSession();
    await this.registry.setActiveSession(sessionId);
    this.selectedSessionId = sessionId;
    this.hasExplicitSelection = true;
    this.bus.broadcast('connection.changed', {
      workspaceId: sessionId,
      phase: this.snapshot(sessionId).phase,
    });
    await this.broadcastDesksChanged();
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

  private async loadChatSegment(args: {
    workspaceId?: string;
    before?: number | null;
    limit?: number;
  }): Promise<{ events: MoxxyEvent[]; prevCursor: number | null }> {
    const workspaceId = args.workspaceId ?? this.selectedSessionId;
    const limit = args.limit ?? 100;
    const events = await loadPersistedEvents(workspaceId);
    return segmentFromEvents(events, args.before ?? null, limit);
  }
}

async function loadPersistedEvents(workspaceId: string): Promise<MoxxyEvent[]> {
  try {
    const events = await restoreSessionEvents(workspaceId);
    if (events.length > 0) return events;
  } catch {
    // Fall through to the desktop chat mirror. Older desktop workspaces used
    // desk ids as chat keys even when the actual session id inside the events
    // was different, so the core session log alone is not enough.
  }
  return readChatMirrorEvents(workspaceId);
}

async function readChatMirrorEvents(workspaceId: string): Promise<MoxxyEvent[]> {
  let raw: string;
  try {
    raw = await readFile(moxxyPath('chats', `${safeChatFileId(workspaceId)}.jsonl`), 'utf8');
  } catch {
    return [];
  }
  const events: MoxxyEvent[] = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      events.push(JSON.parse(line) as MoxxyEvent);
    } catch {
      // Match the desktop chat-log behavior: one corrupt mirror line should not
      // hide the rest of the transcript.
    }
  }
  return events;
}

function safeChatFileId(workspaceId: string): string {
  return workspaceId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 128) || 'unnamed';
}

function segmentFromEvents(
  events: ReadonlyArray<MoxxyEvent>,
  before: number | null,
  limit: number,
): { events: MoxxyEvent[]; prevCursor: number | null } {
  const total = events.length;
  const end = before === null ? total : Math.min(before, total);
  const start = Math.max(0, end - limit);
  const prevCursor = start > 0 ? start : null;
  return { events: events.slice(start, end), prevCursor };
}

function deskForSession(
  desks: ReadonlyArray<{ readonly id: string; readonly sessions: ReadonlyArray<{ readonly id: string }> }>,
  sessionId: string,
): { readonly id: string } | null {
  return desks.find((desk) => desk.sessions.some((session) => session.id === sessionId)) ?? null;
}
