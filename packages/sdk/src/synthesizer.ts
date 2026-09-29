/**
 * Synthesizers convert text into spoken audio (text-to-speech). They are the
 * symmetric counterpart to {@link Transcriber} (speech-to-text): a separate,
 * swappable capability so a user can pair any text provider with a dedicated
 * TTS backend (the OS voice, ElevenLabs, OpenAI, a local engine, …).
 *
 * Plugins register a `SynthesizerDef` via `PluginSpec.synthesizers`. The core
 * `SynthesizerRegistry` holds them; surfaces that read aloud (the desktop's
 * "Read aloud" button, a future voice channel) call
 * `session.synthesizers.getActive()` (or `tryGetActive()`) to turn text into
 * audio. There is at most one *active* synthesizer at a time; when none is
 * active the caller degrades gracefully (the desktop falls back to the
 * browser/OS `speechSynthesis`).
 *
 * The user swaps the active synthesizer by asking the agent ("use ElevenLabs
 * for read-aloud") — there is no settings UI. The agent activates a registered
 * synthesizer (a plugin it authored/installed self-activates in `onInit`, or it
 * calls a set-active tool); switching back to the OS voice deactivates it.
 */

export interface SynthesizeOptions {
  /** Preferred voice id/name, when the backend supports selection. */
  readonly voice?: string;
  /** BCP-47 language hint (e.g. `en`, `pl`). */
  readonly language?: string;
  /** Speaking rate multiplier (1.0 = normal), when supported. */
  readonly rate?: number;
  /** Cancellation signal — callers propagate a stop/abort here. */
  readonly signal?: AbortSignal;
}

export interface SynthesisResult {
  /** Encoded audio bytes ready to play (e.g. an mp3/wav/ogg payload). */
  readonly audio: Uint8Array;
  /** MIME type of {@link audio}, e.g. `audio/mpeg`, `audio/wav`, `audio/ogg`. */
  readonly mimeType: string;
}

export interface Synthesizer {
  /** Short stable name, e.g. `elevenlabs`. */
  readonly name: string;
  synthesize(text: string, opts?: SynthesizeOptions): Promise<SynthesisResult>;
}

/**
 * Context handed to {@link SynthesizerDef.create} when the registry activates a
 * synthesizer. `getSecret` reads a vault secret (the API key) the same way a
 * tool handler does via `ctx.getSecret` — so an authored TTS plugin never has
 * to touch `process.env`, and the key never enters the model's context.
 */
export interface SynthesizerCreateContext {
  /** Per-synthesizer config (e.g. from `session.synthesizers.setActive(name, config)`). */
  readonly config: Record<string, unknown>;
  /** Read a named vault secret, or null if unset / no vault is wired. */
  readonly getSecret?: (name: string) => Promise<string | null>;
}

/**
 * Plugin-side definition. Mirrors `TranscriberDef`: a `create(ctx)` factory the
 * registry calls when this synthesizer is activated.
 */
export interface SynthesizerDef {
  readonly name: string;
  /** Optional human-readable label for UI surfaces. */
  readonly displayName?: string;
  create(ctx: SynthesizerCreateContext): Synthesizer;
}
