import { randomUUID } from 'node:crypto';

/**
 * The BlueBubbles transport seam (the "sidecar" equivalent for iMessage).
 *
 * BlueBubbles is a native macOS app running a localhost Koa + socket.io server
 * (default port 1234). We hit it directly over `http://127.0.0.1:1234`:
 *  - inbound: a socket.io client subscribed to `new-message` (built-in
 *    reconnection; no webhook lifecycle),
 *  - outbound: `POST /api/v1/message/text` with `method: 'apple-script'`.
 *
 * Auth is a single password passed as a QUERY PARAM on every call (BlueBubbles
 * never reads it from a header). There is no HMAC on the socket feed — pure
 * localhost trust — so the consumer must stay bound to loopback.
 *
 * The channel drives this behind {@link BlueBubblesClientLike} so tests inject a
 * fake and no socket.io / network is touched. `socket.io-client` is imported
 * lazily inside {@link BlueBubblesClient.connect} so module load (and
 * `isAvailable`) stays light.
 */
export interface BlueBubblesClientLike {
  /** Best-effort reachability + auth probe; throws a friendly error on failure. */
  ping(): Promise<void>;
  /** Open the socket.io connection and begin emitting inbound messages. */
  connect(): Promise<void>;
  /** Subscribe to raw `new-message` payloads. Returns an unsubscribe fn. */
  onMessage(listener: (raw: unknown) => void): () => void;
  /**
   * Send a text message. `tempGuid` correlates the send with its echoed
   * `new-message`; the returned `guid` (when the server reports it) is the
   * permanent id. Both feed the anti-echo set.
   */
  sendText(chatGuid: string, message: string): Promise<{ guid: string | null; tempGuid: string }>;
  /** Tear down the socket. */
  close(): void;
}

export interface BlueBubblesClientLogger {
  debug?(msg: string, meta?: Record<string, unknown>): void;
  info?(msg: string, meta?: Record<string, unknown>): void;
  warn?(msg: string, meta?: Record<string, unknown>): void;
}

/** Minimal slice of a socket.io client the channel uses (keeps typing loose). */
export interface SocketLike {
  on(event: string, listener: (...args: unknown[]) => void): void;
  close(): void;
}

export interface BlueBubblesClientOptions {
  readonly serverUrl: string;
  readonly password: string;
  readonly logger?: BlueBubblesClientLogger;
  /** Test seam: injectable fetch (defaults to global fetch). */
  readonly fetchImpl?: typeof fetch;
  /** Test seam: injectable socket factory (defaults to lazy socket.io-client). */
  readonly socketFactory?: (opts: { url: string; password: string }) => Promise<SocketLike>;
}

/** A fresh per-send temp guid (correlates our send with its echoed message). */
export function makeTempGuid(): string {
  return `temp-${randomUUID()}`;
}

export class BlueBubblesClient implements BlueBubblesClientLike {
  private readonly opts: BlueBubblesClientOptions;
  private readonly base: string;
  private socket: SocketLike | null = null;
  private readonly messageListeners = new Set<(raw: unknown) => void>();

  constructor(opts: BlueBubblesClientOptions) {
    this.opts = opts;
    // Normalize the base URL once (strip a trailing slash) so path joins are clean.
    this.base = opts.serverUrl.trim().replace(/\/+$/, '');
  }

  async ping(): Promise<void> {
    const doFetch = this.opts.fetchImpl ?? fetch;
    let res: Response;
    try {
      res = await doFetch(this.apiUrl('/api/v1/ping'));
    } catch (err) {
      throw new Error(
        `Cannot reach the BlueBubbles server at ${this.base}. Is it running on this Mac? ` +
          `(${err instanceof Error ? err.message : String(err)})`,
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        'The BlueBubbles server rejected the password. Check the password in the BlueBubbles app matches the one stored for moxxy.',
      );
    }
    // Any other HTTP response means something is listening — reachable enough.
  }

  async connect(): Promise<void> {
    const factory = this.opts.socketFactory ?? ((o) => defaultSocketFactory(o));
    const socket = await factory({ url: this.base, password: this.opts.password });
    this.socket = socket;
    socket.on('new-message', (...args: unknown[]) => {
      const payload = args.length > 0 ? args[0] : undefined;
      for (const listener of this.messageListeners) {
        try {
          listener(payload);
        } catch (err) {
          this.opts.logger?.warn?.('imessage: message listener threw', { err: String(err) });
        }
      }
    });
    socket.on('disconnect', (...args: unknown[]) => {
      this.opts.logger?.debug?.('imessage: socket disconnected (auto-reconnecting)', {
        reason: String(args.length > 0 ? args[0] : ''),
      });
    });
  }

  onMessage(listener: (raw: unknown) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  async sendText(
    chatGuid: string,
    message: string,
  ): Promise<{ guid: string | null; tempGuid: string }> {
    const doFetch = this.opts.fetchImpl ?? fetch;
    const tempGuid = makeTempGuid();
    const res = await doFetch(this.apiUrl('/api/v1/message/text'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatGuid, tempGuid, message, method: 'apple-script' }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`BlueBubbles send failed (HTTP ${res.status})${detail ? `: ${detail}` : ''}`);
    }
    const guid = await extractGuid(res);
    return { guid, tempGuid };
  }

  close(): void {
    this.messageListeners.clear();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        socket.close();
      } catch (err) {
        this.opts.logger?.warn?.('imessage: socket close threw', { err: String(err) });
      }
    }
  }

  /** Build an absolute API URL with the password query param appended. */
  private apiUrl(path: string): string {
    const url = new URL(this.base + path);
    url.searchParams.set('password', this.opts.password);
    return url.toString();
  }
}

/** Read the sent message's permanent guid from the send response, if present. */
async function extractGuid(res: Response): Promise<string | null> {
  const body: unknown = await res.json().catch(() => null);
  if (!body || typeof body !== 'object') return null;
  const data = (body as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return null;
  const guid = (data as { guid?: unknown }).guid;
  return typeof guid === 'string' && guid.length > 0 ? guid : null;
}

/** Lazily import socket.io-client and open a connection to the BlueBubbles feed. */
async function defaultSocketFactory(opts: { url: string; password: string }): Promise<SocketLike> {
  const { io } = await import('socket.io-client');
  const socket = io(opts.url, {
    query: { password: opts.password },
    transports: ['websocket'],
    // BlueBubbles' socket.io has built-in reconnection; keep it on.
    reconnection: true,
  });
  return socket as unknown as SocketLike;
}
