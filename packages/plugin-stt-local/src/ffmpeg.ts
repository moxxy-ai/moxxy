/**
 * The ffmpeg fallback for compressed audio (ogg/opus voice notes, mp3, m4a,
 * webm, …) that we can't decode in-process. ffmpeg reads the container on stdin
 * and writes raw 32-bit-float mono PCM at 16 kHz to stdout, which we read
 * straight into a Float32Array — no intermediate WAV, no temp files.
 *
 * Gated behind a presence probe (mirrors channel-kit's voice-reply, cached per
 * process; an injected `spawnImpl` bypasses the cache so tests are
 * deterministic). When ffmpeg is absent we throw a clear, actionable MoxxyError
 * — raw PCM16 and PCM16 WAV keep working without it, only compressed input
 * needs it.
 */

import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';

import { getInstallHint, MoxxyError } from '@moxxy/sdk';

import { TARGET_SAMPLE_RATE } from './audio.js';

/** ffmpeg args: decode any input container → f32le mono @ 16 kHz on stdout. */
const DECODE_ARGS = [
  '-hide_banner',
  '-loglevel',
  'error',
  '-i',
  'pipe:0',
  '-f',
  'f32le',
  '-ac',
  '1',
  '-ar',
  String(TARGET_SAMPLE_RATE),
  'pipe:1',
];

/** Ceiling on decoded PCM we buffer. At 16 kHz f32 mono (64 KB/s) this is ~30
 *  minutes — well past any voice note, and bounds an adversarial input. */
const MAX_DECODED_BYTES = 120 * 1024 * 1024;

const PROBE_TIMEOUT_MS = 1_500;
const DECODE_TIMEOUT_MS = 60_000;

/**
 * Decode compressed audio bytes to Float32 mono @ 16 kHz via ffmpeg. Throws a
 * `PLUGIN_LOAD_FAILED` MoxxyError (with an OS-specific install hint) when ffmpeg
 * isn't on PATH, and an `INTERNAL` MoxxyError when ffmpeg runs but fails.
 */
export async function decodeViaFfmpeg(
  audio: Uint8Array,
  spawnImpl?: typeof spawn,
): Promise<Float32Array> {
  const available = await probeFfmpeg(spawnImpl);
  if (!available) throw missingFfmpegError();
  const raw = await runDecode(audio, spawnImpl ?? spawn);
  return f32leToFloat32(raw);
}

/** The user-facing error raised when compressed audio arrives but ffmpeg is
 *  absent. Exported so the decode orchestrator / tests can assert on it. */
export function missingFfmpegError(): MoxxyError {
  const hint = getInstallHint('ffmpeg');
  return new MoxxyError({
    code: 'PLUGIN_LOAD_FAILED',
    message:
      'Local Whisper needs ffmpeg to decode compressed audio (ogg/opus, mp3, m4a, webm). Raw PCM and 16-bit PCM WAV transcribe without it.',
    hint: `Install ffmpeg via ${hint.manager}: \`${hint.command}\`.`,
  });
}

// Process-cached ffmpeg availability (the probe spawns a subprocess; caching
// keeps a chatty voice channel from re-probing on every note). An injected
// `spawnImpl` (tests) bypasses the cache.
let ffmpegAvailable: Promise<boolean> | null = null;

async function probeFfmpeg(spawnImpl?: typeof spawn): Promise<boolean> {
  if (spawnImpl) return runProbe(spawnImpl);
  ffmpegAvailable ??= runProbe(spawn);
  return ffmpegAvailable;
}

/** Reset the cached ffmpeg probe (tests only). */
export function __resetFfmpegProbeForTest(): void {
  ffmpegAvailable = null;
}

function runProbe(spawnImpl: typeof spawn, command = 'ffmpeg'): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawnImpl(command, ['-version'], { stdio: ['ignore', 'ignore', 'ignore'] });
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      try {
        if (!child.killed) child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      done(false);
    }, PROBE_TIMEOUT_MS);
    timer.unref?.();
    child.once('error', () => done(false));
    child.once('close', (code) => done(code === 0));
  });
}

function runDecode(audio: Uint8Array, spawnImpl: typeof spawn, command = 'ffmpeg'): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawnImpl(command, DECODE_ARGS, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      reject(decodeFailure(err instanceof Error ? err.message : String(err)));
      return;
    }
    const out: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let outBytes = 0;
    let over = false;
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      try {
        if (!child.killed) child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      finish(() => reject(decodeFailure('ffmpeg decode timed out')));
    }, DECODE_TIMEOUT_MS);
    timer.unref?.();

    child.stdout?.on('data', (c: Buffer) => {
      if (over) return;
      if (outBytes + c.byteLength > MAX_DECODED_BYTES) {
        over = true;
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
        finish(() => reject(decodeFailure('decoded audio exceeded the size limit')));
        return;
      }
      outBytes += c.byteLength;
      out.push(Buffer.from(c));
    });
    child.stderr?.on('data', (c: Buffer) => {
      errChunks.push(Buffer.from(c));
      while (Buffer.concat(errChunks).byteLength > 4_096) errChunks.shift();
    });
    child.once('error', (err) =>
      finish(() => reject(decodeFailure(err instanceof Error ? err.message : String(err)))),
    );
    child.once('close', (code) =>
      finish(() => {
        if (over) return; // already rejected on the size cap
        if (code === 0 && out.length > 0) {
          resolve(Buffer.concat(out));
        } else if (code === 0) {
          reject(decodeFailure('ffmpeg produced no audio'));
        } else {
          reject(
            decodeFailure(`ffmpeg exited ${code}: ${Buffer.concat(errChunks).toString('utf8').trim()}`),
          );
        }
      }),
    );

    const stdin = child.stdin;
    if (stdin) {
      stdin.on('error', () => {
        // EPIPE if ffmpeg died before consuming stdin — the close/error handler
        // reports the real failure; swallow this to avoid an unhandled 'error'.
      });
      try {
        stdin.end(Buffer.from(audio));
      } catch {
        /* the close/error path reports it */
      }
    }
  });
}

/** Reinterpret little-endian float32 bytes as a Float32Array. Copies through a
 *  DataView so a non-4-aligned Buffer offset and big-endian hosts both work. */
function f32leToFloat32(buf: Buffer): Float32Array {
  const usable = buf.byteLength - (buf.byteLength % 4);
  const count = usable / 4;
  const out = new Float32Array(count);
  const view = new DataView(buf.buffer, buf.byteOffset, usable);
  for (let i = 0; i < count; i += 1) out[i] = view.getFloat32(i * 4, true);
  return out;
}

function decodeFailure(detail: string): MoxxyError {
  return new MoxxyError({
    code: 'INTERNAL',
    message: `Local Whisper failed to decode audio with ffmpeg: ${detail}`,
  });
}
