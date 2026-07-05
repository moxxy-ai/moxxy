import { synthesizeReply, type SynthesizeReplyResult, type SynthesizerSource } from '@moxxy/channel-kit';
import type { ClientSession as Session } from '@moxxy/sdk';
import { playAudio, type AudioPlaybackOptions, type PlayAudioResult } from '../audio-play.js';

/**
 * Read-aloud machinery for the TUI: the `/speak` command + the auto-speak hook.
 * It turns the assistant's final reply into speech through the session's active
 * {@link @moxxy/sdk!Synthesizer} (via channel-kit's transport-agnostic
 * {@link synthesizeReply}) and plays it through the system audio player (via
 * {@link playAudio}).
 *
 * Text replies always render regardless — read-aloud is best-effort. Nothing
 * here throws into the UI; every failure is surfaced as a subtle notice.
 */

/** Guidance shown when `/speak` (or auto-speak) has no synthesizer to voice. */
export const READ_ALOUD_NO_SYNTH_HINT =
  'Install a text-to-speech backend:\n' +
  '  moxxy plugins install tts-local   (offline)\n' +
  '  moxxy plugins install tts-openai';

const NO_SYNTH_NOTICE = `read-aloud: no active text-to-speech backend.\n${READ_ALOUD_NO_SYNTH_HINT}`;

export interface SpeakCommandInput {
  /** The `/speak` argument: `''`, `on`, `off`, `stop`, `status`, or other. */
  readonly arg: string;
  /** Whether auto-speak is currently on. */
  readonly autoSpeak: boolean;
  /** Whether a synthesizer is active right now. */
  readonly hasSynthesizer: boolean;
}

export type SpeakCommandDecision =
  // Speak the last assistant reply now.
  | { readonly action: 'speak-last' }
  // Turn sticky auto-speak on/off. `reply` is the notice to show.
  | { readonly action: 'auto-on'; readonly reply: string }
  | { readonly action: 'auto-off'; readonly reply: string }
  // Stop current playback.
  | { readonly action: 'stop' }
  // Just show a notice (status, usage, or the no-synthesizer nudge on a bare
  // `/speak` that can't do anything).
  | { readonly action: 'notice'; readonly reply: string };

/**
 * Resolve a `/speak` command line into an action + any notice. Pure, so the
 * on/off/stop/bare parsing and the no-synthesizer nudge are unit-testable
 * without React or a live session. Mirrors channel-kit's `resolveVoiceToggle`:
 *   - bare `/speak` speaks the last reply (nudges to install TTS if none active);
 *   - `on`/`off` toggle sticky auto-speak (turning `on` with no synthesizer
 *     still arms the preference, appending an install hint, so replies start
 *     speaking once a backend is installed);
 *   - `stop` stops current playback;
 *   - `status` reports the auto-speak state.
 */
export function resolveSpeakCommand(input: SpeakCommandInput): SpeakCommandDecision {
  const arg = input.arg.trim().toLowerCase();
  const hint = input.hasSynthesizer ? '' : `\n\n${READ_ALOUD_NO_SYNTH_HINT}`;

  if (arg === '') {
    if (!input.hasSynthesizer) return { action: 'notice', reply: NO_SYNTH_NOTICE };
    return { action: 'speak-last' };
  }
  if (arg === 'stop') return { action: 'stop' };
  if (arg === 'off') return { action: 'auto-off', reply: '🔇 read-aloud OFF.' };
  if (arg === 'on') {
    return {
      action: 'auto-on',
      reply: `🔊 read-aloud ON — I'll speak each final reply aloud.${hint}`,
    };
  }
  if (arg === 'status') {
    const state = input.autoSpeak ? 'ON' : 'OFF';
    const note = input.autoSpeak ? hint : '';
    return { action: 'notice', reply: `read-aloud auto-speak is ${state}.${note}` };
  }
  return {
    action: 'notice',
    reply: `read-aloud: unknown option "${input.arg.trim()}". Usage: /speak [on|off|stop|status]`,
  };
}

/** The final assistant reply text in the log, or null. Picks the most recent
 *  `assistant_message` that actually ended a turn (`stopReason: 'end_turn'`)
 *  with non-empty content — intermediate tool-use messages aren't spoken. The
 *  `seq` lets the auto-speak hook dedupe (don't re-speak an unchanged reply). */
export function lastAssistantReply(
  session: Pick<Session['log'], 'ofType'>,
): { readonly content: string; readonly seq: number } | null {
  const messages = session.ofType('assistant_message');
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.stopReason === 'end_turn' && m.content.trim().length > 0) {
      return { content: m.content, seq: m.seq };
    }
  }
  return null;
}

/** The session slice the read-aloud controller needs. */
export interface ReadAloudSession extends SynthesizerSource {
  readonly log: Pick<Session['log'], 'ofType'>;
}

export interface ReadAloudDeps {
  readonly session: ReadAloudSession;
  readonly setSystemNotice: (notice: string | null) => void;
  /** Injectable synth (tests). Defaults to channel-kit `synthesizeReply`. */
  readonly synthesize?: (
    session: SynthesizerSource,
    text: string,
    opts?: { readonly signal?: AbortSignal },
  ) => Promise<SynthesizeReplyResult>;
  /** Injectable player (tests). Defaults to `playAudio`. */
  readonly play?: (audio: Uint8Array, opts: AudioPlaybackOptions) => Promise<PlayAudioResult>;
  /** Platform override (tests / player selection). */
  readonly platform?: NodeJS.Platform;
}

