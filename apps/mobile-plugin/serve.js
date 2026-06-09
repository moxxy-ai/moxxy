import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import QRCode from 'qrcode';
import { WebSocketServer } from 'ws';
import { buildHealth, connectBridgeEvents, fetchSnapshot, postBridge, streamBridgeTurn } from './src/bridge.js';
import { PairingStore, publicMobileUrl } from './src/pairing.js';
import { createMobilePromptHub, createSessionMobileBackend } from './src/session-backend.js';

export { PairingStore } from './src/pairing.js';

const PLUGIN_NAME = '@moxxy/mobile-gateway-plugin';
const DEFAULT_PORT = 17902;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_MOBILE_BIND_HOST = '0.0.0.0';
const DEFAULT_API_HOST = '127.0.0.1';
const DEFAULT_EXPO_HOST = 'lan';
const DEFAULT_EXPO_PORT = 8081;
const PLUGIN_DIR = fileURLToPath(new URL('.', import.meta.url));

export function resolveMobileGatewayOptions(options = {}) {
  const resolved = { host: DEFAULT_MOBILE_BIND_HOST };
  const port = parsePositiveInt(options.port);
  const host = stringOption(options.host);
  const apiUrl = stringOption(options['api-url']) ?? apiUrlFromPort(options['api-port']);
  const token = stringOption(options.token);
  if (port !== undefined) resolved.port = port;
  if (host) resolved.host = host;
  if (apiUrl) resolved.apiUrl = apiUrl;
  if (token !== undefined) resolved.token = token;
  return resolved;
}

export function resolveMobileExpoOptions(options = {}) {
  return {
    enabled: !isTruthy(options['no-expo']) && process.env.MOXXY_MOBILE_NO_EXPO !== '1',
    host: stringOption(options['expo-host']) ?? DEFAULT_EXPO_HOST,
    port: parsePositiveInt(options['expo-port']) ?? DEFAULT_EXPO_PORT,
  };
}

export function buildExpoStartArgs(options) {
  return [
    'run',
    'start',
    '--',
    '--host',
    options.host,
    '--port',
    String(options.port),
  ];
}

function isTruthy(value) {
  return value === true || value === 'true' || value === '1';
}

