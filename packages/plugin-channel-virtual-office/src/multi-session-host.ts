/**
 * Backs the IPC contract with MANY runner {@link ClientSession}s — one per
 * office worker. Multi-session generalization of the mobile channel's
 * `MobileSessionHost`: every worker is exposed as its own workspace
 * (`workspaceId === session.id`), `sessions.*` is the roster surface
 * (create = hire a new agent, rename = name tag, remove = walk out), and the
 * per-`workspaceId` `session.*` commands route to that worker's session.
 *
 * Events: each worker's `session.log` streams to `runner.event` tagged with
 * its workspaceId; turn completion broadcasts `runner.turn.complete`; and
 * permission/approval prompts flow through `ask.request` / `ask.respond` with
 * host-unique requestIds, so concurrent asks from different workers coexist.
 *
 * Chat history isn't persisted host-side per the mobile precedent — the live
 * event stream rebuilds the transcript and `chat.loadSegment` returns empty.
 * (Worker JSONL transcripts ARE written via SessionPersistence for `moxxy
 * resume`-style forensics; they're just not served over this surface.)
 */

import { randomUUID } from 'node:crypto';

import type { ClientSession, PermissionResolver, ApprovalResolver } from '@moxxy/sdk';
import type {
  AskRequest,
  AskResponse,
  ConnectionPhase,
  ConnectionSnapshot,
  DeskSession,
  RunTurnArgs,
  RunTurnResult,
} from '@moxxy/desktop-ipc-contract';
import type { CommandBus, EventSink } from '@moxxy/desktop-ipc-contract/bus';
import { IpcError } from '@moxxy/desktop-ipc-contract/dispatch';

/** A spawned worker: the session plus an optional extra teardown hook
 *  (e.g. the persistence detach). */
export interface SpawnedWorkerSession {
  readonly session: ClientSession;
  readonly dispose?: () => void;
}

export interface VirtualOfficeHostDeps {
  /** Spawn a brand-new worker session (a clone of the primary). Injected so
   *  the host is testable with fakes and the channel owns the core wiring. */
  readonly spawnSession: () => SpawnedWorkerSession;
  readonly logger?: {
    info?(msg: string, meta?: Record<string, unknown>): void;
    warn?(msg: string, meta?: Record<string, unknown>): void;
  };
}

interface OfficeWorker {
  readonly session: ClientSession;
  name: string;
  readonly createdAt: number;
  readonly turns: Map<string, AbortController>;
  autoApprove: boolean;
  readonly disposers: Array<() => void>;
  /** False for the primary (the CLI owns its lifecycle); true for spawned
   *  clones the host must close. */
  readonly ownsSession: boolean;
}

/** Display name for the CLI-provided session — worker #1 runs the office. */
const PRIMARY_NAME = 'Manager';

export class VirtualOfficeHost {
  /** The interactive permission resolver for the PRIMARY session — exposed so
   *  the channel can install it as its `Channel.permissionResolver` (the field
   *  `moxxy serve --all` reads). Worker resolvers are installed in wire(). */
  readonly permissionResolver: PermissionResolver;

  private readonly workers = new Map<string, OfficeWorker>();
  private activeWorkspaceId: string;
  private readonly pendingAsks = new Map<
    string,
    { workspaceId: string; resolve: (r: AskResponse) => void }
  >();
  private askCounter = 0;
  private workerCounter = 1;
  private wired = false;
  private disposed = false;

  constructor(
    private readonly bus: CommandBus & EventSink,
    primary: ClientSession,
    private readonly deps: VirtualOfficeHostDeps,
  ) {
    const first: OfficeWorker = {
      session: primary,
      name: PRIMARY_NAME,
      createdAt: Date.now(),
      turns: new Map(),
      autoApprove: false,
      disposers: [],
      ownsSession: false,
    };
    this.workers.set(primary.id, first);
    this.activeWorkspaceId = primary.id;
    this.permissionResolver = this.makePermissionResolver(first);
  }

