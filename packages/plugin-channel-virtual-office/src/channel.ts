/**
 * The `office` channel. On start it stands up:
 *   - an HTTP server (default :4090) serving the bundled pixel-art game
 *     (`dist/public/*`), token-gated via `?t=` exactly like the web channel;
 *   - a WebSocket IPC bridge (default :4091, via `@moxxy/ipc-server-ws`)
 *     backed by a {@link VirtualOfficeHost} — the multi-session host where
 *     every office worker sprite is a full moxxy session.
 *
 * The browser connects with the printed tokenized URL; the page fetches
 * `/config` (same token) for the WS endpoint and authenticates the socket via
 * the Sec-WebSocket-Protocol bearer entry (the token never rides the WS URL).
 * Browser upgrades carry an Origin header, so the bridge gets an explicit
 * allow-list of this server's own origins — without it every browser connect
 * is silently rejected.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

import { bearerTokenMatches } from '@moxxy/sdk';
import type {
  Channel,
  ChannelHandle,
  ChannelStartOptsBase,
  ClientSession,
  PermissionResolver,
} from '@moxxy/sdk';
import { WebSocketCommandBus, startWsBridge } from '@moxxy/ipc-server-ws';

import { VirtualOfficeHost } from './multi-session-host.js';
import { resolveOfficeToken } from './token.js';
import {
  attachWorkerPersistence,
  isLocalSession,
  spawnWorkerSession,
} from './worker-session.js';

/** Where `scripts/build-web.mjs` writes the game bundle. `office-public` is
 *  the bundled-CLI layout (the cli's tsup copies it there because plain
 *  `dist/public` already belongs to the web channel's frontend); `public` is
 *  this package's own dist layout; the last entry covers running the
 *  TypeScript source directly (vitest, tsx). */
const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIRS = [
  path.join(here, 'office-public'),
  path.join(here, 'public'),
  path.join(here, '..', 'dist', 'public'),
];

const DEFAULT_HTTP_PORT = 4090;

export interface OfficeStartOpts extends ChannelStartOptsBase {
  readonly session: ClientSession;
}

export interface OfficeChannelOptions {
  /** HTTP port for the game page (default 4090). */
  readonly port?: number;
  /** WebSocket bridge port (default HTTP port + 1). */
  readonly wsPort?: number;
  /** Bind address. Loopback by default; `0.0.0.0` exposes on the LAN
   *  (still token-gated). */
  readonly bindHost?: string;
  /** Bearer token. Falls back to env / a persisted secret (see resolveOfficeToken). */
  readonly token?: string;
  readonly logger?: {
    info?(msg: string, meta?: Record<string, unknown>): void;
    warn?(msg: string, meta?: Record<string, unknown>): void;
  };
}

function isAddrInUse(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === 'EADDRINUSE';
}

/** Run a command and collect its stdout. Empty string on any failure. */
async function captureStdout(cmd: string, args: ReadonlyArray<string>): Promise<string> {
  const { spawn } = await import('node:child_process');
  return await new Promise<string>((resolve) => {
    let out = '';
    try {
      const child = spawn(cmd, [...args], { stdio: ['ignore', 'pipe', 'ignore'] });
      child.stdout.on('data', (b) => {
        out += b.toString();
      });
      child.on('error', () => resolve(''));
      child.on('close', () => resolve(out));
    } catch {
      resolve('');
    }
  });
}

/** PIDs actively LISTENing on a TCP port (lsof; empty on Windows / no lsof). */
async function pidsListeningOn(port: number): Promise<ReadonlyArray<number>> {
  if (process.platform === 'win32') return [];
  const out = await captureStdout('lsof', ['-t', `-iTCP:${port}`, '-sTCP:LISTEN']);
  const found = new Set<number>();
  for (const line of out.split('\n')) {
    const n = parseInt(line.trim(), 10);
    if (Number.isFinite(n) && n > 0) found.add(n);
  }
  return [...found];
}

/** A PID's command line via `ps`. Empty when the process is gone / unknowable. */
async function pidCommand(pid: number): Promise<string> {
  return (await captureStdout('ps', ['-p', String(pid), '-o', 'command='])).trim();
}

/** Identity gate: only ever signal processes that look like moxxy's own.
 *  An unidentifiable command line fails the gate — never kill what we can't name. */
function looksLikeMoxxy(command: string): boolean {
  return command.length > 0 && /moxxy/i.test(command);
}

/**
 * Free a TCP port ONLY if every process holding it is a moxxy process (stale
 * leftovers — legitimate self-healing). Anything else holding the port is left
 * alone and the caller falls back to an ephemeral port. SIGTERM → grace → SIGKILL.
 */
