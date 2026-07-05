import { describe, expect, it } from 'vitest';

import {
  downmixToMono,
  isRiffWave,
  parseWav,
  pcm16ToFloat32,
  resampleLinear,
} from './audio.js';

/** Build a canonical PCM16 WAV buffer from interleaved int16 samples. */
function buildWav(
  int16: number[],
  opts: { channels?: number; sampleRate?: number; audioFormat?: number; bitsPerSample?: number } = {},
): Uint8Array {
  const channels = opts.channels ?? 1;
  const sampleRate = opts.sampleRate ?? 16_000;
  const audioFormat = opts.audioFormat ?? 1;
  const bitsPerSample = opts.bitsPerSample ?? 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataSize = int16.length * bytesPerSample;
  const buf = new Uint8Array(44 + dataSize);
  const view = new DataView(buf.buffer);
  const ascii = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i += 1) buf[o + i] = s.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, audioFormat, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, bitsPerSample, true);
  ascii(36, 'data');
  view.setUint32(40, dataSize, true);
  let off = 44;
  for (const s of int16) {
    if (bitsPerSample === 16) view.setInt16(off, s, true);
    else view.setUint8(off, s & 0xff);
    off += bytesPerSample;
  }
  return buf;
}

describe('pcm16ToFloat32', () => {
  it('maps int16 range edges to ~[-1, 1) and 0 to 0', () => {
    const bytes = new Uint8Array(6);
    const v = new DataView(bytes.buffer);
    v.setInt16(0, 0, true);
    v.setInt16(2, 32767, true);
    v.setInt16(4, -32768, true);
    const f = pcm16ToFloat32(bytes);
    expect(f[0]).toBe(0);
    expect(f[1]).toBeCloseTo(0.99997, 4);
    expect(f[2]).toBe(-1); // -32768 / 32768
  });

  it('drops a trailing odd byte instead of misreading it', () => {
    const bytes = new Uint8Array([0, 0, 0, 0, 7]); // 2 samples + 1 stray byte
    expect(pcm16ToFloat32(bytes)).toHaveLength(2);
  });

  it('works on a non-2-aligned subarray view', () => {
    const backing = new Uint8Array(5);
    const v = new DataView(backing.buffer);
    v.setInt16(1, 16384, true); // write at offset 1 (odd)
    const f = pcm16ToFloat32(backing.subarray(1, 3));
    expect(f[0]).toBeCloseTo(0.5, 5);
  });
});

describe('downmixToMono', () => {
  it('averages stereo frames', () => {
    // interleaved L,R,L,R → [(1+3)/2, (0.5-0.5)/2]
    const stereo = Float32Array.from([1, 3, 0.5, -0.5]);
    const mono = downmixToMono(stereo, 2);
    expect(Array.from(mono)).toEqual([2, 0]);
  });

  it('returns the input unchanged for mono', () => {
    const mono = Float32Array.from([0.1, 0.2]);
    expect(downmixToMono(mono, 1)).toBe(mono);
  });

  it('ignores a trailing partial frame', () => {
    const stereo = Float32Array.from([1, 1, 2]); // 1.5 frames
    expect(downmixToMono(stereo, 2)).toHaveLength(1);
  });
});

describe('resampleLinear', () => {
  it('returns the input unchanged when rates match', () => {
    const x = Float32Array.from([0.1, 0.2, 0.3]);
    expect(resampleLinear(x, 16_000, 16_000)).toBe(x);
  });

  it('preserves a DC (constant) signal', () => {
    const x = new Float32Array(240).fill(0.42);
    const y = resampleLinear(x, 24_000, 16_000);
    expect(y.length).toBe(160);
    for (const s of y) expect(s).toBeCloseTo(0.42, 6);
  });

  it('changes length by the rate ratio (24k → 16k ≈ 2/3)', () => {
    const y = resampleLinear(new Float32Array(300), 24_000, 16_000);
    expect(y.length).toBe(200);
    const up = resampleLinear(new Float32Array(160), 16_000, 24_000);
    expect(up.length).toBe(240);
  });

  it('tracks a sine wave in continuous time after resampling 24k → 16k', () => {
    const fromRate = 24_000;
    const toRate = 16_000;
    const freq = 220; // Hz — well below Nyquist at both rates
    const n = 2400; // 0.1 s
    const src = new Float32Array(n);
    for (let i = 0; i < n; i += 1) src[i] = Math.sin((2 * Math.PI * freq * i) / fromRate);
    const out = resampleLinear(src, fromRate, toRate);
    // Each output sample should approximate the same continuous sine sampled at
    // the target rate (linear interpolation error is tiny for 220 Hz).
    for (let i = 0; i < out.length - 1; i += 1) {
      const expected = Math.sin((2 * Math.PI * freq * i) / toRate);
      expect(out[i]).toBeCloseTo(expected, 2);
    }
  });
});

