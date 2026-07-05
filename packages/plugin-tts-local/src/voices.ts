/**
 * The pinned local voice catalog.
 *
 * Every voice is a Piper VITS model published by the sherpa-onnx project as a
 * `.tar.bz2` under its `tts-models` GitHub release. Each `sha256` is copied
 * VERBATIM from that release's `checksum.txt` (re-verified 2026-07-05) — so a
 * first-use download is content-addressed and tamper-evident, unlike an
 * unverified blob fetch. The archive extracts to a single top directory
 * (`archiveRootDir`) holding `<id>.onnx`, `tokens.txt`, and `espeak-ng-data/`.
 */

import { MoxxyError } from '@moxxy/sdk';

export type VoiceLanguage = 'en' | 'pl';

export interface VoiceEntry {
  /** Stable voice id, e.g. `en_US-amy-medium` (also the `set_voice` name). */
  readonly id: string;
  /** BCP-47 primary language subtag used for language routing. */
  readonly language: VoiceLanguage;
  /** Human label for UI surfaces. */
  readonly label: string;
  /** Pinned archive URL (sherpa-onnx GitHub release). */
  readonly url: string;
  /** Pinned hex sha256 of the archive (from the release checksum.txt). */
  readonly sha256: string;
  /** Top directory the archive extracts to (`vits-piper-<id>`). */
  readonly archiveRootDir: string;
  /** The ONNX model filename inside `archiveRootDir` (`<id>.onnx`). */
  readonly modelFile: string;
  /** Approximate download size in MB (for the one-time first-use notice). */
  readonly approxMb: number;
}

const RELEASE_BASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models';

function piperVoice(
  id: string,
  language: VoiceLanguage,
  label: string,
  sha256: string,
  approxMb: number,
): VoiceEntry {
  const archiveRootDir = `vits-piper-${id}`;
  return {
    id,
    language,
    label,
    url: `${RELEASE_BASE}/${archiveRootDir}.tar.bz2`,
    sha256,
    archiveRootDir,
    modelFile: `${id}.onnx`,
    approxMb,
  };
}

export const VOICE_CATALOG: readonly VoiceEntry[] = [
  piperVoice(
    'en_US-amy-medium',
    'en',
    'Amy (English, US)',
    '9a5d1fc497f85e8022b785bff5f8105203b1e33099ee6265203efc70b0cb0264',
    63,
  ),
  piperVoice(
    'pl_PL-gosia-medium',
    'pl',
    'Gosia (Polish)',
    '75bd34dcbdc4dd98d763954756b4b34b4208100497c836381542e4d73dcefa9c',
    63,
  ),
  piperVoice(
    'pl_PL-darkman-medium',
    'pl',
    'Darkman (Polish)',
    '444727aa46eb6db645a2bc88fe73868e4bd7596b7f56ca39fad5ef53c41210d4',
    63,
  ),
];

export const DEFAULT_VOICE_ID = 'en_US-amy-medium';
export const DEFAULT_POLISH_VOICE_ID = 'pl_PL-gosia-medium';

/** All valid voice ids, for error messages and validation. */
export function voiceIds(): string[] {
  return VOICE_CATALOG.map((v) => v.id);
}

export function findVoice(id: string): VoiceEntry | undefined {
  return VOICE_CATALOG.find((v) => v.id === id);
}

/** Resolve a voice id to its catalog entry, or throw a clear, actionable error
 *  listing the valid ids. `field` names where the bad id came from. */
export function requireVoice(id: string, field: string): VoiceEntry {
  const entry = findVoice(id);
  if (!entry) {
    throw new MoxxyError({
      code: 'CONFIG_INVALID',
      message: `Unknown local voice ${JSON.stringify(id)} (${field}).`,
      hint: `Valid voices: ${voiceIds().join(', ')}.`,
      context: { field, voice: id },
    });
  }
  return entry;
}

export interface RouteVoiceInput {
  /** Explicit per-call voice id (`SynthesizeOptions.voice`) — overrides all. */
  readonly requestedVoice?: string;
  /** Per-call BCP-47 language hint (`SynthesizeOptions.language`). */
  readonly language?: string;
  /** Configured default (non-Polish) voice id. */
  readonly defaultVoice: string;
  /** Configured Polish voice id. */
  readonly polishVoice: string;
}

/**
 * Pick the voice for a synthesis call:
 *   1. an explicit `requestedVoice` (a catalog id) wins outright;
 *   2. else a `language` starting with `pl` routes to the Polish voice;
 *   3. else the configured default voice.
 * An unknown id (in any of the three) throws a clear `CONFIG_INVALID` error.
 */
export function routeVoice(input: RouteVoiceInput): VoiceEntry {
  if (input.requestedVoice) {
    return requireVoice(input.requestedVoice, 'voice');
  }
  const lang = (input.language ?? '').trim().toLowerCase();
  if (lang.startsWith('pl')) {
    return requireVoice(input.polishVoice, 'polishVoice');
  }
  return requireVoice(input.defaultVoice, 'voice');
}
