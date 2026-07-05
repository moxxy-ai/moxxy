import { describe, expect, it } from 'vitest';
import { encodeWav, WAV_HEADER_BYTES } from './wav.js';

function ascii(bytes: Uint8Array, start: number, len: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + len));
}

describe('encodeWav', () => {
  it('writes a canonical mono PCM16 header (golden)', () => {
    const samples = new Float32Array([0, 1, -1, 0.5]);
    const wav = encodeWav(samples, 8000);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const dataSize = samples.length * 2;

    expect(wav.byteLength).toBe(WAV_HEADER_BYTES + dataSize);
    expect(ascii(wav, 0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + dataSize);
    expect(ascii(wav, 8, 4)).toBe('WAVE');
    expect(ascii(wav, 12, 4)).toBe('fmt ');
    expect(view.getUint32(16, true)).toBe(16); // PCM fmt size
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(8000); // sample rate
    expect(view.getUint32(28, true)).toBe(8000 * 2); // byte rate (mono, 2 bytes)
    expect(view.getUint16(32, true)).toBe(2); // block align
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(ascii(wav, 36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(dataSize);
  });

  it('maps full-scale samples to the int16 range edges', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 0.5]), 8000);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(view.getInt16(WAV_HEADER_BYTES + 0, true)).toBe(0);
    expect(view.getInt16(WAV_HEADER_BYTES + 2, true)).toBe(32767); // +1.0
    expect(view.getInt16(WAV_HEADER_BYTES + 4, true)).toBe(-32768); // -1.0
    expect(view.getInt16(WAV_HEADER_BYTES + 6, true)).toBe(16384); // +0.5
  });

  it('clamps out-of-range samples and encodes NaN as silence', () => {
    const wav = encodeWav(new Float32Array([2, -2, Number.NaN]), 16000);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(view.getInt16(WAV_HEADER_BYTES + 0, true)).toBe(32767);
    expect(view.getInt16(WAV_HEADER_BYTES + 2, true)).toBe(-32768);
    expect(view.getInt16(WAV_HEADER_BYTES + 4, true)).toBe(0);
  });

  it('encodes an empty sample array to a bare 44-byte header', () => {
    const wav = encodeWav(new Float32Array([]), 22050);
    expect(wav.byteLength).toBe(WAV_HEADER_BYTES);
  });

  it('rejects an invalid sample rate', () => {
    expect(() => encodeWav(new Float32Array([0]), 0)).toThrow();
    expect(() => encodeWav(new Float32Array([0]), Number.NaN)).toThrow();
  });
});
