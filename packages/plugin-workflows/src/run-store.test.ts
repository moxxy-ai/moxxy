import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Workflow } from '@moxxy/sdk';
import { WorkflowRunStore } from './run-store.js';

let dir: string;
let store: WorkflowRunStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-runstore-'));
  store = new WorkflowRunStore(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const fakeWorkflow = { name: 'x', description: 'x', steps: [] } as unknown as Workflow;

function checkpoint(vars: Record<string, unknown> = {}) {
  return {
    workflow: fakeWorkflow,
    trigger: 'manual',
    inputs: {},
    states: {},
    vars,
    pendingStepId: 'ask',
    interactionAgentId: 'child-1',
    startedAt: 1,
  };
}

describe('WorkflowRunStore', () => {
  it('round-trips a checkpoint including vars (Finding 4)', async () => {
    const runId = await store.save(checkpoint({ email: 'ops@example.com' }));
    const loaded = await store.load(runId);
    expect(loaded?.vars).toEqual({ email: 'ops@example.com' });
    expect(loaded?.pendingStepId).toBe('ask');
    // The atomic write leaves no orphan temp file behind (proves the rename
    // completed; the shared helper uses a pid+uuid-unique tmp).
    const leftovers = (await fs.readdir(dir)).filter((n) => n.includes('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('concurrent saves both land intact with no temp collision', async () => {
    const [a, b] = await Promise.all([
      store.save(checkpoint({ k: 'a' })),
      store.save(checkpoint({ k: 'b' })),
    ]);
    expect((await store.load(a))?.vars).toEqual({ k: 'a' });
    expect((await store.load(b))?.vars).toEqual({ k: 'b' });
    const leftovers = (await fs.readdir(dir)).filter((n) => n.includes('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('removes a checkpoint', async () => {
    const runId = await store.save(checkpoint());
    await store.remove(runId);
    expect(await store.load(runId)).toBeNull();
  });

  it('sweeps stale checkpoint files past the TTL (Finding 1)', async () => {
    const stale = await store.save(checkpoint());
    const fresh = await store.save(checkpoint());

    // Backdate the stale file's mtime well past any TTL.
    const stalePath = path.join(dir, `${stale}.json`);
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await fs.utimes(stalePath, old, old);

    const removed = await store.sweepStale(7 * 24 * 60 * 60 * 1000);
    expect(removed).toBe(1);
    expect(await store.load(stale)).toBeNull();
    expect(await store.load(fresh)).not.toBeNull();
  });

  it('sweepStale on a missing dir returns 0', async () => {
    const missing = new WorkflowRunStore(path.join(dir, 'does-not-exist'));
    expect(await missing.sweepStale()).toBe(0);
  });

  it('rejects a path-traversal runId on load (no arbitrary-file read)', async () => {
    // Plant a secret outside the store dir; a traversal id must not reach it.
    const secret = path.join(dir, '..', 'secret.json');
    await fs.writeFile(secret, JSON.stringify({ ...checkpoint(), pendingStepId: 'leak' }), 'utf8');
    try {
      for (const bad of [
        '../secret',
        '../../etc/passwd',
        '..%2f..%2fsecret',
        'not-a-ulid',
        '01ARZ3NDEKTSV4RRFFQ69G5FA', // 25 chars (one short of a ulid)
        '',
      ]) {
        expect(await store.load(bad)).toBeNull();
      }
    } finally {
      await fs.rm(secret, { force: true });
    }
  });

  it('does not unlink outside the store dir on a traversal runId (no arbitrary delete)', async () => {
    const victim = path.join(dir, '..', 'victim.json');
    await fs.writeFile(victim, 'keep me', 'utf8');
    try {
      await store.remove('../victim');
      await store.remove('../../victim');
      // The file outside the store survives the traversal attempts.
      expect(await fs.readFile(victim, 'utf8')).toBe('keep me');
    } finally {
      await fs.rm(victim, { force: true });
    }
  });

  it('returns null for a corrupt/tampered checkpoint instead of surfacing it', async () => {
    const runId = await store.save(checkpoint());
    const file = path.join(dir, `${runId}.json`);
    // Truncated JSON (write that lost to the rename in an older build).
    await fs.writeFile(file, '{"workflow":{"steps":', 'utf8');
    expect(await store.load(runId)).toBeNull();
    // Structurally wrong shapes (states null, steps not an array, missing fields).
    await fs.writeFile(file, JSON.stringify({ workflow: { steps: 'nope' }, states: {}, pendingStepId: 'x' }), 'utf8');
    expect(await store.load(runId)).toBeNull();
    await fs.writeFile(file, JSON.stringify({ workflow: { steps: [] }, states: null, pendingStepId: 'x' }), 'utf8');
    expect(await store.load(runId)).toBeNull();
    await fs.writeFile(file, 'null', 'utf8');
    expect(await store.load(runId)).toBeNull();
  });
});
