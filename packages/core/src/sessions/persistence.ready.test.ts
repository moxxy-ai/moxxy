/**
 * Regression for u45-2: `writeIndex()` used to re-run ensureDir + ensureLogFile
 * (an `fs.open(logPath,'a')` + close) on EVERY 250ms debounced index flush. The
 * one-time setup is now memoized, so `fs.open` fires once (at attach), never
 * again from the index-write path.
 */

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventLog } from '../events/log.js';
import { SessionPersistence } from './persistence.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-ready-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('SessionPersistence one-time setup (no per-flush open/close)', () => {
  it('opens the log file at most once across attach + many flushes', async () => {
    const dir = await makeTempDir();
    const id = '01READYONCE00000000000000A';
    const log = new EventLog();
    const persistence = new SessionPersistence({ sessionId: id as never, cwd: '/tmp/p', dir });

    const openSpy = vi.spyOn(fs, 'open');
    const detach = persistence.attach(log);

    // Drive several index flushes (each bypasses the debounce).
    for (let i = 0; i < 5; i += 1) {
      await log.append({
        type: 'user_prompt',
        sessionId: id as never,
        turnId: `t${i}` as never,
        source: 'user',
        text: `msg ${i}`,
      });
      await persistence.flush();
    }
    detach();
    await persistence.flush();

    // Exactly one open (the initial ensureLogFile) — not one per flush.
    expect(openSpy).toHaveBeenCalledTimes(1);

    // Sidecar still written correctly.
    const raw = await fs.readFile(path.join(dir, `${id}.meta.json`), 'utf8');
    const meta = JSON.parse(raw) as { eventCount: number; firstPrompt: string | null };
    expect(meta.eventCount).toBe(5);
    expect(meta.firstPrompt).toBe('msg 0');
  });
});
