import { useHotkey, useHotkeyDispatcher } from '../hotkeys/useHotkeys';
import type { HotkeyBinding } from '../hotkeys/registry';
import { voiceMicrophonePulse } from '@/lib/chatPulses';

/** What the shortcut needs of a Voice Mode call. */
export type VoiceMicrophoneControl = {
  readonly active: boolean;
  readonly microphoneMuted: boolean;
  readonly muteMicrophone: () => void;
  readonly unmuteMicrophone: () => void;
};

/**
 * ⌘D on macOS, Ctrl+D on Windows and Linux. Not ⌘M: macOS minimizes the
 * window with it, and ⌘⇧M is Focus Mode. Listed in the shortcuts sheet by the
 * main window's keymap.
 */
export const VOICE_MICROPHONE_HOTKEY = {
  id: 'voice.microphone',
  chord: 'mod+d',
  label: 'Mute or unmute the microphone',
  group: 'Voice',
} as const satisfies Omit<HotkeyBinding, 'run'>;

/** The same switch as the rail's microphone button; nothing to switch outside a call. */
function toggleMicrophone(call: VoiceMicrophoneControl): void {
  if (!call.active) return;
  if (call.microphoneMuted) call.unmuteMicrophone();
  else call.muteMicrophone();
}

/** Main window: the shell's keymap fires the pulse, the chat surface owning the call answers it. */
export function useVoiceMicrophonePulse(call: VoiceMicrophoneControl): void {
  voiceMicrophonePulse.use(() => toggleMicrophone(call));
}

/** Focus Mode window: a renderer with no shell keymap of its own, so it listens for the shortcut itself. */
export function useFocusVoiceMicrophoneHotkey(call: VoiceMicrophoneControl): void {
  useHotkeyDispatcher();
  useHotkey({ ...VOICE_MICROPHONE_HOTKEY, disabled: !call.active, run: () => toggleMicrophone(call) });
}
