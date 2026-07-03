import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import type { SynthesizeOptions, Synthesizer } from '@moxxy/sdk';

/**
 * Voice-reply machinery shared by messaging channels that can speak the final
 * assistant reply through the session's active {@link Synthesizer}
 * (text-to-speech). Everything here is transport-agnostic — turning text into
 * audio, cleaning markdown for speech, transcoding to OGG/Opus, and picking a
 * filename. The messenger-specific delivery (grammy `sendVoice`, a discord.js
 * `AttachmentBuilder`) stays in each channel plugin behind the
 * {@link VoiceReplySink}.
 *
 * The load-bearing guarantee is that NOTHING here throws into the turn path: a
 * missing synthesizer, a TTS failure, a missing ffmpeg, or a transport error
 * all resolve to a typed result. Callers send the text reply first and treat a
 * voice reply as best-effort, so a synth/transcode/delivery failure never
 * breaks the (already-sent) text answer.
 */

/** The slice of a session the voice-reply path needs: the synthesizer view. */
export interface SynthesizerSource {
  readonly synthesizers: { tryGetActive(): Synthesizer | null };
}

/**
 * Strip markdown down to what should be *spoken*. Code fences become a short
 * "(code omitted)" placeholder (reading a diff aloud is noise), links keep only
 * their label, and the inline emphasis/heading/quote/bullet marks are removed
 * so a TTS engine doesn't voice the punctuation. Whitespace is collapsed.
 */
