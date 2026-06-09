import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { PairingStore, createMobileGatewayServer } from '../serve.js';

describe('PairingStore', () => {
  it('exchanges the current pairing code for a reusable bearer token', () => {
    const store = new PairingStore({ code: '123456', tokenFactory: () => 'token-1' });

    expect(store.consumeCode('000000')).toBeNull();
    expect(store.consumeCode('123456')).toEqual({ token: 'token-1' });
    expect(store.isAuthorized('token-1')).toBe(true);
  });

  it('serializes a scan-ready QR payload with the current LAN URL and pairing code', () => {
    const store = new PairingStore({ code: '123456', tokenFactory: () => 'token-1' });

    const info = store.pairingInfo('http://192.168.0.44:17902/mobile/v1');
    const payload = JSON.parse(info.qrPayload);

    expect(payload).toEqual({
      type: 'moxxy-mobile-gateway',
      version: 1,
      url: 'http://192.168.0.44:17902/mobile/v1',
      code: '123456',
    });
  });
});

describe('mobile gateway server', () => {
  let bridge: FakeBridge | undefined;
  let gateway: Awaited<ReturnType<ReturnType<typeof createMobileGatewayServer>['start']>> | undefined;

  afterEach(async () => {
    await gateway?.stop();
    await bridge?.stop();
    gateway = undefined;
    bridge = undefined;
  });

  it('rejects snapshot requests without a paired mobile token', async () => {
    bridge = await startFakeBridge();
    gateway = await createMobileGatewayServer({ apiUrl: bridge.url, token: 'bridge-token', port: 0 }).start();

    const res = await fetch(`${gateway.url}/mobile/v1/snapshot`);

    expect(res.status).toBe(401);
  });

  it('returns pairing metadata and allows a paired token to read a snapshot', async () => {
    bridge = await startFakeBridge();
    gateway = await createMobileGatewayServer({ apiUrl: bridge.url, token: 'bridge-token', port: 0 }).start();

    const pairing = await getJson<{ code: string }>(`${gateway.url}/mobile/v1/pairing`);
    const paired = await postJson<{ token: string }>(`${gateway.url}/mobile/v1/pair`, {
      code: pairing.code,
    });
    const snapshot = await getJson(`${gateway.url}/mobile/v1/snapshot`, paired.token);

    expect(paired.token).toMatch(/^mg_/);
    expect(snapshot).toMatchObject({
      session: { id: 'session-1' },
      agents: [{ id: 'agent-1', label: 'Agent 1' }],
      pendingPermissions: [{ id: 'perm-1' }],
      commands: [{ name: 'compact' }],
    });
  });

  it('returns the desktop-mirror snapshot fields needed by the mobile app', async () => {
    bridge = await startFakeBridge();
    gateway = await createMobileGatewayServer({ apiUrl: bridge.url, token: 'bridge-token', port: 0 }).start();

    const pairing = await getJson<{ code: string }>(`${gateway.url}/mobile/v1/pairing`);
    const paired = await postJson<{ token: string }>(`${gateway.url}/mobile/v1/pair`, {
      code: pairing.code,
    });
    const snapshot = await getJson(`${gateway.url}/mobile/v1/snapshot`, paired.token);

    expect(snapshot).toMatchObject({
      activeWorkspaceId: 'workspace-1',
      workspaces: [
        {
          id: 'workspace-1',
          name: 'Moxxy',
          cwd: '/repo/moxxy',
          unread: false,
        },
      ],
      chatEvents: [{ id: 'event-1', type: 'assistant_message', content: 'Ready' }],
      streamingText: 'Working',
      sending: true,
      activeTurnId: 'turn-1',
      queue: [{ id: 'q-1', prompt: 'next task' }],
      compacting: false,
      usage: { latestPrompt: 1024 },
      autoApprove: true,
      activeMode: 'goal',
      activeProvider: 'openai-codex',
      modeBadge: { label: 'Goal', tone: 'primary' },
      pendingAsks: [{ requestId: 'ask-1', kind: 'permission' }],
    });
  });

  it('allows Expo web to call gateway endpoints across localhost origins', async () => {
    bridge = await startFakeBridge();
    gateway = await createMobileGatewayServer({ apiUrl: bridge.url, token: 'bridge-token', port: 0 }).start();

    const options = await fetch(`${gateway.url}/mobile/v1/pairing`, { method: 'OPTIONS' });
    const pairing = await fetch(`${gateway.url}/mobile/v1/pairing`);

    expect(options.status).toBe(204);
    expect(options.headers.get('access-control-allow-origin')).toBe('*');
    expect(pairing.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('renders a scannable QR code on the gateway status page', async () => {
    bridge = await startFakeBridge();
    gateway = await createMobileGatewayServer({
      apiUrl: bridge.url,
      token: 'bridge-token',
      port: 0,
      pairingStore: new PairingStore({ code: '123456', tokenFactory: () => 'token-1' }),
    }).start();

    const html = await fetch(gateway.url).then((res) => res.text());

    expect(html).toContain('Scan to pair');
    expect(html).toContain('data:image/svg+xml;base64,');
    expect(html).toContain('/mobile/v1/pairing-qr.svg');
    expect(html).toContain('refreshPairing');
    expect(html).toContain('123456');
  });

  it('serves the latest pairing QR after the one-time code rotates', async () => {
    bridge = await startFakeBridge();
    gateway = await createMobileGatewayServer({
      apiUrl: bridge.url,
      token: 'bridge-token',
      port: 0,
      pairingStore: new PairingStore({ code: '123456', tokenFactory: () => 'token-1' }),
    }).start();

    const firstQr = await fetch(`${gateway.url}/mobile/v1/pairing-qr.svg`).then(async (res) => ({
      status: res.status,
      contentType: res.headers.get('content-type'),
      body: await res.text(),
    }));
    await postJson(`${gateway.url}/mobile/v1/pair`, { code: '123456' });
    const rotated = await getJson<{ code: string }>(`${gateway.url}/mobile/v1/pairing`);
    const secondQr = await fetch(`${gateway.url}/mobile/v1/pairing-qr.svg`).then(async (res) => ({
      status: res.status,
      contentType: res.headers.get('content-type'),
      body: await res.text(),
    }));

    expect(firstQr.status).toBe(200);
    expect(firstQr.contentType).toContain('image/svg+xml');
    expect(firstQr.body).toContain('<svg');
    expect(rotated.code).not.toBe('123456');
    expect(secondQr.status).toBe(200);
    expect(secondQr.body).toContain('<svg');
    expect(secondQr.body).not.toBe(firstQr.body);
  });

  it('fans out bridge SSE events to authorized websocket clients', async () => {
    bridge = await startFakeBridge();
    gateway = await createMobileGatewayServer({ apiUrl: bridge.url, token: 'bridge-token', port: 0 }).start();
    const pairing = await getJson<{ code: string }>(`${gateway.url}/mobile/v1/pairing`);
    const paired = await postJson<{ token: string }>(`${gateway.url}/mobile/v1/pair`, {
      code: pairing.code,
    });

    const socket = new WebSocket(`${gateway.wsUrl}/mobile/v1/ws?token=${paired.token}`);
    const messages = collectMessages(socket);
    await waitForFrame(messages, 'snapshot');

    bridge.emitSse({ type: 'event', event: { type: 'chat.message', text: 'hello' } });

    await expect(waitForFrame(messages, 'event')).resolves.toMatchObject({
      type: 'event',
      event: { type: 'chat.message', text: 'hello' },
    });
    socket.close();
  });

  it('proxies permission decisions to the bridge', async () => {
    bridge = await startFakeBridge();
    gateway = await createMobileGatewayServer({ apiUrl: bridge.url, token: 'bridge-token', port: 0 }).start();
    const pairing = await getJson<{ code: string }>(`${gateway.url}/mobile/v1/pairing`);
    const paired = await postJson<{ token: string }>(`${gateway.url}/mobile/v1/pair`, {
      code: pairing.code,
    });

    const socket = new WebSocket(`${gateway.wsUrl}/mobile/v1/ws?token=${paired.token}`);
    const messages = collectMessages(socket);
    await waitForFrame(messages, 'snapshot');

    socket.send(
      JSON.stringify({
        type: 'permission.decision',
        id: 'client-frame-1',
        permissionId: 'perm-1',
        decision: { mode: 'allow_once' },
      }),
    );

    await waitFor(() => bridge?.permissionDecisions.length === 1);
    expect(bridge.permissionDecisions[0]).toEqual({
      id: 'perm-1',
      body: { mode: 'allow_once' },
      authorization: 'Bearer bridge-token',
    });
    socket.close();
  });

  it('proxies mobile control frames to the bridge runtime', async () => {
    bridge = await startFakeBridge();
    gateway = await createMobileGatewayServer({ apiUrl: bridge.url, token: 'bridge-token', port: 0 }).start();
    const pairing = await getJson<{ code: string }>(`${gateway.url}/mobile/v1/pairing`);
    const paired = await postJson<{ token: string }>(`${gateway.url}/mobile/v1/pair`, {
      code: pairing.code,
    });

    const socket = new WebSocket(`${gateway.wsUrl}/mobile/v1/ws?token=${paired.token}`);
    const messages = collectMessages(socket);
    await waitForFrame(messages, 'snapshot');

    socket.send(JSON.stringify({ type: 'runTurn', id: 'frame-run', workspaceId: 'workspace-1', prompt: 'ship it' }));
    socket.send(JSON.stringify({ type: 'abortTurn', id: 'frame-abort', workspaceId: 'workspace-1', turnId: 'turn-1' }));
    socket.send(JSON.stringify({ type: 'ask.respond', id: 'frame-ask', requestId: 'ask-1', response: { mode: 'allow_session' } }));
    socket.send(JSON.stringify({ type: 'setAutoApprove', id: 'frame-auto', workspaceId: 'workspace-1', enabled: true }));
    socket.send(JSON.stringify({ type: 'setMode', id: 'frame-mode', workspaceId: 'workspace-1', mode: 'goal' }));
    socket.send(JSON.stringify({ type: 'newSession', id: 'frame-new', workspaceId: 'workspace-1' }));
    socket.send(JSON.stringify({ type: 'runCommand', id: 'frame-command', workspaceId: 'workspace-1', name: 'compact', args: '--now' }));
    socket.send(JSON.stringify({ type: 'selectWorkspace', id: 'frame-select', workspaceId: 'workspace-2' }));

    await waitFor(() => (bridge?.requests.length ?? 0) >= 7);
    expect(bridge.requests).toEqual(expect.arrayContaining([
      {
        path: '/v1/turn/stream',
        body: { prompt: 'ship it' },
        authorization: 'Bearer bridge-token',
      },
      {
        path: '/v1/asks/ask-1/respond',
        body: { mode: 'allow_session' },
        authorization: 'Bearer bridge-token',
      },
      {
        path: '/v1/session/auto-approve',
        body: { type: 'setAutoApprove', id: 'frame-auto', workspaceId: 'workspace-1', enabled: true },
        authorization: 'Bearer bridge-token',
      },
      {
        path: '/v1/session/mode',
        body: { type: 'setMode', id: 'frame-mode', workspaceId: 'workspace-1', mode: 'goal' },
        authorization: 'Bearer bridge-token',
      },
      {
        path: '/v1/session/new',
        body: { type: 'newSession', id: 'frame-new', workspaceId: 'workspace-1' },
        authorization: 'Bearer bridge-token',
      },
      {
        path: '/v1/commands',
        body: { type: 'runCommand', id: 'frame-command', workspaceId: 'workspace-1', name: 'compact', args: '--now' },
        authorization: 'Bearer bridge-token',
      },
      {
        path: '/v1/session-selection',
        body: { type: 'selectWorkspace', id: 'frame-select', workspaceId: 'workspace-2' },
        authorization: 'Bearer bridge-token',
      },
    ]));
    expect(bridge.requests).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/v1/runs' }),
      expect.objectContaining({ path: '/v1/runs/abort' }),
    ]));
    socket.close();
  });

  it('runs mobile chat turns through the real HTTP channel stream endpoint', async () => {
    bridge = await startFakeBridge();
    gateway = await createMobileGatewayServer({ apiUrl: bridge.url, token: 'bridge-token', port: 0 }).start();
    const pairing = await getJson<{ code: string }>(`${gateway.url}/mobile/v1/pairing`);
    const paired = await postJson<{ token: string }>(`${gateway.url}/mobile/v1/pair`, {
      code: pairing.code,
    });

    const socket = new WebSocket(`${gateway.wsUrl}/mobile/v1/ws?token=${paired.token}`);
    const messages = collectMessages(socket);
    await waitForFrame(messages, 'snapshot');

    socket.send(JSON.stringify({ type: 'runTurn', id: 'frame-run-stream', prompt: 'czesc' }));

    await expect(waitForEvent(messages, 'assistant_message')).resolves.toMatchObject({
      type: 'event',
      event: { type: 'assistant_message', content: 'czesc from bridge' },
    });
    expect(bridge.requests).toContainEqual({
      path: '/v1/turn/stream',
      body: { prompt: 'czesc' },
      authorization: 'Bearer bridge-token',
    });
    socket.close();
  });
});

