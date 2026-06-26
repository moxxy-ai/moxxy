/**
 * Supervises communication-channel runners spawned from the desktop "Channels"
 * panel. Each channel (Slack, Telegram) runs as its OWN dedicated, isolated
 * runner subprocess — `moxxy <channelId>` with `MOXXY_DEDICATED_RUNNER=1`, which
 * (via the channel's `ChannelDef.dedicatedRunner` declaration) binds a distinct
 * runner socket + sticky session, separate from the desktop's workspace runners.
 *
 * This is a deliberately lighter sibling of {@link RunnerSupervisor}: a channel
 * is fire-and-supervise (no reconnect/socket handshake, no per-workspace driver).
 * We hold the child handle for liveness, tail stderr for error reporting, and
 * read the channel's own status file (`channelStatusPath`) for its public Request
 * URL once its tunnel opens. State changes broadcast `channels.status` so the
 * panel re-renders without polling.
 *
 * Electron-free by construction (spawn + fs + the host event buses only), so it
 * unit-tests against a fake CLI like the rest of desktop-host.
 */

import type { ChildProcess } from 'node:child_process';

import { clearChannelStatus, readChannelStatus } from '@moxxy/sdk/server';
import type { ChannelRuntimeStatus } from '@moxxy/desktop-ipc-contract';
import { augmentedPaths, resolveMoxxyCli, spawnCli } from './cli-resolver';
import { broadcastHostEvent } from './event-bus';

/** How often / how long to poll the status file after a channel starts. A
 *  channel publishes its connect value fast (Slack's Request URL within a second
 *  or two; Telegram's pairing deep link at start), but the connect-state can flip
 *  much later — when the user actually scans the QR and pairs — so we keep
 *  watching for several minutes (the poll also stops the moment `connected`
 *  becomes true, or the process exits). */
const URL_POLL_INTERVAL_MS = 700;
const URL_POLL_TIMEOUT_MS = 5 * 60_000;
/** Cap the stderr we retain per channel for error reporting (avoid unbounded). */
const STDERR_TAIL_CAP = 4096;

interface ChannelProc {
  readonly child: ChildProcess;
  readonly pid: number;
  readonly startedAtMs: number;
  requestUrl?: string;
  connected?: boolean;
  error?: string;
  stderrTail: string;
  urlPoll?: ReturnType<typeof setInterval>;
  urlPollStartedAt: number;
}

/** One process per channel id. Module-level singleton: the IPC handlers are
 *  registered once per transport but share this map. */
const procs = new Map<string, ChannelProc>();

/** The live runtime view of a channel (sans `configured`, which the handler
 *  derives from the vault). `running:false` when we hold no process for it. */
export interface ChannelRuntime {
  readonly running: boolean;
  readonly pid?: number;
  readonly startedAtMs?: number;
  readonly requestUrl?: string;
  readonly connected?: boolean;
  readonly error?: string;
}

export function channelRuntime(id: string): ChannelRuntime {
  const p = procs.get(id);
  if (!p) return { running: false };
  return {
    running: true,
    pid: p.pid,
    startedAtMs: p.startedAtMs,
    ...(p.requestUrl ? { requestUrl: p.requestUrl } : {}),
    ...(p.connected !== undefined ? { connected: p.connected } : {}),
    ...(p.error ? { error: p.error } : {}),
  };
}

/** Broadcast a channel's status. `configured:true` is sound here — the
 *  supervisor only ever tracks channels that were started, which requires being
 *  configured; the full (possibly-false) `configured` is computed by the handler
 *  for the not-running case in `channels.list`. */
function broadcast(id: string, extra?: Partial<ChannelRuntimeStatus>): void {
  const rt = channelRuntime(id);
  broadcastHostEvent('channels.status', {
    id,
    configured: true,
    running: rt.running,
    ...(rt.pid !== undefined ? { pid: rt.pid } : {}),
    ...(rt.startedAtMs !== undefined ? { startedAtMs: rt.startedAtMs } : {}),
    ...(rt.requestUrl !== undefined ? { requestUrl: rt.requestUrl } : {}),
    ...(rt.connected !== undefined ? { connected: rt.connected } : {}),
    ...(rt.error !== undefined ? { error: rt.error } : {}),
    ...extra,
  });
}

/**
 * Start a channel on its own dedicated runner subprocess. Idempotent: if it is
 * already running, this is a no-op. Throws if the moxxy CLI can't be resolved or
 * the spawn fails synchronously.
 */
