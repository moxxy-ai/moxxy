import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { bearerTokenMatches, readRequestBody } from '@moxxy/sdk';
import type {
  Channel,
  ChannelHandle,
  ChannelStartOptsBase,
  ClientSession,
  PermissionResolver,
} from '@moxxy/sdk';
import type { Session as CoreSession } from '@moxxy/core';
import { OfficeAgentRuntime } from './office-agent-runtime.js';
import { HttpPermissionBroker } from './permission-broker.js';
import {
  OFFICE_ROUTES,
  type OfficeEventStream,
  type OfficeLogger,
  type OfficeRequestContext,
} from './routes.js';

/**
 * The Virtual Office is its OWN channel: a self-contained HTTP + SSE server
 * standing up the multi-agent office surface (agents, unified timeline,
 * graveyard, interactive permissions). It deliberately does NOT extend the
 * generic `@moxxy/plugin-channel-http` — per the user directive the office is a
 * separate, opt-in channel that only runs when invoked (`moxxy virtual-office`).
 *
 * The channel is its own security boundary: it bearer-auths every route (the
 * same generic `bearerTokenMatches` helper the HTTP/web/mobile channels use),
 * zod-validates request bodies inside its handlers, caps the agent-run body, and
 * drops `sensitive`-flagged envelopes before they reach the SSE wire.
 */

export interface VirtualOfficeChannelOptions {
  readonly port?: number;
  readonly host?: string;
  /** Bearer token required on every route. If unset, auth is disabled (dev-only). */
  readonly authToken?: string;
  /**
   * Route tool-permission checks through an out-of-band HTTP decision flow
   * (`POST /v1/permissions/{id}/decision`) instead of upfront allow-listing.
   * When set the channel installs the {@link HttpPermissionBroker} as its
   * resolver, so each tool check becomes an interactive HTTP exchange.
   */
  readonly interactivePermissions?: boolean;
  readonly logger?: {
    info?(msg: string, meta?: Record<string, unknown>): void;
    warn?(msg: string, meta?: Record<string, unknown>): void;
  };
}

export interface VirtualOfficeStartOpts extends ChannelStartOptsBase {
  readonly session: ClientSession;
}

const NOT_FOUND = { error: 'not_found', message: 'no such route' } as const;

export class VirtualOfficeChannel implements Channel<VirtualOfficeStartOpts> {
  readonly name = 'virtual-office';
  readonly permissionResolver: PermissionResolver;
  private readonly port: number;
  private readonly host: string;
  private readonly authToken: string | null;
  private readonly logger: VirtualOfficeChannelOptions['logger'];
  private readonly broker: HttpPermissionBroker | null;
  private server: Server | null = null;
  private runtime: OfficeAgentRuntime | null = null;
  private boundPortValue = 0;

  /** The actual TCP port the server bound to after {@link start} — equals the
   *  configured port, or the OS-assigned one when `port: 0` (ephemeral), so
   *  tests/callers can address the server without guessing a free port. */
  get boundPort(): number {
    return this.boundPortValue;
  }

  constructor(opts: VirtualOfficeChannelOptions = {}) {
    this.port = opts.port ?? 3939;
    this.host = opts.host ?? '127.0.0.1';
    this.authToken = opts.authToken ?? null;
    this.logger = opts.logger;
    this.broker = opts.interactivePermissions ? new HttpPermissionBroker() : null;
    // With interactive permissions the broker IS the resolver; otherwise the
    // office defers to whatever resolver the session already carries (the CLI's
    // channel-launch wiring), so it never silently relaxes the session policy.
    this.permissionResolver =
      this.broker ?? { name: 'virtual-office-passthrough', check: async () => ({ mode: 'deny', reason: 'no resolver' }) };
  }

