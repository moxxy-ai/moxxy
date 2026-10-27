// ---------- Desktop preferences (first-run + auth state) -------------------

import type { ChannelRunMode } from './channels.js';

/** The user's color-scheme choice. `system` follows the OS (the default). */
export type ThemePreference = 'light' | 'dark' | 'system';

/** Which engine Voice Mode talks through. `local` is the transcribe → agent →
 *  spoken-voice loop (shown as Classic); `gpt-live` is a full-duplex GPT-Live
 *  call on the person's OpenAI API key. */
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
  /** Color scheme. The renderer's useTheme() controller maps it to
   *  `data-theme="dark"` on <html>; the main process mirrors it into
   *  `nativeTheme.themeSource` so window chrome / prefers-color-scheme agree.
   *  Defaults to `system`. */
  theme: ThemePreference;
  /** Voice Mode engine. Defaults to `local`. */
  voiceEngine: VoiceEnginePreference;
  /** Whether a chat the person is not reading rings when it answers or stops
   *  to ask. Defaults to true. */
  replySound: boolean;
  /** Whether such a chat also shows a system notification while the app is in
   *  the background. Defaults to true. */
  systemNotifications: boolean;
  /** Whether Moxxy shows its own toasts in the main window: a chat the person
   *  is not reading, or work it finished in the background. Defaults to true. */
  inAppToasts: boolean;
  /** Last native size chosen for the Focus Mode mini text composer.
   *  Null means the renderer should use its built-in default. */
  focusMiniTextSize: FocusMiniTextSize | null;
  /** How each desktop-runnable channel runs (`channels.setRunMode`); a missing
   *  entry is `manual`. Host-owned — not writable through `prefs.update`,
   *  because changing it installs/removes an OS background service. */
  channelRunModes: Readonly<Record<string, ChannelRunMode>>;
  /** The agent update the person closed the notice of, by connection name
   *  (`codex-agent` → `0.162.1`): it shows again for a newer version. */
  dismissedAgentUpdates: Readonly<Record<string, string>>;
  version: 1;
}
