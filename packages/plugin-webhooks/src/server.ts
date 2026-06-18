import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readRequestBody } from '@moxxy/sdk/server';
import { DeliveryDedupeCache } from './dedupe.js';
import { shouldFire } from './filter.js';
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

  constructor(private readonly opts: WebhookServerOptions) {
    this.dedupe = opts.dedupe ?? new DeliveryDedupeCache();
    this.maxBodyBytes = opts.maxBodyBytes ?? 1024 * 1024;
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
        this.opts.logger?.warn?.('webhooks: handler threw', {
          err: err instanceof Error ? err.message : String(err),
        });
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
        this.opts.logger?.info?.('webhooks: listening', {
          host: this.opts.host,
          port: this.opts.port,
        });
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
    const triggerId = m[1]!;
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

    let body: Buffer;
    try {
      body = await readRequestBody(req, this.maxBodyBytes);
    } catch (err) {
      res.writeHead(413, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'payload_too_large', message: String(err) }));
      return;
    }

    const verdict = verifyDelivery({
      verification: trigger.verification,
      headers: req.headers,
      body,
    });
    if (!verdict.ok) {
      this.opts.logger?.warn?.('webhooks: rejected delivery', {
        trigger: trigger.name,
        reason: verdict.reason,
      });
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
      this.opts.logger?.info?.('webhooks: duplicate delivery, dropped', {
        trigger: trigger.name,
        key: idempKey,
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'duplicate' }));
      return;
    }

    if (!shouldFire(trigger.filters, { headers: req.headers, body })) {
      this.opts.logger?.info?.('webhooks: filtered out, not firing', {
        trigger: trigger.name,
      });
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

    // Fire-and-forget. Errors are logged inside the dispatcher.
    void this.opts.dispatcher.fire(trigger, prompt, idempKey);
  }
}
