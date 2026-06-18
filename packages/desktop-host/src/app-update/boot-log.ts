/**
 * A tiny, persistent boot/update decision log — the missing observability for
 * self-update. Every launch, the bootstrap + boot-probe + confirm IPC record
 * what they decided and WHY, so a silent fall-back-to-the-floor (the
 * "downloads but relaunches old" failure) is no longer invisible: the user can
 * read the last decisions from `<userData>/app/boot-log.json` (surfaced in the
 * in-app Updates → Diagnostics panel).
 *
 * Dependency-free (node built-ins only) and synchronous, exactly like the rest
 * of the app-update module, because it is BAKED into the immutable bootstrap and
 * must not delay or destabilize process start. Every operation is best-effort:
 * a missing/corrupt/unwritable log never throws into the boot path.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { appUpdateDir } from './resolve.js';

/** Which step of the launch/update lifecycle produced this entry. */
export type BootLogPhase = 'boot' | 'recover' | 'probe' | 'confirm' | 'load-error';

export interface BootLogEntry {
  /** Epoch millis. Filled in by {@link appendBootLog} when omitted. */
  ts: number;
  phase: BootLogPhase;
  /** The bundle version chosen, or `'floor'` when the baked app was loaded. */
  picked?: string;
  /** Why this decision was made (e.g. the resolve reject reason, probe revert). */
  reason?: string;
  /** The confirmed-good version `active` was rolled back to, if any. */
  recoveredTo?: string;
  /** A failure message (staged-main import throw, confirm IPC failure, …). */
  error?: string;
  /** `process.versions.electron` at decision time. */
  electron?: string;
  /** `process.versions.modules` (the Node ABI) at decision time. */
  abi?: string;
}

/** Keep the log small — it is a rolling window of recent launches, not history. */
const MAX_ENTRIES = 50;

function logPath(userDataDir: string): string {
  return path.join(appUpdateDir(userDataDir), 'boot-log.json');
}

/**
 * tmp-write + rename so a crash mid-write can't corrupt the log. A deliberate
 * dependency-free duplicate of @moxxy/sdk's `writeFileAtomicSync`: this module
 * is BAKED into the immutable bootstrap (see the file header), so importing the
 * SDK barrel — which has no lightweight sync-fs subpath — would inline the whole
 * SDK into the bootstrap. The temp name carries pid + a random UUID, matching
 * the SDK helper's collision-safety, so concurrent writers never clash.
 */
function writeAtomic(p: string, value: unknown): void {
  mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, p);
}

/** Read the raw log array, tolerating a missing or malformed file. */
export function readBootLog(userDataDir: string, limit?: number): BootLogEntry[] {
  let raw: string;
  try {
    raw = readFileSync(logPath(userDataDir), 'utf8');
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const entries = parsed.filter(
    (e): e is BootLogEntry =>
      !!e && typeof e === 'object' && typeof (e as BootLogEntry).ts === 'number' && typeof (e as BootLogEntry).phase === 'string',
  );
  return typeof limit === 'number' && limit >= 0 ? entries.slice(-limit) : entries;
}

/**
 * Append one decision to the log (newest last), capped at {@link MAX_ENTRIES}.
 * Never throws — a logging failure must not break the boot path.
 */
export function appendBootLog(userDataDir: string, entry: Partial<BootLogEntry> & { phase: BootLogPhase }): void {
  try {
    const existing = readBootLog(userDataDir);
    const full: BootLogEntry = { ts: Date.now(), ...entry };
    const next = [...existing, full].slice(-MAX_ENTRIES);
    writeAtomic(logPath(userDataDir), next);
  } catch {
    /* best effort — observability must never destabilize launch */
  }
}

/** True iff a boot log file exists (used by diagnostics to distinguish empty). */
export function hasBootLog(userDataDir: string): boolean {
  return existsSync(logPath(userDataDir));
}
