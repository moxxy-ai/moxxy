/**
 * The sound of an answer arriving in a chat that is not on screen: two soft
 * notes a fifth apart, the second a moment after the first. It is made here
 * instead of shipped as a file, so it has no asset to load and no licence.
 */
export const REPLY_CHIME = Object.freeze({
  notes: Object.freeze([
    { frequency: 880, at: 0 },
    { frequency: 1318.51, at: 0.11 },
  ]),
  /** Loudest point of a note, of a full-scale 1. */
  peak: 0.12,
  attackSeconds: 0.008,
  decaySeconds: 0.42,
});

/** A ramp to silence cannot end on zero; this is as good as. */
const SILENT = 0.0001;

/** Puts the chime on `context`'s clock, starting now. */
export function scheduleReplyChime(context: AudioContext): void {
  const { notes, peak, attackSeconds, decaySeconds } = REPLY_CHIME;
  for (const note of notes) {
    const start = context.currentTime + note.at;
    const end = start + attackSeconds + decaySeconds;
    const gain = context.createGain();
    gain.gain.setValueAtTime(SILENT, start);
    gain.gain.linearRampToValueAtTime(peak, start + attackSeconds);
    gain.gain.exponentialRampToValueAtTime(SILENT, end);
    gain.connect(context.destination);
    const tone = context.createOscillator();
    tone.type = 'sine';
    tone.frequency.setValueAtTime(note.frequency, start);
    tone.connect(gain);
    tone.start(start);
    tone.stop(end + 0.02);
  }
}

let shared: AudioContext | null = null;

/** Rings the chime on the window's speaker; does nothing where there is none. */
export function ringReplyChime(): void {
  if (typeof AudioContext === 'undefined') return;
  shared ??= new AudioContext();
  // A window that has not been touched yet starts suspended.
  if (shared.state === 'suspended') void shared.resume().catch(() => undefined);
  scheduleReplyChime(shared);
}
