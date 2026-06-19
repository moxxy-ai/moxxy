/**
 * Web Speech API implementation of the {@link TextToSpeech} capability, plus the
 * standalone functions the desktop's read-aloud button imports directly.
 *
 * Two things make the browser's TTS sound robotic out of the box, both fixed
 * here: it reads markdown punctuation literally (handled by `toSpeakableText`
 * from @moxxy/client-core) and it picks whatever default voice the OS hands back
 * ({@link pickVoice} prefers the good local voices). Everything degrades
 * gracefully: no `speechSynthesis` → {@link speak} is a no-op and {@link
 * isSpeechSupported} is false.
 */

import { toSpeakableText } from '@moxxy/client-core';
import type { TextToSpeech, SpeakOptions, AudioClipHandle } from '@moxxy/client-core';

export type { SpeakOptions, AudioClipHandle };

/** Voices we explicitly prefer, best-first. macOS natural voices lead; the
 *  Google/Microsoft entries cover Chromium/Windows hosts. Matched by prefix so
 *  "Samantha (Enhanced)" / "Microsoft Aria Online" still hit. */
const PREFERRED_VOICES: ReadonlyArray<string> = [
  'Samantha',
  'Allison',
  'Ava',
  'Serena',
  'Zoe',
  'Google US English',
  'Microsoft Aria',
  'Microsoft Jenny',
  'Daniel',
  'Karen',
  'Moira',
];

let cachedVoices: SpeechSynthesisVoice[] = [];

function synth(): SpeechSynthesis | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
}

/** Voice lists load asynchronously on some platforms — warm and cache them on
 *  first access and whenever the engine signals a change. */
function refreshVoices(): SpeechSynthesisVoice[] {
  const s = synth();
  if (!s) return [];
  const v = s.getVoices();
  if (v.length > 0) cachedVoices = v;
  return cachedVoices;
}

let voicesListenerAttached = false;

// Prime the cache and attach the `voiceschanged` listener lazily on first use
// (not at module load) so merely importing the module has no side effect and
// the listener is registered exactly once. `voiceschanged` fires once the
// engine has voices ready (Chromium returns [] synchronously on the first call).
function ensureVoicePriming(): void {
  if (voicesListenerAttached) return;
  const s = synth();
  if (!s) return;
  voicesListenerAttached = true;
  refreshVoices();
  s.addEventListener?.('voiceschanged', () => refreshVoices());
}

/** Pick the best available voice: a preferred name, else any local English
 *  voice, else any English voice, else the platform default. */
export function pickVoice(): SpeechSynthesisVoice | null {
  ensureVoicePriming();
  const all = cachedVoices.length > 0 ? cachedVoices : refreshVoices();
  if (all.length === 0) return null;
  for (const name of PREFERRED_VOICES) {
    const match = all.find((v) => v.name === name || v.name.startsWith(name));
    if (match) return match;
  }
  const enLocal = all.find((v) => v.lang?.startsWith('en') && v.localService);
  if (enLocal) return enLocal;
  return all.find((v) => v.lang?.startsWith('en')) ?? all[0] ?? null;
}

/**
 * Speak `markdown` aloud with the best available voice. Cancels any in-flight
 * utterance first (so re-clicking stops, and a new block never overlaps the
 * previous). Cleans the text via `toSpeakableText`.
 */
export function speak(markdown: string, opts: SpeakOptions = {}): void {
  const s = synth();
  if (!s) {
    opts.onerror?.();
    return;
  }
  s.cancel();
  const utter = new SpeechSynthesisUtterance(toSpeakableText(markdown));
  const voice = pickVoice();
  if (voice) {
    utter.voice = voice;
    utter.lang = voice.lang;
  }
  utter.rate = 1.0;
  utter.pitch = 1.0;
  if (opts.onend) utter.onend = () => opts.onend?.();
  utter.onerror = () => opts.onerror?.();
  s.speak(utter);
}

/** Stop any in-flight speech. Safe to call when unsupported. */
export function cancelSpeech(): void {
  synth()?.cancel();
}

/**
 * Play a base64-encoded audio clip (the output of a runner-side synthesizer
 * plugin, e.g. ElevenLabs) via an `<audio>` element. Returns a handle whose
 * `stop()` halts playback. `onend`/`onerror` mirror {@link SpeakOptions} so
 * callers treat local and remote TTS uniformly.
 */
export function playAudioClip(base64: string, mimeType: string, opts: SpeakOptions = {}): AudioClipHandle {
  // Decode to a Blob + object URL rather than embedding the (potentially
  // multi-MB, unbounded from the runner) clip in a data: URL — the data: form
  // keeps the JS string AND the URL string AND the decoded audio coexisting and
  // can't be revoked, so peak memory is ~2x and release is non-deterministic.
  let objectUrl: string | null = null;
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  } catch {
    objectUrl = null;
  }
  // Fall back to the data: URL if decode/Blob construction failed (malformed
  // base64) so the error still surfaces via the element's onerror, not a throw.
  const audio = new Audio(objectUrl ?? `data:${mimeType};base64,${base64}`);
  let done = false;
  const finish = (cb?: () => void): void => {
    if (done) return;
    done = true;
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
    cb?.();
  };
  audio.onended = () => finish(opts.onend);
  audio.onerror = () => finish(opts.onerror);
  void audio.play().catch(() => finish(opts.onerror));
  return {
    stop: () => {
      try {
        audio.pause();
        audio.src = '';
      } catch {
        /* already gone */
      }
      finish();
    },
  };
}

/** Whether this environment can speak at all (gates the affordance). */
export function isSpeechSupported(): boolean {
  return synth() !== null;
}

/** The capability the desktop registers with `configurePlatform`. */
export const webTts: TextToSpeech = {
  isSupported: isSpeechSupported,
  speak,
  cancel: cancelSpeech,
  playClip: playAudioClip,
};
