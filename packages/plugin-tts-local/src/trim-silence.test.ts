import { describe, expect, it } from 'vitest';

import { SILENCE_KEPT_AFTER_MS, SILENCE_KEPT_BEFORE_MS, trimSilence } from './trim-silence.js';

const RATE = 1_000; // one sample per millisecond keeps the arithmetic readable

function clip(...parts: Array<[value: number, ms: number]>): Float32Array {
  return Float32Array.from(parts.flatMap(([value, ms]) => Array<number>(ms).fill(value)));
}

describe('trimSilence', () => {
  it('cuts the silence around a sentence down to a short natural margin', () => {
    const samples = clip([0, 500], [0.4, 200], [0, 600]);

    const trimmed = trimSilence(samples, RATE);

    expect(trimmed.length).toBe(SILENCE_KEPT_BEFORE_MS + 200 + SILENCE_KEPT_AFTER_MS);
    expect(trimmed[SILENCE_KEPT_BEFORE_MS]).toBeCloseTo(0.4);
    expect(trimmed[SILENCE_KEPT_BEFORE_MS - 1]).toBe(0);
  });

  it('keeps a quiet onset such as a breath or an "s"', () => {
    const samples = clip([0.0002, 400], [0.004, 50], [0.3, 100], [0.0003, 400]);

    const trimmed = trimSilence(samples, RATE);

    expect(trimmed.length).toBe(SILENCE_KEPT_BEFORE_MS + 50 + 100 + SILENCE_KEPT_AFTER_MS);
    expect(trimmed[SILENCE_KEPT_BEFORE_MS]).toBeCloseTo(0.004);
  });

  it('keeps a pause inside the sentence', () => {
    const samples = clip([0, 300], [0.3, 100], [0, 250], [0.3, 100], [0, 300]);

    expect(trimSilence(samples, RATE).length).toBe(
      SILENCE_KEPT_BEFORE_MS + 100 + 250 + 100 + SILENCE_KEPT_AFTER_MS,
    );
  });

  it('leaves a clip with no silence to cut as it was', () => {
    const samples = clip([0.3, 100]);

    expect(trimSilence(samples, RATE)).toEqual(samples);
  });

  it('leaves an all-silent clip as it was', () => {
    const samples = clip([0, 300]);

    expect(trimSilence(samples, RATE)).toEqual(samples);
  });
});