  /** Register the `IpcCommands` subset the office client drives. */
  register(): void {
    this.bus.handle('connection.snapshotAll', async () =>
      [...this.workers.values()].map((w) => ({
        workspaceId: w.session.id,
        ...this.snapshot(w),
      })),
    );
    this.bus.handle('connection.activeWorkspace', async () => this.activeWorkspaceId);
    this.bus.handle('connection.retry', async () => {});

    // ---- roster (sessions.*) ----------------------------------------------
    this.bus.handle('sessions.list', async () => ({
      sessions: [...this.workers.values()].map((w) => this.deskSession(w)),
      activeSessionId: this.activeWorkspaceId,
    }));
    this.bus.handle('sessions.create', async (args) => {
      const worker = this.addWorker(args?.name);
      return this.deskSession(worker);
    });
    this.bus.handle('sessions.setActive', async ({ id }) => {
      if (!this.workers.has(id)) throw new IpcError('no-workspace', `unknown session: ${id}`);
      this.activeWorkspaceId = id;
    });
    this.bus.handle('sessions.rename', async ({ id, name }) => {
      const worker = this.workers.get(id);
      if (!worker) throw new IpcError('no-workspace', `unknown session: ${id}`);
      worker.name = name;
      return this.deskSession(worker);
    });
    this.bus.handle('sessions.remove', async ({ id }) => {
      await this.removeWorker(id);
    });

    // ---- per-workspace session commands ------------------------------------
    this.bus.handle('session.info', async (args) => this.workerFor(args).session.getInfo());
    this.bus.handle('session.runTurn', async (args) => this.runTurn(this.workerFor(args), args));
    this.bus.handle('session.abortTurn', async (args) => {
      this.workerFor(args).turns.get(args.turnId)?.abort();
    });
    this.bus.handle('session.setAutoApprove', async (args) => {
      this.workerFor(args).autoApprove = args.enabled;
    });
    this.bus.handle('session.setMode', async (args) => {
      const worker = this.workerFor(args);
      worker.session.modes.setActive(args.mode);
      // Re-broadcast the phase so connected clients see the new activeMode
      // without a session.info round-trip.
      this.broadcastPhase(worker);
    });
    this.bus.handle('session.newSession', async (args) => {
      // `/new`: abort in-flight turns, then reset at the source. `reset()` is
      // the authoritative seam; a session without it degrades to clearing the
      // live log — never silently no-op.
      const worker = this.workerFor(args);
      for (const controller of worker.turns.values()) controller.abort();
      if (worker.session.reset) await worker.session.reset();
      else worker.session.log.clear();
    });
    this.bus.handle('session.runCommand', async (args) => {
      const worker = this.workerFor(args);
      const def = worker.session.commands.get(args.name);
      if (!def) return { kind: 'error', message: `unknown command: /${args.name}` } as const;
      return await def.handler({
        channel: 'office',
        sessionId: worker.session.getInfo().sessionId,
        args: args.args,
        session: worker.session as unknown as Parameters<typeof def.handler>[0]['session'],
      });
    });

    // Voice: route to the ACTIVE worker's transcriber when one is registered.
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

    // Workflows: the office routes these to the PRIMARY session (the only one
    // carrying the live plugin host); absent ⇒ degrade exactly like mobile.
    this.bus.handle('workflows.list', async () => this.primary().session.workflows?.list() ?? []);
    this.bus.handle('workflows.setEnabled', async ({ name, enabled }) => {
      const view = this.primary().session.workflows;
      if (view) await view.setEnabled(name, enabled);
    });
    this.bus.handle('workflows.run', async ({ name }) => {
      const view = this.primary().session.workflows;
      if (!view) throw new IpcError('not-supported', 'workflows plugin not loaded on this session');
      return await view.run(name);
    });
    this.bus.handle('workflows.getRun', async ({ name }) => {
      const view = this.primary().session.workflows;
      if (!view?.getRun) {
        throw new IpcError('not-supported', 'workflows builder not supported on this session');
      }
      return await view.getRun(name);
    });
    this.bus.handle('workflows.resume', async ({ runId, reply }) => {
      const view = this.primary().session.workflows;
      if (!view?.resume) {
        throw new IpcError('not-supported', 'workflow resume not supported on this session');
      }
      return await view.resume(runId, reply);
    });

    this.bus.handle('ask.respond', async ({ requestId, response }) => {
      this.answerAsk(requestId, response);
    });

    // No host-side transcript paging — the live stream rebuilds it.
    this.bus.handle('chat.loadSegment', async () => ({ events: [], prevCursor: null }));
    this.bus.handle('chat.append', async () => {});
    this.bus.handle('chat.clearLog', async () => {});
    this.bus.handle('chat.migrate', async () => {});
  }

