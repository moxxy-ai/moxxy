import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { createAllowListResolver } from '@moxxy/sdk';
import { bearerTokenMatches } from '@moxxy/sdk/server';
import type {
  Channel,
  ChannelHandle,
  ChannelStartOptsBase,
  ClientSession,
  PermissionResolver,
  TunnelHandle,
  TunnelProviderDef,
} from '@moxxy/sdk';
import { EventProjector } from './projector.js';
import { actionPrompt, clientFrameSchema, type ClientFrame, type ServerFrame } from './protocol.js';

/** Hard cap on an inbound WS frame; anything larger is garbage, not a prompt. */
const MAX_FRAME_BYTES = 256 * 1024;
/** Invalid-frame warnings are rate-limited to one per this window. */
const DROP_WARN_INTERVAL_MS = 10_000;
/**
 * Cap on distinct NAMED screens kept for replay. Named views replace in place
 * (bounded by an app's screen count) but we still LRU-evict so a pathological
 * agent that mints unbounded distinct names can't grow the map without limit.
 */
const MAX_REPLAY_VIEWS = 32;
/**
 * Replay-map slot shared by every UNNAMED view (latest wins). The leading
 * newline guarantees no collision with an agent-chosen `<view name>` (view
 * names can't contain control chars), so a real named screen never lands here.
 */
const UNNAMED_VIEW_KEY = '\n__current__';

function isAddrInUse(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    (err as { code?: string }).code === 'EADDRINUSE'
  );
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

/** Identity gate: only ever signal processes that look like moxxy's own
 *  (CLI bin / `moxxy serve` daemon / desktop app). An unidentifiable
 *  command line fails the gate — never kill what we can't name. */
function looksLikeMoxxy(command: string): boolean {
  return command.length > 0 && /moxxy/i.test(command);
}

/** Injectable seams so the kill path can be unit-tested without real processes. */
export interface FreePortDeps {
  pidsListeningOn(port: number): Promise<ReadonlyArray<number>>;
  pidCommand(pid: number): Promise<string>;
  kill(pid: number, signal: number | NodeJS.Signals): void;
  /** Grace delay between SIGTERM and the SIGKILL sweep. */
  graceMs?: number;
}

const realFreePortDeps: FreePortDeps = {
  pidsListeningOn,
  pidCommand,
  kill: (pid, signal) => process.kill(pid, signal),
  graceMs: 400,
};

/**
 * Free a TCP port ONLY if every process holding it is a moxxy process
 * (stale `moxxy serve` leftovers — legitimate self-healing). Returns true
 * when a kill was attempted. Anything else holding the port (the default,
 * 4040, is also ngrok's local-UI port!) is left alone — the caller falls
 * back to an ephemeral port instead. SIGTERM → grace → SIGKILL.
 */
export async function freeTcpPortIfMoxxy(
  port: number,
  logger: WebChannelOptions['logger'],
  deps: FreePortDeps = realFreePortDeps,
): Promise<boolean> {
  if (process.platform === 'win32') return false;
  const pids = (await deps.pidsListeningOn(port)).filter((pid) => pid !== process.pid);
  if (pids.length === 0) return false;
  const holders = await Promise.all(
    pids.map(async (pid) => ({ pid, command: await deps.pidCommand(pid) })),
  );
  const foreign = holders.filter((h) => !looksLikeMoxxy(h.command));
  if (foreign.length > 0) {
    if (logger?.warn)
      logger.warn(`port ${port} is held by non-moxxy process(es); not killing them`, {
        holders: foreign.map((h) => `${h.pid}: ${h.command || '<unknown command>'}`),
      });
    return false;
  }
  // Re-verify identity immediately before each signal. Between the `ps`
  // snapshot above and the kill, a holder PID can exit and be reused by an
  // unrelated process — so re-read its command and skip any whose name no
  // longer looks like moxxy. Narrows (can't fully close — POSIX signalling
  // is inherently racy) the TOCTOU on the identity gate.
  let attempted = false;
  for (const { pid } of holders) {
    const command = await deps.pidCommand(pid);
    if (!looksLikeMoxxy(command)) continue;
    try {
      // Log the exact command we judged moxxy-owned before signalling, so a
      // mis-fire on a substring-collision process is auditable after the fact.
      if (logger?.warn) logger.warn('freeing port: SIGTERM to apparent stale moxxy process', { pid, command });
      deps.kill(pid, 'SIGTERM');
      attempted = true;
    } catch {
      /* may already be gone */
    }
  }
  if (!attempted) return false;
  await new Promise((r) => setTimeout(r, deps.graceMs ?? 400));
  for (const { pid } of holders) {
    // Re-check identity again before escalating to SIGKILL.
    try {
      deps.kill(pid, 0);
    } catch {
      continue; /* dead — nothing to escalate */
    }
    const command = await deps.pidCommand(pid);
    if (!looksLikeMoxxy(command)) continue;
    try {
      if (logger?.warn) logger.warn('freeing port: SIGKILL to apparent stale moxxy process', { pid, command });
      deps.kill(pid, 'SIGKILL');
    } catch {
      /* dead */
    }
  }
  return true;
}

