import { randomUUID } from 'node:crypto';
import { rename } from 'node:fs/promises';
import path from 'node:path';
import { createMutex } from '@moxxy/sdk';
import { moxxyHome, writeFileAtomic } from '@moxxy/sdk/server';
import type { GeminiTtsUsageSnapshot } from '@moxxy/desktop-ipc-contract';
import { z } from '@moxxy/sdk';
import { readBoundedFile } from './bounded-read.js';

const TEXT_INPUT_USD_PER_MILLION_TOKENS = 0.5;
const AUDIO_OUTPUT_USD_PER_MILLION_TOKENS = 6;
const MAX_USAGE_FILE_BYTES = 16_384;

interface PersistedUsage {
  readonly version: 1;
  readonly requestCount: number;
  readonly estimatedRequestCount: number;
  readonly inputTextTokens: number;
  readonly outputAudioTokens: number;
  readonly updatedAt: string | null;
}

const persistedUsageSchema = z.object({
  version: z.literal(1),
  requestCount: z.number().int().nonnegative(),
  estimatedRequestCount: z.number().int().nonnegative().default(0),
  inputTextTokens: z.number().int().nonnegative(),
  outputAudioTokens: z.number().int().nonnegative(),
  updatedAt: z.string().datetime().nullable(),
}).strict();

const emptyUsage: PersistedUsage = {
  version: 1,
  requestCount: 0,
  estimatedRequestCount: 0,
  inputTextTokens: 0,
  outputAudioTokens: 0,
  updatedAt: null,
};

export interface GeminiTtsUsageCounts {
  readonly inputTextTokens: number;
  readonly outputAudioTokens: number;
  readonly estimated?: boolean;
}

export interface GeminiTtsUsageStore {
  read(): Promise<GeminiTtsUsageSnapshot>;
  record(usage: GeminiTtsUsageCounts): Promise<GeminiTtsUsageSnapshot>;
}

/** Current Gemini 3.8 Flash-Lite TTS Standard rates through 2026-12-31. */
export function estimateGeminiTtsCostUsd(inputTextTokens: number, outputAudioTokens: number): number {
  return (inputTextTokens * TEXT_INPUT_USD_PER_MILLION_TOKENS
    + outputAudioTokens * AUDIO_OUTPUT_USD_PER_MILLION_TOKENS) / 1_000_000;
}

export function createGeminiTtsUsageStore(
  file: string,
  now: () => Date = () => new Date(),
): GeminiTtsUsageStore {
  const mutex = createMutex();

  async function load(): Promise<PersistedUsage> {
    let raw: Buffer;
    try {
      raw = await readBoundedFile(file, MAX_USAGE_FILE_BYTES, 'Invalid Gemini TTS usage file');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...emptyUsage };
      throw error;
    }

    try {
      return persistedUsageSchema.parse(JSON.parse(raw.toString('utf8')));
    } catch {
      // Keep the previous evidence for diagnosis; never silently replace a
      // corrupt usage ledger with a zero-value ledger.
      await rename(file, `${file}.corrupt-${Date.now()}-${randomUUID()}`);
      return { ...emptyUsage };
    }
  }

  function snapshot(usage: PersistedUsage): GeminiTtsUsageSnapshot {
    return {
      requestCount: usage.requestCount,
      estimatedRequestCount: usage.estimatedRequestCount,
      inputTextTokens: usage.inputTextTokens,
      outputAudioTokens: usage.outputAudioTokens,
      estimatedCostUsd: estimateGeminiTtsCostUsd(usage.inputTextTokens, usage.outputAudioTokens),
      updatedAt: usage.updatedAt,
    };
  }

  return {
    async read() {
      return snapshot(await load());
    },
    async record(usage) {
      return mutex.run(async () => {
        const inputTextTokens = z.number().int().nonnegative().parse(usage.inputTextTokens);
        const outputAudioTokens = z.number().int().nonnegative().parse(usage.outputAudioTokens);
        const current = await load();
        const next: PersistedUsage = {
          version: 1,
          requestCount: current.requestCount + 1,
          estimatedRequestCount: current.estimatedRequestCount + (usage.estimated ? 1 : 0),
          inputTextTokens: current.inputTextTokens + inputTextTokens,
          outputAudioTokens: current.outputAudioTokens + outputAudioTokens,
          updatedAt: now().toISOString(),
        };
        await writeFileAtomic(file, JSON.stringify(next, null, 2), { mode: 0o600 });
        return snapshot(next);
      });
    },
  };
}

const defaultStore = createGeminiTtsUsageStore(
  path.join(moxxyHome(), 'desktop', 'gemini-tts-usage.json'),
);

export function getGeminiTtsUsage(): Promise<GeminiTtsUsageSnapshot> {
  return defaultStore.read();
}

export async function recordGeminiTtsUsage(usage: GeminiTtsUsageCounts): Promise<GeminiTtsUsageSnapshot> {
  return defaultStore.record(usage);
}
