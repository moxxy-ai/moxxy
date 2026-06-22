/**
 * Build a {@link MoxxyApi} backed by the desktop host's WebSocket bridge, for a
 * remote client (the Expo app):
 *
 *   import { makeWsApi } from '@moxxy/client-transport-ws';
 *   import { configureTransport } from '@moxxy/client-core/transport';
 *   configureTransport(makeWsApi({ url: 'ws://192.168.1.5:8765', token }));
 *
 * `invoke` maps to a JSON-RPC request; `subscribe` registers a notification
 * handler for an event channel. The token is presented as a
 * `Sec-WebSocket-Protocol` bearer entry (`moxxy.bearer.<encoded>` alongside the
 * `moxxy.v1` protocol) — the only header a browser/RN `WebSocket` can influence
 * — so the secret never rides the URL (query strings leak through logs and
 * shoulder-surfed QRs; the bridge rejects `?t=` unless legacy mode is enabled).
 *
 * NOTE: the protocol constants here mirror `MOXXY_WS_SUBPROTOCOL` /
 * `encodeWsBearerProtocol` in `@moxxy/sdk` (this package must stay free of
 * Node-flavoured deps to bundle under Metro, so it can't import them).
 */

import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import {
  WsRpcClient,
  type WebSocketCtor,
  type WsClientStatus,
} from './json-rpc-client.js';
import { makeE2EWebSocketCtor } from './e2e-socket.js';

export {
  WsRpcClient,
  type WebSocketCtor,
  type WebSocketLike,
  type WsClientStatus,
  type WsRpcClientOptions,
} from './json-rpc-client.js';
export { splitConnectUrl } from './pairing.js';
export { makeE2EWebSocketCtor } from './e2e-socket.js';

/** Mirrors `MOXXY_WS_SUBPROTOCOL` in `@moxxy/sdk`. */
const WS_SUBPROTOCOL = 'moxxy.v1';
/** Mirrors `MOXXY_WS_BEARER_PROTOCOL_PREFIX` in `@moxxy/sdk`. */
const WS_BEARER_PREFIX = 'moxxy.bearer.';

/** Encode the bearer token as a subprotocol entry — RFC 3986 strict percent
 *  encoding keeps every output char a valid HTTP token char. Mirrors
 *  `encodeWsBearerProtocol` in `@moxxy/sdk`. */
function bearerProtocol(token: string): string {
  const strict = encodeURIComponent(token).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${WS_BEARER_PREFIX}${strict}`;
}

export interface WsApiOptions {
  /** Bridge URL, e.g. `ws://host:8765` (no token in the URL). */
  readonly url: string;
  /** Shared secret, presented via the `Sec-WebSocket-Protocol` bearer entry
   *  (or, with `e2e`, as the first encrypted frame). */
  readonly token?: string;
  /** Override the WebSocket implementation (defaults to the global one). */
  readonly WebSocket?: WebSocketCtor;
  /**
   * End-to-end-encrypt the connection through an untrusted relay (the proxy
   * tunnel). `pinnedFingerprint` is the agent's public-key fingerprint from the
   * QR (`?fp=`); the transport runs the `@moxxy/e2e` handshake, pins it, and
   * carries the token encrypted. When set, the token is NOT put in the
   * subprotocol (it would leak to the relay).
   */
  readonly e2e?: { readonly pinnedFingerprint: string };
  /** Observe transport lifecycle; the terminal `disconnected` status means the
   *  reconnect budget is exhausted and the app should prompt a re-pair.
   *  Defaults to a console.warn on `disconnected`. */
  readonly onStatus?: (status: WsClientStatus) => void;
}

export function makeWsApiHandle(opts: WsApiOptions): {
  api: MoxxyApi;
  close: () => void;
} {
  const baseCtor =
    opts.WebSocket ?? (globalThis as unknown as { WebSocket?: WebSocketCtor }).WebSocket;
  if (!baseCtor) {
    throw new Error('makeWsApi: no WebSocket implementation available (pass opts.WebSocket)');
  }
  const onStatus =
    opts.onStatus ??
    ((status: WsClientStatus): void => {
      if (status === 'disconnected') {
        console.warn('[moxxy] ws transport gave up reconnecting — re-pair to continue');
      }
    });
  // E2E: wrap the ctor; the token rides encrypted (no bearer subprotocol).
  // Plain: present the token via the Sec-WebSocket-Protocol bearer entry.
  const ctor = opts.e2e
    ? makeE2EWebSocketCtor(baseCtor, opts.e2e.pinnedFingerprint, opts.token)
    : baseCtor;
  const protocols =
    !opts.e2e && opts.token ? [WS_SUBPROTOCOL, bearerProtocol(opts.token)] : undefined;
  const client = new WsRpcClient(opts.url, ctor, {
    ...(protocols ? { protocols } : {}),
    onStatus,
  });
  client.connect();

  const api: MoxxyApi = {
    // INVARIANT: every IPC command takes at most one positional `args` object,
    // so only args[0] crosses the wire as JSON-RPC `params`. A command with a
    // second positional parameter would silently lose it here — keep IPC
    // commands single-arg (or teach the bridge to spread an array param).
    invoke: ((command: string, ...args: unknown[]) =>
      client.request(command, args[0])) as MoxxyApi['invoke'],
    subscribe: ((channel: string, handler: (payload: unknown) => void) =>
      client.on(channel, handler)) as MoxxyApi['subscribe'],
  };

  return { api, close: () => client.close() };
}

export function makeWsApi(opts: WsApiOptions): MoxxyApi {
  return makeWsApiHandle(opts).api;
}
