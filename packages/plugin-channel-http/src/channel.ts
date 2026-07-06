import { createServer, type Server } from 'node:http';
import { createAllowListResolver, denyByDefaultResolver } from '@moxxy/sdk';
import type { ClientSession as Session } from '@moxxy/sdk';
import type {
  Channel,
  ChannelHandle,
  ChannelStartOptsBase,
  PermissionResolver,
} from '@moxxy/sdk';
import { routeRequest, TurnLimiter, type RouterContext } from './router.js';

/** Hosts auth-disabled mode is only safe to bind on. A non-loopback bind with
 *  no token would expose an unauthenticated agent endpoint to the network. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1']);

export interface HttpChannelOptions {
  readonly port?: number;
  readonly host?: string;
  /** Bearer token required on every protected route. If unset, auth is disabled (dev-only). */
  readonly authToken?: string;
  /** Max turns running concurrently on the shared session; excess requests get
   *  a 429. Bounds provider-stream fan-out and history interleaving. */
  readonly maxConcurrentTurns?: number;
  /** Abort an SSE turn whose consumer has stalled (socket open but not reading)
   *  for this many ms, so a half-open client can't keep a provider stream alive
   *  forever. A live-but-slow consumer resets the timer on every flushed write.
   *  Defaults to 120_000; set <= 0 to disable (not recommended for a network
   *  bind). */
  readonly streamStallMs?: number;
  /**
   * Tool names that the model is allowed to call without further interaction.
   * This is the entire permission story for HTTP — there's no human in the
   * loop to click "allow", so the operator declares trust upfront. Anything
   * not in this list is denied.
   */
  readonly allowedTools?: ReadonlyArray<string>;
  readonly logger?: {
    info?(msg: string, meta?: Record<string, unknown>): void;
    warn?(msg: string, meta?: Record<string, unknown>): void;
  };
}

export interface HttpStartOpts extends ChannelStartOptsBase {
  readonly session: Session;
}

export class HttpChannel implements Channel<HttpStartOpts> {
  readonly name = 'http';
  readonly permissionResolver: PermissionResolver;
  private readonly port: number;
  private readonly host: string;
  private readonly authToken: string | null;
  private readonly maxConcurrentTurns: number;
  private readonly streamStallMs: number | undefined;
  private readonly logger: HttpChannelOptions['logger'];
  private server: Server | null = null;
  private boundPortValue = 0;

  /** The actual TCP port the server bound to after {@link start}. Equals the
   *  configured port, or the OS-assigned one when `port: 0` (ephemeral) — so
   *  callers (and tests) can address the server without guessing a free port. */
  get boundPort(): number {
    return this.boundPortValue;
  }

  constructor(opts: HttpChannelOptions = {}) {
    this.port = opts.port ?? 3737;
    this.host = opts.host ?? '127.0.0.1';
    this.authToken = opts.authToken ?? null;
    this.maxConcurrentTurns =
      typeof opts.maxConcurrentTurns === 'number' && opts.maxConcurrentTurns > 0
        ? Math.floor(opts.maxConcurrentTurns)
        : 4;
    // undefined => router uses its DEFAULT_STREAM_STALL_MS; a finite number
    // (including <= 0 to disable) is honored as-is.
    this.streamStallMs =
      typeof opts.streamStallMs === 'number' && Number.isFinite(opts.streamStallMs)
        ? opts.streamStallMs
        : undefined;
    this.logger = opts.logger;
    this.permissionResolver = opts.allowedTools && opts.allowedTools.length > 0
      ? createAllowListResolver([...opts.allowedTools])
      : denyByDefaultResolver;
  }

