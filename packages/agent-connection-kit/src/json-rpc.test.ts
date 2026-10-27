/**
 * The line JSON-RPC client Moxxy uses to talk to a vendor agent's own server
 * (Codex app-server, an ACP agent such as OpenCode). The agent side is a real
 * child process speaking the protocol, one JSON message per line.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { JsonRpcError, JsonRpcLineClient } from './json-rpc.js';

/**
 * A tiny agent: answers `add`, fails `boom`, sends a notification for
 * `progress`, asks the client `approve` for `act`, and exits on `quit`.
 * Messages are written in two pieces to prove lines are joined.
 */
const AGENT = String.raw`
const rl = require('node:readline').createInterface({ input: process.stdin });
const withJsonrpc = process.argv[1] === 'jsonrpc';
let queue = Promise.resolve();
const send = (m) => {
  const line = JSON.stringify(withJsonrpc ? { jsonrpc: '2.0', ...m } : m) + '\n';
  const half = Math.floor(line.length / 2);
  queue = queue.then(() => new Promise((done) => {
    process.stdout.write(line.slice(0, half));
    setTimeout(() => { process.stdout.write(line.slice(half)); done(); }, 5);
  }));
};
let asked = 0;
rl.on('line', (line) => {
  const m = JSON.parse(line);
  if (process.env.ECHO_SHAPE && m.method) send({ method: 'shape', params: { hasJsonrpc: 'jsonrpc' in m } });
  if (m.method === 'add') send({ id: m.id, result: m.params.a + m.params.b });
  else if (m.method === 'boom') send({ id: m.id, error: { code: -32000, message: 'it broke', data: { why: 'test' } } });
  else if (m.method === 'progress') { send({ method: 'turn/progress', params: { step: 1 } }); send({ id: m.id, result: null }); }
  else if (m.method === 'act') { asked = m.id; send({ id: 'srv-1', method: 'approve', params: { what: 'rm' } }); }
  else if (m.id === 'srv-1') send({ id: asked, result: m.result ?? { error: m.error } });
  else if (m.method === 'quit') process.exit(0);
  else if (m.method === 'hang') {}
});
`;

const children: ChildProcessWithoutNullStreams[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill();
});

function agent(mode: 'plain' | 'jsonrpc' = 'plain', env: Record<string, string> = {}): JsonRpcLineClient {
  const child = spawn(process.execPath, ['-e', AGENT, mode], { env: { ...process.env, ...env } });
  children.push(child);
  return new JsonRpcLineClient({ readable: child.stdout, writable: child.stdin, jsonrpc: mode === 'jsonrpc' });
}

describe('talking to an agent over line JSON-RPC', () => {
  it('sends a request and gets its answer', async () => {
    const client = agent();
    expect(await client.request('add', { a: 2, b: 3 })).toBe(5);
  });

  it('writes the "jsonrpc" field only for agents that expect it', async () => {
    const shapes: unknown[] = [];
    const codex = agent('plain', { ECHO_SHAPE: '1' });
    codex.onNotification((method, params) => method === 'shape' && shapes.push(params));
    const acp = agent('jsonrpc', { ECHO_SHAPE: '1' });
    acp.onNotification((method, params) => method === 'shape' && shapes.push(params));

    await codex.request('add', { a: 1, b: 1 });
    await acp.request('add', { a: 1, b: 1 });

    expect(shapes).toEqual([{ hasJsonrpc: false }, { hasJsonrpc: true }]);
  });

  it('turns an error answer into a JsonRpcError', async () => {
    const client = agent('jsonrpc');

    const failure = await client.request('boom').catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(JsonRpcError);
    expect(failure).toMatchObject({ code: -32000, message: 'it broke', data: { why: 'test' } });
  });

  it('delivers what the agent reports while it works', async () => {
    const client = agent();
    const seen: unknown[] = [];
    client.onNotification((method, params) => seen.push({ method, params }));

    await client.request('progress');

    expect(seen).toEqual([{ method: 'turn/progress', params: { step: 1 } }]);
  });

  it('answers what the agent asks Moxxy, such as an approval', async () => {
    const client = agent();
    client.onRequest(async (method, params) => ({ decision: method === 'approve' && (params as { what: string }).what === 'rm' ? 'deny' : 'allow' }));

    expect(await client.request('act')).toEqual({ decision: 'deny' });
  });

  it('tells the agent when Moxxy has no answer for what it asks', async () => {
    const client = agent();

    expect(await client.request('act')).toEqual({ error: { code: -32601, message: 'Method not found: approve' } });
  });

  it('fails what is still waiting when the agent exits', async () => {
    const client = agent();
    const waiting = client.request('hang');

    void client.notify('quit');

    await expect(waiting).rejects.toThrow(/stopped/);
    await expect(client.request('add', { a: 1, b: 2 })).rejects.toThrow(/stopped/);
  });

  it('gives up waiting when the turn is stopped', async () => {
    const client = agent();
    const controller = new AbortController();
    const waiting = client.request('hang', undefined, controller.signal);

    controller.abort();

    await expect(waiting).rejects.toThrow(/abort/i);
  });
});
