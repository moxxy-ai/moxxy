import { describe, expect, it } from 'vitest';
import { pcm16Peak, uint8ArrayToBase64 } from './pcm16.js';

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

describe('uint8ArrayToBase64', () => {
  /** Decode a base64 string back to bytes, independent of the encoder. */
  function fromBase64(b64: string): Uint8Array {
    return Uint8Array.from(Buffer.from(b64, 'base64'));
  }

  it('encodes an empty buffer to an empty string', () => {
    expect(uint8ArrayToBase64(new Uint8Array(0))).toBe('');
  });

  it('round-trips a small buffer byte-for-byte', () => {
    const bytes = new Uint8Array([0, 1, 2, 254, 255, 128, 127]);
    expect(fromBase64(uint8ArrayToBase64(bytes))).toEqual(bytes);
  });

  it('round-trips a buffer larger than one 0x8000 chunk (exercises the partial trailing chunk)', () => {
    // 0x8001 bytes => one full CHUNK + a 1-byte final chunk, the slicing edge
    // the chunker exists to get right.
    const n = 0x8000 + 1;
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) bytes[i] = (i * 31 + 7) & 0xff;
    expect(fromBase64(uint8ArrayToBase64(bytes))).toEqual(bytes);
  });

  it('round-trips an exact multiple of the chunk size (no trailing partial chunk)', () => {
    const n = 0x8000 * 2;
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) bytes[i] = (i * 13) & 0xff;
    expect(fromBase64(uint8ArrayToBase64(bytes))).toEqual(bytes);
  });

  it('encodes a subarray view honoring byteOffset/byteLength', () => {
    const backing = new Uint8Array([9, 9, 1, 2, 3, 9, 9]);
    const view = backing.subarray(2, 5); // [1,2,3]
    expect(fromBase64(uint8ArrayToBase64(view))).toEqual(new Uint8Array([1, 2, 3]));
  });
});
