import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBrowserPlugin } from './index.js';
import { resetBrowserBackendForTests } from './browser-session.js';
import { BRIDGE_SOCKET_ENV, BRIDGE_TOKEN_ENV } from './bridge-client.js';

/**
 * Which browser the plugin brings depends on whether the host already has one.
 *
 * Getting this wrong is not a cosmetic bug: registering the polling frame
 * surface inside the desktop would launch a second Chromium and stream
 * screenshots of a page nobody is looking at, while the user watches a
 * different page entirely.
 */

const saved = { socket: process.env[BRIDGE_SOCKET_ENV], token: process.env[BRIDGE_TOKEN_ENV] };

afterEach(() => {
  if (saved.socket === undefined) delete process.env[BRIDGE_SOCKET_ENV];
  else process.env[BRIDGE_SOCKET_ENV] = saved.socket;
  if (saved.token === undefined) delete process.env[BRIDGE_TOKEN_ENV];
  else process.env[BRIDGE_TOKEN_ENV] = saved.token;
});

describe('browser plugin — picking a backend', () => {
  it('ships the frame surface when the host has no browser of its own', () => {
    delete process.env[BRIDGE_SOCKET_ENV];
    delete process.env[BRIDGE_TOKEN_ENV];

    expect(buildBrowserPlugin().surfaces).toHaveLength(1);
  });

  it('ships no surface when the desktop already hosts the page', () => {
    process.env[BRIDGE_SOCKET_ENV] = '/tmp/x.sock';
    process.env[BRIDGE_TOKEN_ENV] = 'abc';

    expect(buildBrowserPlugin().surfaces).toHaveLength(0);
  });

  it('offers the same tools either way, so the model sees one browser', () => {
    delete process.env[BRIDGE_SOCKET_ENV];
    const withoutBridge = buildBrowserPlugin().tools?.map((t) => t.name);
    process.env[BRIDGE_SOCKET_ENV] = '/tmp/x.sock';
    process.env[BRIDGE_TOKEN_ENV] = 'abc';
    const withBridge = buildBrowserPlugin().tools?.map((t) => t.name);

    expect(withBridge).toEqual(withoutBridge);
  });
});

/**
 * The one that mattered and was missed: `browser_session` built its own call
 * bound straight to the Playwright child, bypassing the backend switch that
 * every other browser tool goes through. Inside the desktop that launched a
 * SECOND Chromium — none of the user's logins, invisible to everyone — and the
 * agent drove that one while the person watched the real page sit still.
 *
 * Seen live: asked to play a YouTube video, the agent reported it had, and was
 * telling the truth. About a browser nobody could see.
 *
 * Driven against a real socket rather than a spawn spy, because an explicit
 * `spawnFn` deliberately forces the sidecar and so cannot answer the question
 * this test asks.
 */
describe('browser_session — which browser it actually drives', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    resetBrowserBackendForTests();
    for (const s of servers.splice(0)) await new Promise((r) => s.close(() => r(undefined)));
  });

  /** A bridge that records what the tool asked it to do. */
  async function fakeBridge(): Promise<{ socketPath: string; token: string; seen: string[] }> {
    const seen: string[] = [];
    const token = 'test-token';
    const socketPath = join(mkdtempSync(join(tmpdir(), 'moxxy-bridge-test-')), 'b.sock');
    const server = createServer((socket) => {
      socket.setEncoding('utf8');
      let buf = '';
      socket.on('data', (chunk: string) => {
        buf += chunk;
        let nl: number;
        while ((nl = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          const req = JSON.parse(line) as { id: string; method: string };
          if (req.method !== 'hello') seen.push(req.method);
          socket.write(JSON.stringify({ id: req.id, ok: true, result: 'https://widoczna.pl' }) + '\n');
        }
      });
    });
    servers.push(server);
    await new Promise<void>((res) => server.listen(socketPath, () => res()));
    return { socketPath, token, seen };
  }

  function sessionTool() {
    const tool = buildBrowserPlugin().tools?.find((t) => t.name === 'browser_session');
    if (!tool) throw new Error('no browser_session tool');
    return tool as unknown as { handler: (i: unknown, c: never) => Promise<unknown> };
  }

  const ctx = (): never =>
    ({
      signal: new AbortController().signal,
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    }) as never;

  it('sends its work to the page on screen, not to a browser of its own', async () => {
    const bridge = await fakeBridge();
    process.env[BRIDGE_SOCKET_ENV] = bridge.socketPath;
    process.env[BRIDGE_TOKEN_ENV] = bridge.token;
    resetBrowserBackendForTests();

    const out = await sessionTool().handler({ action: { kind: 'url' } }, ctx());

    expect(bridge.seen).toContain('url');
    expect(out).toBe('https://widoczna.pl');
  });

  it('routes the selector layer there too, not just navigation', async () => {
    const bridge = await fakeBridge();
    process.env[BRIDGE_SOCKET_ENV] = bridge.socketPath;
    process.env[BRIDGE_TOKEN_ENV] = bridge.token;
    resetBrowserBackendForTests();
    const tool = sessionTool();

    await tool.handler({ action: { kind: 'click', selector: 'button.play' } }, ctx());
    await tool.handler({ action: { kind: 'eval', expression: '1' } }, ctx());
    await tool.handler({ action: { kind: 'text' } }, ctx());

    expect(bridge.seen).toEqual(['click', 'eval', 'text']);
  });
});
