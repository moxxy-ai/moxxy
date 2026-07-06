import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { assertDefined } from '@moxxy/sdk';
import { readRequestBody } from '@moxxy/sdk/server';
import { DeliveryDedupeCache } from './dedupe.js';
import { shouldFire } from './filter.js';
import { RateLimiter } from './rate-limit.js';
import type { WebhookDispatcher } from './runner.js';
import { renderPrompt } from './template.js';
import type { WebhookStore } from './store.js';
import { idempotencyKey, verifyDelivery } from './verify.js';

/**
 * HTTP listener that routes verified webhook deliveries to the
 * dispatcher. The only public route is `POST /webhook/:triggerId`.
 * GET `/health` returns 200 so an external uptime check (or the agent
 * itself) can confirm the listener is alive.
 *
 * Lifecycle: bootstrap calls `start()`; the plugin's `onShutdown` hook
 * calls `stop()`. Idempotent on both ends.
 */

export interface WebhookServerOptions {
  readonly host: string;
  readonly port: number;
  readonly store: WebhookStore;
  readonly dispatcher: WebhookDispatcher;
  readonly logger?: {
    info?(msg: string, meta?: Record<string, unknown>): void;
    warn?(msg: string, meta?: Record<string, unknown>): void;
  };
  /** Max request body size in bytes. Default 1MB. */
  readonly maxBodyBytes?: number;
  /** Override dedupe cache (tests). */
  readonly dedupe?: DeliveryDedupeCache;
  /**
   * Sustained requests/second admitted PER TRIGGER before the expensive
   * verify/parse/regex work runs. Excess requests get a cheap 429. Default 20/s
   * (burst = capacity). Set to 0 / negative to disable (not recommended on a
   * non-loopback bind). A flood beyond this never reaches HMAC/JSON/regex.
   */
  readonly ratePerSec?: number;
  /** Override the rate limiter (tests). */
  readonly rateLimiter?: RateLimiter;
}

export interface WebhookServerHandle {
  readonly host: string;
  readonly port: number;
  readonly stop: () => Promise<void>;
}

const TRIGGER_PATH_RE = /^\/webhook\/([A-Za-z0-9_-]+)\/?(?:\?.*)?$/;

export class WebhookServer {
  private server: Server | null = null;
  private readonly dedupe: DeliveryDedupeCache;
  private readonly maxBodyBytes: number;
  /** Per-trigger admission control; null when explicitly disabled. */
  private readonly rateLimiter: RateLimiter | null;

  constructor(private readonly opts: WebhookServerOptions) {
    this.dedupe = opts.dedupe ?? new DeliveryDedupeCache();
    this.maxBodyBytes = opts.maxBodyBytes ?? 1024 * 1024;
    if (opts.rateLimiter) {
      this.rateLimiter = opts.rateLimiter;
    } else if (opts.ratePerSec !== undefined && opts.ratePerSec <= 0) {
      this.rateLimiter = null;
    } else {
      this.rateLimiter = new RateLimiter(
        opts.ratePerSec !== undefined ? { ratePerSec: opts.ratePerSec } : {},
      );
    }
  }

