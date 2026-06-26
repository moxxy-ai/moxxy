import { readFileSync, rmSync } from 'node:fs';

import { moxxyPath, writeFileAtomicSync } from './fs-utils.js';

/**
 * The on-disk status a dedicated channel runner publishes so an out-of-process
 * supervisor (the desktop "Channels" panel) can observe it without the runner
 * protocol. Written by `moxxy <channel>` when it self-hosts a dedicated runner,
 * read by the desktop host; removed on graceful shutdown.
 *
 * It is intentionally tiny — readiness + the public ingest URL — not a mirror of
 * the session. The supervisor owns liveness (it holds the child handle); this
 * file is the channel's own report of "I'm up, and here's the URL to paste".
 */
export interface ChannelRunStatus {
  /** Channel name (e.g. `slack`, `telegram`). */
  readonly name: string;
  /** PID of the channel runner process. */
  readonly pid: number;
  /** ISO timestamp the channel reported ready. */
  readonly startedAt: string;
  /** The session source the runner stamped (e.g. `slack`). */
  readonly source?: string;
  /** Public ingest URL (e.g. Slack's Events Request URL) once the tunnel is up;
   *  null for channels with no inbound endpoint (Telegram long-polls). */
  readonly requestUrl?: string | null;
}

/** `~/.moxxy/channel-<name>.status.json` (honors `$MOXXY_HOME`). */
export function channelStatusPath(name: string): string {
  return moxxyPath(`channel-${name}.status.json`);
}

/** Atomically publish a channel's run status (0600 — it may carry a URL). */
export function writeChannelStatus(status: ChannelRunStatus): void {
  writeFileAtomicSync(channelStatusPath(status.name), JSON.stringify(status), { mode: 0o600 });
}

/** Read a channel's published status, or null if absent/unparseable. */
export function readChannelStatus(name: string): ChannelRunStatus | null {
  try {
    return JSON.parse(readFileSync(channelStatusPath(name), 'utf8')) as ChannelRunStatus;
  } catch {
    return null;
  }
}

/** Remove a channel's status file (best-effort; called on graceful shutdown). */
export function clearChannelStatus(name: string): void {
  try {
    rmSync(channelStatusPath(name), { force: true });
  } catch {
    /* best-effort */
  }
}
