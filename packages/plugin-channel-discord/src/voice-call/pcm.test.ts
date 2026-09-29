import { describe, expect, it } from 'vitest';
import { decodeUtterance, toPcm16Mono24k } from './pcm.js';

/** The 20 ms Opus silence frame Discord itself sends. */
const SILENCE_FRAME = new Uint8Array([0xf8, 0xff, 0xfe]);

const int16 = (bytes: Uint8Array): number[] =>
  Array.from(new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2));

describe('Discord voice → transcriber audio', () => {
  it('mixes stereo to mono and halves 48 kHz to the 24 kHz the transcribers take', () => {
    const left = new Float32Array([0.5, 0.5, -0.5, -0.5]);
    const right = new Float32Array([0.5, 0.5, 0.5, 0.5]);

    expect(int16(toPcm16Mono24k([left, right], 48_000))).toEqual([16384, 0]);
  });

  it('clips samples beyond full scale instead of wrapping around', () => {
    const loud = new Float32Array([1.5, 1.5, -1.5, -1.5]);

    expect(int16(toPcm16Mono24k([loud], 48_000))).toEqual([32767, -32768]);
  });

  it('decodes a spoken stretch of Discord Opus frames into 16-bit PCM', async () => {
    const oneSecond = Array.from({ length: 50 }, () => SILENCE_FRAME);

    const pcm = await decodeUtterance(oneSecond);

    expect(pcm.byteLength).toBe(24_000 * 2);
    expect(int16(pcm).every((s) => s === 0)).toBe(true);
  });

  it('decodes nothing to nothing', async () => {
    expect((await decodeUtterance([])).byteLength).toBe(0);
  });
});
