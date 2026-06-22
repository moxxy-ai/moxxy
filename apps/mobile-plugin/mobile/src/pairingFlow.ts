export const MOBILE_QR_SCAN_ROUTE = '/settings?scan=1' as const;

export interface WaitingRoomPairingDeps {
  readonly closeMenu: () => void;
  readonly dismissKeyboard: () => void;
  readonly navigateToScanner: (route: typeof MOBILE_QR_SCAN_ROUTE) => void;
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
