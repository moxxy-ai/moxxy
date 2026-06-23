import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EventLog } from '../events/log.js';
import { SessionPersistence, type SessionMeta } from './persistence.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-flush-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function readMeta(dir: string, id: string): Promise<SessionMeta> {
  const raw = await fs.readFile(path.join(dir, `${id}.json`), 'utf8');
  return JSON.parse(raw) as SessionMeta;
}

describe('SessionPersistence final-write on detach (async-error-3)', () => {
  it('flush() persists the latest meta immediately, bypassing the 250ms debounce', async () => {
    const dir = await makeTempDir();
    const id = '01FLUSHBYPASS0000000000000';
    const log = new EventLog();
    const persistence = new SessionPersistence({ sessionId: id as never, cwd: '/tmp/p', dir });
    const detach = persistence.attach(log);

    // An append schedules a debounced index write but does NOT flush it.
    await log.append({
      type: 'user_prompt',
      sessionId: id as never,
      turnId: 't1' as never,
      source: 'user',
      text: 'hello',
    });

    // flush() forces the pending write through now. If it waited on the
    // debounce this would still read the pre-append (eventCount 0) sidecar.
    await persistence.flush();
    const after = await readMeta(dir, id);
    expect(after.eventCount).toBe(1);
    expect(after.firstPrompt).toBe('hello');

    detach();
  });

  it('detach writes the final index row without waiting for the debounce window', async () => {
    const dir = await makeTempDir();
    const id = '01DETACHFINAL00000000000000';
    const log = new EventLog();
    const persistence = new SessionPersistence({ sessionId: id as never, cwd: '/tmp/p', dir });
    const detach = persistence.attach(log);

    await log.append({
      type: 'user_prompt',
      sessionId: id as never,
      turnId: 't1' as never,
      source: 'user',
      text: 'last activity',
    });

    // Flush the append's debounced write, then capture the timestamp.
    await persistence.flush();
    const beforeDetach = await readMeta(dir, id);

    // Detach must fire its own final (close-time) write synchronously, not on a
    // 250ms timer an immediate exit would drop. We poll only a microtask-scale
    // window — far shorter than the debounce — to prove it doesn't wait on it.
    detach();
    await waitForCondition(async () => {
      const meta = await readMeta(dir, id);
      return meta.lastActivity >= beforeDetach.lastActivity && meta.eventCount === 1;
    }, 100);

    const finalMeta = await readMeta(dir, id);
    expect(finalMeta.eventCount).toBe(1);
    expect(finalMeta.id).toBe(id);
  });
});

async function waitForCondition(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (await predicate()) return;
    } catch {
      // sidecar may not exist yet — keep polling
    }
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