  async start(startOpts: VirtualOfficeStartOpts): Promise<ChannelHandle> {
    const session = startOpts.session;
    // The runtime + broker need the concrete core Session (its EventLog, mode/
    // provider registries); the ClientSession surface is a structural subset.
    // This is the same cast channels use internally.
    const coreSession = session as unknown as CoreSession;
    this.broker?.attachSession(coreSession);
    this.runtime = new OfficeAgentRuntime(coreSession, this.logger as OfficeLogger, this.broker);
    const runtime = this.runtime;
    const broker = this.broker;
    const logger = this.logger as OfficeLogger | undefined;

    const server = createServer((req, res) => {
      this.handle(req, res, { session, runtime, broker, logger }).catch((err) => {
        this.logger?.warn?.('virtual-office handler threw', { err: errMsg(err) });
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'internal', message: errMsg(err) }));
        } else {
          try { res.end(); } catch { /* ignore */ }
        }
      });
    });
    this.server = server;

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.port, this.host, () => {
        const addr = server.address();
        this.boundPortValue = typeof addr === 'object' && addr ? addr.port : this.port;
        this.logger?.info?.('virtual-office channel listening', {
          host: this.host,
          port: this.boundPortValue,
          authEnabled: this.authToken !== null,
          interactivePermissions: this.broker !== null,
        });
        resolve();
      });
    });

    const running = new Promise<void>((resolve) => {
      server.once('close', () => resolve());
    });

    return {
      running,
      stop: async () => {
        this.broker?.abortAll('Virtual Office stopped');
        if (this.runtime) {
          await this.runtime.archiveLiveAgents('session_closed').catch(() => undefined);
        }
        this.runtime = null;
        await new Promise<void>((resolve) => {
          if (!this.server) return resolve();
          this.server.close(() => resolve());
          this.server = null;
        });
      },
    };
  }

  private async handle(
    req: IncomingMessage,
    res: ServerResponse,
    deps: {
      session: ClientSession;
      runtime: OfficeAgentRuntime;
      broker: HttpPermissionBroker | null;
      logger: OfficeLogger | undefined;
    },
  ): Promise<void> {
    const rawUrl = req.url ?? '/';
    const pathname = rawUrl.split('?')[0] ?? rawUrl;

    // Health is the only unauthenticated route — it leaks nothing and lets an
    // uptime probe confirm the listener is alive.
    if (req.method === 'GET' && (pathname === '/v1/health' || pathname === '/health')) {
      reply(res, 200, { status: 'ok', listener: 'virtual-office' });
      return;
    }

    // The channel is its own security boundary: bearer-auth EVERY office route
    // (constant-time compare of the full `Bearer <token>` header) before any
    // body is read or handler runs.
    if (!this.checkAuth(req)) {
      reply(res, 401, { error: 'unauthorized' });
      return;
    }

    const route = OFFICE_ROUTES.find((r) => r.method === req.method && r.match(pathname));
    if (!route) {
      reply(res, 404, NOT_FOUND);
      return;
    }

    const ctx = this.buildContext(req, res, pathname, deps);
    await route.handle(ctx);
  }

  private checkAuth(req: IncomingMessage): boolean {
    if (!this.authToken) return true;
    return bearerTokenMatches(req.headers.authorization, `Bearer ${this.authToken}`);
  }

  private buildContext(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
    deps: {
      session: ClientSession;
      runtime: OfficeAgentRuntime;
      broker: HttpPermissionBroker | null;
      logger: OfficeLogger | undefined;
    },
  ): OfficeRequestContext {
    const segments = pathname.split('/');
    return {
      session: deps.session,
      runtime: deps.runtime,
      broker: deps.broker,
      req,
      res,
      pathname,
      ...(deps.logger ? { logger: deps.logger } : {}),
      pathSegment: (n: number) => segments[n] ?? '',
      readBody: async (max = 64 * 1024) => (await readRequestBody(req, max)).toString('utf8'),
      reply: (status: number, body: unknown) => reply(res, status, body),
      openEventStream: () => openEventStream(res, this.logger as OfficeLogger | undefined),
    };
  }
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Open a crash-safe Server-Sent Events stream on the response. `send` swallows
 * write failures (a hung-up client must not crash the office), and `closed`
 * resolves when the socket closes so the handler can unsubscribe its listeners.
 */
function openEventStream(res: ServerResponse, logger?: OfficeLogger): OfficeEventStream {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  // Prime the stream so proxies flush headers immediately.
  try { res.write(': connected\n\n'); } catch { /* ignore */ }

  let resolveClosed: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  const onClose = (): void => resolveClosed();
  res.on('close', onClose);

  return {
    send: (data: unknown) => {
      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch (err) {
        logger?.warn('virtual-office SSE write failed', { err: errMsg(err) });
      }
    },
    closed: closed.finally(() => {
      res.off('close', onClose);
      try { res.end(); } catch { /* ignore */ }
    }),
  };
}
