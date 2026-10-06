import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { asToolCallId } from '@moxxy/sdk';
import { WorkflowApprovals } from './workflow-approvals.js';
import { removeDir } from '@moxxy/vitest-preset/fs';

type Requests = Awaited<ReturnType<WorkflowApprovals['list']>>;
const isPending = (items: Requests) => items.some((item) => item.status === 'pending');

/**
 * The broker's requests once `ready` holds. `check` writes its request to disk without the caller awaiting it,
 * and a busy machine can take far longer than a fixed pause, so this waits for the files themselves.
 */
async function requestsWhen(broker: WorkflowApprovals, ready: (items: Requests) => boolean, missing: string): Promise<Requests> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const items = await broker.list();
    if (ready(items)) return items;
    if (Date.now() > deadline) throw new Error(`${missing} within 5 s`);
    await delay(5);
  }
}

it('persists scoped approvals, arbitrates two clients, supports revoke, deny and cancellation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moxxy-approvals-'));
  const broker = new WorkflowApprovals(dir);
  const other = new WorkflowApprovals(dir);
  const scope = { workflowId: 'fixture', workflowName: 'Fixture', revision: 'revision1', runId: 'run1' };
  const call = (id: string, value = 'hello') => ({ callId: asToolCallId(id), name: 'Write', input: { path: 'test.txt', value } });
  const controller = new AbortController();
    const request = broker.check(scope, call('a'), controller.signal);
  try {
    const first = (await requestsWhen(broker, (items) => items.length > 0, 'No durable request'))[0];
    if (!first) throw new Error('No durable request');
    expect((await other.list())[0]?.id).toBe(first.id);
    const decisions = await Promise.allSettled([
      broker.decide(first.id, 'allow_always'), other.decide(first.id, 'deny'),
    ]);
    expect(decisions.filter(d => d.status === 'fulfilled')).toHaveLength(1);
    const decided = await request;
    expect(['allow', 'deny']).toContain(decided.mode);
    if (decided.mode === 'allow') {
      await expect(other.check({ ...scope, runId: 'run2' }, call('b'), controller.signal)).resolves.toMatchObject({ mode: 'allow' });
      await other.revoke(first.id);
      await expect(broker.check(scope, call('a'), controller.signal)).resolves.toMatchObject({ mode: 'deny' });
    }
    const again = broker.check({ ...scope, revision: 'revision2' }, call('c'), controller.signal);
    const next = (await requestsWhen(broker, isPending, 'Changed definition did not request approval')).find(p => p.status === 'pending');
    if (!next) throw new Error('Changed definition did not request approval');
    await broker.decide(next.id, 'deny');
    await expect(again).resolves.toMatchObject({ mode: 'deny' });
    await expect(broker.check({ ...scope, revision: 'revision2' }, call('d'), controller.signal)).resolves.toMatchObject({ mode: 'deny' });
    const cancelled = broker.check(scope, call('e', 'different'), controller.signal);
    await requestsWhen(broker, isPending, 'Changed input did not request approval');
    controller.abort();
    await expect(cancelled).resolves.toMatchObject({ mode: 'deny' });
    expect((await broker.list()).some(p => p.status === 'pending')).toBe(false);
    // Invalid data must never reset or overwrite the original evidence.
    const corrupt = join(dir, 'requests', first.id + '.json');
    await writeFile(corrupt, '{broken');
    await expect(other.list()).rejects.toThrow();
    expect(await readFile(corrupt, 'utf8')).toBe('{broken');
  } finally { controller.abort(); await request; await removeDir(dir); }
});

it('stops a pending execution and prevents a late decision from granting access', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moxxy-approval-stop-'));
  const broker = new WorkflowApprovals(dir);
  const controller = new AbortController();
  const scope = { workflowId: 'workflow', workflowName: 'Workflow', revision: 'r', runId: 'run' };
  const pending = broker.check(scope, { callId: asToolCallId('call'), name: 'Write', input: {} }, controller.signal);
  try {
    const request = (await requestsWhen(broker, (items) => items.length > 0, 'No request'))[0];
    if (!request) throw new Error('No request');
    await broker.cancel(request.id);
    await expect(pending).resolves.toMatchObject({ mode: 'deny' });
    await expect(broker.decide(request.id, 'allow_always')).rejects.toThrow();
    expect(await broker.isCancelled(scope)).toBe(true);
  } finally { controller.abort(); await pending; await removeDir(dir); }
});

it('reuses only acknowledged exact grants and immediately honors revocation on the same call', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workflow-grant-revoke-'));
  const broker = new WorkflowApprovals(dir);
  const controller = new AbortController();
  const scope = { workflowId: 'workflow', workflowName: 'Workflow', revision: 'r', runId: 'first' };
  const call = { callId: asToolCallId('first'), name: 'Write', input: { path: 'report.txt', text: 'fixed' } };
  const pending = broker.check(scope, call, controller.signal);
  try {
    const request = (await requestsWhen(broker, (items) => items.length > 0, 'Missing approval'))[0];
    if (!request) throw new Error('Missing approval');
    await broker.decide(request.id, 'allow_always');
    await expect(pending).resolves.toMatchObject({ mode: 'allow' });
    const next = { ...scope, runId: 'second' };
    await expect(broker.check(next, call, controller.signal)).resolves.toMatchObject({ mode: 'allow' });
    expect(await broker.list()).toHaveLength(1);
    await broker.revoke(request.id);
    await expect(broker.check(next, call, controller.signal)).resolves.toMatchObject({ mode: 'deny' });
    const changed = broker.check({ ...scope, runId: 'third' }, { ...call, input: { ...call.input, path: 'other.txt' } }, controller.signal);
    expect(await requestsWhen(broker, (items) => items.length >= 2, 'Changed input did not request approval')).toHaveLength(2);
    controller.abort(); await expect(changed).resolves.toMatchObject({ mode: 'deny' });
  } finally { controller.abort(); await pending; await removeDir(dir); }
});
