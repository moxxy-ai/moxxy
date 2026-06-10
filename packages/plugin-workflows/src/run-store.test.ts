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
});
