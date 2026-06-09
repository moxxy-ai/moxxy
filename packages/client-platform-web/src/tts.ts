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

// Prime the cache at module load; `voiceschanged` fires once the engine has them
// ready (Chromium returns [] synchronously on the first call).
{
  const s = synth();
  if (s) {
    refreshVoices();
    s.addEventListener?.('voiceschanged', () => refreshVoices());
  }
}

/** Pick the best available voice: a preferred name, else any local English
 *  voice, else any English voice, else the platform default. */
export function pickVoice(): SpeechSynthesisVoice | null {
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
  const audio = new Audio(`data:${mimeType};base64,${base64}`);
  let done = false;
  const finish = (cb?: () => void): void => {
    if (done) return;
    done = true;
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
