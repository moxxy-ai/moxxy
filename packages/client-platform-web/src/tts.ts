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
import { getAudioContextCtor } from './pcm16.js';

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

interface VoiceCandidate {
  readonly name: string;
  readonly lang: string;
  readonly localService: boolean;
}

/** Pure voice selection: matching local language first, natural-name ranking
 *  within that language, then remote matching voice and platform default. */
export function selectBestVoice<T extends VoiceCandidate>(
  voices: ReadonlyArray<T>,
  language = 'en',
): T | null {
  if (voices.length === 0) return null;
  const base = language.toLocaleLowerCase().split('-')[0] ?? language.toLocaleLowerCase();
  const matching = voices.filter((voice) => {
    const lang = voice.lang.toLocaleLowerCase();
    return lang === base || lang.startsWith(`${base}-`);
  });
  for (const name of PREFERRED_VOICES) {
    const match = matching.find((voice) => voice.name === name || voice.name.startsWith(name));
    if (match) return match;
  }
  return matching.find((voice) => voice.localService) ?? matching[0] ?? voices[0] ?? null;
}

/** Pick the best available voice for the requested BCP-47 language. */
export function pickVoice(language = 'en'): SpeechSynthesisVoice | null {
  ensureVoicePriming();
  const all = cachedVoices.length > 0 ? cachedVoices : refreshVoices();
  return selectBestVoice(all, language);
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
  const voice = pickVoice(opts.language);
  if (voice) {
    utter.voice = voice;
    utter.lang = voice.lang;
  } else if (opts.language) {
    utter.lang = opts.language;
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

function playAudioSource(
  sourceUrl: string,
  opts: SpeakOptions,
  releaseSource: () => void,
): AudioClipHandle {
  const audio = new Audio(sourceUrl);
  audio.loop = opts.loop ?? false;
  let done = false;
  let audioContext: AudioContext | null = null;
  let source: MediaElementAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  let analyserExposed = false;

  if (opts.onAnalyser) {
    const AudioContextCtor = getAudioContextCtor();
    if (AudioContextCtor) {
      try {
        audioContext = new AudioContextCtor();
        source = audioContext.createMediaElementSource(audio);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.72;
        source.connect(analyser);
        analyser.connect(audioContext.destination);
        analyserExposed = true;
        opts.onAnalyser(analyser);
        void audioContext.resume().catch(() => undefined);
      } catch {
        // The visualizer is optional. If graph construction partially failed,
        // route the media element straight to the destination when possible so
        // a visualization problem cannot silence otherwise valid Piper audio.
        try {
          source?.disconnect();
          if (audioContext && source) source.connect(audioContext.destination);
          if (audioContext) void audioContext.resume().catch(() => undefined);
        } catch {
          if (audioContext) void audioContext.close().catch(() => undefined);
          audioContext = null;
          source = null;
        }
        analyser = null;
      }
    }
  }

  const releaseAudioGraph = (): void => {
    if (analyserExposed) opts.onAnalyser?.(null);
    analyserExposed = false;
    try {
      source?.disconnect();
      analyser?.disconnect();
    } catch {
      /* graph already disconnected */
    }
    source = null;
    analyser = null;
    if (audioContext) void audioContext.close().catch(() => undefined);
    audioContext = null;
  };
  const finish = (cb?: () => void): void => {
    if (done) return;
    done = true;
    releaseAudioGraph();
    releaseSource();
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
  const sourceUrl = objectUrl ?? `data:${mimeType};base64,${base64}`;
  return playAudioSource(sourceUrl, opts, () => {
    if (!objectUrl) return;
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  });
}

/** Play a trusted application-owned audio asset without a Blob copy. */
export function playAudioUrl(url: string, opts: SpeakOptions = {}): AudioClipHandle {
  return playAudioSource(url, opts, () => undefined);
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
  playUrl: playAudioUrl,
};
