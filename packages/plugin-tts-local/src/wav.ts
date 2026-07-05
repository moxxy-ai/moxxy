/**
 * Minimal float32 → PCM16 mono WAV encoder.
 *
 * sherpa-onnx hands back `{ samples: Float32Array in [-1, 1], sampleRate }`.
 * Read-aloud surfaces and channel voice replies want playable container bytes,
 * so we wrap the samples in a canonical 44-byte RIFF/WAVE header + 16-bit PCM
 * little-endian data. Kept dependency-free and self-contained (deliberately NOT
 * imported from plugin-stt-whisper) and covered by golden tests — the header
 * offsets are load-bearing.
 */

/** Bytes in the RIFF/WAVE header preceding the PCM data. */
export const WAV_HEADER_BYTES = 44;

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
}

/**
 * Encode float samples as a mono 16-bit PCM WAV. `sampleRate` must be a
 * positive integer (sherpa reports e.g. 22050). Samples are clamped to
 * [-1, 1]; non-finite samples encode as silence.
 */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error(`encodeWav: invalid sampleRate ${sampleRate}`);
  }
  const rate = Math.round(sampleRate);
  const numSamples = samples.length;
  const bytesPerSample = 2; // PCM16
  const blockAlign = bytesPerSample; // mono
  const byteRate = rate * blockAlign;
  const dataSize = numSamples * bytesPerSample;
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataSize);
  const view = new DataView(buffer);

  // RIFF chunk descriptor
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true); // ChunkSize = 4 + (8 + Subchunk1) + (8 + data)
  writeAscii(view, 8, 'WAVE');
  // fmt subchunk
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size for PCM
  view.setUint16(20, 1, true); // AudioFormat = 1 (PCM)
  view.setUint16(22, 1, true); // NumChannels = 1 (mono)
  view.setUint32(24, rate, true); // SampleRate
  view.setUint32(28, byteRate, true); // ByteRate
  view.setUint16(32, blockAlign, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample
  // data subchunk
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = WAV_HEADER_BYTES;
  for (let i = 0; i < numSamples; i += 1) {
    const raw = samples[i];
    const s = Number.isFinite(raw as number) ? Math.max(-1, Math.min(1, raw as number)) : 0;
    // Asymmetric scaling so full-scale positive/negative map to the int16 range
    // edges without overflow.
    const int16 = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
    view.setInt16(offset, int16, true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}
