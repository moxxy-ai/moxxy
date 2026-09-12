import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { Session, WorkflowApprovals } from '@moxxy/core';
import { asToolCallId } from '@moxxy/sdk';
import { startRunnerServer } from './server.js';
import { connectRemoteSession } from './remote-session.js';

it('serves durable background approvals across a real runner connection and reconnect', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wf-rpc-'));
  const session = new Session({ cwd: dir, silent: true });
  const approvals = new WorkflowApprovals(join(dir, 'approvals'));
  session.workflows = { list: async () => [], setEnabled: async () => {},
    run: async () => ({ ok: true, output: '', steps: [] }), approvals };
  const socketPath = process.platform === 'win32' ? '\\\\.\\pipe\\moxxy-workflow-approval-' + randomUUID() : join(dir, 'runner.sock');
  const server = await startRunnerServer(session, { socketPath });
  let remote = await connectRemoteSession({ socketPath });
  const abort = new AbortController();
  const pending = approvals.check({ workflowId: 'w', workflowName: 'Workflow', revision: 'r1', runId: 'run' },
    { callId: asToolCallId('a'), name: 'Write', input: { path: 'test' } }, abort.signal);
  try {
    const deadline = Date.now() + 3000;
    while ((await approvals.list()).length === 0 && Date.now() < deadline) await delay(10);
    await remote.close();
    remote = await connectRemoteSession({ socketPath });
    const view = remote.workflows.approvals;
    expect(view).toBeDefined();
    if (!view) throw new Error('Missing workflow approvals capability');
    const items = await view.list();
    const first = items[0]; if (!first) throw new Error('Missing request');
    await expect(view.decide('../escape', 'allow_once')).rejects.toThrow();
    await view.decide(first.id, 'allow_once');
    await expect(pending).resolves.toMatchObject({ mode: 'allow' });
    await expect(view.decide(first.id, 'deny')).rejects.toThrow();
  } finally { abort.abort(); await pending; await remote.close(); await server.close(); await session.close(); await rm(dir, { recursive: true, force: true }); }
});
