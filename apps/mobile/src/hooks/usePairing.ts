/**
 * Pairing state for the WebSocket bridge.
 *
 * Wave-5 semantics: `moxxy mobile` prints ONE QR — a `ws://host:port/?t=TOKEN`
 * URL. Scanning (or pasting) it splits the token out (`parsePairingQrPayload`
 * / `splitConnectUrl`); the bare URL + token persist in secure storage and the
 * token is later presented as the `Sec-WebSocket-Protocol` bearer entry, never
 * on the live WS URL.
 *
 * The facade keeps the reference's `PairingState` shape so the settings UI
 * binds unchanged — with adjusted semantics where the old gateway differed:
 *   - manual pairing = paste the printed connect URL (token included as `?t=`)
 *     into the gateway-URL field; the embedded token surfaces as `code` and
 *     `pair()` adopts it. No server round-trip.
 *   - `loadPairing()` only clears a stale error — the WS bridge has no
 *     pairing-code endpoint; the code is derived locally from the typed URL.
 */

import Constants from 'expo-constants';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { splitConnectUrl } from '../boot';
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
  const [gatewayUrl, setGatewayUrlState] = useState(
    chooseGatewayUrlForPairing(storedUrl, expoHostUri),
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!urlLoading) setGatewayUrlState(chooseGatewayUrlForPairing(storedUrl, expoHostUri));
  }, [expoHostUri, storedUrl, urlLoading]);

  // The token embedded in whatever the user typed/pasted — surfaced as the
  // pairing "code" so the manual flow reads: paste printed URL → Pair.
  const code = useMemo(() => splitConnectUrl(gatewayUrl.trim()).token ?? '', [gatewayUrl]);

  const setGatewayUrl = useCallback(
    (value: string) => {
      setGatewayUrlState(value);
      setStoredUrl(normalizeGatewayUrl(value));
    },
    [setStoredUrl],
  );

  // No pairing-code endpoint on the WS bridge — the affordance only clears a
  // stale error (the code is derived locally from the typed URL).
  const loadPairing = useCallback(async () => {
    setError(null);
  }, []);

  const adopt = useCallback(
    (url: string, nextToken: string) => {
      const normalized = normalizeGatewayUrl(url);
      setGatewayUrlState(normalized);
      setStoredUrl(normalized);
      setToken(nextToken);
      setError(null);
    },
    [setStoredUrl, setToken],
  );

  const pair = useCallback(async () => {
    if (!code) {
      setError('Paste the full connect URL `moxxy mobile` prints (it carries the token as ?t=).');
      return;
    }
    adopt(gatewayUrl, code);
  }, [adopt, code, gatewayUrl]);

  const pairFromQrPayload = useCallback(
    async (raw: string) => {
      setError(null);
      try {
        const target = parsePairingQrPayload(raw);
        if (!target.token) {
          setError('This QR has no token — scan the one `moxxy mobile` prints.');
          return;
        }
        adopt(target.gatewayUrl, target.token);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Invalid Moxxy pairing QR code');
      }
    },
    [adopt],
  );

  const disconnect = useCallback(() => {
    setToken(null);
  }, [setToken]);

  return {
    gatewayUrl,
    token,
    code,
    loading: tokenLoading || urlLoading,
    error,
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
    manifest2?: {
      extra?: { expoClient?: { hostUri?: string | null }; expoGo?: { debuggerHost?: string | null } };
    };
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
