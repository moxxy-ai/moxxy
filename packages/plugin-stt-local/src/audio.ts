/**
 * Pure, dependency-free audio DSP for the local Whisper transcriber. sherpa's
 * OfflineRecognizer wants Float32 mono PCM in [-1, 1] at 16 kHz; inbound audio
 * arrives in several shapes, so these helpers convert each to that canonical
 * form IN-PROCESS (no ffmpeg for raw PCM / WAV):
 *
 *   - `pcm16ToFloat32`  int16 little-endian bytes → Float32 in [-1, 1]
 *   - `downmixToMono`   interleaved N-channel Float32 → averaged mono
 *   - `resampleLinear`  linear-interpolation resample between two rates
 *   - `parseWav`        RIFF/WAVE header parse → PCM16 samples (float) + rate +
 *                       channels; rejects non-PCM16 (float/compressed) WAV
 *
 * The `decodeToMono16k` orchestrator (in ./decode.ts) drives these plus the
 * ffmpeg path. Everything here is synchronous and unit-tested against synthetic
 * fixtures — the header offsets and the resampler math are load-bearing.
 */

import { MoxxyError } from '@moxxy/sdk';

/** The sample rate sherpa's Whisper feature extractor expects. */
export const TARGET_SAMPLE_RATE = 16_000;

/** Full-scale divisor: int16 spans [-32768, 32767]; dividing by 32768 keeps
 *  the result in [-1, 1) without clipping the negative rail. */
const INT16_SCALE = 32_768;

/**
 * Convert raw 16-bit little-endian PCM bytes to Float32 in [-1, 1]. A trailing
 * odd byte (half a sample) is dropped. Channel interleaving is preserved — a
 * stereo buffer stays interleaved, so callers downmix afterwards.
 */
export function pcm16ToFloat32(pcm: Uint8Array | ArrayBuffer): Float32Array {
  const bytes = pcm instanceof Uint8Array ? pcm : new Uint8Array(pcm);
  const usable = bytes.byteLength & ~1; // drop a trailing odd byte
  const count = usable / 2;
  const out = new Float32Array(count);
  // Read via DataView so we don't depend on the platform being little-endian
  // and don't require the byte offset to be 2-aligned (a subarray view can
  // start on an odd offset).
  const view = new DataView(bytes.buffer, bytes.byteOffset, usable);
  for (let i = 0; i < count; i += 1) {
    out[i] = view.getInt16(i * 2, true) / INT16_SCALE;
  }
  return out;
}

/**
 * Average `channels` interleaved Float32 channels down to mono. `channels` must
 * be a positive integer; a value of 1 returns the input unchanged. Trailing
 * samples that don't complete a frame are ignored.
 */
export function downmixToMono(interleaved: Float32Array, channels: number): Float32Array {
  if (!Number.isInteger(channels) || channels < 1) {
    throw new MoxxyError({
      code: 'INTERNAL',
      message: `downmixToMono: invalid channel count ${channels}.`,
    });
  }
  if (channels === 1) return interleaved;
  const frames = Math.floor(interleaved.length / channels);
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f += 1) {
    let sum = 0;
    const base = f * channels;
    for (let c = 0; c < channels; c += 1) sum += interleaved[base + c]!;
    out[f] = sum / channels;
  }
  return out;
}

/**
 * Resample mono Float32 audio from `fromRate` to `toRate` by linear
 * interpolation. Cheap and dependency-free — good enough for speech recognition
 * (Whisper is robust to the mild low-pass a linear kernel imposes). Returns the
 * input unchanged when the rates match, and an empty array for empty input.
 */
export function resampleLinear(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (!Number.isFinite(fromRate) || !Number.isFinite(toRate) || fromRate <= 0 || toRate <= 0) {
    throw new MoxxyError({
      code: 'INTERNAL',
      message: `resampleLinear: invalid rate(s) from=${fromRate} to=${toRate}.`,
    });
  }
  if (fromRate === toRate) return input;
  if (input.length === 0) return new Float32Array(0);
  if (input.length === 1) return Float32Array.of(input[0]!);

  const ratio = fromRate / toRate;
  const outLen = Math.max(1, Math.round(input.length / ratio));
  const out = new Float32Array(outLen);
  const lastIdx = input.length - 1;
  for (let i = 0; i < outLen; i += 1) {
    const srcPos = i * ratio;
    const i0 = Math.floor(srcPos);
    if (i0 >= lastIdx) {
      out[i] = input[lastIdx]!;
      continue;
    }
    const frac = srcPos - i0;
    out[i] = input[i0]! * (1 - frac) + input[i0 + 1]! * frac;
  }
  return out;
}

