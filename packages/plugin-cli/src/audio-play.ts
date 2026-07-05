import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Play synthesized audio bytes through the platform's system audio player. This
 * is the read-aloud counterpart to {@link file://./voice-input.ts} (which
 * *captures* audio via ffmpeg): here we take the OGG/MP3/WAV a
 * {@link @moxxy/sdk!Synthesizer} produced and hand it to a native player.
 *
 * The load-bearing guarantee mirrors the voice-reply path: NOTHING here throws
 * into the UI. A missing player, an unsupported format, an abort, or a player
 * that exits non-zero all resolve to a typed {@link PlayAudioResult}. The caller
 * (the `/speak` machinery) renders text replies regardless, so a playback
 * failure is always best-effort.
 *
 * ## Player matrix
 *   - **darwin** — `afplay` (built into macOS; CoreAudio handles WAV/MP3/M4A/AAC
 *     but not OGG/Opus), falling back to `ffplay` for OGG/Opus when present.
 *   - **linux** — first available of `paplay` (PulseAudio), `aplay` (ALSA, WAV
 *     only), then `ffplay -nodisp -autoexit -loglevel quiet` (universal).
 *   - **win32** — PowerShell `Media.SoundPlayer` (WAV only), falling back to
 *     `ffplay` for other formats when present.
 *
 * Playback is abortable: a second `/speak` (or `/speak stop`, or Ctrl+C) aborts
 * the {@link AudioPlaybackOptions.signal}, which SIGKILLs the spawned player.
 */

/** How each supported player is invoked + which formats it can handle. */
interface PlayerCandidate {
  readonly command: string;
  /** Args used to presence-probe the binary (a successful spawn proves it
   *  exists; the exact flag is irrelevant since we resolve on `spawn`). */
  readonly probeArgs: readonly string[];
  buildArgs(file: string): string[];
  /** Whether this player can voice the given mime type. */
  supports(mimeType: string): boolean;
}

function isWavMime(mimeType: string): boolean {
  return /wav/i.test(mimeType);
}

function isOggOpusWebmMime(mimeType: string): boolean {
  return /(opus|ogg|webm)/i.test(mimeType);
}

const AFPLAY: PlayerCandidate = {
  command: 'afplay',
  probeArgs: ['-h'],
  buildArgs: (file) => [file],
  // CoreAudio decodes WAV/MP3/M4A/AAC/AIFF but not OGG/Opus/WebM.
  supports: (mimeType) => !isOggOpusWebmMime(mimeType),
};

const FFPLAY: PlayerCandidate = {
  command: 'ffplay',
  probeArgs: ['-version'],
  buildArgs: (file) => ['-nodisp', '-autoexit', '-loglevel', 'quiet', file],
  supports: () => true,
};

const PAPLAY: PlayerCandidate = {
  command: 'paplay',
  probeArgs: ['--version'],
  buildArgs: (file) => [file],
  supports: () => true,
};

const APLAY: PlayerCandidate = {
  command: 'aplay',
  probeArgs: ['--version'],
  buildArgs: (file) => ['-q', file],
  supports: (mimeType) => isWavMime(mimeType),
};

const POWERSHELL: PlayerCandidate = {
  command: 'powershell',
  probeArgs: ['-NoProfile', '-Command', 'exit'],
  // Media.SoundPlayer.PlaySync blocks until the WAV finishes, then exits — so a
  // SIGKILL on abort stops playback. Temp filenames never contain a quote.
  buildArgs: (file) => [
    '-NoProfile',
    '-Command',
    `$p = New-Object Media.SoundPlayer '${file}'; $p.PlaySync();`,
  ],
  supports: (mimeType) => isWavMime(mimeType),
};

function playerCandidates(platform: NodeJS.Platform): readonly PlayerCandidate[] {
  switch (platform) {
    case 'darwin':
      return [AFPLAY, FFPLAY];
    case 'linux':
      return [PAPLAY, APLAY, FFPLAY];
    case 'win32':
      return [POWERSHELL, FFPLAY];
    default:
      return [FFPLAY];
  }
}

function probeArgsFor(command: string): readonly string[] {
  for (const platform of ['darwin', 'linux', 'win32'] as const) {
    const found = playerCandidates(platform).find((c) => c.command === command);
    if (found) return found.probeArgs;
  }
  return ['-version'];
}

