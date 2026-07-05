/**
 * The pinned Whisper model catalog.
 *
 * Every model is a multilingual sherpa-onnx Whisper export published as a
 * `.tar.bz2` under the project's `asr-models` GitHub release. Each `sha256` is
 * copied VERBATIM from that release's `checksum.txt` (re-verified 2026-07-05) —
 * so a first-use download is content-addressed and tamper-evident, unlike an
 * unverified blob fetch. The archive extracts to a single top directory
 * (`archiveRootDir`) holding `<id>-encoder.onnx`, `<id>-decoder.onnx` (+ int8
 * variants we don't use) and `<id>-tokens.txt`.
 *
 * All three are the MULTILINGUAL models (not the `.en` English-only exports),
 * so Polish (and any other Whisper language) works — `small` is the accuracy
 * sweet spot for Polish, `base` the balanced default, `tiny` the fastest.
 */

import { MoxxyError } from '@moxxy/sdk';

export type WhisperModelId = 'tiny' | 'base' | 'small';

export interface WhisperModelEntry {
  /** Stable model id (also the `model` config value). */
  readonly id: WhisperModelId;
  /** Human label for UI surfaces / the first-use notice. */
  readonly label: string;
  /** Pinned archive URL (sherpa-onnx GitHub `asr-models` release). */
  readonly url: string;
  /** Pinned hex sha256 of the archive (from the release checksum.txt). */
  readonly sha256: string;
  /** Top directory the archive extracts to (`sherpa-onnx-whisper-<id>`). */
  readonly archiveRootDir: string;
  /** Encoder ONNX filename inside `archiveRootDir` (`<id>-encoder.onnx`). */
  readonly encoderFile: string;
  /** Decoder ONNX filename inside `archiveRootDir` (`<id>-decoder.onnx`). */
  readonly decoderFile: string;
  /** Tokens filename inside `archiveRootDir` (`<id>-tokens.txt`). */
  readonly tokensFile: string;
  /** Approximate download size in MB (for the one-time first-use notice). */
  readonly approxMb: number;
}

const RELEASE_BASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models';

function whisperModel(
  id: WhisperModelId,
  label: string,
  sha256: string,
  approxMb: number,
): WhisperModelEntry {
  const archiveRootDir = `sherpa-onnx-whisper-${id}`;
  return {
    id,
    label,
    url: `${RELEASE_BASE}/${archiveRootDir}.tar.bz2`,
    sha256,
    archiveRootDir,
    encoderFile: `${id}-encoder.onnx`,
    decoderFile: `${id}-decoder.onnx`,
    tokensFile: `${id}-tokens.txt`,
    approxMb,
  };
}

export const MODEL_CATALOG: readonly WhisperModelEntry[] = [
  whisperModel(
    'tiny',
    'Whisper tiny (multilingual — fastest, lowest accuracy)',
    'c46116994e539aa165266d96b325252728429c12535eb9d8b6a2b10f129e66b1',
    111,
  ),
  whisperModel(
    'base',
    'Whisper base (multilingual — balanced; default)',
    '911b2083efd7c0dca2ac3b358b75222660dc09fb716d64fbfc417ba6c99ff3de',
    198,
  ),
  whisperModel(
    'small',
    'Whisper small (multilingual — best accuracy; recommended for Polish)',
    '486a46afbb7ba798507190ffe02fea2dd726049af212e774537efac6afb210a6',
    610,
  ),
];

/** Default model when the caller doesn't pick one. `base` balances size vs.
 *  accuracy; `small` is recommended for Polish (see the catalog description). */
export const DEFAULT_MODEL_ID: WhisperModelId = 'base';

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
