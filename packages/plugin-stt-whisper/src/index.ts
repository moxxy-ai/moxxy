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
  /**
   * Optional default config baked into the transcriber def. Callers can
   * still override per-`setActive(name, config)`.
   */
  readonly defaults?: Omit<WhisperTranscriberOptions, 'client'>;
}

/**
 * Build the @moxxy/plugin-stt-whisper plugin. Each instance registers
 * exactly one transcriber, named `openai-<model>`.
 *
 * To run several Whisper-family models at once, build the plugin once per
 * model — the transcriber names won't collide (`openai-whisper-1` vs
 * `openai-gpt-4o-transcribe`), but each registration carries the SAME
 * plugin name, so the host must register them under DISTINCT plugin names
 * (the name-keyed plugin registry would otherwise clobber the first).
 *
 * Activation:
 *   session.transcribers.setActive('openai-whisper-1', { apiKey: ... });
 *
 * The plugin is intentionally side-effect free — registering it does
 * NOT activate the transcriber. The host (CLI / config loader) chooses
 * activation explicitly so users on local providers aren't surprised by
 * outbound calls to OpenAI.
 */
export function buildWhisperPlugin(opts: BuildWhisperPluginOptions = {}): Plugin {
  const model = opts.model ?? 'whisper-1';
  const name = `openai-${model}`;
  return definePlugin({
    name: '@moxxy/plugin-stt-whisper',
    version: '0.0.0',
    transcribers: [
      defineTranscriber({
        name,
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
    ],
  });
}
