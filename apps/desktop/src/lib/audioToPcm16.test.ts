import { describe, expect, it } from 'vitest';
import { pcm16Peak } from './audioToPcm16';

/** Build a PCM16 LE byte buffer from signed 16-bit samples. */
function pcm(samples: number[]): Uint8Array {
  const buf = new Int16Array(samples);
  return new Uint8Array(buf.buffer);
}

describe('pcm16Peak', () => {
  it('reports 0 for a fully silent buffer (the mic-access failure case)', () => {
    expect(pcm16Peak(pcm([0, 0, 0, 0]))).toBe(0);
  });

  it('reports near 1 for a full-scale sample', () => {
    expect(pcm16Peak(pcm([0, 32767, -1234]))).toBeCloseTo(1, 2);
  });

  it('stays below the 0.005 silence threshold for dither-level noise', () => {
    // A handful of ±1..±50 samples — what a denied/muted mic effectively yields.
    expect(pcm16Peak(pcm([1, -2, 3, -1, 50, -10]))).toBeLessThan(0.005);
  });

  it('rises above the silence threshold for audible speech-level samples', () => {
    // ~ -30 dBFS — quiet but clearly present speech.
    expect(pcm16Peak(pcm([1000, -1200, 800]))).toBeGreaterThan(0.005);
  });

  it('handles an empty buffer without throwing', () => {
    expect(pcm16Peak(new Uint8Array(0))).toBe(0);
  });
});
