/**
 * Build a {@link MoxxyApi} backed by the desktop host's WebSocket bridge, for a
 * remote client (the Expo app):
 *
 *   import { makeWsApi } from '@moxxy/client-transport-ws';
 *   import { configureTransport } from '@moxxy/client-core/transport';
 *   configureTransport(makeWsApi({ url: 'ws://192.168.1.5:8765', token }));
 *
 * `invoke` maps to a JSON-RPC request; `subscribe` registers a notification
 * handler for an event channel. The token is presented as a `?t=` query param
 * (the bridge also accepts an `Authorization: Bearer` header, which a browser /
 * RN `WebSocket` can't set).
 */

import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { WsRpcClient, type WebSocketCtor } from './json-rpc-client.js';

export { WsRpcClient, type WebSocketCtor, type WebSocketLike } from './json-rpc-client.js';

export interface WsApiOptions {
  /** Bridge URL, e.g. `ws://host:8765`. */
  readonly url: string;
  /** Shared secret presented as `?t=<token>`. */
  readonly token?: string;
  /** Override the WebSocket implementation (defaults to the global one). */
  readonly WebSocket?: WebSocketCtor;
}

function withToken(url: string, token?: string): string {
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}t=${encodeURIComponent(token)}`;
}

export function makeWsApi(opts: WsApiOptions): MoxxyApi {
  const ctor =
    opts.WebSocket ?? (globalThis as unknown as { WebSocket?: WebSocketCtor }).WebSocket;
  if (!ctor) {
    throw new Error('makeWsApi: no WebSocket implementation available (pass opts.WebSocket)');
  }
  const client = new WsRpcClient(withToken(opts.url, opts.token), ctor);
  client.connect();

  return {
    invoke: ((command: string, ...args: unknown[]) =>
      client.request(command, args[0])) as MoxxyApi['invoke'],
    subscribe: ((channel: string, handler: (payload: unknown) => void) =>
      client.on(channel, handler)) as MoxxyApi['subscribe'],
  };
}
