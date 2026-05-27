import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EventLog } from '../events/log.js';
import { SessionPersistence, readIndex, restoreEvents, type SessionMeta } from './persistence.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-sessions-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function meta(id: string, eventCount = 0): SessionMeta {
  return {
    id,
    cwd: '/tmp/project',
    startedAt: '2026-05-21T00:00:00.000Z',
    lastActivity: '2026-05-21T00:00:00.000Z',
    eventCount,
    firstPrompt: eventCount > 0 ? 'hello' : null,
    provider: null,
    model: null,
  };
}

describe('SessionPersistence', () => {
  it('readIndex ignores rows whose event log file is missing', async () => {
    const dir = await makeTempDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'present.jsonl'), '', 'utf8');
    await fs.writeFile(
      path.join(dir, 'index.json'),
      JSON.stringify([meta('missing'), meta('present')], null, 2),
      'utf8',
    );

    await expect(readIndex(dir)).resolves.toEqual([meta('present')]);
  });

  it('creates a resumable empty event log when a session is indexed before any events', async () => {
    const dir = await makeTempDir();
    const id = '01EMPTYSESSION000000000000';
    const persistence = new SessionPersistence({ sessionId: id as never, cwd: '/tmp/project', dir });
    const detach = persistence.attach(new EventLog());

    await waitForFile(path.join(dir, `${id}.jsonl`));
    await expect(restoreEvents(id, dir)).resolves.toEqual([]);

    detach();
  });

  it('writes a per-session sidecar that readIndex assembles', async () => {
    const dir = await makeTempDir();
    const id = '01SIDECAR00000000000000000';
    const persistence = new SessionPersistence({ sessionId: id as never, cwd: '/tmp/p', dir });
    const detach = persistence.attach(new EventLog());
    await waitForFile(path.join(dir, `${id}.meta.json`));
    const ids = (await readIndex(dir)).map((m) => m.id);
    expect(ids).toContain(id);
    detach();
  });

  it('two concurrent sessions both survive (no shared-index clobber)', async () => {
    const dir = await makeTempDir();
    const idA = '01AAAA00000000000000000001';
    const idB = '01BBBB00000000000000000002';
    const detachA = new SessionPersistence({ sessionId: idA as never, cwd: '/a', dir }).attach(
      new EventLog(),
    );
    const detachB = new SessionPersistence({ sessionId: idB as never, cwd: '/b', dir }).attach(
      new EventLog(),
    );
    await waitForFile(path.join(dir, `${idA}.meta.json`));
    await waitForFile(path.join(dir, `${idB}.meta.json`));
    const ids = (await readIndex(dir)).map((m) => m.id);
    expect(ids).toContain(idA);
    expect(ids).toContain(idB);
    detachA();
    detachB();
  });
});

async function waitForFile(file: string): Promise<void> {
  const deadline = Date.now() + 1_000;
  for (;;) {
    try {
      await fs.access(file);
      return;
    } catch {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${file}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}
