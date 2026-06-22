import Constants from 'expo-constants';
import { useCallback, useEffect, useRef, useState } from 'react';
import { splitConnectUrl, type WsClientStatus } from '@moxxy/client-transport-ws';
import { parsePairingQrPayload } from '../pairingQr';
import { createPairingOpenWaiter } from '../pairingOpenWaiter';
import {
  openBridgePairingTransport,
  resolveBridgePairingTarget,
  type BridgePairingTransportHandle,
} from '../pairingRuntime';
import { planPairingStartup } from '../pairingStartup';
import { chooseGatewayUrlForPairing } from '../pairingUrl';
import { GATEWAY_CONNECTION_FAILED_MESSAGE } from '../qrScannerFeedback';
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
  const [gatewayUrl, setGatewayUrlState] = useState(chooseGatewayUrlForPairing(null, expoHostUri));
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [transportReady, setTransportReady] = useState(false);
  const transportHandleRef = useRef<BridgePairingTransportHandle | null>(null);
  const startupHandledRef = useRef(false);

  const configureBridgeTransport = useCallback((
    rawUrl: string,
    pairingToken?: string | null,
    onTargetStatus?: (status: WsClientStatus) => void,
  ) => {
    try {
      const target = resolveBridgePairingTarget(rawUrl, pairingToken);
      const current = transportHandleRef.current;
      if (current?.url === target.url && current.token === target.token) {
        if (current.status() === 'open') {
          setTransportReady(true);
          setError(null);
          onTargetStatus?.('open');
          return current;
        }
        transportHandleRef.current = null;
        current.close();
      }

      transportHandleRef.current = null;
      current?.close();
      setTransportReady(false);
      let nextHandle: BridgePairingTransportHandle | null = null;
      const handle = openBridgePairingTransport(target.url, target.token, undefined, (status) => {
        if (transportHandleRef.current !== nextHandle) return;
        onTargetStatus?.(status);
        const open = status === 'open';
        setTransportReady(open);
        if (open) {
          setError(null);
        } else if (status === 'disconnected') {
          setError('Mobile bridge disconnected. Re-pair this device to continue.');
        }
      });
      nextHandle = handle;
      transportHandleRef.current = handle;
      return handle;
    } catch (err) {
      setTransportReady(false);
      setError(err instanceof Error ? err.message : 'Cannot configure Moxxy mobile bridge.');
      return null;
    }
  }, []);

  useEffect(() => {
    if (tokenLoading || urlLoading || startupHandledRef.current) return;
    startupHandledRef.current = true;
    const startup = planPairingStartup({
      storedToken: token,
      storedUrl,
      expoHostUri,
    });

    transportHandleRef.current?.close();
    transportHandleRef.current = null;
    setCode('');
    setError(null);
    setTransportReady(false);
    setGatewayUrlState(startup.gatewayUrl);
    if (startup.clearStoredToken) setToken(null);
    if (startup.clearStoredUrl) setStoredUrl(null);
  }, [expoHostUri, setStoredUrl, setToken, storedUrl, token, tokenLoading, urlLoading]);

  useEffect(() => () => {
    transportHandleRef.current?.close();
    transportHandleRef.current = null;
  }, []);

  useEffect(() => {
    if (urlLoading || startupHandledRef.current) return;
    setGatewayUrlState(chooseGatewayUrlForPairing(null, expoHostUri));
  }, [expoHostUri, urlLoading]);

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

  const pairWithCode = useCallback(async (
    targetUrl: string,
    pairingCode: string,
    options: { readonly awaitOpen?: boolean } = {},
  ): Promise<boolean> => {
    setError(null);
    const openWaiter = options.awaitOpen ? createPairingOpenWaiter() : null;
    const handle = configureBridgeTransport(targetUrl, pairingCode, openWaiter?.onStatus);
    if (!handle) {
      openWaiter?.cancel();
      return false;
    }

    if (openWaiter) {
      if (handle.status() === 'open') openWaiter.onStatus('open');
      try {
        await openWaiter.wait;
      } catch {
        if (transportHandleRef.current === handle) {
          transportHandleRef.current = null;
          setTransportReady(false);
        }
        handle.close();
        setError(GATEWAY_CONNECTION_FAILED_MESSAGE);
        return false;
      } finally {
        openWaiter.cancel();
      }
    }

    setToken(handle.token);
    setStoredUrl(handle.url);
    setGatewayUrlState(handle.url);
    setCode('');
    return true;
  }, [configureBridgeTransport, setStoredUrl, setToken]);

  const pair = useCallback(async () => {
    await pairWithCode(gatewayUrl, code);
  }, [code, gatewayUrl, pairWithCode]);

  const pairFromQrPayload = useCallback(async (raw: string) => {
    setError(null);
    try {
      const target = parsePairingQrPayload(raw);
      setGatewayUrlState(target.gatewayUrl);
      setCode(target.code);
      const paired = await pairWithCode(target.gatewayUrl, target.code, { awaitOpen: true });
      if (!paired) throw new Error(GATEWAY_CONNECTION_FAILED_MESSAGE);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid Moxxy pairing QR code';
      setError(message);
      throw err instanceof Error ? err : new Error(message);
    }
  }, [pairWithCode]);

  const disconnect = useCallback(() => {
    transportHandleRef.current?.close();
    transportHandleRef.current = null;
    setToken(null);
    setStoredUrl(null);
    setCode('');
    setTransportReady(false);
    setGatewayUrlState(chooseGatewayUrlForPairing(null, expoHostUri));
  }, [expoHostUri, setStoredUrl, setToken]);

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