export function startChannel(id: string): void {
  if (procs.has(id)) return;

  const cli = resolveMoxxyCli({ extraPaths: augmentedPaths() });
  if (!cli) throw new Error('moxxy CLI not found');

  // `MOXXY_DEDICATED_RUNNER=1` forces the isolated runner even if the channel
  // didn't declare it; declared channels (slack/telegram) get it either way. We
  // deliberately do NOT set MOXXY_SESSION_SOURCE — the channel stamps its own.
  const child = spawnCli(cli, [id], {
    env: { MOXXY_DEDICATED_RUNNER: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const entry: ChannelProc = {
    child,
    pid: child.pid ?? -1,
    startedAtMs: Date.now(),
    stderrTail: '',
    urlPollStartedAt: Date.now(),
  };
  procs.set(id, entry);

  const appendStderr = (b: Buffer): void => {
    entry.stderrTail = (entry.stderrTail + b.toString()).slice(-STDERR_TAIL_CAP);
  };
  child.stderr?.on('data', appendStderr);
  // Surface a crash/early-exit: record the error, drop the entry, broadcast.
  child.on('error', (err) => {
    entry.error = err instanceof Error ? err.message : String(err);
    finalize(id, entry);
  });
  child.on('exit', (code, signal) => {
    // A clean stop (we SIGTERM'd it) leaves no error; a non-zero/abnormal exit
    // we didn't ask for carries the stderr tail so the panel can show why.
    if (entry.error === undefined && code !== 0 && code !== null) {
      entry.error = entry.stderrTail.trim() || `exited with code ${code}`;
    } else if (entry.error === undefined && signal && signal !== 'SIGTERM') {
      entry.error = entry.stderrTail.trim() || `killed by ${signal}`;
    }
    finalize(id, entry);
  });

  // Poll the channel's status file for its connect value (Slack's Request URL,
  // Telegram's pairing deep link) AND its connect-state (Telegram pairing).
  // Broadcasts on any change; stops once the channel reports connected, on
  // timeout, or when the process goes away.
  entry.urlPoll = setInterval(() => {
    if (!procs.has(id)) return stopUrlPoll(entry);
    const status = readChannelStatus(id);
    let changed = false;
    if (status?.requestUrl && status.requestUrl !== entry.requestUrl) {
      entry.requestUrl = status.requestUrl;
      changed = true;
    }
    if (status?.connected !== undefined && status.connected !== entry.connected) {
      entry.connected = status.connected;
      changed = true;
    }
    if (changed) broadcast(id);
    // Once the other side is connected (paired) there's nothing left to watch.
    // Otherwise keep polling until the cap — the pairing transition can land
    // minutes after start, when the user finally scans the QR.
    if (entry.connected === true || Date.now() - entry.urlPollStartedAt > URL_POLL_TIMEOUT_MS) {
      stopUrlPoll(entry);
    }
  }, URL_POLL_INTERVAL_MS);
  entry.urlPoll.unref?.();

  broadcast(id);
}

/** Stop a channel's runner (SIGTERM, then SIGKILL after a grace period). */
export function stopChannel(id: string): void {
  const entry = procs.get(id);
  if (!entry) return;
  stopUrlPoll(entry);
  try {
    entry.child.kill('SIGTERM');
  } catch {
    /* already gone */
  }
  // Backstop: if it ignores SIGTERM, force-kill. The 'exit' handler finalizes.
  const force = setTimeout(() => {
    try {
      entry.child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }, 4000);
  force.unref?.();
}

/** Stop every supervised channel — called on app teardown. */
export function stopAllChannels(): void {
  for (const id of [...procs.keys()]) stopChannel(id);
}

function stopUrlPoll(entry: ChannelProc): void {
  if (entry.urlPoll) {
    clearInterval(entry.urlPoll);
    entry.urlPoll = undefined;
  }
}

/** Drop the entry, clean up the (possibly orphaned) status file, broadcast the
 *  stopped status carrying any error so the panel can explain it. */
function finalize(id: string, entry: ChannelProc): void {
  stopUrlPoll(entry);
  if (procs.get(id) !== entry) return;
  procs.delete(id);
  clearChannelStatus(id);
  broadcast(id, entry.error !== undefined ? { error: entry.error } : undefined);
}

// Best-effort: never leave channel subprocesses orphaned when the app quits.
// `exit` handlers must be synchronous; SIGTERM is, and the children's own
// shutdown clears their status files.
process.once('exit', () => {
  for (const entry of procs.values()) {
    try {
      entry.child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
});
