/**
 * Decode a recorded audio Blob (webm/opus, mp4, etc. — whatever MediaRecorder
 * produced) and re-encode it as raw PCM16 LE mono @ 24 kHz — the format moxxy's
 * Codex transcriber expects via the `audio/x-moxxy-pcm16-24khz` MIME flag (the
 * TUI does the same with ffmpeg; the renderer can't ship ffmpeg, so AudioContext
 * does the job). Plus the peak + base64 helpers the capture path needs.
 */

/** The MIME tag the moxxy whisper helpers use to flag "raw PCM16 mono 24 kHz".
 *  The Codex transcriber sees this and wraps the bytes in a WAV header.
 *  Re-exported from the SDK's zero-dep `./transcriber` subpath (the cross-package
 *  source of truth) via a browser-safe entry that never pulls node built-ins. */
export { MOXXY_PCM16_24KHZ_MIME } from '@moxxy/sdk/transcriber';

const TARGET_SAMPLE_RATE = 24_000;

/**
 * Resolve the AudioContext constructor, falling back to the vendor-prefixed
 * `webkitAudioContext` on older WebKit. Centralized so the (necessarily
 * cast-laden) reach for the prefixed global lives in exactly one place.
 */
export function getAudioContextCtor(): typeof AudioContext | undefined {
  if (typeof window === 'undefined') return undefined;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  );
}

export async function audioToPcm16(blob: Blob): Promise<Uint8Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const Ctor = getAudioContextCtor();
  if (!Ctor) throw new Error('AudioContext is not available');

  // OfflineAudioContext lets us decode at any source rate first, then OFFLINE-
  // render to a fixed sample-rate buffer. Cheaper + no realtime playback.
  const decodeCtx = new Ctor();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    void decodeCtx.close();
  }

  // Resample to 24 kHz mono via OfflineAudioContext.
  const targetLength = Math.ceil(decoded.duration * TARGET_SAMPLE_RATE);
  // A decodable-but-empty clip (sub-sample blip / truncated container) yields a
  // 0-frame target; OfflineAudioContext(1, 0, …) throws RangeError. The capture
  // path maps an empty PCM result to a clean "no speech" message, so bail early.
  if (targetLength <= 0 || decoded.length === 0) return new Uint8Array(0);
  const offline = new OfflineAudioContext(1, targetLength, TARGET_SAMPLE_RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  const mono = rendered.getChannelData(0);

  // Float32 (-1..1) → Int16 LE. Clamp + scale.
  const pcm = new Int16Array(mono.length);
  for (let i = 0; i < mono.length; i++) {
    const sample = Math.max(-1, Math.min(1, mono[i] ?? 0));
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
}

/**
 * Largest absolute sample (0..1) in a PCM16 LE buffer. Distinguishes a SILENT
 * capture (mic access denied / muted / wrong input device — the audio track
 * resolved but carries only zeros) from genuine silence the user could fix by
 * speaking up, so the UI can point at the real cause.
 */
export function pcm16Peak(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let peak = 0;
  for (let i = 0; i + 1 < bytes.byteLength; i += 2) {
    const s = Math.abs(view.getInt16(i, true));
    if (s > peak) peak = s;
  }
  return peak / 0x8000;
}

/** Base64-encode a Uint8Array. Builds the binary string with a tight per-byte
 *  loop (no argument spread) so it can't hit the engine-specific
 *  `String.fromCharCode(...)` spread limit — historically lower in
 *  JavaScriptCore, the very older-WebKit target `getAudioContextCtor` caters to —
 *  on the multi-second clips this path repeatedly handles. */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  return btoa(binary);
}
