import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createLocalSupertonicSynthesizer } from './local-tts.js';
import { PRONUNCIATION_CORPUS } from './__fixtures__/pronunciation-corpus.js';
import { removeDir } from '@moxxy/vitest-preset/fs';

// vitest runs the TypeScript SOURCE, so `import.meta.url` here is src/. The
// sidecar must be the COMPILED entry, so point at dist/sidecar.js (build first:
// `pnpm -F @moxxy/plugin-tts-local build`).
const SIDECAR_PATH = fileURLToPath(new URL('../dist/sidecar.js', import.meta.url));

/**
 * Opt-in end-to-end test that REALLY downloads the voice and runs the native
 * sherpa sidecar — off by default (it fetches ~129 MB and needs the platform
 * binary). Run manually with:
 *
 *   MOXXY_TTS_LOCAL_LIVE=1 pnpm -F @moxxy/plugin-tts-local test
 */
const LIVE = !!process.env.MOXXY_TTS_LOCAL_LIVE;

let modelsDir: string;
beforeAll(async () => {
  if (!LIVE) return;
  modelsDir = await mkdtemp(path.join(tmpdir(), 'tts-local-live-'));
});
afterAll(async () => {
  if (modelsDir) await removeDir(modelsDir);
});

describe.skipIf(!LIVE)('local TTS (live, real download + native sidecar)', () => {
  it('synthesizes English audio', async () => {
    const synth = createLocalSupertonicSynthesizer({ modelsDir, sidecarPath: SIDECAR_PATH });
    try {
      const out = await synth.synthesize('Hello from a fully local voice.', { language: 'en' });
      expect(out.mimeType).toBe('audio/wav');
      expect(String.fromCharCode(...out.audio.subarray(0, 4))).toBe('RIFF');
      expect(out.audio.byteLength).toBeGreaterThan(44 + 1000);
    } finally {
      synth.shutdown();
    }
  }, 600_000);

  it('produces audio for every sentence of the pronunciation corpus', async () => {
    const synth = createLocalSupertonicSynthesizer({ modelsDir, sidecarPath: SIDECAR_PATH });
    try {
      for (const { lang, text } of PRONUNCIATION_CORPUS) {
        const out = await synth.synthesize(text, { language: lang });
        expect(out.audio.byteLength, text).toBeGreaterThan(44 + 1000);
      }
    } finally {
      synth.shutdown();
    }
  }, 600_000);

  it('synthesizes Polish audio', async () => {
    const synth = createLocalSupertonicSynthesizer({ modelsDir, sidecarPath: SIDECAR_PATH });
    try {
      const out = await synth.synthesize('Dzień dobry, mówię po polsku.', { language: 'pl' });
      expect(out.mimeType).toBe('audio/wav');
      expect(out.audio.byteLength).toBeGreaterThan(44 + 1000);
    } finally {
      synth.shutdown();
    }
  }, 600_000);
});