export type SelectAudioPlayerResult =
  | { readonly ok: true; readonly command: string; buildArgs(file: string): string[] }
  // `no-player`: no installed player on this platform can voice the format
  // (ffplay is a universal fallback on every platform, so a format is never
  // intrinsically unsupported — it just means nothing is installed).
  | { readonly ok: false; readonly reason: 'no-player' };

/**
 * Pick the audio player for a platform + mime type. Walks the platform's
 * ordered candidate list, keeps the ones that can voice the format, and returns
 * the first that `isAvailable` confirms is installed. Pure but for the
 * (injectable) availability probe, so the per-platform pick is unit-testable.
 */
export async function selectAudioPlayer(
  platform: NodeJS.Platform,
  mimeType: string,
  isAvailable: (command: string) => boolean | Promise<boolean>,
): Promise<SelectAudioPlayerResult> {
  const supporting = playerCandidates(platform).filter((c) => c.supports(mimeType));
  for (const candidate of supporting) {
    if (await isAvailable(candidate.command)) {
      return { ok: true, command: candidate.command, buildArgs: candidate.buildArgs };
    }
  }
  return { ok: false, reason: 'no-player' };
}

// Process-cached player-presence probes (each probe spawns a subprocess;
// caching keeps repeated /speak calls from re-probing every time). Tests reset
// via `__resetAudioPlayerProbeForTest`. Unlike the ffmpeg probe we cache even
// when a spawn is injected, so a caching test can assert one probe per command.
const probeCache = new Map<string, Promise<boolean>>();

/** Reset the cached player-presence probes (tests only). */
export function __resetAudioPlayerProbeForTest(): void {
  probeCache.clear();
}

function cachedProbe(command: string, spawnImpl?: typeof spawn): Promise<boolean> {
  const cached = probeCache.get(command);
  if (cached) return cached;
  const probe = probePlayerPresent(command, probeArgsFor(command), spawnImpl ?? spawn);
  probeCache.set(command, probe);
  return probe;
}

function probePlayerPresent(
  command: string,
  probeArgs: readonly string[],
  spawnImpl: typeof spawn,
  timeoutMs = 1_500,
): Promise<boolean> {
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
      child = spawnImpl(command, [...probeArgs], { stdio: ['ignore', 'ignore', 'ignore'] });
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
    }, timeoutMs);
    timer.unref?.();
    // A successful spawn is all "present" needs — kill immediately so a player
    // probed with a throwaway flag can't linger.
    child.once('spawn', () => {
      try {
        if (!child.killed) child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      done(true);
    });
    // ENOENT (or any pre-spawn failure) means the binary isn't on PATH.
    child.once('error', () => done(false));
    // A fake/tool that exits before we observe `spawn` still proved it ran.
    child.once('close', () => done(true));
  });
}

export interface AudioPlaybackAvailability {
  readonly available: boolean;
  /** The player command that would be used, or null when none is installed. */
  readonly player: string | null;
  readonly platform: NodeJS.Platform;
}

export interface AudioPlaybackAvailabilityOptions {
  readonly platform?: NodeJS.Platform;
  readonly spawnImpl?: typeof spawn;
  /** Injectable availability check (tests). Bypasses the cached spawn probe. */
  readonly isAvailable?: (command: string) => boolean | Promise<boolean>;
}

/**
 * Whether ANY audio player is installed for this platform (ignoring format).
 * Powers the read-aloud readiness notice; the real format-aware pick happens in
 * {@link playAudio}.
 */
export async function checkAudioPlaybackAvailable(
  opts: AudioPlaybackAvailabilityOptions = {},
): Promise<AudioPlaybackAvailability> {
  const platform = opts.platform ?? process.platform;
  const isAvailable = opts.isAvailable ?? ((command: string) => cachedProbe(command, opts.spawnImpl));
  for (const candidate of playerCandidates(platform)) {
    if (await isAvailable(candidate.command)) {
      return { available: true, player: candidate.command, platform };
    }
  }
  return { available: false, player: null, platform };
}

export type PlayAudioResult =
  | { readonly ok: true; readonly player: string }
  // `aborted`: the signal fired (user stopped, or a newer /speak superseded).
  // `no-player`: no installed player can voice the format on this platform.
  // `failed`: temp-write, spawn, timeout, or non-zero exit.
  | {
      readonly ok: false;
      readonly reason: 'aborted' | 'no-player' | 'failed';
      readonly error?: string;
    };