interface FakeBridge {
  readonly url: string;
  readonly permissionDecisions: Array<{ id: string; body: unknown; authorization?: string }>;
  readonly requests: Array<{ path: string; body: unknown; authorization?: string }>;
  emitSse(payload: unknown): void;
  stop(): Promise<void>;
}

async function startFakeBridge(): Promise<FakeBridge> {
  const sseClients = new Set<{ write(chunk: string): void }>();
  const permissionDecisions: FakeBridge['permissionDecisions'] = [];
  const requests: FakeBridge['requests'] = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/v1/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === '/v1/snapshot') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          session: { id: 'session-1' },
          activeWorkspaceId: 'workspace-1',
          workspaces: [
            {
              id: 'workspace-1',
              name: 'Moxxy',
              cwd: '/repo/moxxy',
              unread: false,
            },
          ],
          agents: [{ id: 'agent-1', label: 'Agent 1' }],
          pendingPermissions: [{ id: 'perm-1' }],
          pendingAsks: [{ requestId: 'ask-1', kind: 'permission' }],
          commands: [{ name: 'compact' }],
          chatEvents: [{ id: 'event-1', type: 'assistant_message', content: 'Ready' }],
          streamingText: 'Working',
          sending: true,
          activeTurnId: 'turn-1',
          queue: [{ id: 'q-1', prompt: 'next task' }],
          compacting: false,
          usage: { latestPrompt: 1024 },
          autoApprove: true,
          activeMode: 'goal',
          activeProvider: 'openai-codex',
          modeBadge: { label: 'Goal', tone: 'primary' },
        }),
      );
      return;
    }
    if (url.pathname === '/v1/events/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }
    if (url.pathname === '/v1/turn/stream' && req.method === 'POST') {
      requests.push({
        path: url.pathname,
        body: await readJson(req),
        authorization: req.headers.authorization,
      });
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(`data: ${JSON.stringify({ type: 'user_prompt', content: 'czesc' })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'assistant_message', content: 'czesc from bridge' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    const permissionMatch = url.pathname.match(/^\/v1\/permissions\/([^/]+)\/decision$/);
    if (permissionMatch && req.method === 'POST') {
      permissionDecisions.push({
        id: permissionMatch[1],
        body: await readJson(req),
        authorization: req.headers.authorization,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    const askMatch = url.pathname.match(/^\/v1\/asks\/([^/]+)\/respond$/);
    if (askMatch && req.method === 'POST') {
      requests.push({
        path: url.pathname,
        body: await readJson(req),
        authorization: req.headers.authorization,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (
      req.method === 'POST' &&
      [
        '/v1/runs',
        '/v1/runs/abort',
        '/v1/session/auto-approve',
        '/v1/session/mode',
        '/v1/session/new',
        '/v1/commands',
        '/v1/session-selection',
      ].includes(url.pathname)
    ) {
      requests.push({
        path: url.pathname,
        body: await readJson(req),
        authorization: req.headers.authorization,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  await listen(server);
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    permissionDecisions,
    requests,
    emitSse(payload) {
      for (const client of sseClients) client.write(`data: ${JSON.stringify(payload)}\n\n`);
    },
    stop: () => close(server),
  };
}

function collectMessages(socket: WebSocket): unknown[] {
  const messages: unknown[] = [];
  socket.on('message', (data) => messages.push(JSON.parse(String(data))));
  return messages;
}

async function waitForFrame(messages: unknown[], type: string): Promise<unknown> {
  await waitFor(() => messages.some((message) => (message as { type?: string }).type === type));
  return messages.find((message) => (message as { type?: string }).type === type);
}

async function waitForEvent(messages: unknown[], eventType: string): Promise<unknown> {
  await waitFor(() =>
    messages.some((message) => {
      const frame = message as { type?: string; event?: { type?: string } };
      return frame.type === 'event' && frame.event?.type === eventType;
    }),
  );
  return messages.find((message) => {
    const frame = message as { type?: string; event?: { type?: string } };
    return frame.type === 'event' && frame.event?.type === eventType;
  });
}

async function getJson<T = unknown>(url: string, token?: string): Promise<T> {
  const res = await fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : undefined });
  expect(res.status).toBe(200);
  return (await res.json()) as T;
}

async function postJson<T = unknown>(url: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as T;
}

async function readJson(req: NodeJS.ReadableStream): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function waitFor(predicate: () => boolean, timeoutMs = 1500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for condition');
}

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
