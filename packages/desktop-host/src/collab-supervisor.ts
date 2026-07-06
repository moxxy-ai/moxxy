/**
 * Supervises THE collaboration coordinator — a single, dedicated `moxxy collab`
 * runner subprocess, entirely separate from the desktop's per-workspace chat
 * runners. This is what makes "collaborate" a self-contained feature: the
 * coordinator no longer hijacks a chat session (flipping its mode + flooding its
 * thread with the whole team's activity). It runs in its own Session on its own
 * runner socket, and the Collaborate panel talks to it through the dedicated
 * `collab.*` IPC + the `collab.event` / `collab.approval` broadcasts — never
 * `runner.event` / the chat ask sheet.
 *
 * Single-flight: only one collaboration runs machine-wide (the coordinator's own
 * `~/.moxxy/collab/active.lock` enforces it across processes). This supervisor
 * holds at most one coordinator at a time.
 *
 * Lifecycle:
 *   - start(): spawn `moxxy collab`, connect a RemoteSession to its socket, mirror
 *     its log to `collab.event`, and DRIVE the goal turn (so the turn is
 *     client-scoped and the coordinator's roster-approval checkpoint is forwarded
 *     to us — we surface it as a `collab.approval` the panel answers).
 *   - ensureAttached(): if a coordinator is already running (e.g. started from the
 *     TUI, or a prior desktop run), connect read-only so the panel can view it.
 *   - stop(): abort the coordinator turn (its finally archives + releases the
 *     lock) and terminate the process.
 *
 * Electron-free by construction (spawn + the runner client + the host event bus),
 * so it unit-tests against a fake CLI like the rest of desktop-host.
 */

import type { ChildProcess } from 'node:child_process';

import {
  connectRemoteSession,
  isRunnerUp,
  type RemoteSession,
} from '@moxxy/runner';
import {
  collabCoordinatorSocketPath,
  readActiveCollab,
} from '@moxxy/mode-collaborative';
import type { ApprovalDecision, ApprovalRequest, MoxxyEvent } from '@moxxy/sdk';

import { augmentedPaths, resolveMoxxyCli, spawnCli } from './cli-resolver';
import { broadcastHostEvent } from './event-bus';

/** How long to wait for the freshly-spawned coordinator to bind its socket. */
const SOCKET_WAIT_MS = 15_000;
const SOCKET_POLL_MS = 120;

interface Coordinator {
  /** The spawned process, when WE spawned it (start). Absent for a read-only
   *  attach to a coordinator started elsewhere (ensureAttached). */
  child?: ChildProcess;
  session: RemoteSession;
  /** Aborts the driven goal turn (only set when we drive it). */
  turnAbort?: AbortController;
  logUnsub: () => void;
  task: string;
  stderrTail: string;
}

let coordinator: Coordinator | null = null;
const pendingApprovals = new Map<string, (d: ApprovalDecision) => void>();
let approvalCounter = 0;

/** Broadcast a coordinator liveness change so the panel re-renders without
 *  polling. `active` mirrors `collab.active`'s single-flight truth. */
function broadcastStatus(): void {
  broadcastHostEvent('collab.status', {
    running: coordinator != null,
    ...(coordinator?.task ? { task: coordinator.task } : {}),
  });
}

/** True when this supervisor holds a live coordinator session. */
export function collabRunning(): boolean {
  return coordinator != null;
}

/** The coordinator's current event log (seed for a newly-mounted panel). */
export function collabSnapshot(): ReadonlyArray<MoxxyEvent> {
  try {
    return coordinator?.session.log.toJSON() ?? [];
  } catch {
    return [];
  }
}

async function waitForSocket(socket: string): Promise<boolean> {
  const deadline = Date.now() + SOCKET_WAIT_MS;
  while (Date.now() < deadline) {
    if (await isRunnerUp(socket)) return true;
    await new Promise((r) => setTimeout(r, SOCKET_POLL_MS));
  }
  return isRunnerUp(socket);
}

