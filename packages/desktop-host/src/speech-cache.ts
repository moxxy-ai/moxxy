import { createHash } from 'node:crypto';
import { readdir, readFile, rm, stat, utimes } from 'node:fs/promises';
import path from 'node:path';
import { moxxyHome, writeFileAtomic } from '@moxxy/sdk/server';

/** A synthesized clip as the synthesizer returned it. */
export interface SpeechClip {
  readonly audio: Uint8Array;
  readonly mimeType: string;
}

/** What makes two clips the same speech: the same words said by the same voice, model and pace. */
export interface SpeechCacheKeyParts {
  readonly synthesizer: string;
  readonly model: string;
  readonly voice: string;
  readonly text: string;
  readonly language?: string;
  readonly rate?: number;
}

export interface SpeechCache {
  /** The stored clip, marked as just heard; `null` when none is stored or it cannot be read. */
  get(key: string): Promise<SpeechClip | null>;
  /** Store a clip, then delete the clips heard longest ago while the store is over its limit. Never throws. */
  put(key: string, clip: SpeechClip): Promise<void>;
}

/** About 170 minutes of Gemini's 24 kHz 16-bit mono speech. */
export const SPEECH_CACHE_MAX_BYTES = 500 * 1024 * 1024;

const WAV = 'audio/wav';
const EXTENSION = '.wav';
const RIFF = [82, 73, 70, 70];

/** `$MOXXY_HOME/cache/speech`, beside the rest of Moxxy's data. */
export function defaultSpeechCacheDir(): string {
  return path.join(moxxyHome(), 'cache', 'speech');
}

export function speechCacheKey(parts: SpeechCacheKeyParts): string {
  const fields = [parts.synthesizer, parts.model, parts.voice, parts.language ?? '', parts.rate ?? '', parts.text];
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

/**
 * Speech kept on disk so hearing a message again costs no second synthesis.
 * One file per clip, named by its key; a file's modification time is when it
 * was last heard, so the store needs no index of its own.
 */
export function createSpeechCache(opts: { readonly dir: string; readonly maxBytes: number }): SpeechCache {
  const fileOf = (key: string): string => path.join(opts.dir, `${key}${EXTENSION}`);

  async function evict(): Promise<void> {
    const names = (await readdir(opts.dir)).filter((name) => name.endsWith(EXTENSION));
    const files = await Promise.all(
      names.map(async (name) => {
        const info = await stat(path.join(opts.dir, name)).catch(() => null);
        return info ? { name, size: info.size, heardAt: info.mtimeMs } : null;
      }),
    );
    const present = files.filter((file): file is NonNullable<typeof file> => file !== null);
    let total = present.reduce((sum, file) => sum + file.size, 0);
    for (const file of present.sort((a, b) => a.heardAt - b.heardAt)) {
      if (total <= opts.maxBytes) break;
      await rm(path.join(opts.dir, file.name), { force: true });
      total -= file.size;
    }
  }

  return {
    async get(key) {
      const file = fileOf(key);
      let audio: Buffer;
      try {
        audio = await readFile(file);
      } catch {
        return null;
      }
      if (!RIFF.every((byte, index) => audio[index] === byte)) {
        await rm(file, { force: true }).catch(() => undefined);
        return null;
      }
      const now = new Date();
      await utimes(file, now, now).catch(() => undefined);
      return { audio: new Uint8Array(audio), mimeType: WAV };
    },
    async put(key, clip) {
      if (clip.mimeType !== WAV || clip.audio.byteLength > opts.maxBytes) return;
      try {
        await writeFileAtomic(fileOf(key), clip.audio);
        await evict();
      } catch {
        // The store only saves money; speech plays without it.
      }
    },
  };
}
