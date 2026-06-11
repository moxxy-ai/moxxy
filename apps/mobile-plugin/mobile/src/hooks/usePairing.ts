import Constants from 'expo-constants';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { configurePlatform, configureTransport } from '@moxxy/client-core';
import { makeWsApi, splitConnectUrl } from '@moxxy/client-transport-ws';
import { pairWithGatewayCode } from '../pairingClient';
import { parsePairingQrPayload } from '../pairingQr';
import { chooseGatewayUrlForPairing, normalizeGatewayUrl } from '../pairingUrl';
import { useStorageState } from './storage';

const TOKEN_KEY = 'moxxy.mobile.gateway.token';
const URL_KEY = 'moxxy.mobile.gateway.url';

export interface PairingState {
  readonly gatewayUrl: string;
  readonly token: string | null;
  readonly code: string;
  readonly loading: boolean;
  readonly error: string | null;
  readonly transportReady: boolean;
  readonly setGatewayUrl: (value: string) => void;
  readonly loadPairing: () => Promise<void>;
  readonly pair: () => Promise<void>;
  readonly pairFromQrPayload: (raw: string) => Promise<void>;
  readonly disconnect: () => void;
}

export function usePairing(): PairingState {
  const [[tokenLoading, token], setToken] = useStorageState(TOKEN_KEY);
  const [[urlLoading, storedUrl], setStoredUrl] = useStorageState(URL_KEY);
  const expoHostUri = readExpoHostUri();
  const [gatewayUrl, setGatewayUrlState] = useState(chooseGatewayUrlForPairing(storedUrl, expoHostUri));
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [transportReady, setTransportReady] = useState(false);

  const normalizedUrl = useMemo(() => normalizeGatewayUrl(gatewayUrl), [gatewayUrl]);

  useEffect(() => {
    if (!tokenLoading && !urlLoading && token && storedUrl && isBridgeUrl(storedUrl)) {
      configureBridgeTransport(storedUrl, token);
      setTransportReady(true);
    }
  }, [storedUrl, token, tokenLoading, urlLoading]);

  useEffect(() => {
    if (!urlLoading) setGatewayUrlState(chooseGatewayUrlForPairing(storedUrl, expoHostUri));
  }, [expoHostUri, storedUrl, urlLoading]);

  const setGatewayUrl = useCallback(
    (value: string) => {
      setGatewayUrlState(value);
      setStoredUrl(value);
    },
    [setStoredUrl],
  );

  const loadPairing = useCallback(async () => {
    setError(null);
    if (isBridgeUrl(gatewayUrl)) {
      const split = splitConnectUrl(gatewayUrl);
      setGatewayUrlState(split.url);
      setStoredUrl(split.url);
      setCode(split.token ?? '');
      if (!split.token) setError('Paste the full ws:// or wss:// URL printed by moxxy mobile, including ?t=token.');
      return;
    }
    try {
      const res = await fetch(`${normalizedUrl}/mobile/v1/pairing`);
      if (!res.ok) {
        setError(`Pairing failed with ${res.status}`);
        return;
      }
      const body = (await res.json()) as { code?: string };
      setCode(body.code ?? '');
    } catch {
      setError(`Cannot reach gateway at ${normalizedUrl}. Use your Mac LAN URL, for example http://192.168.x.x:17902.`);
    }
  }, [normalizedUrl]);

  const pairWithCode = useCallback(async (targetUrl: string, pairingCode: string, refreshOnInvalid: boolean) => {
    setError(null);
    if (isBridgeUrl(targetUrl)) {
      if (!pairingCode.trim()) {
        setError('Missing mobile pairing token. Scan the QR printed by moxxy mobile.');
        return;
      }
      const split = splitConnectUrl(targetUrl);
      const url = split.url;
      const token = pairingCode.trim();
      configureBridgeTransport(url, token);
      setToken(token);
      setStoredUrl(url);
      setGatewayUrlState(url);
      setCode('');
      setTransportReady(true);
      return;
    }
    try {
      const result = await pairWithGatewayCode(targetUrl, pairingCode, { refreshOnInvalid });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setToken(result.token);
      setStoredUrl(targetUrl);
      setCode('');
    } catch {
      setError(`Cannot pair with gateway at ${targetUrl}. Check Wi-Fi and keep moxxy mobile running.`);
    }
  }, [setStoredUrl, setToken]);

  const pair = useCallback(async () => {
    await pairWithCode(normalizedUrl, code, false);
  }, [code, normalizedUrl, pairWithCode]);

  const pairFromQrPayload = useCallback(async (raw: string) => {
    setError(null);
    try {
      const target = parsePairingQrPayload(raw);
      setGatewayUrlState(target.gatewayUrl);
      setStoredUrl(target.gatewayUrl);
      setCode(target.code);
      await pairWithCode(target.gatewayUrl, target.code, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid Moxxy pairing QR code');
    }
  }, [pairWithCode, setStoredUrl]);

  const disconnect = useCallback(() => {
    setToken(null);
    setTransportReady(false);
  }, [setToken]);

  return {
    gatewayUrl,
    token,
    code,
    loading: tokenLoading || urlLoading,
    error,
    transportReady,
    setGatewayUrl,
    loadPairing,
    pair,
    pairFromQrPayload,
    disconnect,
  };
}

function configureBridgeTransport(rawUrl: string, token: string): void {
  const split = splitConnectUrl(rawUrl);
  configureTransport(makeWsApi({ url: split.url, token: token || split.token }));
  configurePlatform({});
}

function isBridgeUrl(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^wss?:\/\//i.test(value.trim());
}

function readExpoHostUri(): string | null {
  const constants = Constants as unknown as {
    expoConfig?: { hostUri?: string | null };
    manifest2?: { extra?: { expoClient?: { hostUri?: string | null }; expoGo?: { debuggerHost?: string | null } } };
    manifest?: { debuggerHost?: string | null };
  };

  return (
    constants.expoConfig?.hostUri ??
    constants.manifest2?.extra?.expoClient?.hostUri ??
    constants.manifest2?.extra?.expoGo?.debuggerHost ??
    constants.manifest?.debuggerHost ??
    null
  );
}