describe('isRiffWave', () => {
  it('detects RIFF/WAVE magic', () => {
    expect(isRiffWave(buildWav([0, 0]))).toBe(true);
    expect(isRiffWave(new Uint8Array([1, 2, 3, 4]))).toBe(false);
    expect(isRiffWave(new Uint8Array(0))).toBe(false);
  });
});

describe('parseWav', () => {
  it('parses a mono PCM16 file', () => {
    const wav = buildWav([0, 16384, -16384], { channels: 1, sampleRate: 16_000 });
    const parsed = parseWav(wav);
    expect(parsed.channels).toBe(1);
    expect(parsed.sampleRate).toBe(16_000);
    expect(parsed.samples[1]).toBeCloseTo(0.5, 4);
    expect(parsed.samples[2]).toBeCloseTo(-0.5, 4);
  });

  it('parses a stereo PCM16 file (interleaved, still needs downmix)', () => {
    const wav = buildWav([1000, 2000, 3000, 4000], { channels: 2, sampleRate: 8_000 });
    const parsed = parseWav(wav);
    expect(parsed.channels).toBe(2);
    expect(parsed.samples).toHaveLength(4);
    expect(Array.from(downmixToMono(parsed.samples, parsed.channels))).toHaveLength(2);
  });

  it('rejects IEEE-float WAV politely', () => {
    const wav = buildWav([0, 0], { audioFormat: 3, bitsPerSample: 32 });
    expect(() => parseWav(wav)).toThrow(/IEEE float/);
  });

  it('rejects 8-bit PCM WAV', () => {
    const wav = buildWav([0, 0], { audioFormat: 1, bitsPerSample: 8 });
    expect(() => parseWav(wav)).toThrow(/8-bit PCM/);
  });

  it('throws CONFIG_INVALID for a non-RIFF buffer', () => {
    expect(() => parseWav(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toThrow(
      /not a RIFF/,
    );
    try {
      parseWav(new Uint8Array(12));
    } catch (err) {
      expect((err as { code?: string }).code).toBe('CONFIG_INVALID');
    }
  });

  it('tolerates an extra chunk before data and a padded odd-size chunk', () => {
    // Hand-build: RIFF WAVE | fmt(16) | LIST(3, padded to 4) | data(4)
    const parts: number[] = [];
    const push32 = (n: number): void => {
      parts.push(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff);
    };
    const pushStr = (s: string): void => {
      for (const c of s) parts.push(c.charCodeAt(0));
    };
    // placeholder RIFF size filled later
    pushStr('RIFF');
    push32(0);
    pushStr('WAVE');
    pushStr('fmt ');
    push32(16);
    parts.push(1, 0); // PCM
    parts.push(1, 0); // mono
    push32(16_000);
    push32(16_000 * 2);
    parts.push(2, 0); // block align
    parts.push(16, 0); // bits
    pushStr('LIST');
    push32(3); // odd size
    parts.push(9, 9, 9, 0); // 3 bytes + 1 pad
    pushStr('data');
    push32(4);
    parts.push(0, 0, 0, 64); // two int16 samples: 0, 16384
    const bytes = new Uint8Array(parts);
    new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
    const parsed = parseWav(bytes);
    expect(parsed.sampleRate).toBe(16_000);
    expect(parsed.samples).toHaveLength(2);
    expect(parsed.samples[1]).toBeCloseTo(0.5, 4);
  });
});
