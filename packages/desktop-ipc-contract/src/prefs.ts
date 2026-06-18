// ---------- Desktop preferences (first-run + auth state) -------------------

/** The user's color-scheme choice. `system` follows the OS (the default). */
export type ThemePreference = 'light' | 'dark' | 'system';

export interface DesktopPrefs {
  onboardingComplete: boolean;
  clerkUserId: string | null;
  clerkDisplayName: string | null;
  signedInAt: number | null;
  /** Whether the user enabled the mobile gateway (the WebSocket bridge). The
   *  main process re-starts the bridge on boot when this is true so pairing
   *  survives a restart. Defaults to false (OFF) — exposing the host on the LAN
   *  is always an explicit opt-in. */
  mobileGatewayEnabled: boolean;
  /** Color scheme. The renderer's useTheme() controller maps it to
   *  `data-theme="dark"` on <html>; the main process mirrors it into
   *  `nativeTheme.themeSource` so window chrome / prefers-color-scheme agree.
   *  Defaults to `system`. */
  theme: ThemePreference;
  version: 1;
}
