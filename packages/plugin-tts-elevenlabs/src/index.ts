import { definePlugin, defineSynthesizer, type Plugin } from '@moxxy/sdk';
import {
  ElevenLabsSynthesizer,
  type ElevenLabsSynthesizerOptions,
  type ElevenLabsTtsFormat,
} from './elevenlabs-tts.js';

export {
  ElevenLabsSynthesizer,
  createElevenLabsSynthesizer,
  capInput,
  type ElevenLabsSynthesizerOptions,
  type ElevenLabsTtsFormat,
  type FetchLike,
} from './elevenlabs-tts.js';

/** The single registered synthesizer name — surfaces show this in `set_voice`. */
export const ELEVENLABS_TTS_SYNTHESIZER_NAME = 'elevenlabs';

export interface BuildElevenLabsTtsPluginOptions {
  /**
   * Build-time defaults baked into the synthesizer def. Per-activation config
   * (`session.synthesizers.setActive(name, config)`) still overrides `model` /
   * `voiceId` / `format`. Mainly a seam for tests to inject `fetchImpl` / `apiKey`.
   */
  readonly defaults?: Omit<ElevenLabsSynthesizerOptions, 'getSecret'>;
}

/**
 * Build the @moxxy/plugin-tts-elevenlabs plugin. Registers exactly one
 * synthesizer, `elevenlabs`, backed by ElevenLabs' `POST /v1/text-to-speech`.
 *
 * The plugin is intentionally side-effect free — it never calls `setActive`.
 * The `SynthesizerRegistry` is `autoAdoptFirst`, so the first synthesizer
 * registered becomes active on read without any activation step here; the agent
 * switches voices via the `set_voice` tool.
 */
export function buildElevenLabsTtsPlugin(opts: BuildElevenLabsTtsPluginOptions = {}): Plugin {
  const defaults = opts.defaults ?? {};
  return definePlugin({
    name: '@moxxy/plugin-tts-elevenlabs',
    version: '0.0.0',
    synthesizers: [
      defineSynthesizer({
        name: ELEVENLABS_TTS_SYNTHESIZER_NAME,
        displayName: 'ElevenLabs',
        // `create` runs lazily and may re-run (buildOnRead) — keep it cheap and
        // side-effect free; the key is resolved inside `synthesize`.
        create: (ctx) =>
          new ElevenLabsSynthesizer({
            ...defaults,
            ...configToOptions(ctx.config),
            ...(ctx.getSecret ? { getSecret: ctx.getSecret } : {}),
          }),
      }),
    ],
  });
}

/** Narrow the untrusted per-activation config record into typed options. Only
 *  string `model` / `voiceId` / `baseURL` / `apiKey` and a known `format` are
 *  honored; anything else is ignored so a malformed config can't break create. */
function configToOptions(config: Record<string, unknown>): Partial<ElevenLabsSynthesizerOptions> {
  const out: {
    -readonly [K in keyof ElevenLabsSynthesizerOptions]?: ElevenLabsSynthesizerOptions[K];
  } = {};
  if (typeof config.model === 'string' && config.model) out.model = config.model;
  if (typeof config.voiceId === 'string' && config.voiceId) out.voiceId = config.voiceId;
  if (typeof config.baseURL === 'string' && config.baseURL) out.baseURL = config.baseURL;
  if (typeof config.apiKey === 'string' && config.apiKey) out.apiKey = config.apiKey;
  const format = normalizeFormat(config.format);
  if (format) out.format = format;
  return out;
}

const KNOWN_FORMATS: ReadonlyArray<ElevenLabsTtsFormat> = [
  'mp3_44100_128',
  'mp3_44100_64',
  'mp3_22050_32',
];

/** Accept only the exact supported format strings (guards against inherited
 *  keys like `constructor` slipping through an `in` check). */
function normalizeFormat(value: unknown): ElevenLabsTtsFormat | undefined {
  return typeof value === 'string' && (KNOWN_FORMATS as ReadonlyArray<string>).includes(value)
    ? (value as ElevenLabsTtsFormat)
    : undefined;
}

// Discovery entry: `createPluginLoader` requires a default Plugin export.
export default buildElevenLabsTtsPlugin();
