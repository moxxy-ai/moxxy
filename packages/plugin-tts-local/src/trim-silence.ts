/**
 * Supertonic pads every sentence with about half a second of silence on each
 * side. Read aloud plays one clip per sentence, so the padding adds up to more
 * than a second of dead air between sentences. This cuts the padding down to a
 * short margin and leaves every pause inside the sentence alone.
 */

/** Louder than the model's silence (at most ~0.0003) and quieter than the start
 *  of a breath or an "s" (~0.001 and up). */
const SILENCE_LEVEL = 0.002;
/** Kept before the first sound, so a soft onset is never clipped. */
export const SILENCE_KEPT_BEFORE_MS = 30;
/** Kept after the last sound, so a fading word ends naturally. */
export const SILENCE_KEPT_AFTER_MS = 100;

export function trimSilence(samples: Float32Array, sampleRate: number): Float32Array {
  let first = 0;
  while (first < samples.length && Math.abs(samples[first] ?? 0) < SILENCE_LEVEL) first += 1;
  if (first === samples.length) return samples;
  let last = samples.length - 1;
  while (last > first && Math.abs(samples[last] ?? 0) < SILENCE_LEVEL) last -= 1;

  const start = Math.max(0, first - Math.round((SILENCE_KEPT_BEFORE_MS * sampleRate) / 1000));
  const end = Math.min(samples.length, last + 1 + Math.round((SILENCE_KEPT_AFTER_MS * sampleRate) / 1000));
  return start === 0 && end === samples.length ? samples : samples.subarray(start, end);
}
