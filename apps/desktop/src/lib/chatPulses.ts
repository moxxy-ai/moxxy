import { createPulse } from './pulse';

/**
 * Shell → chat-surface signals for the keyboard shortcuts whose state belongs
 * to the chat surface rather than to `App`. See {@link createPulse}.
 */

/** ⌘F opens transcript search and focuses its field. */
export const transcriptSearchPulse = createPulse();

/** ⌘. interrupts the running turn. */
export const abortTurnPulse = createPulse();

/** ⌘L puts the caret in the composer. */
export const focusComposerPulse = createPulse();

/** ⌘D mutes or unmutes the microphone of the running Voice Mode call. */
export const voiceMicrophonePulse = createPulse();
