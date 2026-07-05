import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createLocalWhisperTranscriber } from './local-stt.js';

// vitest runs the TypeScript SOURCE, so `import.meta.url` here is src/. The
// sidecar must be the COMPILED entry, so point at dist/sidecar.js (build first:
// `pnpm -F @moxxy/plugin-stt-local build`).
const SIDECAR_PATH = fileURLToPath(new URL('../dist/sidecar.js', import.meta.url));

/**
 * Opt-in end-to-end test that REALLY downloads the tiny Whisper model and runs
 * the native sherpa sidecar — off by default (it fetches ~111 MB and needs the
 * platform binary). Run manually with:
 *
 *   MOXXY_STT_LOCAL_LIVE=1 pnpm -F @moxxy/plugin-stt-local test
 */
const LIVE = !!process.env.MOXXY_STT_LOCAL_LIVE;

/** Generate a 1-second 16 kHz mono PCM16 WAV of a 440 Hz tone as a fixture. The
 *  transcript of a pure tone is meaningless — the assertion is that the whole
 *  download → decode → recognize pipeline runs and yields a string. */
function toneWav(): Uint8Array {
  const rate = 16_000;
  const n = rate; // 1 s
  const dataSize = n * 2;
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
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < n; i += 1) {
    const s = Math.sin((2 * Math.PI * 440 * i) / rate) * 0.3;
    view.setInt16(44 + i * 2, Math.round(s * 32767), true);
  }
  return buf;
}

let modelsDir: string;
beforeAll(async () => {
  if (!LIVE) return;
  modelsDir = await mkdtemp(path.join(tmpdir(), 'stt-local-live-'));
});
afterAll(async () => {
  if (modelsDir) await rm(modelsDir, { recursive: true, force: true });
});

describe.skipIf(!LIVE)('local STT (live, real download + native sidecar)', () => {
  it('downloads the tiny model and transcribes a generated WAV fixture', async () => {
    const stt = createLocalWhisperTranscriber({
      model: 'tiny',
      modelsDir,
      sidecarPath: SIDECAR_PATH,
    });
    try {
      const out = await stt.transcribe(toneWav(), { mimeType: 'audio/wav' });
      expect(typeof out.text).toBe('string');
      expect(out.durationSec).toBeCloseTo(1, 1);
    } finally {
      stt.shutdown();
    }
  }, 600_000);
});