function stringOption(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parsePositiveInt(value) {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function apiUrlFromPort(value) {
  const port = parsePositiveInt(value);
  return port === undefined ? undefined : `http://${DEFAULT_API_HOST}:${port}`;
}

export async function runMobileGatewayCommand(options = {}, deps = {}) {
  const handle = await startMobileRuntime(options, deps);
  await waitForShutdown();
  await handle.stop();
  return 0;
}

export async function startMobileRuntime(options = {}, deps = {}) {
  const server = createMobileGatewayServer({
    ...resolveMobileGatewayOptions(options),
    ...(deps.session ? { session: deps.session } : {}),
    ...(deps.promptHub ? { promptHub: deps.promptHub } : {}),
  });
  const gateway = await server.start();
  console.log(`Moxxy Mobile Gateway running on ${gateway.url}`);
  await printPairingQrHint(gateway.url).catch(() => undefined);
  const expo = await startExpoApp(resolveMobileExpoOptions(options));
  return {
    url: gateway.url,
    stop: async () => {
      await expo?.stop();
      await gateway.stop();
    },
  };
}

async function startExpoApp(options, deps = {}) {
  if (!options.enabled) return null;
  const mobileDir = deps.mobileDir ?? resolveMobileAppDir();
  if (!mobileDir) return null;
  if (!existsSync(join(mobileDir, 'package.json'))) return null;
  if (await isTcpPortOpen('127.0.0.1', options.port)) {
    console.log(`Moxxy Mobile Expo already running on http://localhost:${options.port}`);
    return { stop: async () => undefined };
  }

  const spawnProcess = deps.spawnProcess ?? spawn;
  const child = spawnProcess('npm', buildExpoStartArgs(options), {
    cwd: mobileDir,
    env: {
      ...process.env,
      BROWSER: 'none',
      EXPO_NO_TELEMETRY: '1',
    },
    stdio: 'inherit',
  });

  const running = new Promise((resolve) => {
    child.once('exit', () => resolve());
    child.once('error', () => resolve());
  });

  return {
    stop: async () => {
      if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
      await running;
    },
  };
}

export function resolveMobileAppDir(cwd = process.cwd()) {
  const local = join(PLUGIN_DIR, 'mobile');
  if (existsSync(join(local, 'package.json'))) return local;

  let cursor = resolve(cwd);
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(cursor, 'apps', 'mobile-plugin', 'mobile');
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return null;
}

function createMobileLauncherChannel(deps = {}) {
  const baseOptions = deps.options ?? {};
  const promptHub = deps.promptHub ?? createMobilePromptHub();
  return {
    name: 'mobile',
    permissionResolver: promptHub.permissionResolver,
    async start(options = {}) {
      let resolveRunning;
      let handle;
      const session = options.session;
      session?.setApprovalResolver?.(promptHub.approvalResolver);
      const running = startMobileRuntime({ ...baseOptions, ...options }, { session, promptHub }).then((started) => {
        handle = started;
        return new Promise((resolve) => {
          resolveRunning = resolve;
        });
      });
      return {
        running,
        async stop() {
          await handle?.stop();
          promptHub.abortAll();
          session?.setApprovalResolver?.(null);
          resolveRunning?.();
        },
      };
    },
  };
}

export const mobileGatewayPlugin = Object.freeze({
  __moxxy: 'plugin',
  name: PLUGIN_NAME,
  version: '0.1.0',
  channels: [
    Object.freeze({
      name: 'mobile',
      description: 'Pair a phone with the active Moxxy session over the LAN.',
      interactiveCommand: 'open',
      create: createMobileLauncherChannel,
      subcommands: {
        open: {
          description: 'Start the Mobile Gateway pairing server.',
          run: async (ctx) => ctx.startChannel({ ...ctx.args.flags, __skipWizard: true }),
        },
      },
    }),
  ],
});

export default mobileGatewayPlugin;

export function createMobileGatewayServer(options = {}) {
  const host = options.host ?? process.env.MOXXY_PLUGIN_HOST ?? process.env.HOST ?? DEFAULT_HOST;
  const port = Number(options.port ?? process.env.MOXXY_PLUGIN_PORT ?? process.env.PORT ?? DEFAULT_PORT);
  const apiUrl = new URL(options.apiUrl ?? process.env.MOXXY_API_URL ?? 'http://127.0.0.1:3737');
  const upstreamToken = options.token ?? process.env.MOXXY_TOKEN ?? '';
  const pairing = options.pairingStore ?? new PairingStore();
  const clients = new Set();
  const eventAbort = new AbortController();
  const turnControllers = new Map();
  const broadcastFrame = (frame) => {
    for (const client of clients) sendFrame(client, frame);
  };
  const promptHub = options.promptHub ?? createMobilePromptHub();
  const sessionBackend = options.session
    ? createSessionMobileBackend(options.session, {
        promptHub,
        broadcast: broadcastFrame,
        ...(options.sessionCatalog ? { sessionCatalog: options.sessionCatalog } : {}),
        ...(options.sessionDir ? { sessionDir: options.sessionDir } : {}),
        ...(options.workspaceCatalog ? { workspaceCatalog: options.workspaceCatalog } : {}),
        ...(options.desktopChatCatalog ? { desktopChatCatalog: options.desktopChatCatalog } : {}),
        ...(options.desktopChatDir ? { desktopChatDir: options.desktopChatDir } : {}),
      })
    : null;
  let server;
  let wss;

  async function handleHttp(req, res) {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${host}:${port}`}`);
    try {
      if (req.method === 'OPTIONS' && url.pathname.startsWith('/mobile/v1/')) {
        return sendCorsPreflight(res);
      }
      if (req.method === 'GET' && url.pathname === '/') {
        return sendHtml(res, await renderStatusPage(pairing.pairingInfo(publicMobileUrl(req))));
      }
      if (req.method === 'GET' && url.pathname === '/mobile/v1/pairing-qr.svg') {
        return sendSvg(res, await pairingQrSvg(pairing.pairingInfo(publicMobileUrl(req)).qrPayload));
      }
      if (req.method === 'GET' && url.pathname === '/mobile/v1/health') {
        return sendJson(res, 200, sessionBackend ? sessionBackend.health() : await buildHealth(apiUrl, upstreamToken));
      }
      if (req.method === 'GET' && url.pathname === '/mobile/v1/pairing') {
        return sendJson(res, 200, pairing.pairingInfo(publicMobileUrl(req)));
      }
      if (req.method === 'POST' && url.pathname === '/mobile/v1/pair') {
        const body = await readJson(req);
        const result = pairing.consumeCode(body.code);
        if (!result) return sendJson(res, 401, { error: 'invalid_pairing_code' });
        return sendJson(res, 200, { ...result, url: publicMobileUrl(req) });
      }
      if (req.method === 'GET' && url.pathname === '/mobile/v1/snapshot') {
        if (!isAuthorizedRequest(req, pairing)) return sendJson(res, 401, { error: 'unauthorized' });
        return sendJson(res, 200, sessionBackend ? sessionBackend.snapshot() : await fetchSnapshot(apiUrl, upstreamToken));
      }
      return sendJson(res, 404, { error: 'not_found' });
    } catch (err) {
      return sendJson(res, 500, { error: 'gateway_error', message: errorMessage(err) });
    }
  }

  async function handleClientFrame(ws, frame) {
    if (frame.type === 'ping') {
      sendFrame(ws, { type: 'connection', status: 'alive' });
      return;
    }
    if (sessionBackend) {
      const result = await sessionBackend.handleClientFrame(frame, ws);
      if (result.handled) {
        if (result.frame) sendFrame(ws, result.frame);
        return;
      }
    }
    switch (frame.type) {
      case 'ping':
        sendFrame(ws, { type: 'connection', status: 'alive' });
        return;
      case 'ask.respond':
        await postBridge(
          apiUrl,
          upstreamToken,
          `/v1/asks/${encodeURIComponent(frame.requestId)}/respond`,
          frame.response,
        );
        sendFrame(ws, { type: 'ask.resolved', id: frame.id, requestId: frame.requestId });
        return;
      case 'permission.decision':
        await postBridge(apiUrl, upstreamToken, `/v1/permissions/${encodeURIComponent(frame.permissionId)}/decision`, frame.decision);
        sendFrame(ws, { type: 'permission.resolved', id: frame.id, permissionId: frame.permissionId });
        return;
      case 'runTurn':
      case 'run':
        sendFrame(ws, { type: 'connection', status: 'run.accepted', id: frame.id });
        startBridgeTurnStream(frame, ws);
        return;
      case 'abortTurn':
      case 'abort':
        abortBridgeTurn(frame);
        sendFrame(ws, { type: 'connection', status: 'abort.accepted', id: frame.id });
        return;
      case 'setAutoApprove':
        await postBridge(apiUrl, upstreamToken, '/v1/session/auto-approve', frame);
        sendFrame(ws, {
          type: 'connection',
          status: 'auto-approve.updated',
          id: frame.id,
          autoApprove: frame.enabled === true,
        });
        return;
      case 'setMode':
        await postBridge(apiUrl, upstreamToken, '/v1/session/mode', frame);
        sendFrame(ws, { type: 'connection', status: 'mode.updated', id: frame.id });
        return;
      case 'newSession':
        await postBridge(apiUrl, upstreamToken, '/v1/session/new', frame);
        sendFrame(ws, { type: 'connection', status: 'session.new', id: frame.id });
        return;
      case 'runCommand':
      case 'command':
        sendFrame(ws, { type: 'connection', status: 'command.started', id: frame.id, commandName: frame.name });
        try {
          await postBridge(apiUrl, upstreamToken, '/v1/commands', frame);
          sendFrame(ws, { type: 'connection', status: 'command.completed', id: frame.id, commandName: frame.name });
        } catch (err) {
          sendFrame(ws, { type: 'connection', status: 'command.failed', id: frame.id, commandName: frame.name });
          throw err;
        }
        return;
      case 'transcribe':
        sendFrame(ws, { type: 'connection', status: 'transcribe.accepted', id: frame.id });
        {
          const result = await postBridge(apiUrl, upstreamToken, '/v1/transcribe', frame);
          sendFrame(ws, {
            type: 'transcribe.result',
            id: frame.id,
            text: typeof result?.text === 'string' ? result.text : typeof result === 'string' ? result : '',
          });
        }
        return;
      case 'selectWorkspace':
      case 'selectSession':
        await postBridge(apiUrl, upstreamToken, '/v1/session-selection', frame);
        sendFrame(ws, {
          type: 'connection',
          status: 'workspace.selected',
          id: frame.id,
          activeWorkspaceId: frame.workspaceId ?? frame.sessionId,
        });
        return;
      default:
        sendFrame(ws, { type: 'error', message: `unknown client frame: ${frame.type}` });
    }
  }

  function startBridgeTurnStream(frame, owner) {
    if (typeof frame.prompt !== 'string' || frame.prompt.trim().length === 0) {
      sendFrame(owner, { type: 'error', message: 'runTurn requires a non-empty prompt' });
      return;
    }
    const controller = new AbortController();
    const key = typeof frame.id === 'string' ? frame.id : `turn-${Date.now()}`;
    turnControllers.set(key, controller);
    streamBridgeTurn(
      apiUrl,
      upstreamToken,
      frame,
      (payload) => {
        for (const client of clients) sendFrame(client, { type: 'event', event: payload });
      },
      controller.signal,
    )
      .catch((err) => {
        const message = errorMessage(err);
        sendFrame(owner, { type: 'error', message });
        for (const client of clients) sendFrame(client, { type: 'event', event: { type: 'turn_error', message } });
      })
      .finally(() => {
        turnControllers.delete(key);
      });
  }

  function abortBridgeTurn(frame) {
    const keys = [frame.turnId, frame.id].filter((value) => typeof value === 'string');
    if (keys.length === 0) {
      for (const controller of turnControllers.values()) controller.abort('mobile requested abort');
      return;
    }
    for (const key of keys) {
      turnControllers.get(key)?.abort('mobile requested abort');
    }
  }

  return {
    async start() {
      server = createServer(handleHttp);
      wss = new WebSocketServer({ noServer: true });
      wss.on('connection', async (ws) => {
        clients.add(ws);
        sendFrame(ws, { type: 'hello', protocol: 'mobile.v1' });
        try {
          sendFrame(ws, { type: 'snapshot', snapshot: sessionBackend ? sessionBackend.snapshot() : await fetchSnapshot(apiUrl, upstreamToken) });
        } catch (err) {
          sendFrame(ws, { type: 'error', message: errorMessage(err) });
        }
        ws.on('message', async (data) => {
          try {
            await handleClientFrame(ws, JSON.parse(String(data)));
          } catch (err) {
            sendFrame(ws, { type: 'error', message: errorMessage(err) });
          }
        });
        ws.on('close', () => clients.delete(ws));
      });
      server.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${host}:${port}`}`);
        if (url.pathname !== '/mobile/v1/ws' || !pairing.isAuthorized(url.searchParams.get('token'))) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
      });
      await listen(server, port, host);
      sessionBackend?.start();
      if (!sessionBackend) connectBridgeEvents(apiUrl, upstreamToken, clients, eventAbort.signal).catch(() => undefined);
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      const displayHost = displayHostForBindHost(host);
      return {
        url: `http://${displayHost}:${actualPort}`,
        wsUrl: `ws://${displayHost}:${actualPort}`,
        stop: async () => {
          eventAbort.abort();
          sessionBackend?.stop();
          for (const controller of turnControllers.values()) controller.abort('mobile gateway stopping');
          turnControllers.clear();
          for (const client of clients) client.close();
          await closeWss(wss);
          await closeServer(server);
        },
      };
    },
  };
}

