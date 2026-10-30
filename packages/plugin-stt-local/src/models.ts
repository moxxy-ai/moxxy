/**
 * The pinned local speech model catalog.
 *
 * Whisper large-v3 turbo is the multilingual sherpa-onnx int8 export. Its three
 * files download as they are from Hugging Face, pinned to a fixed revision and
 * checked against their size and sha256 — byte for byte the files the project's
 * `asr-models` GitHub release packs into a `.tar.bz2` (verified 2026-10-24), but
 * with no archive to unpack: unpacking it in JavaScript took about 67 s against
 * 9 s for the download. Multilingual (not an `.en` export), so Polish and every
 * other Whisper language work.
 *
 * Parakeet TDT 0.6B v3 is the sherpa-onnx int8 export of NVIDIA's transducer
 * (CC-BY-4.0), pinned the same way. It works out the spoken language itself, in
 * 25 languages, and takes no language hint.
 */

import path from 'node:path';

import { MoxxyError } from '@moxxy/sdk';
import { moxxyPath } from '@moxxy/sdk/server';
import type { ModelFile } from '@moxxy/model-fetch/files';

export type LocalSttModelId = 'turbo' | 'parakeet';

/** The transcriber that reads Whisper turbo. */
export const LOCAL_WHISPER_TRANSCRIBER_NAME = 'local-whisper';
/** The transcriber that reads Parakeet. */
export const LOCAL_PARAKEET_TRANSCRIBER_NAME = 'local-parakeet';

export interface LocalSttModelEntry {
  /** Stable model id (also the `model` config value and its directory name). */
  readonly id: LocalSttModelId;
  /** Human label for UI surfaces / the first-use notice. */
  readonly label: string;
  /** The registered transcriber that reads this model. */
  readonly transcriber: string;
  readonly encoder: ModelFile;
  readonly decoder: ModelFile;
  /** Only a transducer has one; it is what tells the sidecar which engine to load. */
  readonly joiner?: ModelFile;
  readonly tokens: ModelFile;
  /** Longer audio is read piece by piece, for a model whose memory grows with it. */
  readonly maxChunkSeconds?: number;
  /** Drop the model from memory after this long without use. */
  readonly idleReleaseMs?: number;
}

const TURBO_REVISION = '2ca6ff69fc878651b770880507669577ac41c2ff';
const TURBO_BASE = `https://huggingface.co/csukuangfj/sherpa-onnx-whisper-turbo/resolve/${TURBO_REVISION}`;

const PARAKEET_REVISION = '2bda32ec70b097a55adaa07d9a7173915b43cc78';
const PARAKEET_BASE = `https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/${PARAKEET_REVISION}`;

export const MODEL_CATALOG: readonly LocalSttModelEntry[] = [
  {
    id: 'turbo',
    label: 'Whisper turbo (multilingual, large-v3 turbo)',
    transcriber: LOCAL_WHISPER_TRANSCRIBER_NAME,
    encoder: {
      name: 'turbo-encoder.int8.onnx',
      url: `${TURBO_BASE}/turbo-encoder.int8.onnx`,
      bytes: 674_716_297,
      sha256: 'b02dcdf54f348741e93fe732b67d933c8dcb6735655f710640143081db38878b',
    },
    decoder: {
      name: 'turbo-decoder.int8.onnx',
      url: `${TURBO_BASE}/turbo-decoder.int8.onnx`,
      bytes: 361_080_764,
      sha256: '20accd02388482eb3a46bd615631adfdc85e1eb2c7db9ea3f02a40ffe6b81547',
    },
    tokens: {
      name: 'turbo-tokens.txt',
      url: `${TURBO_BASE}/turbo-tokens.txt`,
      bytes: 816_730,
      sha256: 'b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126',
    },
  },
  {
    id: 'parakeet',
    label: 'Parakeet TDT 0.6B v3',
    transcriber: LOCAL_PARAKEET_TRANSCRIBER_NAME,
    encoder: {
      name: 'encoder.int8.onnx',
      url: `${PARAKEET_BASE}/encoder.int8.onnx`,
      bytes: 652_184_281,
      sha256: 'acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247',
    },
    decoder: {
      name: 'decoder.int8.onnx',
      url: `${PARAKEET_BASE}/decoder.int8.onnx`,
      bytes: 11_845_275,
      sha256: '179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e',
    },
    joiner: {
      name: 'joiner.int8.onnx',
      url: `${PARAKEET_BASE}/joiner.int8.onnx`,
      bytes: 6_355_277,
      sha256: '3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3',
    },
    tokens: {
      name: 'tokens.txt',
      url: `${PARAKEET_BASE}/tokens.txt`,
      bytes: 93_939,
      sha256: 'd58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d',
    },
    // Measured: 5 minutes in one go took 3 GB, and the model holds 850 MB at rest.
    maxChunkSeconds: 60,
    idleReleaseMs: 5 * 60_000,
  },
];

/** Every file of a model, in download order. */
export function modelFiles(entry: LocalSttModelEntry): ModelFile[] {
  return [entry.encoder, entry.decoder, ...(entry.joiner ? [entry.joiner] : []), entry.tokens];
}

/** The model's download size in bytes. */
export function modelBytes(entry: LocalSttModelEntry): number {
  return modelFiles(entry).reduce((sum, file) => sum + file.bytes, 0);
}

/** The models root: `~/.moxxy/models/stt`, MOXXY_HOME-aware. */
export function defaultModelsDir(): string {
  return moxxyPath('models', 'stt');
}

/** Where a model's files live under the models root. */
export function modelDir(entry: LocalSttModelEntry, modelsDir: string): string {
  return path.join(modelsDir, entry.id);
}

/** The model used when the caller doesn't pick one. */
export const DEFAULT_MODEL_ID: LocalSttModelId = 'turbo';

/** All valid model ids, for error messages and validation. */
export function modelIds(): string[] {
  return MODEL_CATALOG.map((m) => m.id);
}

export function findModel(id: string): LocalSttModelEntry | undefined {
  return MODEL_CATALOG.find((m) => m.id === id);
}

/** Resolve a model id to its catalog entry, or throw a clear, actionable error
 *  listing the valid ids. `field` names where the bad id came from. */
export function requireModel(id: string, field: string): LocalSttModelEntry {
  const entry = findModel(id);
  if (!entry) {
    throw new MoxxyError({
      code: 'CONFIG_INVALID',
      message: `Unknown local speech model ${JSON.stringify(id)} (${field}).`,
      hint: `Valid models: ${modelIds().join(', ')}.`,
      context: { field, model: id },
    });
  }
  return entry;
}
