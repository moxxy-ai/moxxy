import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { expect, it } from 'vitest';
import { Session, WorkflowApprovals } from '@moxxy/core';
import { asToolCallId } from '@moxxy/sdk';
import { startWsBridge, WebSocketCommandBus } from '@moxxy/ipc-server-ws';
import { MobileSessionHost } from './single-session-host.js';

it('serves scoped workflow decisions through the authenticated mobile bridge and rejects another workspace', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mobile-workflow-'));
  const session = new Session({ cwd: dir, silent: true });
  const approvals = new WorkflowApprovals(join(dir, 'approvals'));
  session.workflows = { list: async () => [], setEnabled: async () => {},
    run: async () => ({ ok: true, output: '', steps: [] }), approvals };
  const bus = new WebSocketCommandBus();
  const host = new MobileSessionHost(bus, session);
  host.register();
  const server = await startWsBridge(bus, { port: 0, authToken: 'workflow-test-token' });
  const socket = new WebSocket(server.address, { headers: { authorization: 'Bearer workflow-test-token' } });
  const abort = new AbortController();
  const pending = approvals.check({ workflowId: 'w', workflowName: 'Test', revision: 'r', runId: 'run' },
    { callId: asToolCallId('call'), name: 'Write', input: {} }, abort.signal);
  let id = 0;
  const request = (method: string, params: unknown) => new Promise<unknown>((resolve, reject) => {
    const callId = ++id;
    const timer = setTimeout(() => { socket.off('message', receive); reject(new Error('RPC timeout')); }, 3000);
    const receive = (bytes: WebSocket.RawData) => {
      const frame = JSON.parse(bytes.toString());
      if (frame.id !== callId) return;
      clearTimeout(timer); socket.off('message', receive);
      if (frame.error) reject(new Error(frame.error.message)); else resolve(frame.result);
    };
    socket.on('message', receive);
    socket.send(JSON.stringify({ jsonrpc: '2.0', id: callId, method, params }));
  });
  try {
    await once(socket, 'open');
    const deadline = Date.now() + 3000;
    while (!(await approvals.list()).length && Date.now() < deadline) await delay(10);
    const item = (await approvals.list())[0]; if (!item) throw new Error('No approval');
    await expect(request('workflows.approvals', { workspaceId: String(session.id) })).resolves.toMatchObject([{ id: item.id }]);
    await expect(request('workflows.decideApproval', { workspaceId: 'other', id: item.id, choice: 'allow_always' })).rejects.toThrow(/workspace/i);
    await request('workflows.decideApproval', { workspaceId: String(session.id), id: item.id, choice: 'allow_once' });
    await expect(pending).resolves.toMatchObject({ mode: 'allow' });
  } finally {
    abort.abort(); await pending; socket.terminate(); await server.close(); host.dispose();
    await session.close(); await rm(dir, { recursive: true, force: true });
  }
});