export interface AudioPlaybackOptions {
  /** Mime type of `audio` (drives the player pick + temp-file extension). */
  readonly mimeType: string;
  readonly platform?: NodeJS.Platform;
  /** Abort to stop playback (kills the spawned player). */
  readonly signal?: AbortSignal;
  /** Injectable spawn for tests (drives BOTH the presence probe and the player
   *  child). */
  readonly spawnImpl?: typeof spawn;
  /** Injectable availability check (tests) — bypasses the probe so the player
   *  pick is deterministic. */
  readonly isAvailable?: (command: string) => boolean | Promise<boolean>;
  /** Temp directory for the scratch audio file. Defaults to `os.tmpdir()`. */
  readonly tmpDir?: string;
  /** Hard ceiling on playback (a stuck player can't hang forever). Default 5m. */
  readonly timeoutMs?: number;
}

/** A spoken reply is short (synthesizeReply caps speech text); 5 minutes is a
 *  generous ceiling that still reaps a wedged player. */
const DEFAULT_PLAYBACK_TIMEOUT_MS = 5 * 60_000;

/**
 * Play `audio` through the platform's system player. Writes the bytes to a temp
 * file (cleaned up after), picks the player via {@link selectAudioPlayer}, and
 * spawns it — SIGKILLing on abort. NEVER throws: every failure mode is a typed
 * {@link PlayAudioResult}.
 */
export async function playAudio(
  audio: Uint8Array,
  opts: AudioPlaybackOptions,
): Promise<PlayAudioResult> {
  const platform = opts.platform ?? process.platform;
  const spawnImpl = opts.spawnImpl ?? spawn;
  const isAvailable =
    opts.isAvailable ?? ((command: string) => cachedProbe(command, opts.spawnImpl));

  if (opts.signal?.aborted) return { ok: false, reason: 'aborted' };

  const selection = await selectAudioPlayer(platform, opts.mimeType, isAvailable);
  if (!selection.ok) return { ok: false, reason: selection.reason };

  let file: string;
  try {
    file = await writeTempAudio(audio, opts.mimeType, opts.tmpDir);
  } catch (err) {
    return { ok: false, reason: 'failed', error: errMessage(err) };
  }

  try {
    return await spawnPlayer(
      selection.command,
      selection.buildArgs(file),
      spawnImpl,
      opts.signal,
      opts.timeoutMs ?? DEFAULT_PLAYBACK_TIMEOUT_MS,
    );
  } finally {
    void rm(file, { force: true }).catch(() => undefined);
  }
}

function spawnPlayer(
  command: string,
  args: string[],
  spawnImpl: typeof spawn,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<PlayAudioResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawnImpl(command, args, { stdio: ['ignore', 'ignore', 'ignore'] });
    } catch (err) {
      resolve({ ok: false, reason: 'failed', error: errMessage(err) });
      return;
    }
    let settled = false;
    let aborted = false;
    const onAbort = (): void => {
      aborted = true;
      try {
        if (!child.killed) child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    };
    const done = (result: PlayAudioResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try {
        if (!child.killed) child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      done({ ok: false, reason: 'failed', error: 'audio playback timed out' });
    }, timeoutMs);
    timer.unref?.();

    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    child.once('error', (err) => done({ ok: false, reason: 'failed', error: errMessage(err) }));
    child.once('close', (code) => {
      if (aborted) return done({ ok: false, reason: 'aborted' });
      if (code === 0) return done({ ok: true, player: command });
      return done({
        ok: false,
        reason: 'failed',
        error: `${command} exited with code ${code ?? 'null'}`,
      });
    });
  });
}

async function writeTempAudio(
  audio: Uint8Array,
  mimeType: string,
  tmpDir?: string,
): Promise<string> {
  const dir = tmpDir ?? os.tmpdir();
  const suffix = Math.random().toString(36).slice(2, 10);
  const file = path.join(dir, `moxxy-speak-${process.pid}-${Date.now()}-${suffix}.${extForMime(mimeType)}`);
  await writeFile(file, Buffer.from(audio));
  return file;
}

/** Map an audio mime type to a file extension (players sniff by content, but a
 *  sensible extension helps — and SoundPlayer requires `.wav`). */
function extForMime(mimeType: string): string {
  const m = (mimeType || '').toLowerCase();
  if (m.includes('wav')) return 'wav';
  if (m.includes('opus') || m.includes('ogg')) return 'ogg';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('webm')) return 'webm';
  if (m.includes('aac') || m.includes('m4a') || m.includes('mp4')) return 'm4a';
  if (m.includes('flac')) return 'flac';
  if (m.includes('aiff')) return 'aiff';
  return 'audio';
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
