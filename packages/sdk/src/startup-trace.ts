import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { moxxyPath } from './fs-utils.js';

interface StartupRetry {
  readonly attempt: number;
  readonly cause: 'socket-timeout' | 'early-exit' | 'reattach' | 'connection';
}

/** Opt-in benchmark trace. Only pass stage names and opaque IDs, never paths or error messages. */
export function startupMark(stage: string, ms = 0, ok = true, sessionId = process.env.MOXXY_SESSION_ID, retry?: StartupRetry): void {
  if (process.env.MOXXY_STARTUP_TRACE !== '1') return;
  try {
    const dir = moxxyPath('desktop', 'startup-traces');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const row = { at: Date.now(), pid: process.pid, parent: process.ppid, sessionId, stage, ms, ok, ...retry };
    appendFileSync(join(dir, process.pid + '.jsonl'), JSON.stringify(row) + '\n', { mode: 0o600 });
  } catch { /* Diagnostics are best effort, including on a read-only profile. */ }
}

export async function timeStartup<T>(stage: string, work: () => Promise<T>): Promise<T> {
  if (process.env.MOXXY_STARTUP_TRACE !== '1') return work();
  const start = performance.now();
  let ok = false;
  try {
    const result = await work();
    ok = true;
    return result;
  } finally {
    startupMark(stage, performance.now() - start, ok);
  }
}