function displayHostForBindHost(host) {
  return host === '0.0.0.0' || host === '::' ? DEFAULT_HOST : host;
}

export function startServer() {
  const server = createMobileGatewayServer();
  server.start().then((handle) => {
    console.log(`Moxxy Mobile Gateway running on ${handle.url}`);
  });
  return server;
}

function waitForShutdown() {
  return new Promise((resolve) => {
    const done = () => {
      process.off('SIGINT', done);
      process.off('SIGTERM', done);
      resolve();
    };
    process.once('SIGINT', done);
    process.once('SIGTERM', done);
  });
}

function isTcpPortOpen(host, port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const done = (open) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(500);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

export function isDirectRun(argvPath = process.argv[1], moduleUrl = import.meta.url) {
  if (!argvPath) return false;
  if (basename(argvPath) !== 'serve.js') return false;
  if (moduleUrl === pathToFileURL(argvPath).href) return true;
  try {
    return moduleUrl === pathToFileURL(realpathSync(argvPath)).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  startServer();
}

function isAuthorizedRequest(req, pairing) {
  const header = req.headers.authorization ?? '';
  const [kind, token] = header.split(/\s+/, 2);
  return kind?.toLowerCase() === 'bearer' && pairing.isAuthorized(token);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw.length > 0 ? JSON.parse(raw) : {};
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache',
    ...corsHeaders(),
  });
  res.end(JSON.stringify(body));
}

