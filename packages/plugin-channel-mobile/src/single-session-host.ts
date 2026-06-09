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
 * Chat history isn't persisted server-side here (no desk NDJSON log) — the live
 * event stream rebuilds the transcript and `chat.loadSegment` returns empty.
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

export interface MobileHostOptions {
  /** Workspace id exposed to the client. Defaults to the session id. */
  readonly workspaceId?: string;
}

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
  private readonly turns = new Map<string, AbortController>();
  private readonly pendingAsks = new Map<string, (r: AskResponse) => void>();
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
    this.bus.handle('session.hasTranscriber', async () => false);
    this.bus.handle('ask.respond', async ({ requestId, response }) => {
      this.answerAsk(requestId, response);
    });
    // No server-side transcript persistence for the channel — the live stream
    // rebuilds it; paging returns empty and writes are no-ops.
    this.bus.handle('chat.loadSegment', async () => ({ events: [], prevCursor: null }));
    this.bus.handle('chat.append', async () => {});
    this.bus.handle('chat.clearLog', async () => {});
    this.bus.handle('chat.migrate', async () => {});
  }

  /** Stream session events to clients + install the ask resolvers. */
  wire(): void {
    const ws = this.workspaceId;
    const off = this.session.log.subscribe((event) => {
      this.bus.broadcast('runner.event', { workspaceId: ws, event });
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
    for (const controller of this.turns.values()) controller.abort();
    this.turns.clear();
    // Deny parked asks so the runner never hangs on an unanswerable prompt.
    for (const resolve of this.pendingAsks.values()) resolve({ mode: 'deny' });
    this.pendingAsks.clear();
    this.session.setApprovalResolver(null);
  }

  // ---- internals ----------------------------------------------------------

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
        for await (const _event of this.session.runTurn(args.prompt, {
          signal: controller.signal,
          ...(args.model ? { model: args.model } : {}),
        })) {
          void _event;
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      } finally {
        this.turns.delete(turnId);
        this.bus.broadcast('runner.turn.complete', { workspaceId: this.workspaceId, turnId, error });
      }
    })();
    return { turnId };
  }

  private openAsk(req: Omit<AskRequest, 'requestId'>): Promise<AskResponse> {
    const requestId = `ask-${++this.askCounter}`;
    return new Promise<AskResponse>((resolve) => {
      this.pendingAsks.set(requestId, resolve);
      this.bus.broadcast('ask.request', { ...req, requestId } as AskRequest);
    });
  }

  private answerAsk(requestId: string, response: AskResponse): void {
    const resolve = this.pendingAsks.get(requestId);
    if (!resolve) return;
    this.pendingAsks.delete(requestId);
    resolve(response);
  }
}
