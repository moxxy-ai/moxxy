import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { removeDir } from '@moxxy/vitest-preset/fs';
import { createSpeechCache, speechCacheKey } from './speech-cache';

/** A WAV-looking clip of `size` bytes. */
function clip(size: number, fill = 1): { audio: Uint8Array; mimeType: string } {
  const audio = new Uint8Array(size).fill(fill);
  audio.set([82, 73, 70, 70]); // RIFF
  return { audio, mimeType: 'audio/wav' };
}

const key = (text: string): string =>
  speechCacheKey({ synthesizer: 'gemini-tts', model: 'gemini-3.8-flash-lite-tts', voice: 'Fola', text });

async function setLastUsed(dir: string, k: string, secondsAgo: number): Promise<void> {
  const at = new Date(Date.now() - secondsAgo * 1000);
  await utimes(path.join(dir, `${k}.wav`), at, at);
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'moxxy-speech-cache-'));
});
afterEach(async () => {
  await removeDir(dir);
});

describe('speechCacheKey', () => {
  it('names the same speech the same way, and different speech differently', () => {
    const base = { synthesizer: 'gemini-tts', model: 'gemini-3.8-flash-lite-tts', voice: 'Fola', text: 'Hello.' };
    expect(speechCacheKey(base)).toBe(speechCacheKey({ ...base }));
    expect(speechCacheKey(base)).toMatch(/^[a-f0-9]{64}$/);
    for (const changed of [
      { ...base, text: 'Hello!' },
      { ...base, voice: 'Kore' },
      { ...base, model: 'gemini-3.8-flash-tts' },
      { ...base, rate: 0.9 },
      { ...base, language: 'pl' },
    ]) {
      expect(speechCacheKey(changed)).not.toBe(speechCacheKey(base));
    }
  });
});

describe('createSpeechCache', () => {
  it('gives back a stored clip and nothing for one never stored', async () => {
    const cache = createSpeechCache({ dir, maxBytes: 1_000 });
    await cache.put(key('a'), clip(100, 7));
    expect(await cache.get(key('a'))).toEqual(clip(100, 7));
    expect(await cache.get(key('b'))).toBeNull();
  });

  it('deletes the clips heard longest ago once it grows past its limit', async () => {
    const cache = createSpeechCache({ dir, maxBytes: 250 });
    await cache.put(key('a'), clip(100));
    await cache.put(key('b'), clip(100));
    await setLastUsed(dir, key('a'), 300);
    await setLastUsed(dir, key('b'), 200);
    // Hearing "a" again makes "b" the one heard longest ago.
    expect(await cache.get(key('a'))).not.toBeNull();

    await cache.put(key('c'), clip(100));

    expect(await cache.get(key('b'))).toBeNull();
    expect(await cache.get(key('a'))).not.toBeNull();
    expect(await cache.get(key('c'))).not.toBeNull();
  });

  it('does not keep a clip bigger than the whole limit', async () => {
    const cache = createSpeechCache({ dir, maxBytes: 50 });
    await cache.put(key('big'), clip(100));
    expect(await cache.get(key('big'))).toBeNull();
    expect(await readdir(dir)).toEqual([]);
  });

  it('keeps only WAV audio, the format it names its files after', async () => {
    const cache = createSpeechCache({ dir, maxBytes: 1_000 });
    await cache.put(key('mp3'), { audio: new Uint8Array(10), mimeType: 'audio/mpeg' });
    expect(await cache.get(key('mp3'))).toBeNull();
  });

  it('drops a damaged file and reports nothing stored', async () => {
    const cache = createSpeechCache({ dir, maxBytes: 1_000 });
    await writeFile(path.join(dir, `${key('bad')}.wav`), 'not audio');
    expect(await cache.get(key('bad'))).toBeNull();
    expect(await readdir(dir)).toEqual([]);
  });

  it('never throws when the disk refuses to store, so speech still plays', async () => {
    const blocked = path.join(dir, 'a-file');
    await writeFile(blocked, 'x');
    const cache = createSpeechCache({ dir: path.join(blocked, 'speech'), maxBytes: 1_000 });
    await expect(cache.put(key('a'), clip(10))).resolves.toBeUndefined();
    expect(await cache.get(key('a'))).toBeNull();
  });
});
