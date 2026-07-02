export const MOBILE_QR_SCAN_ROUTE = '/settings?scan=1' as const;

export interface WaitingRoomPairingDeps {
  readonly closeMenu: () => void;
  readonly dismissKeyboard: () => void;
  readonly navigateToScanner: (route: typeof MOBILE_QR_SCAN_ROUTE) => void;
}

export interface ManualPairingDeps {
  readonly rawLink: string;
  readonly dismissKeyboard: () => void;
  readonly pairFromQrPayload: (raw: string) => Promise<unknown>;
}

export function openWaitingRoomPairing({
  closeMenu,
  dismissKeyboard,
  navigateToScanner,
}: WaitingRoomPairingDeps): void {
  dismissKeyboard();
  closeMenu();
  navigateToScanner(MOBILE_QR_SCAN_ROUTE);
}

export async function submitManualPairingLink({
  rawLink,
  dismissKeyboard,
  pairFromQrPayload,
}: ManualPairingDeps): Promise<void> {
  const value = rawLink.trim();
  if (!value) return;
  dismissKeyboard();
  await pairFromQrPayload(value);
}
