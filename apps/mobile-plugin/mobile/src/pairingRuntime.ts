import { configurePlatform, configureTransport } from '@moxxy/client-core';
import {
  makeWsApiHandle,
  splitConnectUrl,
  type WsClientStatus,
} from '@moxxy/client-transport-ws';

export interface BridgePairingTarget {
  readonly url: string;
  readonly token: string;
}

export interface BridgePairingTransportHandle extends BridgePairingTarget {
  status(): WsClientStatus;
  close(): void;
}

interface BridgePairingTransportDeps {
  readonly configurePlatform: typeof configurePlatform;
  readonly configureTransport: typeof configureTransport;
  readonly makeWsApiHandle: typeof makeWsApiHandle;
}

export function resolveBridgePairingTarget(rawUrl: string, manualToken?: string | null): BridgePairingTarget {
  const trimmed = rawUrl.trim();
  if (!/^wss?:\/\//i.test(trimmed)) {
    throw new Error('Paste the ws:// or wss:// URL printed by moxxy mobile.');
  }

  const split = splitConnectUrl(trimmed);
  const token = manualToken?.trim() || split.token?.trim();
  if (!token) {
    throw new Error('Missing mobile pairing token.');
  }

  return {
    url: cleanBridgeUrl(split.url),
    token,
  };
}

export function openBridgePairingTransport(
  rawUrl: string,
  manualToken?: string | null,
  deps: BridgePairingTransportDeps = {
    configurePlatform,
    configureTransport,
    makeWsApiHandle,
  },
  onStatus?: (status: WsClientStatus) => void,
): BridgePairingTransportHandle {
  const target = resolveBridgePairingTarget(rawUrl, manualToken);
  let status: WsClientStatus = 'connecting';
  const handle = deps.makeWsApiHandle({
    url: target.url,
    token: target.token,
    onStatus: (next) => {
      status = next;
      onStatus?.(next);
    },
  });
  deps.configureTransport(handle.api);
  deps.configurePlatform({});
  return {
    ...target,
    status: () => status,
    close: handle.close,
  };
}

function cleanBridgeUrl(rawUrl: string): string {
  const withoutQuery = rawUrl.split('#')[0]!.split('?')[0]!.trim();
  return withoutQuery.replace(/^(wss?:\/\/[^/]+)\/$/, '$1');
}
