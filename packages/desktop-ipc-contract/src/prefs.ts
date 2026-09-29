// ---------- Desktop preferences (first-run + auth state) -------------------

/** The user's color-scheme choice. `system` follows the OS (the default). */
export type ThemePreference = 'light' | 'dark' | 'system';

/** Which engine Voice Mode talks through. `local` is the transcribe → agent →
 *  Local Piper loop; `gpt-live` is a full-duplex GPT-Live call over the
 *  existing ChatGPT OAuth login. */
export type VoiceEnginePreference = 'local' | 'gpt-live';

export interface FocusMiniTextSize {
  width: number;
  height: number;
}

export interface DesktopPrefs {
  onboardingComplete: boolean;
  clerkUserId: string | null;
  clerkDisplayName: string | null;
  signedInAt: number | null;
  /** Whether the user last had the mobile gateway (the WebSocket bridge) on.
   *  Recorded when the gateway is toggled, but NOT acted on at boot: the gateway
   *  is on-demand only and never auto-starts with the app (exposing the host on
   *  the network is always an explicit, per-session opt-in from the Mobile view).
   *  Kept for diagnostics / a possible future "remember" option. Defaults to
   *  false (OFF). */
  mobileGatewayEnabled: boolean;
  /** Color scheme. The renderer's useTheme() controller maps it to
   *  `data-theme="dark"` on <html>; the main process mirrors it into
   *  `nativeTheme.themeSource` so window chrome / prefers-color-scheme agree.
   *  Defaults to `system`. */
  theme: ThemePreference;
  /** Voice Mode engine. Defaults to `local`. */
  voiceEngine: VoiceEnginePreference;
  /** Last native size chosen for the Focus Mode mini text composer.
   *  Null means the renderer should use its built-in default. */
  focusMiniTextSize: FocusMiniTextSize | null;
  version: 1;
}
