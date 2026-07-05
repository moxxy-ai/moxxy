import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';
import type { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { MOXXY_PCM16_24KHZ_MIME } from '@moxxy/sdk';

import { decodeToMono16k } from './decode.js';

/** Minimal fake `spawn`: probe → exit 0, decode → emit the given f32le bytes. */
function fakeSpawn(samples: Float32Array): typeof spawn {
  return ((_cmd: string, args: readonly string[]) => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      stdin: { writable: boolean; on: () => void; end: () => void };
      kill: () => boolean;
      killed: boolean;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.kill = () => ((child.killed = true), true);
    child.stdin = { writable: true, on: () => {}, end: () => {} };
    const isProbe = args.includes('-version');
    setImmediate(() => {
      if (isProbe) {
        child.emit('close', 0);
        return;
      }
      if (samples.length > 0) child.stdout.emit('data', Buffer.from(samples.buffer.slice(0)));
      child.emit('close', 0);
    });
    return child;
  }) as unknown as typeof spawn;
}

/** Build raw PCM16 mono little-endian bytes for the given float samples. */
function rawPcm16(samples: number[]): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((s, i) => view.setInt16(i * 2, Math.round(s * 32767), true));
  return bytes;
}

/** Build a mono PCM16 WAV at the given sample rate. */
function monoWav(samples: number[], sampleRate: number): Uint8Array {
  const dataSize = samples.length * 2;
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
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataSize, true);
  samples.forEach((s, i) => view.setInt16(44 + i * 2, Math.round(s * 32767), true));
  return buf;
}

describe('decodeToMono16k', () => {
  it('converts raw PCM16 mono @24k and resamples to 16k (no ffmpeg)', async () => {
    const dc = new Array<number>(240).fill(0.5); // 240 samples @24k → 160 @16k
    const out = await decodeToMono16k(rawPcm16(dc), MOXXY_PCM16_24KHZ_MIME);
    expect(out.length).toBe(160);
    for (const s of out) expect(s).toBeCloseTo(0.5, 2);
  });

  it('parses a 16k mono WAV unchanged (no resample, no ffmpeg)', async () => {
    const wav = monoWav([0, 0.5, -0.5], 16_000);
    const out = await decodeToMono16k(wav, 'audio/wav');
    expect(out.length).toBe(3);
    expect(out[1]).toBeCloseTo(0.5, 3);
  });

  it('resamples a 8k WAV up to 16k', async () => {
    const wav = monoWav(new Array<number>(80).fill(0.25), 8_000);
    const out = await decodeToMono16k(wav, 'audio/x-wav');
    expect(out.length).toBe(160);
  });

  it('sniffs RIFF/WAVE magic when the MIME is missing', async () => {
    const wav = monoWav([0.1, 0.2], 16_000);
    const out = await decodeToMono16k(wav, undefined);
    expect(out.length).toBe(2);
  });

  it('routes compressed audio (audio/ogg) through ffmpeg', async () => {
    const decoded = Float32Array.from([0.1, -0.2, 0.3]);
    const out = await decodeToMono16k(new Uint8Array([1, 2, 3]), 'audio/ogg', {
      spawnImpl: fakeSpawn(decoded),
    });
    expect(Array.from(out)).toEqual([
      expect.closeTo(0.1, 5),
      expect.closeTo(-0.2, 5),
      expect.closeTo(0.3, 5),
    ]);
  });

  it('handles a MIME with a codecs= parameter (case-insensitive)', async () => {
    const decoded = Float32Array.from([0.42]);
    const out = await decodeToMono16k(new Uint8Array([1]), 'AUDIO/OGG; codecs=opus', {
      spawnImpl: fakeSpawn(decoded),
    });
    expect(out[0]).toBeCloseTo(0.42, 5);
  });

  it('rejects an IEEE-float WAV politely instead of mis-decoding', async () => {
    // Build a float WAV header (format 3) — parseWav must reject it.
    const buf = monoWav([0], 16_000);
    new DataView(buf.buffer).setUint16(20, 3, true); // audioFormat = IEEE float
    await expect(decodeToMono16k(buf, 'audio/wav')).rejects.toMatchObject({
      code: 'CONFIG_INVALID',
    });
  });
});
