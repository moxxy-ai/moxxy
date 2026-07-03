import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readRequestBody } from '@moxxy/sdk/server';

/**
 * HTTP scaffold for inbound-webhook channels (Slack Events API today; Discord /
 * WhatsApp / Signal-style ingest next). Binds a `node:http` server to an
 * ephemeral loopback port; the channel exposes it publicly via a tunnel.
 *
 * The scaffold owns the gates that must run BEFORE any payload is trusted
 * (skill A8/A46) and before the session is ever touched:
 *   1. routing — POST-only on `eventsPath` (+ an optional GET health probe);
 *      anything else is 404.
 *   2. raw body read, size-capped → 413 (the raw bytes are what signature
 *      schemes verify — never a reserialized JSON).
 *   3. the `verify` hook → 401. Provider-specific signature schemes (Slack's
 *      HMAC, Discord's ed25519, ...) stay in the channel as this hook.
 *   4. every handler error is caught → 500, so a bad request can never
 *      escalate to a process-level uncaughtException.
 *
 * Everything AFTER verification — schema validation, handshake echoes, dedupe,
 * the immediate ACK, and fire-and-forget turn dispatch — is the channel's
 * `handleVerified`, which owns writing the response.
 */

export type IngestVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface IngestLogger {
  info?(msg: string, meta?: Record<string, unknown>): void;
  warn?(msg: string, meta?: Record<string, unknown>): void;
}

export interface IngestHttpServerOptions {
  /** Bind host. Default 127.0.0.1 (loopback; a tunnel provides public reach). */
  readonly host?: string;
  /** POST endpoint the provider delivers events to (e.g. '/slack/events'). */
  readonly eventsPath: string;
  /** Optional GET liveness probe (e.g. '/slack/health'). */
  readonly healthPath?: string;
  /** Health probe response body. Default `{ status: 'ok' }`. */
  readonly healthBody?: () => unknown;
  /** Max request body size in bytes. Default 1MB. */
  readonly maxBodyBytes?: number;
  /** Short channel label prefixed onto log lines (e.g. 'slack'). */
  readonly label: string;
  /** Signature gate over the EXACT raw bytes, before any parsing. */
  readonly verify: (input: {
    rawBody: Buffer;
    headers: IncomingMessage['headers'];
  }) => IngestVerdict;
  /**
   * The channel-specific pipeline for a verified delivery (parse → dedupe →
   * ACK → dispatch). MUST write the response.
   */
  readonly handleVerified: (
    rawBody: Buffer,
    req: IncomingMessage,
    res: ServerResponse,
  ) => Promise<void>;
  readonly logger?: IngestLogger;
}

export interface IngestHttpServerHandle {
  readonly host: string;
  readonly port: number;
  stop(): Promise<void>;
}

export function respondJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

export class IngestHttpServer {
  private server: Server | null = null;
  private readonly host: string;
  private readonly maxBodyBytes: number;
  private boundPort = 0;

  constructor(private readonly opts: IngestHttpServerOptions) {
    this.host = opts.host ?? '127.0.0.1';
    this.maxBodyBytes = opts.maxBodyBytes ?? 1024 * 1024;
  }

  get port(): number {
    return this.boundPort;
  }

  /** Bind on an ephemeral loopback port. Resolves once listening. */
  async start(): Promise<IngestHttpServerHandle> {
    if (this.server) {
      return { host: this.host, port: this.boundPort, stop: () => this.stop() };
    }
    const server = createServer((req, res) => {
      this.handle(req, res).catch((err) => {
        this.opts.logger?.warn?.(`${this.opts.label}: handler threw`, { err: String(err) });
        if (!res.headersSent) {
          respondJson(res, 500, { error: 'internal' });
        } else {
          try {
            res.end();
          } catch {
            /* ignore */
          }
        }
      });
    });
    this.server = server;

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error): void => reject(err);
      server.once('error', onError);
      // port 0 → OS assigns an ephemeral port; we read it back for the tunnel.
      server.listen(0, this.host, () => {
        server.off('error', onError);
        const addr = server.address();
        this.boundPort = addr && typeof addr === 'object' ? (addr as AddressInfo).port : 0;
        this.opts.logger?.info?.(`${this.opts.label}: ingest listening`, {
          host: this.host,
          port: this.boundPort,
        });
        resolve();
      });
    });

    return { host: this.host, port: this.boundPort, stop: () => this.stop() };
  }

  async stop(): Promise<void> {
    const s = this.server;
    if (!s) return;
    this.server = null;
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = (req.url ?? '/').split('?')[0] ?? '/';

    // Liveness probe (a proxy relay / an operator can hit this).
    if (this.opts.healthPath && req.method === 'GET' && url === this.opts.healthPath) {
      respondJson(res, 200, this.opts.healthBody?.() ?? { status: 'ok' });
      return;
    }

    if (req.method !== 'POST' || url !== this.opts.eventsPath) {
      respondJson(res, 404, { error: 'not_found' });
      return;
    }

    // Raw body bytes (needed for signature verification; BEFORE JSON.parse).
    let raw: Buffer;
    try {
      raw = await readRequestBody(req, this.maxBodyBytes);
    } catch (err) {
      this.opts.logger?.warn?.(`${this.opts.label}: rejected oversized body`, {
        limit: this.maxBodyBytes,
        err: err instanceof Error ? err.message : String(err),
      });
      respondJson(res, 413, { error: 'payload_too_large' });
      return;
    }

    // Signature gate.
    const verdict = this.opts.verify({ rawBody: raw, headers: req.headers });
    if (!verdict.ok) {
      this.opts.logger?.warn?.(`${this.opts.label}: rejected delivery`, { reason: verdict.reason });
      respondJson(res, 401, { error: 'verification_failed' });
      return;
    }

    await this.opts.handleVerified(raw, req, res);
  }
}