  /** Stream every worker's events to clients + install the ask resolvers. */
  wire(): void {
    this.wired = true;
    for (const worker of this.workers.values()) this.wireWorker(worker);
  }

  /** Hire a new office worker: spawn a session clone and wire it live. */
  addWorker(name?: string): OfficeWorker {
    if (this.disposed) throw new IpcError('not-connected', 'office host is shut down');
    const spawned = this.deps.spawnSession();
    this.workerCounter += 1;
    const worker: OfficeWorker = {
      session: spawned.session,
      name: name?.trim() || `Agent ${this.workerCounter}`,
      createdAt: Date.now(),
      turns: new Map(),
      autoApprove: false,
      disposers: spawned.dispose ? [spawned.dispose] : [],
      ownsSession: true,
    };
    this.workers.set(worker.session.id, worker);
    if (this.wired) this.wireWorker(worker);
    this.deps.logger?.info?.('office worker spawned', {
      workspaceId: worker.session.id,
      name: worker.name,
    });
    return worker;
  }

  /** Walk a worker out: abort its turns, deny its parked asks, close it. */
  async removeWorker(id: string): Promise<void> {
    const worker = this.workers.get(id);
    if (!worker) throw new IpcError('no-workspace', `unknown session: ${id}`);
    if (!worker.ownsSession) {
      throw new IpcError('not-supported', 'the primary session cannot be removed');
    }
    this.workers.delete(id);
    if (this.activeWorkspaceId === id) this.activeWorkspaceId = this.primary().session.id;
    this.teardownWorker(worker);
    await this.closeWorkerSession(worker, 'removed from the office');
    // Tell clients the workspace is gone so the sprite can walk out.
    this.bus.broadcast('connection.changed', { workspaceId: id, phase: { phase: 'idle' } });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const owned = [...this.workers.values()];
    this.workers.clear();
    for (const worker of owned) this.teardownWorker(worker);
    await Promise.allSettled(
      owned
        .filter((w) => w.ownsSession)
        .map((w) => this.closeWorkerSession(w, 'office shutdown')),
    );
  }

  // ---- internals ----------------------------------------------------------

  private primary(): OfficeWorker {
    // Insertion order — the primary is always the first entry.
    const first = this.workers.values().next().value as OfficeWorker | undefined;
    if (!first) throw new IpcError('not-connected', 'office host has no sessions');
    return first;
  }

  private workerFor(args?: { workspaceId?: string }): OfficeWorker {
    const id = args?.workspaceId ?? this.activeWorkspaceId;
    const worker = this.workers.get(id);
    if (!worker) throw new IpcError('no-workspace', `unknown workspace: ${id}`);
    return worker;
  }

  private deskSession(worker: OfficeWorker): DeskSession {
    return { id: worker.session.id, name: worker.name, createdAt: worker.createdAt };
  }

  private wireWorker(worker: OfficeWorker): void {
    const ws = worker.session.id;
    const off = worker.session.log.subscribe((event) => {
      this.bus.broadcast('runner.event', { workspaceId: ws, event });
    });
    worker.disposers.push(off);
    worker.session.setPermissionResolver(this.makePermissionResolver(worker));
    worker.session.setApprovalResolver(this.makeApprovalResolver(worker));
    // Tell any already-connected client this workspace exists (snapshotAll
    // covers a late joiner; this covers one connected before the spawn).
    this.broadcastPhase(worker);
  }

  private teardownWorker(worker: OfficeWorker): void {
    for (const off of worker.disposers) {
      try {
        off();
      } catch {
        /* ignore */
      }
    }
    worker.disposers.length = 0;
    for (const controller of worker.turns.values()) controller.abort();
    worker.turns.clear();
    // Deny this worker's parked asks so its runner never hangs on an
    // unanswerable prompt.
    for (const [requestId, pending] of [...this.pendingAsks]) {
      if (pending.workspaceId !== worker.session.id) continue;
      this.pendingAsks.delete(requestId);
      pending.resolve({ mode: 'deny' });
    }
    worker.session.setApprovalResolver(null);
  }

