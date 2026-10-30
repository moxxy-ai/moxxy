/**
 * The pinned local voice.
 *
 * Supertonic 3, the int8 export sherpa-onnx publishes as a `.tar.bz2` under its
 * `tts-models` GitHub release. The `sha256` is copied VERBATIM from that
 * release's `checksum.txt` (verified 2026-10-30), so a first-use download is
 * content-addressed and tamper-evident. The archive extracts to a single top
 * directory holding the four networks, `tts.json`, `unicode_indexer.bin` and
 * `voice.bin`, which carries every preset of the model.
 *
 * The same network reads every language; the language goes in with each call,
 * so one voice speaks Polish and English alike.
 */

import path from 'node:path';

import { detectSpeechLanguage } from '@moxxy/chat-model';

export interface VoiceEntry {
  /** Stable id: the voice's directory name under the models root. */
  readonly id: string;
  /** Human label for UI surfaces. */
  readonly label: string;
  /** Pinned archive URL (sherpa-onnx GitHub release). */
  readonly url: string;
  /** Pinned hex sha256 of the archive (from the release checksum.txt). */
  readonly sha256: string;
  /** Top directory the archive extracts to. */
  readonly archiveRootDir: string;
  /** A file inside `archiveRootDir` that proves the archive was unpacked. */
  readonly modelFile: string;
  /** Approximate download size in MB (for the one-time first-use notice). */
  readonly approxMb: number;
  /** The preset, as Supertone names it. */
  readonly preset: string;
  /** The preset's index in `voice.bin`: F1…F5 are 0…4, M1…M5 are 5…9. */
  readonly speakerId: number;
}

const RELEASE_BASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models';
const ARCHIVE_ROOT = 'sherpa-onnx-supertonic-3-tts-int8-2026-05-11';

export const DEFAULT_VOICE: VoiceEntry = {
  id: 'supertonic-3-int8',
  label: 'Supertonic 3',
  url: `${RELEASE_BASE}/${ARCHIVE_ROOT}.tar.bz2`,
  sha256: '82fa96f91c4ef8abaae3a14a3f4153facf88bed821d1f7331cec2700f432c427',
  archiveRootDir: ARCHIVE_ROOT,
  modelFile: 'vector_estimator.int8.onnx',
  approxMb: 129,
  preset: 'F2',
  speakerId: 1,
};

export const VOICE_CATALOG: readonly VoiceEntry[] = [DEFAULT_VOICE];

/** More denoising steps speak clearer and take longer. On the pronunciation
 *  corpus 5 steps are a third faster but start to lose digits of a number. */
export const DENOISING_STEPS = 8;

/** The languages Supertonic 3 reads. */
export const SUPERTONIC_LANGUAGES: ReadonlySet<string> = new Set([
  'ar', 'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr',
  'hi', 'hr', 'hu', 'id', 'it', 'ja', 'ko', 'lt', 'lv', 'nl', 'pl',
  'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'tr', 'uk', 'vi',
]);

/** On-disk paths sherpa needs for the voice. */
export interface VoiceModelPaths {
  readonly durationPredictor: string;
  readonly textEncoder: string;
  readonly vectorEstimator: string;
  readonly vocoder: string;
  readonly ttsJson: string;
  readonly unicodeIndexer: string;
  readonly voiceStyle: string;
}

export function voiceModelPaths(voice: VoiceEntry, modelsDir: string): VoiceModelPaths {
  const root = path.join(modelsDir, voice.id, voice.archiveRootDir);
  return {
    durationPredictor: path.join(root, 'duration_predictor.int8.onnx'),
    textEncoder: path.join(root, 'text_encoder.int8.onnx'),
    vectorEstimator: path.join(root, 'vector_estimator.int8.onnx'),
    vocoder: path.join(root, 'vocoder.int8.onnx'),
    ttsJson: path.join(root, 'tts.json'),
    unicodeIndexer: path.join(root, 'unicode_indexer.bin'),
    voiceStyle: path.join(root, 'voice.bin'),
  };
}

/**
 * The language to read `text` in: the hint when the model speaks it, else
 * whichever of Polish and English the text is written in. The model has to be
 * told, because a wrong language garbles the reading.
 */
export function speechLanguage(hint: string | undefined, text: string): string {
  const primary = (hint ?? '').trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return SUPERTONIC_LANGUAGES.has(primary) ? primary : detectSpeechLanguage(text);
}
