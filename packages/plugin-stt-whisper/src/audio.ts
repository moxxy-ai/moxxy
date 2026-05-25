/**
 * Audio helpers shared across STT plugins. Whisper-family backends — the
 * generic OpenAI Whisper endpoint, the Codex OAuth `/transcribe` proxy,
 * any future Whisper-compatible vendor — all want the same preprocessing
 * (filename inference from MIME, raw PCM16 → WAV wrapping). Centralizing
 * them here keeps the wrapper plugins thin.
 */

/** A custom MIME tag used by the TUI voice recorder to flag raw PCM16
 *  mono @ 24kHz bytes (ffmpeg's `-f s16le` output) so the transcriber
 *  knows to wrap them in a WAV header before upload. Public so other
 *  recorders / channels can mark their captures identically. */
export const MOXXY_PCM16_24KHZ_MIME = 'audio/x-moxxy-pcm16-24khz';

/** Default filename per MIME type, used to set the upload `filename` so
 *  the vendor's content sniffer routes to the right decoder. Defaults to
 *  `audio.bin` for anything unmapped. */
export const WHISPER_FILENAME_BY_MIME: Readonly<Record<string, string>> = {
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
};

export function whisperFilenameFor(mimeType: string): string {
  return WHISPER_FILENAME_BY_MIME[mimeType] ?? 'audio.bin';
}

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
  const mt = mimeType || 'audio/wav';
  if (mt === MOXXY_PCM16_24KHZ_MIME) {
    return {
      bytes: pcm16MonoToWav(bytes, 24_000),
      mimeType: 'audio/wav',
      filename: rename(filenamePrefix, 'wav') ?? 'audio.wav',
    };
  }
  const defaultName = WHISPER_FILENAME_BY_MIME[mt] ?? 'audio.bin';
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
  const data = pcm instanceof Uint8Array ? pcm : new Uint8Array(pcm);
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
