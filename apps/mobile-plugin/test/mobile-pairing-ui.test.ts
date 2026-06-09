import { describe, expect, it } from 'vitest';
import { buildPairingUiState } from '../mobile/src/pairingUi';

describe('mobile pairing UI model', () => {
  it('shows QR scanning as the primary action and keeps manual pairing collapsed', () => {
    expect(buildPairingUiState({ token: null, scanning: false, permission: 'granted' })).toEqual({
      statusLabel: 'Not paired',
      scanButtonLabel: 'Scan QR code',
      scanButtonEnabled: true,
      manualPairingVisible: false,
      manualPairingToggleLabel: 'Manual pairing',
      scannerTitle: 'Scan Moxxy QR',
      scannerHint: 'Point your camera at the gateway QR, then tap Scan QR code.',
    });
  });

  it('shows camera permission and paired states for the scanner sheet', () => {
    expect(buildPairingUiState({ token: null, scanning: true, permission: 'denied' })).toMatchObject({
      scanButtonLabel: 'Camera blocked',
      scanButtonEnabled: false,
      manualPairingVisible: false,
      scannerHint: 'Camera permission is required to scan the Moxxy pairing QR code.',
    });

    expect(buildPairingUiState({ token: 'mg_token', scanning: false, permission: 'granted' })).toMatchObject({
      statusLabel: 'Paired',
      scanButtonLabel: 'Scan QR code',
      scanButtonEnabled: true,
    });
  });
});
