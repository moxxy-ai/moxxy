import { describe, expect, it } from 'vitest';
import {
  base64urlDecode,
  base64urlEncode,
  connectResponder,
  fingerprint,
  generateIdentity,
  utf8,
  utf8Decode,
  type MessageTransport,
  type SecureChannel,
} from '@moxxy/e2e';
import { makeE2EWebSocketCtor } from './e2e-socket.js';
import type { WebSocketCtor, WebSocketLike } from './json-rpc-client.js';

/**
 * A base WebSocket modelling iOS React Native: it can ONLY send text frames —
 * a binary `send` throws (RN silently drops binary frames on iOS). Inbound
 * frames are delivered as strings. It is pre-wired to a peer responder via an
 * in-memory link carrying the on-the-wire strings, so the real e2e adapter runs
 * the genuine `@moxxy/e2e` handshake against a real responder.
 */
class TextOnlyBaseWs {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  readyState = 1;
  binaryType = 'blob';
  /** Number of non-string (binary) sends attempted — must stay 0 with the fix. */
  binarySends = 0;
  /** Wire strings to hand to the peer responder. */
  toPeer: (wireText: string) => void = () => undefined;

  constructor() {
    queueMicrotask(() => this.onopen?.());
  }
  deliver(wireText: string): void {
    queueMicrotask(() => this.onmessage?.({ data: wireText }));
  }
  send(data: unknown): void {
    if (typeof data !== 'string') {
      this.binarySends += 1;
      throw new Error('RN WebSocket: binary send unsupported');
    }
    this.toPeer(data);
  }
  close(): void {
    queueMicrotask(() => this.onclose?.());
  }
}

/** Link a text-only base socket to a responder MessageTransport (both base64url). */
function wireTextLink(): { base: TextOnlyBaseWs; peer: MessageTransport } {
  const base = new TextOnlyBaseWs();
  let peerOnMsg: ((b: Uint8Array) => void) | null = null;
  base.toPeer = (wireText) => {
    const bytes = base64urlDecode(wireText);
    queueMicrotask(() => peerOnMsg?.(bytes));
  };
  const peer: MessageTransport = {
    send: (bytes) => base.deliver(base64urlEncode(bytes)), // arrives as a string, like RN
    onMessage: (h) => {
      peerOnMsg = h;
    },
    onClose: () => undefined,
    close: () => base.close(),
  };
  return { base, peer };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('makeE2EWebSocketCtor wire framing', () => {
  it('handshakes over a TEXT-only WebSocket (iOS RN) and never sends a binary frame', async () => {
    const identity = generateIdentity();
    const fp = fingerprint(identity.publicKey);
    const { base, peer } = wireTextLink();

    const responderReady: Promise<SecureChannel> = connectResponder(peer, identity);
    // A constructable stand-in: `new baseCtor(url)` returns our pre-wired socket
    // (arrow functions aren't constructable, so use a function expression).
    const baseCtor = function () {
      return base;
    } as unknown as WebSocketCtor;
    const Ctor = makeE2EWebSocketCtor(baseCtor, fp, 'bearer-tok');

    const phone = new Ctor('ws://relay.example/mobile') as WebSocketLike;
    const opened = new Promise<void>((resolve) => {
      phone.onopen = resolve;
    });

    const responder = await responderReady;
    await opened; // handshake completed over text frames only

    // The agent shim sees the bearer as the FIRST encrypted frame, then JSON.
    const agentGot: string[] = [];
    responder.onMessage((pt) => agentGot.push(utf8Decode(pt)));
    phone.send('{"id":1,"method":"ping"}');
    await tick();

    expect(agentGot[0]).toBe('bearer-tok');
    expect(agentGot).toContain('{"id":1,"method":"ping"}');
    expect(base.binarySends).toBe(0); // regression guard: text frames only

    // And the reverse direction decodes a text frame back to plaintext.
    const phoneGot: string[] = [];
    phone.onmessage = (ev) => phoneGot.push(String((ev as { data: unknown }).data));
    responder.send(utf8('{"echo":true}'));
    await tick();
    expect(phoneGot).toContain('{"echo":true}');
  });
});