  private async closeWorkerSession(worker: OfficeWorker, reason: string): Promise<void> {
    try {
      await worker.session.close(reason);
    } catch (err) {
      this.deps.logger?.warn?.('office worker close failed', {
        workspaceId: worker.session.id,
        err: String(err),
      });
    }
  }

  private makePermissionResolver(worker: OfficeWorker): PermissionResolver {
    return {
      name: 'office-ask',
      check: async (call, ctx) => {
        if (worker.autoApprove) return { mode: 'allow' };
        const res = await this.openAsk({
          workspaceId: worker.session.id,
          kind: 'permission',
          tool: {
            name: call.name,
            input: call.input,
            ...(ctx.toolDescription ? { description: ctx.toolDescription } : {}),
          },
        });
        // "Always allow" must persist so the runner skips the prompt next
        // time — the engine is shared, so it applies office-wide.
        if (res.mode === 'allow_always') {
          void worker.session.permissions.addAllow({ name: call.name });
        }
        return { mode: res.mode ?? 'deny' };
      },
    };
  }

  private makeApprovalResolver(worker: OfficeWorker): ApprovalResolver {
    return {
      name: 'office-ask',
      confirm: async (request) => {
        const res = await this.openAsk({
          workspaceId: worker.session.id,
          kind: 'approval',
          approval: request,
        });
        // A response without an optionId means the ask was cancelled
        // (teardown). Never fall through to a default "proceed" option —
        // pick danger/abort.
        const optionId =
          res.optionId ??
          request.options.find((o) => o.danger)?.id ??
          request.defaultOptionId ??
          request.options[0]?.id ??
          'cancel';
        return { optionId, ...(res.text ? { text: res.text } : {}) };
      },
    };
  }

  private snapshot(worker: OfficeWorker): ConnectionSnapshot {
    const info = worker.session.getInfo();
    const phase: ConnectionPhase = {
      phase: 'connected',
      socket: '',
      sessionId: worker.session.id,
      activeProvider: info?.activeProvider ?? null,
      activeMode: info?.activeMode ?? null,
    };
    return { phase, cliPath: null, attempts: 0, log: [] };
  }

  private broadcastPhase(worker: OfficeWorker): void {
    this.bus.broadcast('connection.changed', {
      workspaceId: worker.session.id,
      phase: this.snapshot(worker).phase,
    });
  }

  private async runTurn(
    worker: OfficeWorker,
    args: RunTurnArgs & { workspaceId?: string },
  ): Promise<RunTurnResult> {
    const turnId = randomUUID();
    const controller = new AbortController();
    worker.turns.set(turnId, controller);
    // Drain the iterator in the background — events already flow via
    // log.subscribe; we only need the completion signal.
    void (async () => {
      let error: string | null = null;
      try {
        for await (const _event of worker.session.runTurn(args.prompt, {
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
        worker.turns.delete(turnId);
        this.bus.broadcast('runner.turn.complete', {
          workspaceId: worker.session.id,
          turnId,
          error,
        });
      }
    })();
    return { turnId };
  }

  private openAsk(req: Omit<AskRequest, 'requestId'>): Promise<AskResponse> {
    const requestId = `ask-${++this.askCounter}`;
    return new Promise<AskResponse>((resolve) => {
      this.pendingAsks.set(requestId, { workspaceId: req.workspaceId, resolve });
      this.bus.broadcast('ask.request', { ...req, requestId } as AskRequest);
    });
  }

  private answerAsk(requestId: string, response: AskResponse): void {
    const pending = this.pendingAsks.get(requestId);
    if (!pending) return;
    this.pendingAsks.delete(requestId);
    pending.resolve(response);
  }

  private activeTranscriber() {
    try {
      return this.workerFor().session.transcribers?.tryGetActive() ?? null;
    } catch {
      return null;
    }
  }
}