  async start(startOpts: HttpStartOpts): Promise<ChannelHandle> {
    // Guard against a double-start: unconditionally reassigning `this.server`
    // would orphan the first server (its port stays bound, sockets stay open)
    // since `stop()` only ever closes the most-recently-assigned one.
    if (this.server) {
      throw new Error('HttpChannel is already started — call stop() before starting again.');
    }

    // Refuse to expose an unauthenticated agent endpoint to the network. With
    // no token the only gate is the deny-by-default tool resolver; a
    // non-loopback bind would still let anyone reach /v1/turn.
    if (this.authToken === null && !LOOPBACK_HOSTS.has(this.host)) {
      throw new Error(
        `HttpChannel refuses to bind non-loopback host "${this.host}" without an authToken. ` +
          'Set authToken (or MOXXY_HTTP_TOKEN), or bind 127.0.0.1.',
      );
    }

    const ctx: RouterContext = {
      session: startOpts.session,
      authToken: this.authToken,
      logger: this.logger as RouterContext['logger'],
      turnLimiter: new TurnLimiter(this.maxConcurrentTurns),
      ...(this.streamStallMs !== undefined ? { streamStallMs: this.streamStallMs } : {}),
    };

    const server = createServer(async (req, res) => {
      const handler = routeRequest(req);
      if (!handler) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'not_found', path: req.url }));
        return;
      }
      try {
        await handler(req, res, ctx);
      } catch (err) {
        // Log the full error server-side; return a generic message so internal
        // paths/provider details can't leak to a (possibly remote) caller.
        const logger = this.logger;
        if (logger?.warn) logger.warn('http handler threw', { err: String(err) });
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'internal' }));
        } else {
          try { res.end(); } catch { /* ignore */ }
        }
      }
    });

    // Tighten timeouts so a slow-loris client can't tie up sockets by dribbling
    // headers/bodies. Defaults (requestTimeout 300s) are too generous for an
    // agent endpoint. Cap total connections so a flood can't exhaust handles.
    server.headersTimeout = 10_000;
    server.requestTimeout = 30_000;
    server.keepAliveTimeout = 5_000;
    server.maxConnections = 256;

    this.server = server;

    // `running` rejects on a post-listen server error and resolves on a clean
    // close. Declared up front so the persistent error handler installed below
    // (after the listen-scoped one is detached) can settle it.
    let rejectRunning!: (err: unknown) => void;
    let resolveRunning!: () => void;
    const running = new Promise<void>((resolve, reject) => {
      resolveRunning = resolve;
      rejectRunning = reject;
    });
    // A fire-and-forget caller may never attach a .catch; without this default
    // observer a post-listen server error escalates to a process-level
    // unhandledRejection (fatal under --unhandled-rejections=strict). Real
    // awaiters still see the rejection — a settled promise fans out to all.
    running.catch(() => {});

    const listening = new Promise<void>((resolve, reject) => {
      // Scoped to the listen handshake only — detached once we're listening so
      // it can't no-op on the already-settled promise (and swallow runtime
      // errors). The persistent handler below takes over afterwards.
      const onListenError = (err: unknown): void => reject(err);
      server.once('error', onListenError);
      server.listen(this.port, this.host, () => {
        server.off('error', onListenError);
        // A runtime server error after listen would otherwise be unhandled
        // (Node re-throws an 'error' with no listener). Log it and fail the
        // `running` promise so callers awaiting it observe the crash instead of
        // mistaking it for a clean shutdown.
        server.on('error', (err: unknown) => {
          const logger = this.logger;
          if (logger?.warn) logger.warn('http server error', { err: String(err) });
          rejectRunning(err);
        });
        const addr = server.address();
        this.boundPortValue = typeof addr === 'object' && addr ? addr.port : this.port;
        const logger = this.logger;
        if (logger?.info)
          logger.info('http channel listening', {
            host: this.host,
            port: this.boundPortValue,
            authEnabled: this.authToken !== null,
          });
        resolve();
      });
    });

    await listening;

    server.once('close', () => resolveRunning());

    return {
      running,
      stop: async () => {
        const srv = this.server;
        // Clear the handle first so a concurrent/double stop() is a no-op rather
        // than racing two close() calls on the same server (the second close
        // gets an 'ERR_SERVER_NOT_RUNNING' error in its callback).
        if (this.server === srv) {
          this.server = null;
          this.boundPortValue = 0;
        }
        await new Promise<void>((resolve) => {
          if (!srv) return resolve();
          srv.close((err) => {
            const logger = this.logger;
            if (err && logger?.warn) logger.warn('http server close error', { err: String(err) });
            resolve();
          });
        });
      },
    };
  }
}
