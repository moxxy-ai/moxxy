/**
 * The single entry point that turns whatever audio a caller hands the local
 * Whisper transcriber into the Float32 mono @ 16 kHz that sherpa wants. It
 * dispatches on the MIME type (with a RIFF magic sniff as a backstop):
 *
 *   - `MOXXY_PCM16_24KHZ_MIME` (the TUI/desktop mic) → int16→float32, then
 *     linear-resample 24 kHz → 16 kHz. Never touches ffmpeg.
 *   - `audio/wav` / `audio/x-wav`, or any buffer whose bytes start with the WAV
 *     magic → parse the RIFF header (PCM16 only), downmix, resample. No ffmpeg.
 *   - everything else (ogg/opus, mp3, m4a, webm, flac, …) → ffmpeg.
 *
 * The MIME string is UNTRUSTED (channels forward a messenger's `mime_type`
 * verbatim), so it's runtime-guarded and canonicalized before matching.
 */

import { MOXXY_PCM16_24KHZ_MIME } from '@moxxy/sdk';
import type { spawn } from 'node:child_process';

import {
  downmixToMono,
  isRiffWave,
  parseWav,
  pcm16ToFloat32,
  resampleLinear,
  TARGET_SAMPLE_RATE,
} from './audio.js';
import { decodeViaFfmpeg } from './ffmpeg.js';

/** The raw mic contract carries mono int16 @ this rate (see the SDK MIME tag). */
const MOXXY_PCM16_SAMPLE_RATE = 24_000;

export interface DecodeOptions {
  /** Injected `spawn` for the ffmpeg path (tests). Defaults to real `spawn`. */
  readonly spawnImpl?: typeof spawn;
}

/**
 * Decode `audio` to Float32 mono PCM in [-1, 1] at 16 kHz. Throws a MoxxyError
 * for malformed WAV (non-PCM16) or when ffmpeg is needed but missing.
 */
export async function decodeToMono16k(
  audio: Uint8Array | ArrayBuffer,
  mimeType: string | undefined,
  opts: DecodeOptions = {},
): Promise<Float32Array> {
  const bytes = audio instanceof Uint8Array ? audio : new Uint8Array(audio);
  const mt = canonicalMime(mimeType);

  // 1) Raw PCM16 mono @ 24 kHz from the moxxy mic recorder.
  if (mt === MOXXY_PCM16_24KHZ_MIME) {
    const mono = pcm16ToFloat32(bytes);
    return resampleLinear(mono, MOXXY_PCM16_SAMPLE_RATE, TARGET_SAMPLE_RATE);
  }

  // 2) WAV — by declared MIME or by sniffing the RIFF/WAVE magic (a mislabelled
  //    or MIME-less WAV still decodes in-process).
  if (mt === 'audio/wav' || mt === 'audio/x-wav' || mt === 'audio/wave' || isRiffWave(bytes)) {
    const wav = parseWav(bytes);
    const mono = wav.channels > 1 ? downmixToMono(wav.samples, wav.channels) : wav.samples;
    return wav.sampleRate === TARGET_SAMPLE_RATE
      ? mono
      : resampleLinear(mono, wav.sampleRate, TARGET_SAMPLE_RATE);
  }

  // 3) Everything else is a compressed container → ffmpeg (already resamples to
  //    16 kHz mono for us).
  return decodeViaFfmpeg(bytes, opts.spawnImpl);
}

/** Lower-case, strip a `; codecs=…` parameter, trim. Non-string → ''. */
function canonicalMime(mimeType: string | undefined): string {
  const raw = typeof mimeType === 'string' ? mimeType : '';
  return raw.toLowerCase().split(';')[0]!.trim();
}
