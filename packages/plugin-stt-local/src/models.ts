/**
 * The pinned Whisper model catalog.
 *
 * The one model is Whisper large-v3 turbo, the multilingual sherpa-onnx int8
 * export. Its three files download as they are from Hugging Face, pinned to a
 * fixed revision and checked against their size and sha256 — byte for byte the
 * files the project's `asr-models` GitHub release packs into a `.tar.bz2`
 * (verified 2026-10-24), but with no archive to unpack: unpacking it in
 * JavaScript took about 67 s against 9 s for the download.
 *
 * Multilingual (not an `.en` export), so Polish and every other Whisper
 * language work.
 */

import path from 'node:path';

import { MoxxyError } from '@moxxy/sdk';
import { moxxyPath } from '@moxxy/sdk/server';
import type { ModelFile } from '@moxxy/model-fetch/files';

export type WhisperModelId = 'turbo';

export interface WhisperModelEntry {
  /** Stable model id (also the `model` config value and its directory name). */
  readonly id: WhisperModelId;
  /** Human label for UI surfaces / the first-use notice. */
  readonly label: string;
  readonly encoder: ModelFile;
  readonly decoder: ModelFile;
  readonly tokens: ModelFile;
}

const TURBO_REVISION = '2ca6ff69fc878651b770880507669577ac41c2ff';
const TURBO_BASE = `https://huggingface.co/csukuangfj/sherpa-onnx-whisper-turbo/resolve/${TURBO_REVISION}`;

export const MODEL_CATALOG: readonly WhisperModelEntry[] = [
  {
    id: 'turbo',
    label: 'Whisper turbo (multilingual, large-v3 turbo)',
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
];

/** Every file of a model, in download order. */
export function modelFiles(entry: WhisperModelEntry): ModelFile[] {
  return [entry.encoder, entry.decoder, entry.tokens];
}

/** The model's download size in bytes. */
export function modelBytes(entry: WhisperModelEntry): number {
  return modelFiles(entry).reduce((sum, file) => sum + file.bytes, 0);
}

/** The models root: `~/.moxxy/models/stt`, MOXXY_HOME-aware. */
export function defaultModelsDir(): string {
  return moxxyPath('models', 'stt');
}

/** Where a model's files live under the models root. */
export function modelDir(entry: WhisperModelEntry, modelsDir: string): string {
  return path.join(modelsDir, entry.id);
}

/** The model used when the caller doesn't pick one — the only one there is. */
export const DEFAULT_MODEL_ID: WhisperModelId = 'turbo';

/** All valid model ids, for error messages and validation. */
export function modelIds(): string[] {
  return MODEL_CATALOG.map((m) => m.id);
}

export function findModel(id: string): WhisperModelEntry | undefined {
  return MODEL_CATALOG.find((m) => m.id === id);
}

/** Resolve a model id to its catalog entry, or throw a clear, actionable error
 *  listing the valid ids. `field` names where the bad id came from. */
export function requireModel(id: string, field: string): WhisperModelEntry {
  const entry = findModel(id);
  if (!entry) {
    throw new MoxxyError({
      code: 'CONFIG_INVALID',
      message: `Unknown local Whisper model ${JSON.stringify(id)} (${field}).`,
      hint: `Valid models: ${modelIds().join(', ')}.`,
      context: { field, model: id },
    });
  }
  return entry;
}