async function freeTcpPortIfMoxxy(
  port: number,
  logger: OfficeChannelOptions['logger'],
): Promise<boolean> {
  if (process.platform === 'win32') return false;
  const pids = (await pidsListeningOn(port)).filter((pid) => pid !== process.pid);
  if (pids.length === 0) return false;
  const holders = await Promise.all(pids.map(async (pid) => ({ pid, command: await pidCommand(pid) })));
  const foreign = holders.filter((h) => !looksLikeMoxxy(h.command));
  if (foreign.length > 0) {
    logger?.warn?.(`port ${port} is held by non-moxxy process(es); not killing them`, {
      holders: foreign.map((h) => `${h.pid}: ${h.command || '<unknown command>'}`),
    });
    return false;
  }
  for (const { pid } of holders) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* may already be gone */
    }
  }
  await new Promise((r) => setTimeout(r, 400));
  for (const { pid } of holders) {
    try {
      process.kill(pid, 0);
      process.kill(pid, 'SIGKILL');
    } catch {
      /* dead */
    }
  }
  return true;
}

export class VirtualOfficeChannel implements Channel<OfficeStartOpts> {
  readonly name = 'office';
  readonly permissionResolver: PermissionResolver;

  private port: number;
  private wsPort: number;
  private readonly bindHost: string;
  private readonly token: string;
  private readonly logger: OfficeChannelOptions['logger'];
  private host: VirtualOfficeHost | null = null;
  private server: Server | null = null;
  private bridge: Awaited<ReturnType<typeof startWsBridge>> | null = null;

  constructor(
    opts: OfficeChannelOptions = {},
    private readonly channelDeps: { cwd: string; vault?: unknown } = { cwd: process.cwd() },
  ) {
    this.port = opts.port ?? DEFAULT_HTTP_PORT;
    // An explicit 0 means "ephemeral" — the bridge follows suit rather than
    // landing on the (privileged, nonsensical) port 1.
    this.wsPort = opts.wsPort ?? (this.port > 0 ? this.port + 1 : 0);
    this.bindHost = opts.bindHost ?? '127.0.0.1';
    this.token = resolveOfficeToken(opts.token);
    this.logger = opts.logger;
    // The field `moxxy serve --all` reads to coordinate the session resolver.
    // Delegate to the live host (installed in start()); deny before any client.
    this.permissionResolver = {
      name: 'office',
      check: (call, ctx) =>
        this.host
          ? this.host.permissionResolver.check(call, ctx)
          : Promise.resolve({ mode: 'deny' }),
    };
  }

  /** The local URL to open (token embedded). */
  get url(): string {
    return `http://${this.bindHost}:${this.port}/?t=${this.token}`;
  }

  async start(startOpts: OfficeStartOpts): Promise<ChannelHandle> {
    const primary = startOpts.session;
    // The office HOSTS sibling sessions in-process — it cannot run as a thin
    // client of a remote runner (a RemoteSession has no registries to clone).
    if (!isLocalSession(primary)) {
      throw new Error(
        'the office channel needs a local session to host multiple agents — ' +
          'run `moxxy office --standalone` (or stop the running `moxxy serve`).',
      );
    }
    const vault = this.channelDeps.vault as
      | { get?(name: string): Promise<string | null> }
      | undefined;
    const secretResolver =
      typeof vault?.get === 'function' ? (name: string) => vault.get!(name) : undefined;

    // The standalone office host is its OWN trust surface: it registers
    // exactly the curated multi-session subset the game drives (see
    // `VirtualOfficeHost.register`) and nothing else, so the bus's
    // deny-by-default remote allow-list (which targets the desktop gateway)
    // would only over-restrict it. (Mirrors `moxxy mobile`.)
    const bus = new WebSocketCommandBus({ allowedCommands: null });
    const host = new VirtualOfficeHost(bus, primary, {
      spawnSession: () => {
        const worker = spawnWorkerSession(primary, {
          cwd: this.channelDeps.cwd,
          ...(secretResolver ? { secretResolver } : {}),
        });
        const detach = attachWorkerPersistence(worker);
        return { session: worker, dispose: detach };
      },
      ...(this.logger ? { logger: this.logger } : {}),
    });
    this.host = host;
    host.register(); // populate the method map BEFORE accepting connections
    host.wire(); // stream events + install the ask resolvers

    const server = createServer((req, res) => {
      void this.handleHttp(req, res);
    });
    this.server = server;
    await this.bindServerWithRetry(server);

    // Browser pages from THIS server are the only allowed WS origins.
    const allowedOrigins = [
      `http://${this.bindHost}:${this.port}`,
      `http://localhost:${this.port}`,
      `http://127.0.0.1:${this.port}`,
    ];
    this.bridge = await startWsBridge(bus, {
      port: this.wsPort,
      host: this.bindHost,
      authToken: this.token,
      allowedOrigins,
      // A whole office of tabs/agents is chattier than one phone.
      maxConnections: 16,
    });
    this.wsPort = wsPortOf(this.bridge.address) ?? this.wsPort;
    this.logger?.info?.('office channel listening', { url: this.url, ws: this.bridge.address });

    process.stdout.write(
      '\n  🏢 moxxy virtual office is open:\n\n' +
        `     ${this.url}\n\n` +
        '     Click a worker to chat; "Spawn agent" hires another session.\n\n',
    );

    let resolveRunning!: () => void;
    const running = new Promise<void>((resolve) => {
      resolveRunning = resolve;
    });

    return {
      running,
      stop: async () => {
        await this.host?.dispose();
        this.host = null;
        await this.bridge?.close().catch(() => undefined);
        this.bridge = null;
        await new Promise<void>((resolve) =>
          this.server ? this.server.close(() => resolve()) : resolve(),
        );
        this.server = null;
        resolveRunning();
      },
    };
  }