export function toSpeech(markdown: string): string {
  let t = markdown ?? '';
  // Fenced code blocks (closed, then any unterminated trailing fence) → a short
  // spoken placeholder. Must run BEFORE inline-code stripping (fences contain
  // backticks).
  t = t.replace(/```[\s\S]*?```/g, ' (code omitted) ');
  t = t.replace(/```[\s\S]*$/g, ' (code omitted) ');
  // Images `![alt](url)` → alt; links `[label](url)` → label.
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  // Inline code `x` → x.
  t = t.replace(/`([^`]+)`/g, '$1');
  // Emphasis / strikethrough marks.
  t = t.replace(/(\*\*|__|~~|\*|_)/g, '');
  // Leading heading / blockquote / list markers (line-anchored).
  t = t.replace(/^\s{0,3}#{1,6}\s*/gm, '');
  t = t.replace(/^\s{0,3}>\s?/gm, '');
  t = t.replace(/^\s{0,3}[-*+]\s+/gm, '');
  // Collapse runs of spaces/tabs and excess blank lines.
  t = t.replace(/[ \t]+/g, ' ');
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

/** Default ceiling on the characters we hand a TTS backend for one reply. Long
 *  answers are truncated at a sentence/word boundary so synthesis stays fast
 *  and cheap (a spoken 30-page essay helps no one). */
const DEFAULT_MAX_SPEECH_CHARS = 1_200;

function truncateForSpeech(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const sentence = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? '),
    slice.lastIndexOf('\n'),
  );
  const cut = sentence > max * 0.5 ? sentence + 1 : slice.lastIndexOf(' ');
  const head = (cut > 0 ? slice.slice(0, cut) : slice).trim();
  return `${head}…`;
}

export interface SynthesizeReplyOptions extends SynthesizeOptions {
  /** Max characters of speech text handed to the backend. Default 1200. */
  readonly maxChars?: number;
}

export type SynthesizeReplyResult =
  | { readonly ok: true; readonly audio: Uint8Array; readonly mimeType: string }
  // `no-synthesizer`: nothing active (caller may nudge the user to install one).
  // `empty`: the reply had no speakable text (e.g. a tool-only turn).
  // `failed`: the backend threw or returned no audio.
  | { readonly ok: false; readonly reason: 'no-synthesizer' | 'empty' | 'failed'; readonly error?: string };

/**
 * Synthesize a reply through the session's active synthesizer. Cleans markdown
 * for speech ({@link toSpeech}), truncates sensibly, and NEVER throws — every
 * failure mode is a typed `ok:false` result so the turn path stays intact.
 */
export async function synthesizeReply(
  session: SynthesizerSource,
  text: string,
  opts: SynthesizeReplyOptions = {},
): Promise<SynthesizeReplyResult> {
  let synth: Synthesizer | null;
  try {
    synth = session.synthesizers.tryGetActive();
  } catch (err) {
    return { ok: false, reason: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
  if (!synth) return { ok: false, reason: 'no-synthesizer' };

  const speech = truncateForSpeech(toSpeech(text), opts.maxChars ?? DEFAULT_MAX_SPEECH_CHARS);
  if (!speech) return { ok: false, reason: 'empty' };

  const synthOpts: SynthesizeOptions = {};
  if (opts.voice !== undefined) (synthOpts as { voice?: string }).voice = opts.voice;
  if (opts.language !== undefined) (synthOpts as { language?: string }).language = opts.language;
  if (opts.rate !== undefined) (synthOpts as { rate?: number }).rate = opts.rate;
  if (opts.signal !== undefined) (synthOpts as { signal?: AbortSignal }).signal = opts.signal;

  try {
    const result = await synth.synthesize(speech, synthOpts);
    if (!result?.audio || result.audio.byteLength === 0) {
      return { ok: false, reason: 'failed', error: 'synthesizer returned no audio' };
    }
    return { ok: true, audio: result.audio, mimeType: result.mimeType };
  } catch (err) {
    return { ok: false, reason: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
}

/** True for a mime type Telegram accepts as a native voice note (OGG/Opus). */
function isOggOpusMime(mimeType: string): boolean {
  const m = mimeType.toLowerCase();
  return m.includes('opus') || m.includes('ogg');
}

/** Map an audio mime type to a sensible file extension (for the attachment name
 *  a messenger uses to sniff the format). Falls back to `audio` when unknown. */
export function audioExtForMime(mimeType: string): string {
  const m = (mimeType || '').toLowerCase();
  if (m.includes('opus') || m.includes('ogg')) return 'ogg';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('wav')) return 'wav';
  if (m.includes('webm')) return 'webm';
  if (m.includes('aac') || m.includes('m4a') || m.includes('mp4')) return 'm4a';
  if (m.includes('flac')) return 'flac';
  return 'audio';
}

export interface EnsureOggOpusOptions {
  /** Injectable `spawn` for tests. When set, the ffmpeg presence probe is NOT
   *  process-cached (so each test drives a deterministic outcome). */
  readonly spawnImpl?: typeof spawn;
}

export interface EnsureOggOpusResult {
  readonly audio: Uint8Array;
  readonly mimeType: string;
  /** True when ffmpeg ran to produce these bytes. */
  readonly transcoded: boolean;
  /** True when `audio` is OGG/Opus (safe to send as a native voice note); false
   *  when we returned the ORIGINAL bytes because ffmpeg was unavailable — the
   *  caller should then send plain audio instead of a voice note. */
  readonly isOpus: boolean;
}

const TRANSCODE_ARGS = [
  '-hide_banner',
  '-loglevel',
  'error',
  '-i',
  'pipe:0',
  '-f',
  'ogg',
  '-c:a',
  'libopus',
  '-b:a',
  '32k',
  '-ac',
  '1',
  'pipe:1',
];

/** Ceiling on transcoded output we buffer (a runaway/adversarial input can't
 *  grow memory without bound). 25MB is well past any spoken reply. */
const MAX_TRANSCODE_OUTPUT_BYTES = 25 * 1024 * 1024;

/**
 * Ensure audio is OGG/Opus for a native voice note. Passthrough when it already
 * is; otherwise transcode via ffmpeg (stdin→stdout). Gated on an ffmpeg
 * presence probe (mirrors `checkVoiceCaptureAvailable`, cached per process). On
 * no-ffmpeg — or any transcode failure — returns the ORIGINAL bytes with
 * `isOpus:false` so the caller falls back to a plain audio message. Never throws.
 */
export async function ensureOggOpus(
  audio: Uint8Array,
  mimeType: string,
  opts: EnsureOggOpusOptions = {},
): Promise<EnsureOggOpusResult> {
  if (isOggOpusMime(mimeType)) {
    return { audio, mimeType: 'audio/ogg', transcoded: false, isOpus: true };
  }
  const available = await probeFfmpeg(opts.spawnImpl);
  if (!available) return { audio, mimeType, transcoded: false, isOpus: false };
  try {
    const out = await transcodeToOggOpus(audio, opts.spawnImpl ?? spawn);
    if (out.byteLength === 0) return { audio, mimeType, transcoded: false, isOpus: false };
    return { audio: out, mimeType: 'audio/ogg', transcoded: true, isOpus: true };
  } catch {
    return { audio, mimeType, transcoded: false, isOpus: false };
  }
}

// Process-cached ffmpeg availability (the probe spawns a subprocess; caching
// keeps a chatty channel from re-probing on every reply). Tests inject a
// `spawnImpl`, which bypasses the cache.
let ffmpegAvailable: Promise<boolean> | null = null;

async function probeFfmpeg(spawnImpl?: typeof spawn): Promise<boolean> {
  if (spawnImpl) return runFfmpegProbe(spawnImpl);
  ffmpegAvailable ??= runFfmpegProbe(spawn);
  return ffmpegAvailable;
}

/** Reset the cached ffmpeg probe (tests only). */
export function __resetFfmpegProbeForTest(): void {
  ffmpegAvailable = null;
}

function runFfmpegProbe(
  spawnImpl: typeof spawn,
  command = 'ffmpeg',
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
    }, timeoutMs);
    timer.unref?.();
    child.once('error', () => done(false));
    child.once('close', (code) => done(code === 0));
  });
}

function transcodeToOggOpus(
  audio: Uint8Array,
  spawnImpl: typeof spawn,
  command = 'ffmpeg',
  timeoutMs = 15_000,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawnImpl(command, TRANSCODE_ARGS, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
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
      finish(() => reject(new Error('ffmpeg transcode timed out')));
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.on('data', (c: Buffer) => {
      if (over) return;
      if (outBytes + c.byteLength > MAX_TRANSCODE_OUTPUT_BYTES) {
        over = true;
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
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
      finish(() => reject(err instanceof Error ? err : new Error(String(err)))),
    );
    child.once('close', (code) =>
      finish(() => {
        if (code === 0 && out.length > 0) {
          resolve(new Uint8Array(Buffer.concat(out)));
        } else if (code === 0) {
          reject(new Error('ffmpeg produced no output'));
        } else {
          reject(new Error(`ffmpeg exited ${code}: ${Buffer.concat(errChunks).toString('utf8').trim()}`));
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

/** The transport boundary: a channel implements this to actually deliver the
 *  synthesized audio (grammy `sendVoice`/`sendAudio`, discord.js attachment). */
export interface VoiceReplySink {
  send(
    audio: Uint8Array,
    meta: {
      readonly mimeType: string;
      /** Suggested attachment filename, e.g. `reply.ogg` / `reply.mp3`. */
      readonly filename: string;
      /** True when the bytes are OGG/Opus (send as a native voice note); false
       *  when they are plain audio (no ffmpeg to transcode). */
      readonly isVoiceNote: boolean;
    },
  ): Promise<void>;
}

export type VoiceReplyOutcome =
  | { readonly status: 'sent'; readonly transcoded: boolean; readonly isVoiceNote: boolean }
  | { readonly status: 'skipped'; readonly reason: 'no-synthesizer' | 'empty' }
  | { readonly status: 'failed'; readonly reason: 'synth' | 'delivery'; readonly error?: string };

export type DeliverVoiceReplyOptions = SynthesizeReplyOptions & EnsureOggOpusOptions;

/**
 * End-to-end best-effort voice reply: synthesize → ensure OGG/Opus → deliver
 * through the channel's {@link VoiceReplySink}. NEVER throws — every failure is
 * a typed outcome — so a caller can invoke it AFTER sending the text reply and
 * be sure the (already-sent) text is never broken by a voice failure.
 */
export async function deliverVoiceReply(
  session: SynthesizerSource,
  text: string,
  sink: VoiceReplySink,
  opts: DeliverVoiceReplyOptions = {},
): Promise<VoiceReplyOutcome> {
  const synth = await synthesizeReply(session, text, opts);
  if (!synth.ok) {
    if (synth.reason === 'failed') {
      return synth.error !== undefined
        ? { status: 'failed', reason: 'synth', error: synth.error }
        : { status: 'failed', reason: 'synth' };
    }
    return { status: 'skipped', reason: synth.reason };
  }

  const prepared = await ensureOggOpus(synth.audio, synth.mimeType, opts);
  const filename = prepared.isOpus ? 'reply.ogg' : `reply.${audioExtForMime(prepared.mimeType)}`;
  try {
    await sink.send(prepared.audio, {
      mimeType: prepared.mimeType,
      filename,
      isVoiceNote: prepared.isOpus,
    });
  } catch (err) {
    return { status: 'failed', reason: 'delivery', error: err instanceof Error ? err.message : String(err) };
  }
  return { status: 'sent', transcoded: prepared.transcoded, isVoiceNote: prepared.isOpus };
}

export interface VoiceToggleInput {
  /** The `/voice` argument (`''`, `on`, `off`, `status`, or anything → toggle). */
  readonly arg: string;
  /** Current persisted state. */
  readonly enabled: boolean;
  /** Whether a synthesizer is active right now. */
  readonly hasSynthesizer: boolean;
  /** How this channel delivers audio, e.g. `a voice note` / `an audio file`. */
  readonly delivery: string;
  /** Install-guidance line appended when enabling with no active synthesizer. */
  readonly noSynthesizerHint: string;
}

export interface VoiceToggleResult {
  /** Desired enabled state after the command. */
  readonly enabled: boolean;
  /** Whether the caller should persist `enabled` (false for `status`). */
  readonly persist: boolean;
  /** User-facing reply text. */
  readonly reply: string;
}

/**
 * Resolve a channel-agnostic `/voice` toggle command into the new state + the
 * reply to show. `on`/`off` are explicit, `status` just reports, anything else
 * flips. Enabling with no active synthesizer still turns the preference on (so
 * replies start speaking once a backend is installed) but appends install
 * guidance. Wording is parameterized (`delivery`, `noSynthesizerHint`) so each
 * messenger keeps its own phrasing.
 */
export function resolveVoiceToggle(input: VoiceToggleInput): VoiceToggleResult {
  const arg = input.arg.trim().toLowerCase();
  const hint = input.hasSynthesizer ? '' : `\n\n${input.noSynthesizerHint}`;

  if (arg === 'status') {
    const state = input.enabled ? 'ON' : 'OFF';
    const note = input.enabled ? hint : '';
    return { enabled: input.enabled, persist: false, reply: `Voice replies are ${state}.${note}` };
  }

  const desired = arg === 'on' ? true : arg === 'off' ? false : !input.enabled;
  if (!desired) {
    return { enabled: false, persist: true, reply: '🔇 Voice replies OFF.' };
  }
  return {
    enabled: true,
    persist: true,
    reply: `🔊 Voice replies ON — I'll speak my final reply as ${input.delivery}.${hint}`,
  };
}
