/**
 * An E2E-encrypting adapter that presents the same `WebSocketLike` interface
 * {@link WsRpcClient} already speaks, so the JSON-RPC client is unchanged. It
 * wraps a base WebSocket and, on connect:
 *   1. runs the `@moxxy/e2e` handshake (initiator), pinning the agent's public
 *      key from the QR fingerprint — a relay that can't produce that key's
 *      signature fails here;
 *   2. sends the bearer token as the first ENCRYPTED frame (so it never reaches
 *      the relay, which terminates the outer TLS);
 *   3. seals every outgoing JSON frame and opens every incoming one.
 *
 * Pure JS over `@moxxy/e2e` (no Node deps) so it bundles under Metro/RN.
 */
import {
  connectInitiator,
  publicKeyFromFingerprint,
  utf8,
  utf8Decode,
  type MessageTransport,
  type SecureChannel,
} from '@moxxy/e2e';
import type { WebSocketCtor, WebSocketLike } from './json-rpc-client.js';

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

/** The binary-capable surface of the underlying socket we drive. */
interface BinaryWs {
  send(data: string | ArrayBufferLike | ArrayBufferView): void;
  close(): void;
  readonly readyState: number;
  binaryType?: string;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: ((err: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

function toBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  if (typeof data === 'string') return utf8(data);
  return new Uint8Array(0);
}

/**
 * Build a `WebSocketCtor` that transparently end-to-end-encrypts the connection.
 * `token` (if any) is delivered encrypted as the first frame; do NOT also pass a
 * bearer subprotocol to the base ctor.
 */
export function makeE2EWebSocketCtor(
  baseCtor: WebSocketCtor,
  pinnedFingerprint: string,
  token: string | undefined,
): WebSocketCtor {
  const pinnedKey = publicKeyFromFingerprint(pinnedFingerprint);

  return class E2EWebSocket implements WebSocketLike {
    readyState = CONNECTING;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: ((err: unknown) => void) | null = null;
    onmessage: ((ev: { data: unknown }) => void) | null = null;

    private readonly base: BinaryWs;
    private channel: SecureChannel | null = null;
    private msgHandler: ((b: Uint8Array) => void) | null = null;
    private closeHandler: (() => void) | null = null;
    private readonly backlog: Uint8Array[] = [];
    private closed = false;

    constructor(url: string) {
      this.base = new baseCtor(url) as unknown as BinaryWs;
      try {
        this.base.binaryType = 'arraybuffer';
      } catch {
        /* RN sets it implicitly */
      }

      const transport: MessageTransport = {
        send: (bytes) => this.base.send(bytes),
        onMessage: (handler) => {
          this.msgHandler = handler;
          while (this.backlog.length > 0) handler(this.backlog.shift() as Uint8Array);
        },
        onClose: (handler) => {
          this.closeHandler = handler;
        },
        close: () => this.base.close(),
      };

      this.base.onmessage = (ev) => {
        const bytes = toBytes(ev.data);
        if (this.msgHandler) this.msgHandler(bytes);
        else this.backlog.push(bytes);
      };
      this.base.onclose = () => {
        this.closeHandler?.();
        this.fail();
      };
      this.base.onerror = (err) => this.onerror?.(err);
      this.base.onopen = () => {
        void this.runHandshake(transport);
      };
    }

    private async runHandshake(transport: MessageTransport): Promise<void> {
      try {
        const channel = await connectInitiator(transport, pinnedKey);
        channel.onMessage((pt) => this.onmessage?.({ data: utf8Decode(pt) }));
        channel.onClose(() => this.fail());
        if (token) channel.send(utf8(token)); // auth, encrypted, sent first
        this.channel = channel;
        this.readyState = OPEN;
        this.onopen?.();
      } catch {
        // Handshake failed (pin mismatch / bad signature / early close) — the
        // peer is not the agent the QR named. Surface as a transport close.
        this.fail();
      }
    }

    private fail(): void {
      if (this.closed) return;
      this.closed = true;
      this.readyState = CLOSED;
      try {
        this.base.close();
      } catch {
        /* ignore */
      }
      this.onclose?.();
    }

    send(data: string): void {
      // WsRpcClient only calls send() after we fire onopen, by which point the
      // channel exists; guard anyway.
      this.channel?.send(utf8(data));
    }

    close(): void {
      if (this.closed) return;
      this.closed = true;
      this.readyState = CLOSED;
      try {
        this.base.close();
      } catch {
        /* ignore */
      }
    }
  };
}
