/**
 * Platform-capability registry.
 *
 * A few hooks need things that don't exist uniformly across platforms — mic
 * capture, PCM encoding, text-to-speech, a key-value store, a DOM-style event
 * bus. Rather than reach for `window`/`MediaRecorder`/`localStorage` (which this
 * DOM-free package cannot), they read the capability from this registry, which
 * each platform populates at boot:
 *   - desktop: `configurePlatform(webPlatform)` (Web APIs, in @moxxy/client-platform-web)
 *   - mobile:  `configurePlatform({})` for the PoC, or Expo-backed impls later
 *
 * Every capability is OPTIONAL: when one is absent the consuming hook degrades
 * to the same "unsupported" branch it always had (no mic, no read-aloud, no
 * legacy migration), so a platform can adopt them incrementally.
 */

// ---- Audio capture (mic → PCM16 for session.transcribe) -------------------

export interface AudioCaptureResult {
  /** PCM16 LE mono 24 kHz, base64-encoded — ready for `session.transcribe`. */
  readonly pcm16Base64: string;
  /** MIME tag to report to the transcriber. */
  readonly mimeType: string;
  /** Largest absolute sample, 0..1 — distinguishes a silent capture (mic
   *  muted / wrong device) from genuine quiet. */
  readonly peak: number;
  /** Number of PCM samples captured; 0 ⇒ nothing was recorded. */
  readonly sampleCount: number;
}

export interface AudioRecordingHandle {
  /** Stop recording; the capture then fires `onResult` (or `onError`). */
  stop(): void;
}

export interface AudioCaptureStartOptions {
  /** Fired once with the encoded capture after `stop()`. */
  readonly onResult: (result: AudioCaptureResult) => void;
  /** Fired if capture fails to start or produce audio. */
  readonly onError: (message: string) => void;
  /** Optional live analyser for a visualiser (opaque — the web impl passes an
   *  `AnalyserNode`); called with `null` when recording ends. */
  readonly onAnalyser?: (analyser: unknown | null) => void;
}

export interface AudioCapture {
  isSupported(): boolean;
  start(opts: AudioCaptureStartOptions): Promise<AudioRecordingHandle>;
}

// ---- Text-to-speech (read-aloud) ------------------------------------------

export interface SpeakOptions {
  readonly onend?: () => void;
  readonly onerror?: () => void;
}

export interface AudioClipHandle {
  /** Stop playback and release. Idempotent. */
  stop(): void;
}

export interface TextToSpeech {
  /** Whether this environment can speak at all (gates the affordance). */
  isSupported(): boolean;
  /** Speak `markdown` aloud (the impl cleans it to prose). */
  speak(markdown: string, opts?: SpeakOptions): void;
  /** Stop any in-flight speech. */
  cancel(): void;
  /** Play a base64 audio clip from a runner-side synthesizer plugin. */
  playClip(base64: string, mimeType: string, opts?: SpeakOptions): AudioClipHandle;
}

// ---- Key-value store (legacy localStorage migration only) -----------------

export interface KeyValueStore {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// ---- Event bus (out-of-band session-info refresh) -------------------------

export interface EventBus {
  /** Subscribe; returns an unsubscribe fn. */
  on(event: string, handler: () => void): () => void;
  emit(event: string): void;
}

export interface PlatformCapabilities {
  readonly audioCapture?: AudioCapture;
  readonly tts?: TextToSpeech;
  readonly kv?: KeyValueStore;
  readonly eventBus?: EventBus;
}

let caps: PlatformCapabilities = {};

/** Install the platform capabilities at boot. Last call wins. */
export function configurePlatform(capabilities: PlatformCapabilities): void {
  caps = capabilities;
}

/** The active capabilities (an empty bag until configured). */
export function getPlatform(): PlatformCapabilities {
  return caps;
}
