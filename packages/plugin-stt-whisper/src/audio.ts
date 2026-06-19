/**
 * Audio helpers shared across STT plugins. Whisper-family backends — the
 * generic OpenAI Whisper endpoint, the Codex OAuth `/transcribe` proxy,
 * any future Whisper-compatible vendor — all want the same preprocessing
 * (filename inference from MIME, raw PCM16 → WAV wrapping). Centralizing
 * them here keeps the wrapper plugins thin.
 */

import { MOXXY_PCM16_24KHZ_MIME } from '@moxxy/sdk';

/** A custom MIME tag used by the TUI voice recorder to flag raw PCM16
 *  mono @ 24kHz bytes (ffmpeg's `-f s16le` output) so the transcriber
 *  knows to wrap them in a WAV header before upload. Public so other
 *  recorders / channels can mark their captures identically. Sourced from
 *  the SDK's zero-dep cross-package source of truth; re-exported here so the
 *  existing `@moxxy/plugin-stt-whisper` surface stays stable. */
export { MOXXY_PCM16_24KHZ_MIME };

/** Default filename per MIME type, used to set the upload `filename` so
 *  the vendor's content sniffer routes to the right decoder. Defaults to
 *  `audio.bin` for anything unmapped.
 *
 *  The MIME string is caller-supplied and can be fully untrusted (the
 *  Telegram voice path forwards `media.mime_type` verbatim). A plain object
 *  literal would let a crafted MIME equal to an inherited member name
 *  ('constructor', 'toString', '__proto__', …) resolve to a function/object
 *  instead of `undefined`, defeating the `?? 'audio.bin'` fallback. Using a
 *  null-prototype map closes that hole; lookups can only hit own keys. */
export const WHISPER_FILENAME_BY_MIME: Readonly<Record<string, string>> =
  /* null-prototype: see comment above */ Object.assign(Object.create(null) as Record<string, string>, {
    'audio/ogg': 'audio.ogg',
    'audio/opus': 'audio.opus',
    'audio/mpeg': 'audio.mp3',
    'audio/mp3': 'audio.mp3',
    'audio/wav': 'audio.wav',
    'audio/x-wav': 'audio.wav',
    'audio/webm': 'audio.webm',
    'audio/m4a': 'audio.m4a',
    'audio/mp4': 'audio.mp4',
    'audio/flac': 'audio.flac',
  });

export interface NormalizedAudioUpload {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly filename: string;
}

/**
 * Normalize a raw audio buffer for upload to a Whisper-family endpoint.
 *
 * - If the input is `MOXXY_PCM16_24KHZ_MIME`, wraps the raw samples in a
 *   WAV header (samples are mono, 24kHz, 16-bit little-endian) and
 *   reports the upload as `audio/wav`.
 * - Otherwise passes the bytes through and picks a filename from the
 *   MIME table (or `audio.bin` for unknown types).
 *
 * The optional `filenamePrefix` lets callers brand the upload filename
 * (e.g. Codex uses `moxxy.wav`); when omitted the default `audio.<ext>`
 * shape is used.
 */
export function normalizeWhisperUpload(
  audio: Uint8Array | ArrayBuffer,
  mimeType: string | undefined,
  filenamePrefix?: string,
): NormalizedAudioUpload {
  const bytes = audio instanceof Uint8Array ? audio : new Uint8Array(audio);
  // MIME types are case-insensitive (RFC 2045) and may carry a `; codecs=…`
  // parameter; some callers (Telegram) forward the header verbatim without
  // normalizing. Canonicalize once so casing/params don't miss the table.
  const mt = (mimeType || 'audio/wav').toLowerCase().split(';')[0]!.trim();
  if (mt === MOXXY_PCM16_24KHZ_MIME) {
    return {
      bytes: pcm16MonoToWav(bytes, 24_000),
      mimeType: 'audio/wav',
      filename: rename(filenamePrefix, 'wav') ?? 'audio.wav',
    };
  }
  // Null-prototype map + string guard: an untrusted MIME can't surface an
  // inherited member (function/object), so the upload filename is always a
  // real string and `extOf` never receives a non-string.
  const mapped = WHISPER_FILENAME_BY_MIME[mt];
  const defaultName = typeof mapped === 'string' ? mapped : 'audio.bin';
  return {
    bytes,
    mimeType: mt,
    filename: rename(filenamePrefix, extOf(defaultName)) ?? defaultName,
  };
}

function rename(prefix: string | undefined, ext: string): string | undefined {
  return prefix ? `${prefix}.${ext}` : undefined;
}

function extOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot + 1) : 'bin';
}

/**
 * Wrap raw PCM16 mono samples in a WAV container. Used by recorders that
 * stream `s16le` (ffmpeg's default raw output) so the bytes can be sent
 * to endpoints that only accept container formats.
 */
export function pcm16MonoToWav(pcm: Uint8Array | ArrayBuffer, sampleRate = 24_000): Uint8Array {
  const raw = pcm instanceof Uint8Array ? pcm : new Uint8Array(pcm);
  // 16-bit samples are 2 bytes; a trailing odd byte is half a sample and
  // breaks RIFF even-alignment, so drop it. `subarray` is a view, no copy.
  const data = raw.byteLength & 1 ? raw.subarray(0, raw.byteLength & ~1) : raw;
  // The RIFF/data chunk sizes are unsigned 32-bit; >~4GiB would silently
  // wrap to a tiny size and emit a structurally corrupt WAV. Reject loudly.
  if (data.byteLength > 0xffffffff - 36) {
    throw new RangeError(
      `PCM payload too large for a WAV container (${data.byteLength} bytes; max ${0xffffffff - 36}).`,
    );
  }
  const headerBytes = 44;
  const wav = new Uint8Array(headerBytes + data.byteLength);
  const view = new DataView(wav.buffer);

  writeAscii(wav, 0, 'RIFF');
  view.setUint32(4, 36 + data.byteLength, true);
  writeAscii(wav, 8, 'WAVE');
  writeAscii(wav, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(wav, 36, 'data');
  view.setUint32(40, data.byteLength, true);
  wav.set(data, headerBytes);

  return wav;
}

function writeAscii(target: Uint8Array, offset: number, value: string): void {
  for (let i = 0; i < value.length; i += 1) {
    target[offset + i] = value.charCodeAt(i);
  }
}