/** True when `bytes` begins with the `RIFF….WAVE` magic of a WAV container. */
export function isRiffWave(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x41 && // A
    bytes[10] === 0x56 && // V
    bytes[11] === 0x45 // E
  );
}

export interface ParsedWav {
  /** PCM samples as Float32 in [-1, 1], still interleaved if multi-channel. */
  readonly samples: Float32Array;
  readonly sampleRate: number;
  readonly channels: number;
}

// WAV `fmt ` audio-format codes we care about.
const WAVE_FORMAT_PCM = 1;
const WAVE_FORMAT_IEEE_FLOAT = 3;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

/**
 * Parse a canonical RIFF/WAVE buffer into PCM16 samples. Only linear 16-bit PCM
 * is accepted — IEEE-float, μ-law, and compressed WAV are rejected with a clear
 * `CONFIG_INVALID` MoxxyError (the caller falls back to ffmpeg for real
 * compressed formats, but a mislabelled/exotic WAV should fail loudly, not
 * silently mis-decode). Walks the chunk list rather than assuming a fixed
 * 44-byte header, so files with extra chunks (`LIST`, `fact`, …) still parse.
 */
export function parseWav(bytes: Uint8Array): ParsedWav {
  if (!isRiffWave(bytes)) {
    throw wavError('not a RIFF/WAVE file (bad magic).');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let fmt: { format: number; channels: number; sampleRate: number; bitsPerSample: number } | null =
    null;
  let dataOffset = -1;
  let dataLen = 0;

  // Chunks begin right after `RIFF<size>WAVE` (offset 12). Each chunk is a
  // 4-byte id + uint32 little-endian size + payload, word-aligned (odd payloads
  // carry a pad byte).
  let off = 12;
  while (off + 8 <= bytes.byteLength) {
    const id = ascii4(bytes, off);
    const size = view.getUint32(off + 4, true);
    const body = off + 8;
    if (id === 'fmt ') {
      if (body + 16 > bytes.byteLength) throw wavError('truncated fmt chunk.');
      fmt = {
        format: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      dataOffset = body;
      // Clamp a declared size that overruns the buffer (some encoders write 0
      // or 0xffffffff for streamed data) to what's actually present.
      dataLen = Math.min(size, bytes.byteLength - body);
    }
    // Advance past the payload + pad byte. Guard against a zero/garbage size
    // that would loop forever.
    const advance = 8 + size + (size & 1);
    if (advance <= 8) break;
    off += advance;
  }

  if (!fmt) throw wavError('missing fmt chunk.');
  if (dataOffset < 0) throw wavError('missing data chunk.');

  const { format, channels, sampleRate, bitsPerSample } = fmt;
  if (!Number.isInteger(channels) || channels < 1) {
    throw wavError(`unsupported channel count ${channels}.`);
  }
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw wavError(`unsupported sample rate ${sampleRate}.`);
  }
  // Accept plain PCM; also accept EXTENSIBLE only when it's declared 16-bit PCM
  // (a common wrapper the codecs emit for the same data). Reject float/exotic.
  const isPcm16 =
    (format === WAVE_FORMAT_PCM || format === WAVE_FORMAT_EXTENSIBLE) && bitsPerSample === 16;
  if (!isPcm16) {
    const kind =
      format === WAVE_FORMAT_IEEE_FLOAT
        ? 'IEEE float'
        : format === WAVE_FORMAT_PCM || format === WAVE_FORMAT_EXTENSIBLE
          ? `${bitsPerSample}-bit PCM`
          : `format 0x${format.toString(16)}`;
    throw wavError(
      `unsupported WAV encoding (${kind}). Only 16-bit PCM WAV is decoded in-process; re-export as PCM16 WAV, or install ffmpeg to decode other formats.`,
    );
  }

  const pcm = bytes.subarray(dataOffset, dataOffset + dataLen);
  return { samples: pcm16ToFloat32(pcm), sampleRate, channels };
}

function ascii4(bytes: Uint8Array, off: number): string {
  return String.fromCharCode(bytes[off]!, bytes[off + 1]!, bytes[off + 2]!, bytes[off + 3]!);
}

function wavError(detail: string): MoxxyError {
  return new MoxxyError({ code: 'CONFIG_INVALID', message: `Invalid WAV audio: ${detail}` });
}