export interface ReadAloud {
  /** Whether sticky auto-speak is on (in-memory, per TUI session). */
  readonly autoSpeak: boolean;
  /** Dispatch `/speak [on|off|stop|status]`. */
  handleCommand(arg: string): void;
  /** Called on turn completion — speaks the final reply when auto-speak is on
   *  (and the reply is new). Never blocks the turn; never throws. */
  onTurnComplete(): void;
  /** Stop current playback (also invoked by session reset). */
  stop(): void;
  /** Abort any in-flight playback (unmount safety). */
  dispose(): void;
}

/**
 * Build the read-aloud controller. Plain object (no React) so the auto-speak
 * trigger and command dispatch are unit-testable with a fake synthesizer +
 * player. The hook {@link file://./use-read-aloud.ts} wraps this in a ref.
 */
export function createReadAloud(deps: ReadAloudDeps): ReadAloud {
  const synthesize = deps.synthesize ?? synthesizeReply;
  const play = deps.play ?? playAudio;
  const notice = deps.setSystemNotice;

  let autoSpeak = false;
  // The AbortController for the in-flight playback. Starting a new speak (or
  // stop/off/dispose) aborts it, so a second /speak stops the first.
  let current: AbortController | null = null;
  // seq of the last reply we spoke, so auto-speak doesn't re-voice a turn that
  // produced no new final reply (e.g. an errored/aborted turn leaves the prior
  // reply as the log's last one).
  let lastSpokenSeq: number | null = null;

  const abortCurrent = (): void => {
    if (current) {
      current.abort();
      current = null;
    }
  };

  const start = (text: string): void => {
    abortCurrent();
    const controller = new AbortController();
    current = controller;
    notice('🔊 speaking…');
    void runSpeak(text, controller).finally(() => {
      if (current === controller) current = null;
    });
  };

  const runSpeak = async (text: string, controller: AbortController): Promise<void> => {
    const isCurrent = (): boolean => current === controller;
    const signal = controller.signal;

    const synth = await synthesize(deps.session, text, { signal });
    if (!synth.ok) {
      if (signal.aborted) return;
      if (synth.reason === 'no-synthesizer') return void notice(NO_SYNTH_NOTICE);
      if (synth.reason === 'empty') return void notice('read-aloud: nothing to speak in that reply.');
      return void notice(`read-aloud: synthesis failed${synth.error ? ` — ${synth.error}` : ''}.`);
    }

    const result = await play(synth.audio, {
      mimeType: synth.mimeType,
      signal,
      ...(deps.platform ? { platform: deps.platform } : {}),
    });
    if (result.ok) {
      // Clear the "speaking…" notice on a clean finish — but only if we're still
      // the active speak (don't clobber a notice a newer action set).
      if (isCurrent()) notice(null);
      return;
    }
    switch (result.reason) {
      case 'aborted':
        return; // user stopped or a newer /speak superseded — stay quiet
      case 'no-player':
        return void notice(noPlayerNotice(deps.platform ?? process.platform));
      default:
        return void notice(
          `read-aloud: playback failed${result.error ? ` — ${result.error}` : ''}.`,
        );
    }
  };

  const speakLast = (): void => {
    const reply = lastAssistantReply(deps.session.log);
    if (!reply) {
      notice('read-aloud: no assistant reply to speak yet.');
      return;
    }
    lastSpokenSeq = reply.seq;
    start(reply.content);
  };

  return {
    get autoSpeak() {
      return autoSpeak;
    },
    handleCommand(arg: string) {
      const hasSynthesizer = safeHasSynthesizer(deps.session);
      const decision = resolveSpeakCommand({ arg, autoSpeak, hasSynthesizer });
      switch (decision.action) {
        case 'speak-last':
          speakLast();
          return;
        case 'auto-on':
          autoSpeak = true;
          notice(decision.reply);
          return;
        case 'auto-off':
          autoSpeak = false;
          abortCurrent();
          notice(decision.reply);
          return;
        case 'stop':
          if (current) {
            abortCurrent();
            notice('read-aloud: stopped.');
          } else {
            notice('read-aloud: nothing is playing.');
          }
          return;
        case 'notice':
          notice(decision.reply);
          return;
      }
    },
    onTurnComplete() {
      if (!autoSpeak) return;
      const reply = lastAssistantReply(deps.session.log);
      // No new final reply this turn (tool-only / errored / aborted) — don't
      // re-speak the previous one.
      if (!reply || reply.seq === lastSpokenSeq) return;
      lastSpokenSeq = reply.seq;
      start(reply.content);
    },
    stop() {
      abortCurrent();
    },
    dispose() {
      abortCurrent();
    },
  };
}

/** `tryGetActive` can throw on some sessions — treat any failure as "no synth". */
function safeHasSynthesizer(session: SynthesizerSource): boolean {
  try {
    return session.synthesizers.tryGetActive() != null;
  } catch {
    return false;
  }
}

function noPlayerNotice(platform: NodeJS.Platform): string {
  switch (platform) {
    case 'darwin':
      return 'read-aloud: no audio player found (`afplay` ships with macOS — is it on PATH?).';
    case 'linux':
      return 'read-aloud: no audio player found. Install one of: paplay (pulseaudio-utils), aplay (alsa-utils), or ffplay (ffmpeg).';
    case 'win32':
      return 'read-aloud: no audio player available for this format on Windows (WAV plays via PowerShell; install ffmpeg for other formats).';
    default:
      return 'read-aloud: no audio player found — install ffmpeg (ffplay).';
  }
}
