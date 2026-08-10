import { buildVoiceOrbit, type VoiceOrbitItem, type VoiceOrbitState } from './voice-orbit';

/**
 * What the Voice Presence rail shows about work in flight.
 *
 * The rail is one line inside the ordinary chat surface, not a stage, so it has
 * room for exactly ONE operation. Which one matters: it is the oldest still
 * running, held in place while newer tools come and go, because a label that
 * swaps every few hundred milliseconds tells a person nothing. The rest are a
 * count, and the full record stays where it belongs — in the transcript.
 */
export interface VoiceRailView {
  /** The one operation on screen, or `null` when nothing is running. */
  readonly operation: VoiceOrbitItem | null;
  /** How many further operations are running behind it. */
  readonly overflowCount: number;
  /** When the visible operation's success/failure dwell expires, if ever. */
  readonly nextExpiry: number | null;
}

export function buildVoiceRail(state: VoiceOrbitState, now: number): VoiceRailView {
  const orbit = buildVoiceOrbit(state, now);
  const operation = orbit.items[0] ?? null;
  return Object.freeze({
    operation,
    // Anything the orbit could not seat, plus the ones it seated behind the
    // first — the rail seats only one.
    overflowCount: orbit.overflowCount + Math.max(0, orbit.items.length - 1),
    nextExpiry: orbit.nextExpiry,
  });
}
