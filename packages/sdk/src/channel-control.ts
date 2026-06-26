/**
 * Process-independent control surface for dedicated channel runners.
 *
 * A dedicated channel (Slack, Telegram, …) runs as its OWN isolated runner
 * subprocess that publishes a tiny status file (`channel-<name>.status.json`,
 * see {@link ./channel-status}) on ready and clears it on graceful shutdown. That
 * file — NOT a held child handle — is the source of truth for "is it running",
 * so a channel started from anywhere (the TUI `/channels` panel, `moxxy channels
 * start`, the desktop panel) is visible and stoppable from everywhere, and keeps
 * running after the launcher exits.
 *
 * These helpers are the shared spine for those surfaces:
 *  - {@link spawnDedicatedChannel} — start one, detached, on its own runner.
 *  - {@link liveChannelStatus}/{@link listLiveChannelStatuses} — discover the
 *    running ones (with stale-file self-healing).
 *  - {@link stopDedicatedChannel} — signal one to stop.
 *
 * Node-only (`node:child_process`, `node:fs`) — exported from `@moxxy/sdk/server`.
 */

import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';

import {
  type ChannelRunStatus,
  clearChannelStatus,
  readChannelStatus,
} from './channel-status.js';
import { moxxyHome } from './fs-utils.js';

/** Env vars that ADDRESS a runner (socket + sticky session). We scrub these from
 *  a spawned channel's env so `applyDedicatedRunnerEnv` (which only fills UNSET
 *  vars) derives the channel's OWN isolated socket/session from its name — rather
 *  than the channel silently inheriting and sharing the launcher's runner. */
const ADDRESSING_ENV = ['MOXXY_RUNNER_SOCKET', 'MOXXY_SESSION_ID', 'MOXXY_SESSION_SOURCE'] as const;

/**
 * Start a channel on its own dedicated, detached runner by re-invoking this very
 * moxxy binary as `moxxy <name>` with `MOXXY_DEDICATED_RUNNER=1`. The child is
 * `detached` + `unref`'d with no stdio, so it OUTLIVES the launcher (the user can
 * quit the TUI and the bot keeps serving) and reports itself via its status file.
 *
 * Returns the child pid, or undefined if the spawn produced none. Throws if the
 * moxxy CLI entry can't be resolved (no `process.argv[1]`).
 *
 * Caller's job (this is fire-and-forget): poll {@link liveChannelStatus} to learn
 * when it's ready / failed (no status file within a timeout ⇒ it died on boot —
 * re-run `moxxy <name>` in the foreground to see why).
 */
export function spawnDedicatedChannel(name: string): number | undefined {
  const node = process.execPath; // the running Node binary (pnpm `moxxy` launches via Node)
  const entry = process.argv[1]; // the resolved CLI entry (…/cli/dist/bin.js)
  if (!entry) {
    throw new Error('cannot start a channel: the moxxy CLI entry is unknown (process.argv[1] missing)');
  }

  const env: NodeJS.ProcessEnv = { ...process.env, MOXXY_DEDICATED_RUNNER: '1' };
  for (const key of ADDRESSING_ENV) delete env[key];

  const child = spawn(node, [entry, name], { detached: true, stdio: 'ignore', env });
  child.unref();
  return child.pid;
}

/**
 * Is `pid` a live process? `kill(pid, 0)` sends no signal — it only probes:
 *  - resolves ⇒ alive,
 *  - `ESRCH` ⇒ gone,
 *  - `EPERM` ⇒ alive but owned by another user (treat as alive — it exists).
 */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * The status of channel `name` IF it is actually running. Reads its status file
 * and verifies the pid is alive; a file whose pid is dead (the runner crashed or
 * was SIGKILL'd without clearing it) is treated as not-running AND removed, so a
 * stale file never masquerades as a live channel.
 */
export function liveChannelStatus(name: string): ChannelRunStatus | null {
  const status = readChannelStatus(name);
  if (!status) return null;
  if (!isPidAlive(status.pid)) {
    clearChannelStatus(name);
    return null;
  }
  return status;
}

/** The channel name encoded in a `channel-<name>.status.json` file, or null. */
function statusFileChannelName(file: string): string | null {
  const m = /^channel-(.+)\.status\.json$/.exec(file);
  return m ? (m[1] ?? null) : null;
}

/**
 * Every currently-running dedicated channel, discovered by scanning the moxxy
 * home for status files and filtering to live pids (self-healing stale ones).
 * Returns [] when the home dir doesn't exist yet.
 */
export function listLiveChannelStatuses(): ChannelRunStatus[] {
  let files: string[];
  try {
    files = readdirSync(moxxyHome());
  } catch {
    return []; // no ~/.moxxy yet ⇒ nothing running
  }
  const live: ChannelRunStatus[] = [];
  for (const file of files) {
    const name = statusFileChannelName(file);
    if (!name) continue;
    const status = liveChannelStatus(name);
    if (status) live.push(status);
  }
  return live;
}

/**
 * Ask channel `name` to stop by SIGTERM-ing its runner. The runner's own signal
 * handler tears down gracefully and clears its status file. Returns `'stopped'`
 * if a live runner was signaled, `'not-running'` if there was nothing to stop.
 *
 * This is a single, synchronous SIGTERM — callers that want a hard backstop poll
 * {@link liveChannelStatus} afterwards and escalate (SIGKILL + {@link clearChannelStatus})
 * if it ignores the term within a grace period.
 */
export function stopDedicatedChannel(name: string): 'stopped' | 'not-running' {
  const status = liveChannelStatus(name);
  if (!status) return 'not-running';
  try {
    process.kill(status.pid, 'SIGTERM');
  } catch {
    // Raced us to exit between the liveness check and here — already stopped.
    clearChannelStatus(name);
  }
  return 'stopped';
}
