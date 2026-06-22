/**
 * `SecureChannel` ties the handshake + framing to a concrete message transport
 * (a WebSocket, or anything that delivers discrete binary messages in order).
 *
 * It runs the two-message handshake first, then transparently seals everything
 * the caller `send()`s and opens everything that arrives, emitting plaintext via
 * `onMessage`. Both ends use the same channel object; only the constructor
 * (`connectInitiator` for the phone, `connectResponder` for the agent shim)
 * differs. The returned promise resolves once the channel is encrypted and
 * ready — any handshake failure (length, pin mismatch, bad signature, early
 * close) rejects it, and the caller must abort the connection.
 */
import { FrameOpener, FrameSealer } from './frame.js';
import {
  finishInitiator,
  respond,
  startInitiator,
  type SessionKeys,
} from './handshake.js';
import type { Identity } from './identity.js';

/** A minimal duplex transport of discrete, ordered binary messages. */
export interface MessageTransport {
  /** Send one binary message. */
  send(data: Uint8Array): void;
  /** Register the (single) handler for inbound binary messages. */
  onMessage(handler: (data: Uint8Array) => void): void;
  /** Register the (single) handler for transport close. */
  onClose(handler: () => void): void;
  /** Close the underlying transport. */
  close(): void;
}

export interface SecureChannel {
  /** Encrypt and send one plaintext message. */
  send(plaintext: Uint8Array): void;
  /** Register the handler for decrypted inbound messages. Buffered until set. */
  onMessage(handler: (plaintext: Uint8Array) => void): void;
  /** Register a close handler (fires on transport close or fatal frame error). */
  onClose(handler: () => void): void;
  /** Tear down the channel and the underlying transport. */
  close(): void;
}

function makeChannel(transport: MessageTransport, keys: SessionKeys): SecureChannel {
  const sealer = new FrameSealer(keys.sendKey);
  const opener = new FrameOpener(keys.recvKey);
  let onMsg: ((pt: Uint8Array) => void) | null = null;
  let onClose: (() => void) | null = null;
  const backlog: Uint8Array[] = [];
  let closed = false;

  const close = (): void => {
    if (closed) return;
    closed = true;
    transport.close();
    onClose?.();
  };

  transport.onMessage((data) => {
    let pt: Uint8Array;
    try {
      pt = opener.open(data);
    } catch {
      // A frame that fails to open is a tampering/replay attempt on the wire —
      // tear the whole channel down rather than skipping the message.
      close();
      return;
    }
    if (onMsg) onMsg(pt);
    else backlog.push(pt);
  });
  transport.onClose(() => {
    if (closed) return;
    closed = true;
    onClose?.();
  });

  return {
    send: (plaintext) => transport.send(sealer.seal(plaintext)),
    onMessage: (handler) => {
      onMsg = handler;
      while (backlog.length > 0) handler(backlog.shift() as Uint8Array);
    },
    onClose: (handler) => {
      onClose = handler;
    },
    close,
  };
}

/**
 * Wait for exactly the next inbound transport message (the handshake reply),
 * rejecting if the transport closes first. Used only during the handshake.
 */
function nextMessage(transport: MessageTransport): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    transport.onMessage((data) => resolve(data));
    transport.onClose(() => reject(new Error('proxy-e2e: transport closed during handshake')));
  });
}

/** Phone side: pin the agent's public key (from the QR `fp`) and connect. */
export async function connectInitiator(
  transport: MessageTransport,
  pinnedPublicKey: Uint8Array,
): Promise<SecureChannel> {
  const { clientHello, state } = startInitiator();
  const reply = nextMessage(transport);
  transport.send(clientHello);
  const keys = finishInitiator(await reply, state, pinnedPublicKey);
  return makeChannel(transport, keys);
}

/** Agent side: respond with a signed ServerHello and connect. */
export async function connectResponder(
  transport: MessageTransport,
  identity: Identity,
): Promise<SecureChannel> {
  const clientHello = await nextMessage(transport);
  const { serverHello, keys } = respond(clientHello, identity);
  transport.send(serverHello);
  return makeChannel(transport, keys);
}
