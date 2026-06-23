import { chooseGatewayUrlForPairing } from './pairingUrl';

export interface PairingStartupInput {
  readonly storedToken: string | null;
  readonly storedUrl: string | null;
  readonly expoHostUri?: string | null;
}

export interface PairingStartupPlan {
  readonly gatewayUrl: string;
  readonly clearStoredToken: boolean;
  readonly clearStoredUrl: boolean;
  readonly restoreTransport: boolean;
}

/**
 * On launch, remember a previously paired gateway: when both a token and URL
 * were stored, restore the transport (reconnect) instead of forcing a re-scan.
 * A tokenless stored URL is incomplete — surface it as the manual default but
 * drop it from storage.
 */
export function planPairingStartup(input: PairingStartupInput): PairingStartupPlan {
  const storedUrl = typeof input.storedUrl === 'string' ? input.storedUrl.trim() : '';
  const hasUrl = storedUrl.length > 0;
  const hasToken = input.storedToken !== null && input.storedToken !== '';
  return {
    gatewayUrl: hasUrl ? storedUrl : chooseGatewayUrlForPairing(null, input.expoHostUri),
    clearStoredToken: false,
    clearStoredUrl: hasUrl && !hasToken,
    restoreTransport: hasToken && hasUrl,
  };
}