/** Where `scripts/build-web.mjs` writes the browser bundle (relative to dist/channel.js). */
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

/** The path the tunnel exposes us under (e.g. `/web`), or `''` for the root. */
export function basePathFromUrl(url: string): string {
  try {
    const p = new URL(url).pathname;
    return p === '/' ? '' : p.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

/** Inject the base path into index.html so relative assets (`app.js`) resolve
 *  under it and the client builds the right WS URL — works at root or `/web`. */
export function injectBaseHtml(html: string, basePath: string): string {
  const inject =
    `<base href="${basePath}/" />` +
    `<script>window.__MOXXY_BASE__=${JSON.stringify(basePath)}</script>`;
  return html.replace('<!--moxxy:base-->', inject);
}

export interface WebChannelOptions {
  readonly port?: number;
  readonly host?: string;
  /** Token gating every request + the WS handshake. Generated if unset. */
  readonly authToken?: string;
  /** Tools the model may call without a human prompt (no clicker in this loop). */
  readonly allowedTools?: ReadonlyArray<string>;
  /** Resolve the session's active tunnel provider (injected by the CLI builder). */
  readonly getTunnel?: () => TunnelProviderDef | null;
  /**
   * Publish/clear the live surface so `present_view` can return the public URL
   * the agent relays to the user. Called with the surface on start, null on stop.
   */
  readonly publishSurface?: (surface: { url: string; nextViewId: () => string } | null) => void;
  /**
   * Publish/clear live controls so the agent's `web_set_tunnel` tool can switch
   * the tunnel without a restart. `retunnel` closes the current tunnel (no leak)
   * and re-opens via the now-active provider, returning the new share URL.
   */
  readonly publishControls?: (controls: WebSurfaceControls | null) => void;
  readonly logger?: {
    info?(msg: string, meta?: Record<string, unknown>): void;
    warn?(msg: string, meta?: Record<string, unknown>): void;
  };
}

export interface WebSurfaceControls {
  retunnel(): Promise<string | null>;
}

export interface WebStartOpts extends ChannelStartOptsBase {
  readonly session: ClientSession;
}

export class WebChannel implements Channel<WebStartOpts> {
  readonly name = 'web';
  readonly permissionResolver: PermissionResolver;
  private port: number;
  private readonly host: string;
  private readonly token: string;
  private readonly logger: WebChannelOptions['logger'];
  private readonly getTunnel: WebChannelOptions['getTunnel'];
  private readonly publishSurface: WebChannelOptions['publishSurface'];
  private readonly publishControls: WebChannelOptions['publishControls'];
  private server: Server | null = null;
  private wss: WebSocketServer | null = null;
  private readonly clients = new Set<WebSocket>();
  /**
   * Built screens replayed to a newly-connected browser, keyed by logical
   * `name`. UNNAMED views all share {@link UNNAMED_VIEW_KEY} (latest wins), so
   * an agent that presents many unnamed views over a long session can't leak
   * one ViewDoc per render. Named views LRU-evict at {@link MAX_REPLAY_VIEWS}.
   */
  private readonly views = new Map<string, ServerFrame>();
  private unsubscribe: (() => void) | null = null;
  private session: ClientSession | null = null;
  private busy = false;
  private controller: AbortController | null = null;
  private tunnel: TunnelHandle | null = null;
  private tunnelBase: string | null = null;
  /** Public path the surface is served under (e.g. `/web` behind the relay; `''` local). */
  private basePath = '';
  private viewSeq = 0;
  private droppedFrames = 0;
  private lastDropWarnAt = 0;

  constructor(opts: WebChannelOptions = {}) {
    this.port = opts.port ?? 4040;
    this.host = opts.host ?? '127.0.0.1';
    this.token = opts.authToken ?? randomBytes(16).toString('hex');
    this.logger = opts.logger;
    this.getTunnel = opts.getTunnel;
    this.publishSurface = opts.publishSurface;
    this.publishControls = opts.publishControls;
    // The interactive surface is the gate; tools still need an upfront
    // allow-list (no per-call clicker). Default to present_view + the read-only
    // fetch tools so apps can pull REAL data out of the box. Extend via
    // config.allowedTools. (When co-attached, the PRIMARY channel's resolver
    // governs instead — e.g. the TUI prompts per tool.)
    const allowed =
      opts.allowedTools && opts.allowedTools.length > 0
        ? [...opts.allowedTools]
        : ['present_view', 'web_fetch', 'browser_session'];
    this.permissionResolver = createAllowListResolver(allowed);
  }

  /** The local URL (token embedded). */
  get url(): string {
    return `http://${this.host}:${this.port}/?t=${this.token}`;
  }

  /** The URL to hand the user — the tunnel base if open, else local. */
  get shareUrl(): string {
    const base = this.tunnelBase ?? `http://${this.host}:${this.port}`;
    return `${base}/?t=${this.token}`;
  }

  async start(startOpts: WebStartOpts): Promise<ChannelHandle> {
    this.session = startOpts.session;
    const projector = new EventProjector();
    this.unsubscribe = startOpts.session.log.subscribe((event) => {
      for (const frame of projector.project(event)) {
        // Remember each screen so a browser that connects AFTER the agent built
        // the app (the normal flow: build in TUI/Telegram → open the link) still
        // sees it. Named screens replace in place; unnamed ones coalesce into a
        // single latest-wins slot so the replay set stays bounded.
        if (frame.kind === 'view') this.rememberView(frame);
        this.broadcast(frame);
      }
    });

    const server = createServer((req, res) => {
      void this.handleHttp(req, res);
    });
    this.server = server;

    // Bind FIRST: ws re-emits the http server's 'error' events on the
    // WebSocketServer, so a WSS attached before a failed listen turns a
    // recoverable EADDRINUSE into an unhandled 'error' → process crash.
    await this.bindServerWithRetry(server);

    // Validate the token at the handshake so a bad token is rejected with 401
    // and the client never opens (the token is the only public-internet gate).
    const wss = new WebSocketServer({
      server,
      // No fixed `path`: behind the relay the upgrade may arrive as `/ws` or
      // `/<base>/ws`; verifyClient base-strips and checks it (plus the token).
      // Frames past maxPayload are dropped at the socket layer (ws closes with
      // 1009) instead of being buffered; onMessage applies a tighter cap.
      maxPayload: 1024 * 1024,
      verifyClient: (info: { req: IncomingMessage }) => {
        const p = this.stripBase((info.req.url ?? '/').split('?')[0] ?? '/');
        return p === '/ws' && this.validToken(info.req.url);
      },
    });
    this.wss = wss;
    wss.on('connection', (ws) => this.onConnection(ws));
    // Never leave an EventEmitter 'error' unhandled — it would throw at the
    // process level. Forwarded server errors after bind are log-and-survive.
    wss.on('error', (err) => {
      const logger = this.logger;
      if (logger?.warn) logger.warn('web socket server error', { err: String(err) });
    });

    await this.openTunnel();
    this.publishSurface?.({ url: this.shareUrl, nextViewId: () => `v_srv_${++this.viewSeq}` });
    this.publishControls?.({ retunnel: () => this.retunnel() });

    const running = new Promise<void>((resolve) => server.once('close', () => resolve()));
    return { running, stop: () => this.stop() };
  }

  /**
   * Bind the HTTP server, with recovery if the port is already in use.
   * A stale `moxxy serve` from a prior install often leaves 4040 bound
   * even after its unix socket has been released — if (and only if) the
   * holder is verifiably a moxxy process we kill it and retry. Anything
   * else (ngrok's local UI also defaults to 4040) is never signalled;
   * we bind an ephemeral port instead and log loudly which port the
   * surface actually got (the share URL embeds the real port either way).
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
          const logger = this.logger;
          if (logger?.info) logger.info('web channel listening', { url: this.url });
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(this.port, this.host);
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
      const logger = this.logger;
      if (logger?.warn)
        logger.warn(
          `web channel port ${requested} was held by a stale moxxy process; freed it, retrying`,
        );
      try {
        await tryListen();
        return;
      } catch (err) {
        if (!isAddrInUse(err)) throw err;
      }
    }

    // The holder is not ours to kill (or would not die) — take an
    // ephemeral port. onListening reads back the real bound port, so
    // this.url / shareUrl / the tunnel all carry it automatically.
    this.port = 0;
    await tryListen();
    const logger = this.logger;
    if (logger?.warn)
      logger.warn(
        `web channel port ${requested} was in use by another process; bound ephemeral port ${this.port} instead`,
        { requestedPort: requested, boundPort: this.port, url: this.url },
      );
  }

  /**
   * (Re-)open the tunnel via the active provider, closing any prior one FIRST so
   * a switch never leaks a subprocess. Non-fatal: on failure (e.g. the relay
   * not installed) we fall back to the local URL.
   */
  private async openTunnel(): Promise<void> {
    if (this.tunnel) {
      try {
        await this.tunnel.close();
      } catch {
        /* ignore */
      }
      this.tunnel = null;
      this.tunnelBase = null;
      this.basePath = '';
    }
    const provider = this.getTunnel?.() ?? null;
    if (!provider || provider.name === 'localhost') return;
    try {
      // Route the preview under the `web` path so the relay can multiplex it
      // alongside the mobile bridge under one uuid subdomain.
      this.tunnel = await provider.open({ port: this.port, host: this.host, label: 'web' });
      this.tunnelBase = this.tunnel.url;
      this.basePath = basePathFromUrl(this.tunnel.url);
      const logger = this.logger;
      if (logger?.info) logger.info('web surface tunnel open', { provider: provider.name, url: this.shareUrl });
    } catch (err) {
      const logger = this.logger;
      if (logger?.warn) logger.warn('web surface tunnel failed; using local URL', { provider: provider.name, err: String(err) });
    }
  }

  /** Switch tunnels live (agent's web_set_tunnel) and republish the surface URL. */
  private async retunnel(): Promise<string | null> {
    await this.openTunnel();
    this.publishSurface?.({ url: this.shareUrl, nextViewId: () => `v_srv_${++this.viewSeq}` });
    return this.shareUrl;
  }

  private async stop(): Promise<void> {
    this.publishSurface?.(null);
    this.publishControls?.(null);
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.controller?.abort();
    if (this.tunnel) {
      try {
        await this.tunnel.close();
      } catch {
        /* ignore */
      }
      this.tunnel = null;
      this.tunnelBase = null;
      this.basePath = '';
    }
    for (const ws of this.clients) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
    await new Promise<void>((resolve) => (this.wss ? this.wss.close(() => resolve()) : resolve()));
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  private validToken(reqUrl: string | undefined): boolean {
    try {
      // Constant-time compare so the token isn't recoverable byte-by-byte via
      // response timing (this is the only public-internet gate).
      const presented = new URL(reqUrl ?? '/', 'http://localhost').searchParams.get('t');
      return bearerTokenMatches(presented, this.token);
    } catch {
      return false;
    }
  }

  /** Strip the public base path (if any) so internal routing stays root-relative.
   *  Tolerant: handles both `/web/app.js` (relay didn't strip) and `/app.js`
   *  (relay stripped the first request line). */
  private stripBase(pathname: string): string {
    const b = this.basePath;
    if (b && (pathname === b || pathname.startsWith(`${b}/`))) {
      const rest = pathname.slice(b.length);
      return rest === '' ? '/' : rest;
    }
    return pathname;
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const pathname = this.stripBase((req.url ?? '/').split('?')[0] ?? '/');
    if (pathname === '/v1/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"status":"ok"}');
      return;
    }
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      if (!this.validToken(req.url)) {
        res.writeHead(401, { 'content-type': 'text/plain' });
        res.end('unauthorized — open the tokenized URL the agent gave you');
        return;
      }
      await this.serveFile(res, 'index.html', 'text/html; charset=utf-8');
      return;
    }
    if (req.method === 'GET' && pathname === '/app.js') {
      await this.serveFile(res, 'app.js', 'text/javascript; charset=utf-8');
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }

  /**
   * Defense-in-depth headers for the internet-exposed surface (served over
   * public tunnels). CSP contains any future renderer regression: scripts may
   * only load from this origin (`'self'`) — no inline scripts — while the inline
   * `<style>` block needs `style-src 'unsafe-inline'`; `connect-src` permits the
   * same-origin WebSocket. `frame-ancestors 'none'` + `X-Frame-Options: DENY`
   * stop the tokenized page from being framed (clickjacking); `Referrer-Policy:
   * no-referrer` keeps the `?t` token out of the Referer header on agent-authored
   * outbound links.
   */
  private securityHeaders(): Record<string, string> {
    return {
      'content-security-policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: https:; connect-src 'self' ws: wss:; " +
        "base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
    };
  }

  private async serveFile(res: ServerResponse, name: string, contentType: string): Promise<void> {
    try {
      let buf = await readFile(path.join(PUBLIC_DIR, name));
      if (name === 'index.html') {
        buf = Buffer.from(injectBaseHtml(buf.toString('utf8'), this.basePath), 'utf8');
      }
      res.writeHead(200, { 'content-type': contentType, ...this.securityHeaders() });
      res.end(buf);
    } catch {
      // Defense-in-depth headers are unconditional — they apply to the error
      // response too, so a missing/unreadable bundle never serves a page
      // without the clickjacking / referrer-token protections.
      res.writeHead(500, { 'content-type': 'text/plain', ...this.securityHeaders() });
      res.end('web surface bundle missing — run `pnpm --filter @moxxy/plugin-channel-web build`');
    }
  }

  /**
   * Record a view frame for replay with a bounded footprint. Named views key
   * by their name (re-render replaces in place) under an LRU bounded at
   * {@link MAX_REPLAY_VIEWS}; unnamed views all collapse into a single
   * latest-wins slot so an unbounded stream of unnamed renders can't leak.
   */
  private rememberView(frame: Extract<ServerFrame, { kind: 'view' }>): void {
    const key = frame.name ?? UNNAMED_VIEW_KEY;
    // Re-insert at the tail to refresh LRU recency on re-render.
    this.views.delete(key);
    this.views.set(key, frame);
    while (this.views.size > MAX_REPLAY_VIEWS) {
      const oldest = this.views.keys().next().value;
      if (oldest === undefined) break;
      this.views.delete(oldest);
    }
  }

  private onConnection(ws: WebSocket): void {
    this.clients.add(ws);
    ws.on('close', () => this.clients.delete(ws));
    ws.on('message', (data: unknown) => this.onMessage(ws, data));
    this.send(ws, { kind: 'hello' });
    // Replay already-built screens so a browser opening the link AFTER the agent
    // built the app sees it immediately (no "No view yet").
    for (const frame of this.views.values()) this.send(ws, frame);
  }

  /**
   * Handle a browser → server frame. This is a trust boundary (tunnels put
   * it on the public internet): every frame is schema-validated before any
   * field access, and invalid ones are dropped — a thrown error in a ws
   * 'message' listener escalates to a process-level uncaughtException.
   */
  private onMessage(ws: WebSocket, data: unknown): void {
    const raw = String(data);
    if (raw.length > MAX_FRAME_BYTES) {
      this.dropFrame('oversized frame');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.dropFrame('invalid JSON');
      return;
    }
    const result = clientFrameSchema.safeParse(parsed);
    if (!result.success) {
      this.dropFrame('schema mismatch');
      return;
    }
    const frame: ClientFrame = result.data;
    if (frame.kind === 'prompt') {
      if (frame.text.trim()) void this.drive(frame.text);
      return;
    }
    if (frame.kind === 'action') {
      if (this.busy) {
        this.send(ws, { kind: 'ack', actionId: frame.actionId, accepted: false, reason: 'busy' });
        return;
      }
      this.send(ws, { kind: 'ack', actionId: frame.actionId, accepted: true });
      void this.drive(actionPrompt(frame.action, frame.formValues));
    }
  }

  /** Count a dropped inbound frame; warn at most once per window (no log spam). */
  private dropFrame(reason: string): void {
    this.droppedFrames += 1;
    const now = Date.now();
    if (now - this.lastDropWarnAt < DROP_WARN_INTERVAL_MS) return;
    this.lastDropWarnAt = now;
    const logger = this.logger;
    if (logger?.warn)
      logger.warn('web channel dropped invalid client frame(s)', {
        reason,
        droppedTotal: this.droppedFrames,
      });
  }

  private async drive(prompt: string): Promise<void> {
    if (!this.session || this.busy) return;
    this.busy = true;
    this.controller = new AbortController();
    try {
      // Rendering happens via the log subscription; we only need to drain the
      // iterator so the turn actually executes.
      for await (const _event of this.session.runTurn(prompt, { signal: this.controller.signal })) {
        void _event;
      }
    } catch (err) {
      this.broadcast({ kind: 'status', turnId: '', phase: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      this.busy = false;
      this.controller = null;
    }
  }

  private broadcast(frame: ServerFrame): void {
    const s = JSON.stringify(frame);
    for (const ws of this.clients) {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(s);
        } catch {
          /* ignore */
        }
      }
    }
  }

  private send(ws: WebSocket, frame: ServerFrame): void {
    try {
      ws.send(JSON.stringify(frame));
    } catch {
      /* ignore */
    }
  }
}