  /**
   * Bind the HTTP server, with recovery if the port is already in use: a
   * verified-stale moxxy holder is killed and the bind retried; any other
   * holder is left alone and an ephemeral port is taken instead (the printed
   * URL embeds the real port either way).
   */
  private async bindServerWithRetry(server: ReturnType<typeof createServer>): Promise<void> {
    const tryListen = (): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        const onError = (err: Error): void => {
          server.off('listening', onListening);
          reject(err);
        };
        const onListening = (): void => {
          server.off('error', onError);
          const addr = server.address();
          if (addr && typeof addr === 'object') this.port = (addr as AddressInfo).port;
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(this.port, this.bindHost);
      });

    try {
      await tryListen();
      return;
    } catch (err) {
      if (!isAddrInUse(err)) throw err;
    }

    const requested = this.port;
    const freed = await freeTcpPortIfMoxxy(requested, this.logger).catch(() => false);
    if (freed) {
      this.logger?.warn?.(
        `office port ${requested} was held by a stale moxxy process; freed it, retrying`,
      );
      try {
        await tryListen();
        return;
      } catch (err) {
        if (!isAddrInUse(err)) throw err;
      }
    }

    this.port = 0;
    await tryListen();
    this.logger?.warn?.(
      `office port ${requested} was in use by another process; bound ephemeral port ${this.port} instead`,
      { requestedPort: requested, boundPort: this.port, url: this.url },
    );
  }

  private validToken(reqUrl: string | undefined): boolean {
    try {
      // Constant-time compare — the token is the only gate on this surface.
      const presented = new URL(reqUrl ?? '/', 'http://localhost').searchParams.get('t');
      return bearerTokenMatches(presented, this.token);
    } catch {
      return false;
    }
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const pathname = (req.url ?? '/').split('?')[0] ?? '/';
    if (pathname === '/v1/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"status":"ok"}');
      return;
    }
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      if (!this.validToken(req.url)) {
        res.writeHead(401, { 'content-type': 'text/plain' });
        res.end('unauthorized — open the tokenized URL `moxxy office` printed');
        return;
      }
      await this.serveFile(res, 'index.html', 'text/html; charset=utf-8');
      return;
    }
    if (req.method === 'GET' && pathname === '/app.js') {
      await this.serveFile(res, 'app.js', 'text/javascript; charset=utf-8');
      return;
    }
    // The page (already token-gated) asks where the WS bridge lives. The same
    // token gates this endpoint, and the client presents it on the socket via
    // the bearer subprotocol — never in the WS URL.
    if (req.method === 'GET' && pathname === '/config') {
      if (!this.validToken(req.url)) {
        res.writeHead(401, { 'content-type': 'text/plain' });
        res.end('unauthorized');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ wsUrl: `ws://${this.bindHost}:${this.wsPort}` }));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }

  private async serveFile(res: ServerResponse, name: string, contentType: string): Promise<void> {
    for (const dir of PUBLIC_DIRS) {
      try {
        const buf = await readFile(path.join(dir, name));
        res.writeHead(200, { 'content-type': contentType });
        res.end(buf);
        return;
      } catch {
        /* try the next layout */
      }
    }
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(
      'office bundle missing — run `pnpm --filter @moxxy/plugin-channel-virtual-office build`',
    );
  }
}

/** Pull the bound port back out of the bridge's `ws://host:port` address. */
function wsPortOf(address: string): number | null {
  const m = /:(\d+)$/.exec(address);
  return m ? Number(m[1]) : null;
}