/** Wire a connected coordinator session: mirror its log to `collab.event` and
 *  route its approval checkpoints to the panel via `collab.approval`. Returns the
 *  held record so the caller can attach the driven turn/stderr without fighting
 *  control-flow narrowing on the module-level singleton. */
function bind(session: RemoteSession, task: string, child?: ChildProcess): Coordinator {
  const logUnsub = session.log.subscribe((event) => {
    broadcastHostEvent('collab.event', { event });
  });

  // The coordinator orchestrates (spawns processes, git ops) rather than making
  // arbitrary model tool-calls, so auto-allow permission — there's no human at
  // this headless runner to answer, and blocking would wedge the run.
  session.setPermissionResolver({
    name: 'collab-allow',
    check: async () => ({ mode: 'allow' }),
  });
  // The roster-approval checkpoint (the ONE human gate) is surfaced to the panel.
  session.setApprovalResolver({
    name: 'collab-approve',
    confirm: (request) => awaitApproval(request),
  });

  const c: Coordinator = { session, logUnsub, task, stderrTail: '', ...(child ? { child } : {}) };
  coordinator = c;

  session.onClose(() => {
    if (coordinator?.session === session) teardown();
  });
  return c;
}

function awaitApproval(request: ApprovalRequest): Promise<ApprovalDecision> {
  const requestId = `collab-ask-${++approvalCounter}`;
  return new Promise<ApprovalDecision>((resolve) => {
    pendingApprovals.set(requestId, resolve);
    broadcastHostEvent('collab.approval', { requestId, request });
  });
}

/** Answer a pending roster/approval prompt from the panel. */
export function respondCollabApproval(requestId: string, decision: ApprovalDecision): void {
  const resolve = pendingApprovals.get(requestId);
  if (!resolve) return;
  pendingApprovals.delete(requestId);
  broadcastHostEvent('collab.approval.resolved', { requestId });
  resolve(decision);
}

/** Drop every pending approval (teardown) so nothing leaks; the driven turn is
 *  already aborting, so the resolved value is inconsequential. */
function cancelApprovals(): void {
  for (const [requestId, resolve] of pendingApprovals) {
    broadcastHostEvent('collab.approval.resolved', { requestId });
    resolve({ optionId: '' });
  }
  pendingApprovals.clear();
}

/**
 * Start a collaboration: spawn the dedicated coordinator, connect, and drive the
 * goal turn. Throws if the CLI can't be resolved or the coordinator never binds
 * its socket. The coordinator's own lock refuses a second concurrent run.
 */
