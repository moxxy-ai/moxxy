import type { MobileState } from '../protocol';

/** Identity hook kept for facade parity with the reference app — the snapshot
 *  is already assembled by the provider via `buildMobileState`. */
export function useGatewaySnapshot(state: MobileState): MobileState {
  return state;
}