function sendHtml(res, body) {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache',
    ...corsHeaders(),
  });
  res.end(body);
}

function sendSvg(res, body) {
  res.writeHead(200, {
    'Content-Type': 'image/svg+xml; charset=utf-8',
    'Cache-Control': 'no-cache',
    ...corsHeaders(),
  });
  res.end(body);
}

function sendCorsPreflight(res) {
  res.writeHead(204, corsHeaders());
  res.end();
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

function sendFrame(ws, frame) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
}

async function printPairingQrHint(gatewayUrl) {
  const res = await fetch(`${gatewayUrl}/mobile/v1/pairing`);
  if (!res.ok) return;
  const pairingInfo = await res.json();
  if (typeof pairingInfo?.qrPayload !== 'string') return;
  console.log(`Open ${gatewayUrl} or scan this QR from Moxxy Mobile:`);
  const terminalQr = await QRCode.toString(pairingInfo.qrPayload, { type: 'terminal', small: true });
  console.log(terminalQr);
}

async function renderStatusPage(pairingInfo) {
  const qrDataUrl = await pairingQrSvgDataUrl(pairingInfo.qrPayload).catch(() => '');
  const code = escapeHtml(pairingInfo.code ?? '------');
  const lanUrl = escapeHtml(pairingInfo.lanUrl ?? pairingInfo.url ?? '');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Moxxy Mobile Gateway</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; min-height: 100vh; background: #f1f2f9; color: #0f172a; display: grid; place-items: center; }
    main { width: min(720px, calc(100vw - 32px)); padding: 32px 0; }
    h1 { font-size: clamp(32px, 7vw, 56px); line-height: 1; margin: 0 0 12px; letter-spacing: 0; }
    h2 { font-size: 20px; margin: 0 0 10px; }
    p { color: #475569; font-size: 17px; line-height: 1.6; margin: 0 0 18px; }
    code { background: #f8fafc; border: 1px solid #e3e5f0; border-radius: 8px; padding: 6px 8px; }
    .panel { border: 1px solid #e3e5f0; border-radius: 14px; padding: 22px; background: #fff; box-shadow: 0 18px 42px rgba(15, 23, 42, .08); }
    .qr { align-items: center; background: #fdf2f8; border-radius: 14px; display: grid; justify-items: center; margin: 18px 0; padding: 22px; }
    .qr img { background: #fff; border-radius: 10px; height: min(320px, 70vw); padding: 12px; width: min(320px, 70vw); }
    .code { color: #db2777; font-size: 44px; font-weight: 900; letter-spacing: .08em; margin: 4px 0 0; }
    .muted { color: #64748b; font-size: 14px; }
  </style>
</head>
<body>
  <main>
    <h1>Moxxy Mobile Gateway</h1>
    <p>LAN pairing gateway for the Moxxy mobile app. Keep this process running while your phone is connected.</p>
    <div class="panel">
      <h2>Scan to pair</h2>
      <p>Open Moxxy Mobile on your phone and scan this QR code. Manual pairing still works with the code below.</p>
      <div class="qr">
        ${qrDataUrl ? `<img id="pairing-qr" alt="Moxxy Mobile pairing QR code" src="${qrDataUrl}" data-src="/mobile/v1/pairing-qr.svg">` : '<p>QR code unavailable. Use manual pairing.</p>'}
        <div id="pairing-code" class="code">${code}</div>
      </div>
      <p class="muted">Gateway URL: <code id="gateway-url">${lanUrl}</code></p>
      <p>Health: <code>/mobile/v1/health</code></p>
      <p>Pairing: <code>/mobile/v1/pairing</code></p>
    </div>
  </main>
  <script>
    const codeNode = document.getElementById('pairing-code');
    const urlNode = document.getElementById('gateway-url');
    const qrNode = document.getElementById('pairing-qr');
    let latestCode = ${JSON.stringify(pairingInfo.code ?? '')};

    async function refreshPairing() {
      try {
        const response = await fetch('/mobile/v1/pairing', { cache: 'no-store' });
        if (!response.ok) return;
        const pairing = await response.json();
        if (typeof pairing.code === 'string' && pairing.code !== latestCode) {
          latestCode = pairing.code;
          if (codeNode) codeNode.textContent = pairing.code;
          if (qrNode) qrNode.src = '/mobile/v1/pairing-qr.svg?t=' + encodeURIComponent(pairing.code);
        }
        if (urlNode && typeof pairing.lanUrl === 'string') urlNode.textContent = pairing.lanUrl;
      } catch {}
    }

    setInterval(refreshPairing, 1500);
    refreshPairing();
  </script>
</body>
</html>`;
}

async function pairingQrSvg(payload) {
  if (typeof payload !== 'string' || payload.length === 0) return '';
  return QRCode.toString(payload, { type: 'svg', margin: 1, width: 280 });
}

async function pairingQrSvgDataUrl(payload) {
  if (typeof payload !== 'string' || payload.length === 0) return '';
  const svg = await pairingQrSvg(payload);
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

function closeWss(wss) {
  return new Promise((resolve) => wss.close(() => resolve()));
}

function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}
