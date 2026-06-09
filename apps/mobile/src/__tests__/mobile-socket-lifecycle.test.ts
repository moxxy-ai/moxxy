import { describe, expect, it } from 'vitest';
import { buildConnectionUi, shouldOfferRepair } from '../socketLifecycle';

// The transport (`WsRpcClient`) owns reconnect/backoff, so the lifecycle
// module reduces to status → UI projection. These tests pin the user-facing
// contract per `WsClientStatus`.
describe('mobile socket lifecycle ui', () => {
  it('keeps the chat quiet while the socket is open', () => {
    expect(buildConnectionUi('open')).toMatchObject({
      tone: 'ok',
      showBanner: false,
      canSend: true,
      shouldOfferRepair: false,
    });
  });

  it('shows a pending banner during initial connect and transport-owned reconnects', () => {
    expect(buildConnectionUi('connecting')).toMatchObject({
      label: 'Connecting...',
      tone: 'pending',
      showBanner: true,
      canSend: false,
    });
    expect(buildConnectionUi('reconnecting')).toMatchObject({
      label: 'Reconnecting...',
      tone: 'pending',
      showBanner: true,
      shouldOfferRepair: false,
    });
  });

  it('offers re-pairing only for the terminal disconnect (reconnect budget exhausted)', () => {
    expect(buildConnectionUi('disconnected')).toMatchObject({
      tone: 'error',
      showBanner: true,
      canSend: false,
      shouldOfferRepair: true,
    });
    expect(shouldOfferRepair('disconnected')).toBe(true);
    expect(shouldOfferRepair('reconnecting')).toBe(false);
    expect(shouldOfferRepair('closed')).toBe(false);
  });

  it('treats a deliberate close as quiet, not an error', () => {
    expect(buildConnectionUi('closed')).toMatchObject({
      tone: 'muted',
      showBanner: false,
      canSend: false,
      shouldOfferRepair: false,
    });
  });
});