export async function startCollab(args: { cwd: string; goal: string }): Promise<{ started: boolean }> {
  if (coordinator) return { started: false };

  const cli = resolveMoxxyCli({ extraPaths: augmentedPaths() });
  if (!cli) throw new Error('moxxy CLI not found');
  const socket = collabCoordinatorSocketPath();

  // Mirror the channel-supervisor env: a desktop-spawned runner lives in the
  // read-only packaged app and must not co-attach a web surface, race the web
  // port, or try to self-patch core. A fresh session id per run avoids resuming
  // a stale coordinator log.
  const child = spawnCli(cli, ['collab'], {
    cwd: args.cwd,
    env: {
      MOXXY_DEDICATED_RUNNER: '1',
      MOXXY_NO_WEB_SURFACE: '1',
      MOXXY_NO_CORE_UPDATE: '1',
      MOXXY_RUNNER_SOCKET: socket,
      MOXXY_SESSION_ID: `collab-${Date.now().toString(36)}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let earlyExit = false;
  let stderrTail = '';
  child.stderr?.on('data', (b: Buffer) => {
    stderrTail = (stderrTail + b.toString()).slice(-4096);
  });
  child.once('exit', () => {
    earlyExit = true;
    if (coordinator?.child === child) teardown();
  });

  const up = await waitForSocket(socket);
  if (!up || earlyExit) {
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
    throw new Error(stderrTail.trim() || 'collaboration coordinator failed to start');
  }

  const session = await connectRemoteSession({ socketPath: socket, role: 'desktop', replay: 'full' });
  const c = bind(session, args.goal, child);
  c.stderrTail = stderrTail;
  broadcastStatus();

  // Drive the goal turn. Client-scoped, so the coordinator's approval.confirm is
  // forwarded to us (→ collab.approval) instead of silently taking the default.
  const turnAbort = new AbortController();
  c.turnAbort = turnAbort;
  void (async () => {
    try {
      for await (const _ of session.runTurn(args.goal, { signal: turnAbort.signal })) void _;
    } catch {
      // errors surface on the coordinator's own event log (→ collab.event)
    }
  })();

  return { started: true };
}

/**
 * If a coordinator is already running (started from the TUI or a prior desktop
 * run) but this supervisor doesn't hold it, connect read-only so the panel can
 * view the live run. No-op when we already hold one, or none is active.
 */
export async function ensureCollabAttached(): Promise<void> {
  if (coordinator) return;
  const active = readActiveCollab();
  const runnerSocket = active?.runnerSocket;
  const socket = runnerSocket?.trim();
  if (!active || !socket) return;
  if (!(await isRunnerUp(socket))) return;
  try {
    const session = await connectRemoteSession({ socketPath: socket, role: 'desktop', replay: 'full' });
    bind(session, active.task, undefined); // no child: we don't own the process
    broadcastStatus();
  } catch {
    // best-effort viewing; the panel still has collab.active + history
  }
}

/** Run a step-in command (collab_say / collab_direct / collab_pause / collab_resume)
 *  on the coordinator session. Returns a command-result envelope for the panel. */
export async function runCollabCommand(
  name: string,
  cmdArgs: string,
): Promise<{ kind: 'error'; message: string } | unknown> {
  const session = coordinator?.session;
  if (!session) return { kind: 'error', message: 'no collaboration is running' };
  const def = session.commands.get(name);
  if (!def) return { kind: 'error', message: `unknown command: /${name}` };
  return def.handler({
    channel: 'desktop',
    sessionId: session.getInfo().sessionId,
    args: cmdArgs,
    // CommandContext.session is `unknown` (the SDK stays core-free); RemoteSession
    // is assignable directly.
    session,
  });
}

/** End the collaboration: abort the driven turn (its finally archives + releases
 *  the lock), then terminate the coordinator process. Returns how many turns we
 *  aborted (0 when we were only viewing a coordinator we didn't drive). */
export async function stopCollab(): Promise<{ abortedTurns: number }> {
  const c = coordinator;
  if (!c) return { abortedTurns: 0 };
  let abortedTurns = 0;
  if (c.turnAbort) {
    c.turnAbort.abort();
    abortedTurns = 1;
  }
  if (c.child) {
    try {
      c.child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
    const child = c.child;
    const force = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }, 4000);
    force.unref?.();
  }
  teardown();
  return { abortedTurns };
}

/** Drop the held coordinator + all wiring. Idempotent. */
function teardown(): void {
  const c = coordinator;
  coordinator = null;
  cancelApprovals();
  if (c) {
    try {
      c.logUnsub();
    } catch {
      /* ignore */
    }
    try {
      c.session.close();
    } catch {
      /* ignore */
    }
  }
  broadcastStatus();
}

/** App-teardown hook: stop any supervised coordinator. */
export function stopAllCollab(): void {
  if (coordinator) void stopCollab();
}

// Best-effort: never leave the coordinator subprocess orphaned when the app
// quits. `exit` handlers must be synchronous — SIGTERM is; the coordinator's own
// finally then archives the run + releases the lock. (Only fires for a
// coordinator WE spawned; a read-only attach holds no child.)
process.once('exit', () => {
  try {
    const child = coordinator?.child;
    child?.kill('SIGTERM');
  } catch {
    /* ignore */
  }
});
