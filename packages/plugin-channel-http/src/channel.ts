import { createServer, type Server } from 'node:http';
import { createAllowListResolver, denyByDefaultResolver } from '@moxxy/sdk';
import type { ClientSession as Session } from '@moxxy/sdk';
import type {
  Channel,
  ChannelHandle,
  ChannelStartOptsBase,
  PermissionResolver,
} from '@moxxy/sdk';
import { routeRequest, type RouterContext } from './router.js';

export interface HttpChannelOptions {
  readonly port?: number;
  readonly host?: string;
  /** Bearer token required on every protected route. If unset, auth is disabled (dev-only). */
  readonly authToken?: string;
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
    this.logger = opts.logger;
    this.permissionResolver = opts.allowedTools && opts.allowedTools.length > 0
      ? createAllowListResolver([...opts.allowedTools])
      : denyByDefaultResolver;
  }

  async start(startOpts: HttpStartOpts): Promise<ChannelHandle> {
    const ctx: RouterContext = {
      session: startOpts.session,
      authToken: this.authToken,
      logger: this.logger as RouterContext['logger'],
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
        this.logger?.warn?.('http handler threw', { err: String(err) });
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'internal', message: String(err) }));
        } else {
          try { res.end(); } catch { /* ignore */ }
        }
      }
    });

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
          this.logger?.warn?.('http server error', { err: String(err) });
          rejectRunning(err);
        });
        const addr = server.address();
        this.boundPortValue = typeof addr === 'object' && addr ? addr.port : this.port;
        this.logger?.info?.('http channel listening', {
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
        await new Promise<void>((resolve) => {
          if (!this.server) return resolve();
          this.server.close(() => resolve());
        });
      },
    };
  }
}
