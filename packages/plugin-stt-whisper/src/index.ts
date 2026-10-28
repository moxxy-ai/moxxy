import { definePlugin, defineTranscriber, type Plugin } from '@moxxy/sdk';
import { WhisperTranscriber, type WhisperModel, type WhisperTranscriberOptions } from './whisper.js';

export {
  WhisperTranscriber,
  createWhisperTranscriber,
  type WhisperModel,
  type WhisperTranscriberOptions,
} from './whisper.js';
export {
  MOXXY_PCM16_24KHZ_MIME,
  WHISPER_FILENAME_BY_MIME,
  normalizeWhisperUpload,
  pcm16MonoToWav,
  type NormalizedAudioUpload,
} from './audio.js';

export interface BuildWhisperPluginOptions {
  /**
   * Default model used when the host calls `session.transcribers.setActive(name)`
   * without an explicit config. Defaults to `whisper-1`.
   */
  readonly model?: WhisperModel;
  /** Register one transcriber per model instead (overrides `model`). */
  readonly models?: ReadonlyArray<WhisperModel>;
  /**
   * Optional default config baked into the transcriber def. Callers can
   * still override per-`setActive(name, config)`.
   */
  readonly defaults?: Omit<WhisperTranscriberOptions, 'client'>;
}

/**
 * Build the @moxxy/plugin-stt-whisper plugin: one transcriber per model, each
 * named `openai-<model>` (one model unless `models` lists several).
 *
 * To run several models at once, pass `models` — the transcriber names
 * won't collide (`openai-gpt-transcribe` vs `openai-whisper-1`).
 *
 * Activation:
 *   session.transcribers.setActive('openai-gpt-transcribe', { apiKey: ... });
 *
 * The plugin is intentionally side-effect free — registering it does
 * NOT activate the transcriber. The host (CLI / config loader) chooses
 * activation explicitly so users on local providers aren't surprised by
 * outbound calls to OpenAI.
 */
export function buildWhisperPlugin(opts: BuildWhisperPluginOptions = {}): Plugin {
  const models = opts.models ?? [opts.model ?? 'whisper-1'];
  return definePlugin({
    name: '@moxxy/plugin-stt-whisper',
    version: '0.0.0',
    transcribers: models.map((model) =>
      defineTranscriber({
        name: `openai-${model}`,
        displayName: `OpenAI ${model}`,
        createClient: (config) => {
          const merged: WhisperTranscriberOptions = {
            ...(opts.defaults ?? {}),
            ...(config as WhisperTranscriberOptions),
            model,
          };
          return new WhisperTranscriber(merged);
        },
      }),
    ),
  });
}

// Discovery entry: `createPluginLoader` requires a default Plugin export.
// `gpt-transcribe` is OpenAI's current model; `whisper-1` (deprecated by
// OpenAI) stays registered for configs that already name it.
export default buildWhisperPlugin({ models: ['gpt-transcribe', 'whisper-1'] });
