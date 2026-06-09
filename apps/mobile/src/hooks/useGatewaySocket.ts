/**
 * Owns the live WebSocket JSON-RPC client and the `@moxxy/client-core`
 * transport singleton.
 *
 * When pairing yields a (url, token) pair this hook builds a `WsRpcClient`,
 * presents the token via the `Sec-WebSocket-Protocol` bearer entry (wave-5
 * semantics — the secret never rides the URL), installs the client as the
 * client-core transport (`configureTransport`), and tracks its lifecycle.
 * Re-pairing closes the previous client before installing the next so a stale
 * socket can't keep reconnect-looping in the background.
 *
 * `generation` bumps per fresh client — the provider keys the client-core
 * bridges (`ChatStoreBridge`/`ConnectionBridge`) on it so their subscriptions
 * re-attach to the new client. `refreshTick` bumps on every successful
 * (re)connect — consumers refetch request/response state (session.info,
 * workflows) that pushed events don't cover.
 */

import { useEffect, useRef, useState } from 'react';
import { configurePlatform, configureTransport } from '@moxxy/client-core';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import {
  WsRpcClient,
  type WebSocketCtor,
  type WsClientStatus,
} from '@moxxy/client-transport-ws';

export type GatewaySocketStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface GatewaySocketState {
  readonly status: GatewaySocketStatus;
  /** A transport is configured — client-core hooks/bridges may run. */
  readonly ready: boolean;
  /** Bumps per fresh client (re-pair). Key the bridges on it. */
  readonly generation: number;
  /** Bumps per successful (re)connect. Refetch snapshot-ish state on it. */
  readonly refreshTick: number;
}

// NOTE: mirrors MOXXY_WS_SUBPROTOCOL / encodeWsBearerProtocol in @moxxy/sdk
// (and the same mirror inside @moxxy/client-transport-ws's makeWsApi — the
// encoder isn't exported there, and this app needs the raw WsRpcClient for
// close-on-re-pair lifecycle that makeWsApi doesn't expose).
const WS_SUBPROTOCOL = 'moxxy.v1';
const WS_BEARER_PREFIX = 'moxxy.bearer.';

function bearerProtocol(token: string): string {
  const strict = encodeURIComponent(token).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${WS_BEARER_PREFIX}${strict}`;
}

function toMoxxyApi(client: WsRpcClient): MoxxyApi {
  return {
    invoke: ((command: string, ...args: unknown[]) =>
      client.request(command, args[0])) as MoxxyApi['invoke'],
    subscribe: ((channel: string, handler: (payload: unknown) => void) =>
      client.on(channel, handler)) as MoxxyApi['subscribe'],
  };
}

function mapStatus(status: WsClientStatus): GatewaySocketStatus {
  switch (status) {
    case 'connecting':
      return 'connecting';
    case 'open':
      return 'connected';
    case 'reconnecting':
      return 'reconnecting';
    case 'disconnected':
      // Terminal: the reconnect budget is exhausted — re-pair to recover.
      return 'error';
    case 'closed':
      return 'idle';
  }
}

/** The one live client — module-level so a re-pair always closes its
 *  predecessor even across provider remounts. */
let activeClient: WsRpcClient | null = null;

export function useGatewaySocket(wsUrl: string | null, token: string | null): GatewaySocketState {
  const [status, setStatus] = useState<GatewaySocketStatus>('idle');
  const [generation, setGeneration] = useState(0);
  const [refreshTick, setRefreshTick] = useState(0);
  const readyRef = useRef(false);

  useEffect(() => {
    if (!wsUrl || !token) {
      activeClient?.close();
      activeClient = null;
      readyRef.current = false;
      setStatus('idle');
      return;
    }
    const ctor = (globalThis as unknown as { WebSocket?: WebSocketCtor }).WebSocket;
    if (!ctor) {
      setStatus('error');
      return;
    }
    const client = new WsRpcClient(wsUrl, ctor, {
      protocols: [WS_SUBPROTOCOL, bearerProtocol(token)],
      onStatus: (next) => {
        setStatus(mapStatus(next));
        if (next === 'open') setRefreshTick((tick) => tick + 1);
      },
    });
    activeClient?.close();
    activeClient = client;
    // No-op platform capabilities: voice capture / TTS / legacy-KV migration
    // degrade exactly as the optional-capability design intends.
    configurePlatform({});
    configureTransport(toMoxxyApi(client));
    readyRef.current = true;
    setStatus('connecting');
    setGeneration((value) => value + 1);
    client.connect();
    return () => {
      client.close();
      if (activeClient === client) activeClient = null;
    };
  }, [wsUrl, token]);

  return { status, ready: readyRef.current && status !== 'idle', generation, refreshTick };
}
