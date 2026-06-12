export type CameraPermissionState = 'loading' | 'granted' | 'denied' | 'undetermined';

export interface PairingUiInput {
  readonly token: string | null;
  readonly transportReady?: boolean;
  readonly scanning: boolean;
  readonly permission: CameraPermissionState;
}

export interface PairingUiState {
  readonly statusLabel: 'Paired' | 'Not paired';
  readonly scanButtonLabel: 'Scan QR code' | 'Scanning...' | 'Camera blocked';
  readonly scanButtonEnabled: boolean;
  readonly manualPairingVisible: boolean;
  readonly manualPairingToggleLabel: 'Manual pairing';
  readonly scannerTitle: 'Scan Moxxy QR';
  readonly scannerHint: string;
}

export function buildPairingUiState(input: PairingUiInput): PairingUiState {
  const paired = Boolean(input.token) && input.transportReady !== false;
  const permissionDenied = input.permission === 'denied';
  return {
    statusLabel: paired ? 'Paired' : 'Not paired',
    scanButtonLabel: permissionDenied ? 'Camera blocked' : input.scanning ? 'Scanning...' : 'Scan QR code',
    scanButtonEnabled: !permissionDenied,
    manualPairingVisible: false,
    manualPairingToggleLabel: 'Manual pairing',
    scannerTitle: 'Scan Moxxy QR',
    scannerHint: permissionDenied
      ? 'Camera permission is required to scan the Moxxy pairing QR code.'
      : 'Point your camera at the gateway QR, then tap Scan QR code.',
  };
}