  /** Start listening. Resolves once the socket is bound. */
  async start(): Promise<WebhookServerHandle> {
    if (this.server) {
      return {
        host: this.opts.host,
        port: this.opts.port,
        stop: () => this.stop(),
      };
    }

    const server = createServer((req, res) => {
      this.handle(req, res).catch((err) => {
        const logger = this.opts.logger;
        if (logger?.warn) {
          logger.warn('webhooks: handler threw', {
            err: err instanceof Error ? err.message : String(err),
          });
        }
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'internal' }));
        } else {
          try { res.end(); } catch { /* ignore */ }
        }
      });
    });
    this.server = server;

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.opts.port, this.opts.host, () => {
        const logger = this.opts.logger;
        if (logger?.info) {
          logger.info('webhooks: listening', {
            host: this.opts.host,
            port: this.opts.port,
          });
        }
        resolve();
      });
    });

    return {
      host: this.opts.host,
      port: this.opts.port,
      stop: () => this.stop(),
    };
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const s = this.server;
    this.server = null;
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '/';

    if (req.method === 'GET' && (url === '/health' || url === '/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', listener: 'webhooks' }));
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'method_not_allowed' }));
      return;
    }

    const m = TRIGGER_PATH_RE.exec(url);
    if (!m) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }
    const triggerId = m[1];
    // Group 1 is a required capture in TRIGGER_PATH_RE; a successful exec (m is
    // non-null here) guarantees it matched.
    assertDefined(triggerId, 'webhook trigger id capture group');
    const trigger = await this.opts.store.get(triggerId);
    if (!trigger) {
      // Don't leak which IDs exist — same generic 404.
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }
    if (!trigger.enabled) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'trigger_disabled' }));
      return;
    }

    // Per-trigger admission control runs BEFORE any expensive work (body read,
    // HMAC verify, JSON parse, regex match). Keyed by the resolved trigger id so
    // an unknown/unauthenticated id can never allocate a bucket (the 404 above
    // already short-circuited those). A flood — even one carrying a captured
    // valid signature — is shed here with a cheap 429 instead of pinning the
    // single event loop on cryptographic + parse work for every replayed copy.
    if (this.rateLimiter && !this.rateLimiter.tryAcquire(trigger.id)) {
      const logger = this.opts.logger;
      if (logger?.warn) logger.warn('webhooks: rate limited', { trigger: trigger.name });
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' });
      res.end(JSON.stringify({ error: 'rate_limited' }));
      return;
    }

    let body: Buffer;
    try {
      body = await readRequestBody(req, this.maxBodyBytes);
    } catch (err) {
      // Generic to the (pre-auth) client — don't echo the internal error or the
      // configured size limit. Detail goes to the server log only.
      const logger = this.opts.logger;
      if (logger?.warn) {
        logger.warn('webhooks: rejected oversized body', {
          trigger: trigger.name,
          limit: this.maxBodyBytes,
          err: err instanceof Error ? err.message : String(err),
        });
      }
      res.writeHead(413, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'payload_too_large' }));
      return;
    }

    const verdict = verifyDelivery({
      verification: trigger.verification,
      headers: req.headers,
      body,
    });
    if (!verdict.ok) {
      const logger = this.opts.logger;
      if (logger?.warn) {
        logger.warn('webhooks: rejected delivery', {
          trigger: trigger.name,
          reason: verdict.reason,
        });
      }
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'verification_failed' }));
      return;
    }

    // Dedupe BEFORE the filter (and before the filter's body JSON-parse): a
    // delivery we've already seen is a duplicate regardless of the filter, and
    // dropping it here skips the parse work on aggressive retry storms. Verify
    // stays first so we never dedupe-record an unverified request.
    const idempKey = idempotencyKey(trigger, req.headers);
    if (idempKey && !this.dedupe.check(trigger.id, idempKey)) {
      const logger = this.opts.logger;
      if (logger?.info) {
        logger.info('webhooks: duplicate delivery, dropped', {
          trigger: trigger.name,
          key: idempKey,
        });
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'duplicate' }));
      return;
    }

    if (!shouldFire(trigger.filters, { headers: req.headers, body })) {
      const logger = this.opts.logger;
      if (logger?.info) {
        logger.info('webhooks: filtered out, not firing', {
          trigger: trigger.name,
        });
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'filtered' }));
      return;
    }

    // Respond immediately, then fire in the background. Webhook
    // senders care about ACK latency, not LLM completion.
    res.writeHead(202, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'accepted', trigger: trigger.name }));

    const prompt = renderPrompt({
      trigger,
      headers: req.headers,
      body,
      method: req.method ?? 'POST',
      path: url,
      firedAt: new Date(),
    });

    // Fire-and-forget. `route` fires in-process when this runner owns the
    // trigger (or it's owner-less), and otherwise hands the delivery to the
    // owning runner via the shared queue. Errors are logged inside the dispatcher.
    void this.opts.dispatcher.route(trigger, prompt, idempKey).catch((err) => {
      const logger = this.opts.logger;
      if (logger?.warn) {
        logger.warn('webhooks: route failed', {
          trigger: trigger.name,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }
}
