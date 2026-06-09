/**
 * Connection-status UI helpers.
 *
 * REDUCED from the reference: its `shouldReconnectAfterClose` guarded a
 * hand-rolled reconnect loop in `useGatewaySocket`. In moxxy the transport
 * itself (`WsRpcClient` in `@moxxy/client-transport-ws`) owns reconnect with
 * exponential backoff and reports a `WsClientStatus`
 * (`connecting | open | reconnecting | disconnected | closed`, where
 * `disconnected` is TERMINAL — the reconnect budget is exhausted and only a
 * re-pair/rebuild recovers). What the UI still needs is purely presentational:
 * map that status to a banner/label/tone and to "should we offer re-pairing".
 */

import type { WsClientStatus } from '@moxxy/client-transport-ws';

export type ConnectionTone = 'ok' | 'pending' | 'error' | 'muted';

export interface ConnectionUiState {
  readonly label: string;
  readonly tone: ConnectionTone;
  /** Show the persistent connection banner over the chat. */
  readonly showBanner: boolean;
  /** Requests may be issued (the socket is live). */
  readonly canSend: boolean;
  /** Terminal failure — surface the "scan QR / re-pair" affordance. */
  readonly shouldOfferRepair: boolean;
}

export function buildConnectionUi(status: WsClientStatus): ConnectionUiState {
  switch (status) {
    case 'open':
      return { label: 'Connected', tone: 'ok', showBanner: false, canSend: true, shouldOfferRepair: false };
    case 'connecting':
      return { label: 'Connecting...', tone: 'pending', showBanner: true, canSend: false, shouldOfferRepair: false };
    case 'reconnecting':
      return { label: 'Reconnecting...', tone: 'pending', showBanner: true, canSend: false, shouldOfferRepair: false };
    case 'disconnected':
      return {
        label: 'Connection lost - re-pair with the desktop QR to reconnect.',
        tone: 'error',
        showBanner: true,
        canSend: false,
        shouldOfferRepair: true,
      };
    case 'closed':
      return { label: 'Disconnected', tone: 'muted', showBanner: false, canSend: false, shouldOfferRepair: false };
  }
}

/** Terminal transport failure — the only state a manual re-pair fixes. */
export function shouldOfferRepair(status: WsClientStatus): boolean {
  return status === 'disconnected';
}
