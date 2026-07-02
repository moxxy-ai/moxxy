import { describe, expect, it, vi } from 'vitest';
import { parsePairingQrPayload } from '../src/pairingQr';
import {
  MOBILE_QR_SCAN_ROUTE,
  openWaitingRoomPairing,
  submitManualPairingLink,
} from '../src/pairingFlow';
import {
  describeQrScannerError,
  GATEWAY_CONNECTION_FAILED_MESSAGE,
  GATEWAY_CONNECTION_FAILED_TITLE,
  INVALID_MOXXY_QR_MESSAGE,
  INVALID_MOXXY_QR_TITLE,
} from '../src/qrScannerFeedback';
import { createPairingOpenWaiter } from '../src/pairingOpenWaiter';

describe('mobile QR pairing flow', () => {
  it('opens the scanner route from the waiting room without probing any gateway first', () => {
    const dismissKeyboard = vi.fn();
    const closeMenu = vi.fn();
    const navigateToScanner = vi.fn();
    const forbiddenProbe = vi.fn();

    openWaitingRoomPairing({
      closeMenu,
      dismissKeyboard,
      navigateToScanner,
    });

    expect(dismissKeyboard).toHaveBeenCalledOnce();
    expect(closeMenu).toHaveBeenCalledOnce();
    expect(navigateToScanner).toHaveBeenCalledWith(MOBILE_QR_SCAN_ROUTE);
    expect(forbiddenProbe).not.toHaveBeenCalled();
  });

  it('does not let a stale saved gateway URL decide the target for a newly scanned QR', () => {
    const staleUrl = 'ws://192.168.0.10:8765';
    const scanned = parsePairingQrPayload('wss://fresh.example.test/mobile?t=fresh-token');

    expect(staleUrl).not.toBe(scanned.gatewayUrl);
    expect(scanned).toEqual({
      code: 'fresh-token',
      gatewayUrl: 'wss://fresh.example.test/mobile',
    });
  });

  it('pairs directly from a manually pasted gateway URL', async () => {
    const dismissKeyboard = vi.fn();
    const pairFromQrPayload = vi.fn().mockResolvedValue(undefined);
    const rawLink = '  ws://127.0.0.1:8765/?t=manual-token  ';

    await submitManualPairingLink({
      dismissKeyboard,
      pairFromQrPayload,
      rawLink,
    });

    expect(dismissKeyboard).toHaveBeenCalledOnce();
    expect(pairFromQrPayload).toHaveBeenCalledWith('ws://127.0.0.1:8765/?t=manual-token');
  });

  it('rejects non-Moxxy QR content before attempting to pair', () => {
    expect(() => parsePairingQrPayload('https://example.com/not-moxxy')).toThrow('Invalid Moxxy pairing QR code');
    expect(() => parsePairingQrPayload('ws://192.168.0.44:8765')).toThrow('Invalid Moxxy pairing QR code');
  });

  it('maps invalid QR errors to the user-facing invalid QR alert', () => {
    expect(describeQrScannerError(new Error('Invalid Moxxy pairing QR code'))).toEqual({
      message: INVALID_MOXXY_QR_MESSAGE,
      title: INVALID_MOXXY_QR_TITLE,
    });
  });

  it('maps reachable-format but unreachable gateway errors to a connection alert', () => {
    expect(describeQrScannerError(new Error('connect ECONNREFUSED 192.168.0.44:8765'))).toEqual({
      message: GATEWAY_CONNECTION_FAILED_MESSAGE,
      title: GATEWAY_CONNECTION_FAILED_TITLE,
    });
  });

  it('waits for the scanned gateway transport to open before treating pairing as successful', async () => {
    const waiter = createPairingOpenWaiter(50);

    waiter.onStatus('open');

    await expect(waiter.wait).resolves.toBeUndefined();
    waiter.cancel();
  });

  it('fails the scanned gateway pairing when the transport cannot connect', async () => {
    const waiter = createPairingOpenWaiter(50);

    waiter.onStatus('disconnected');

    await expect(waiter.wait).rejects.toThrow(GATEWAY_CONNECTION_FAILED_MESSAGE);
    waiter.cancel();
  });

  it('times out scanned gateway pairing instead of closing the scanner as if it worked', async () => {
    vi.useFakeTimers();
    const waiter = createPairingOpenWaiter(25);
    const result = expect(waiter.wait).rejects.toThrow(GATEWAY_CONNECTION_FAILED_MESSAGE);

    await vi.advanceTimersByTimeAsync(26);

    await result;
    waiter.cancel();
    vi.useRealTimers();
  });
});
