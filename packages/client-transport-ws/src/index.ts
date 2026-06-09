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

export {
  WsRpcClient,
  type WebSocketCtor,
  type WebSocketLike,
  type WsClientStatus,
  type WsRpcClientOptions,
} from './json-rpc-client.js';

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
  /** Shared secret, presented via the `Sec-WebSocket-Protocol` bearer entry. */
  readonly token?: string;
  /** Override the WebSocket implementation (defaults to the global one). */
  readonly WebSocket?: WebSocketCtor;
  /** Observe transport lifecycle; the terminal `disconnected` status means the
   *  reconnect budget is exhausted and the app should prompt a re-pair.
   *  Defaults to a console.warn on `disconnected`. */
  readonly onStatus?: (status: WsClientStatus) => void;
}

export function makeWsApi(opts: WsApiOptions): MoxxyApi {
  const ctor =
    opts.WebSocket ?? (globalThis as unknown as { WebSocket?: WebSocketCtor }).WebSocket;
  if (!ctor) {
    throw new Error('makeWsApi: no WebSocket implementation available (pass opts.WebSocket)');
  }
  const onStatus =
    opts.onStatus ??
    ((status: WsClientStatus): void => {
      if (status === 'disconnected') {
        console.warn('[moxxy] ws transport gave up reconnecting — re-pair to continue');
      }
    });
  const client = new WsRpcClient(opts.url, ctor, {
    ...(opts.token ? { protocols: [WS_SUBPROTOCOL, bearerProtocol(opts.token)] } : {}),
    onStatus,
  });
  client.connect();

  return {
    invoke: ((command: string, ...args: unknown[]) =>
      client.request(command, args[0])) as MoxxyApi['invoke'],
    subscribe: ((channel: string, handler: (payload: unknown) => void) =>
      client.on(channel, handler)) as MoxxyApi['subscribe'],
  };
}
