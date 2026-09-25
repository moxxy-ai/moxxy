import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGeminiTtsUsageStore, estimateGeminiTtsCostUsd } from './gemini-tts-usage.js';

describe('Gemini TTS usage', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'moxxy-gemini-usage-'));
    file = join(dir, 'usage.json');
  });

  afterEach(async () => rm(dir, { recursive: true, force: true }));

  it('estimates cost using the current Standard text and audio token rates', () => {
    expect(estimateGeminiTtsCostUsd(1_000_000, 1_000_000)).toBe(6.5);
    expect(estimateGeminiTtsCostUsd(2_000, 25_000)).toBeCloseTo(0.151);
  });

  it('persists and aggregates completed Gemini TTS usage', async () => {
    const store = createGeminiTtsUsageStore(file, () => new Date('2026-09-25T12:00:00.000Z'));
    await store.record({ inputTextTokens: 120, outputAudioTokens: 250 });
    await store.record({ inputTextTokens: 80, outputAudioTokens: 500 });

    await expect(store.read()).resolves.toEqual({
      requestCount: 2,
      inputTextTokens: 200,
      outputAudioTokens: 750,
      estimatedCostUsd: 0.0046,
      updatedAt: '2026-09-25T12:00:00.000Z',
    });
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({
      version: 1,
      requestCount: 2,
      inputTextTokens: 200,
      outputAudioTokens: 750,
    });
  });

  it('serializes overlapping records without losing usage', async () => {
    const store = createGeminiTtsUsageStore(file);
    await Promise.all(Array.from({ length: 12 }, () =>
      store.record({ inputTextTokens: 1, outputAudioTokens: 25 }),
    ));

    await expect(store.read()).resolves.toMatchObject({
      requestCount: 12,
      inputTextTokens: 12,
      outputAudioTokens: 300,
    });
  });

  it('quarantines malformed persisted data instead of overwriting it as empty', async () => {
    await writeFile(file, '{bad json');
    const store = createGeminiTtsUsageStore(file);

    await expect(store.read()).resolves.toMatchObject({
      requestCount: 0,
      inputTextTokens: 0,
      outputAudioTokens: 0,
      estimatedCostUsd: 0,
    });
    expect((await readdir(dir)).some((name) => name.startsWith('usage.json.corrupt-'))).toBe(true);
    await store.record({ inputTextTokens: 3, outputAudioTokens: 25 });
    await expect(store.read()).resolves.toMatchObject({ requestCount: 1 });
  });
});
