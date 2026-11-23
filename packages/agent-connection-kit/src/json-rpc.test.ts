/**
 * The line JSON-RPC client Moxxy uses to talk to a vendor agent's own server
 * (Codex app-server, an ACP agent such as OpenCode). The agent side is a real
 * child process speaking the protocol, one JSON message per line.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JsonRpcError, JsonRpcLineClient } from './json-rpc.js';

/**
 * A tiny agent: answers `add`, fails `boom`, sends a notification for
 * `progress`, asks the client `approve` for `act`, and exits on `quit`.
 * Messages are written in two pieces to prove lines are joined.
 */
const AGENT = String.raw`
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
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
  else if (m.method === 'separators') {
    send({ method: 'turn/progress', params: { text: 'a' + LS + 'b' } });
    send({ id: m.id, result: 'one' + LS + 'two' + PS + 'three' });
  }
  else if (m.method === 'split-letters') {
    // Pieces cut inside the bytes of a Polish letter and of an emoji.
    const bytes = Buffer.from(JSON.stringify({ id: m.id, result: 'zażółć 🦊' }) + '\n');
    const cuts = [bytes.indexOf(Buffer.from('ż')) + 1, bytes.indexOf(Buffer.from('🦊')) + 2, bytes.length];
    let from = 0;
    for (const [i, to] of cuts.entries()) { const piece = bytes.subarray(from, to); setTimeout(() => process.stdout.write(piece), 5 * i); from = to; }
  }
  else if (m.method === 'crlf') process.stdout.write(JSON.stringify({ id: m.id, result: 'windows' }) + '\r\n');
  else if (m.method === 'blank-lines') process.stdout.write('\n\n' + JSON.stringify({ id: m.id, result: 'after blanks' }) + '\n');
  else if (m.method === 'last-words') process.stdout.write(JSON.stringify({ id: m.id, result: 'bye' }), () => process.exit(0));
  else if (m.method === 'garbage') { process.stdout.write('not json, private text\n'); process.stdout.write('{"cut":\n'); send({ id: m.id, result: 'still here' }); }
});
`;

const children: ChildProcessWithoutNullStreams[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill();
});

function agent(mode: 'plain' | 'jsonrpc' = 'plain', env: Record<string, string> = {}, warn?: (message: string) => void): JsonRpcLineClient {
  const child = spawn(process.execPath, ['-e', AGENT, mode], { env: { ...process.env, ...env } });
  children.push(child);
  return new JsonRpcLineClient({ readable: child.stdout, writable: child.stdin, jsonrpc: mode === 'jsonrpc', ...(warn ? { warn } : {}) });
}

/** U+2028 and U+2029: valid inside a JSON string, and sent raw by Codex (web search titles, page text). */
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

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

describe('reading what the agent writes, one message per line', () => {
  it('keeps a message whole when its text holds a line or paragraph separator', async () => {
    const client = agent();
    const seen: unknown[] = [];
    client.onNotification((method, params) => seen.push({ method, params }));

    expect(await client.request('separators')).toBe(`one${LS}two${PS}three`);
    expect(seen).toEqual([{ method: 'turn/progress', params: { text: `a${LS}b` } }]);
  });

  it('keeps Polish letters and emoji whose bytes arrive in separate pieces', async () => {
    expect(await agent().request('split-letters')).toBe('zażółć 🦊');
  });

  it('reads lines that end the Windows way', async () => {
    expect(await agent().request('crlf')).toBe('windows');
  });

  it('skips empty lines', async () => {
    expect(await agent().request('blank-lines')).toBe('after blanks');
  });

  it('reads the last message even when the agent exits before ending its line', async () => {
    expect(await agent().request('last-words')).toBe('bye');
  });

  it('reports a line that is not a message once, by its size only, and reads on', async () => {
    const warnings: string[] = [];
    const client = agent('plain', {}, (message) => warnings.push(message));

    expect(await client.request('garbage')).toBe('still here');
    expect(await client.request('garbage')).toBe('still here');

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/not JSON.*22 bytes/);
    expect(warnings[0]).not.toContain('private');
  });

  // The TUI draws on the terminal of the same process: a report on stderr would land in its screen.
  it('writes nothing on the terminal when no reporter is given', async () => {
    const written = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    let reports: string[];
    try {
      expect(await agent().request('garbage')).toBe('still here');
      reports = written.mock.calls.map(([chunk]) => String(chunk)).filter((text) => text.includes('not JSON'));
    } finally {
      written.mockRestore();
    }

    expect(reports).toEqual([]);
  });
});
