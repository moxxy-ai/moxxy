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
  readonly restoreTransport: false;
}

export function planPairingStartup(input: PairingStartupInput): PairingStartupPlan {
  return {
    gatewayUrl: chooseGatewayUrlForPairing(null, input.expoHostUri),
    clearStoredToken: input.storedToken !== null,
    clearStoredUrl: input.storedUrl !== null,
    restoreTransport: false,
  };
}
