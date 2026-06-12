import Constants from 'expo-constants';
import { useCallback, useEffect, useRef, useState } from 'react';
import { splitConnectUrl } from '@moxxy/client-transport-ws';
import { parsePairingQrPayload } from '../pairingQr';
import {
  openBridgePairingTransport,
  resolveBridgePairingTarget,
  type BridgePairingTransportHandle,
} from '../pairingRuntime';
import { chooseGatewayUrlForPairing } from '../pairingUrl';
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
  const transportHandleRef = useRef<BridgePairingTransportHandle | null>(null);

  const configureBridgeTransport = useCallback((rawUrl: string, pairingToken?: string | null) => {
    try {
      const target = resolveBridgePairingTarget(rawUrl, pairingToken);
      const current = transportHandleRef.current;
      if (current?.url === target.url && current.token === target.token) {
        setTransportReady(true);
        return target;
      }

      current?.close();
      const handle = openBridgePairingTransport(target.url, target.token);
      transportHandleRef.current = handle;
      setTransportReady(true);
      return target;
    } catch (err) {
      setTransportReady(false);
      setError(err instanceof Error ? err.message : 'Cannot configure Moxxy mobile bridge.');
      return null;
    }
  }, []);

  useEffect(() => {
    if (!tokenLoading && !urlLoading && token && storedUrl) {
      const target = configureBridgeTransport(storedUrl, token);
      if (target) {
        setGatewayUrlState(target.url);
        setStoredUrl(target.url);
      }
    }
  }, [configureBridgeTransport, setStoredUrl, storedUrl, token, tokenLoading, urlLoading]);

  useEffect(() => () => {
    transportHandleRef.current?.close();
    transportHandleRef.current = null;
  }, []);

  useEffect(() => {
    if (!urlLoading) setGatewayUrlState(chooseGatewayUrlForPairing(storedUrl, expoHostUri));
  }, [expoHostUri, storedUrl, urlLoading]);

  const setGatewayUrl = useCallback(
    (value: string) => {
      setGatewayUrlState(value);
    },
    [],
  );

  const loadPairing = useCallback(async () => {
    setError(null);
    try {
      const split = splitConnectUrl(gatewayUrl);
      if (!split.token) {
        setCode('');
        setGatewayUrlState(split.url);
        setError('Paste the full ws:// or wss:// URL printed by moxxy mobile, including ?t=token.');
        return;
      }
      const target = resolveBridgePairingTarget(gatewayUrl);
      setGatewayUrlState(target.url);
      setStoredUrl(target.url);
      setCode(target.token);
      return;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid Moxxy mobile bridge URL.');
    }
  }, [gatewayUrl, setStoredUrl]);

  const pairWithCode = useCallback(async (targetUrl: string, pairingCode: string) => {
    setError(null);
    const target = configureBridgeTransport(targetUrl, pairingCode);
    if (!target) return;
    setToken(target.token);
    setStoredUrl(target.url);
    setGatewayUrlState(target.url);
    setCode('');
  }, [configureBridgeTransport, setStoredUrl, setToken]);

  const pair = useCallback(async () => {
    await pairWithCode(gatewayUrl, code);
  }, [code, gatewayUrl, pairWithCode]);

  const pairFromQrPayload = useCallback(async (raw: string) => {
    setError(null);
    try {
      const target = parsePairingQrPayload(raw);
      setGatewayUrlState(target.gatewayUrl);
      setStoredUrl(target.gatewayUrl);
      setCode(target.code);
      await pairWithCode(target.gatewayUrl, target.code);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid Moxxy pairing QR code');
    }
  }, [pairWithCode, setStoredUrl]);

  const disconnect = useCallback(() => {
    transportHandleRef.current?.close();
    transportHandleRef.current = null;
    setToken(null);
    setCode('');
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
