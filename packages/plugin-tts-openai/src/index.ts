import { definePlugin, defineSynthesizer, type Plugin } from '@moxxy/sdk';
import {
  OpenAiSynthesizer,
  type OpenAiSynthesizerOptions,
  type OpenAiTtsFormat,
} from './openai-tts.js';

export {
  OpenAiSynthesizer,
  createOpenAiSynthesizer,
  capInput,
  clampSpeed,
  type OpenAiSynthesizerOptions,
  type OpenAiTtsFormat,
  type FetchLike,
} from './openai-tts.js';

/** The single registered synthesizer name — surfaces show this in `set_voice`. */
export const OPENAI_TTS_SYNTHESIZER_NAME = 'openai-tts';

export interface BuildOpenAiTtsPluginOptions {
  /**
   * Build-time defaults baked into the synthesizer def. Per-activation config
   * (`session.synthesizers.setActive(name, config)`) still overrides `model` /
   * `voice` / `format`. Mainly a seam for tests to inject `fetchImpl` / `apiKey`.
   */
  readonly defaults?: Omit<OpenAiSynthesizerOptions, 'getSecret'>;
}

/**
 * Build the @moxxy/plugin-tts-openai plugin. Registers exactly one synthesizer,
 * `openai-tts`, backed by OpenAI's `/v1/audio/speech`.
 *
 * The plugin is intentionally side-effect free — it never calls `setActive`.
 * The `SynthesizerRegistry` is `autoAdoptFirst`, so the first synthesizer
 * registered (this one, on a fresh install) becomes active on read without any
 * activation step here; the agent switches voices via the `set_voice` tool.
 */
export function buildOpenAiTtsPlugin(opts: BuildOpenAiTtsPluginOptions = {}): Plugin {
  const defaults = opts.defaults ?? {};
  return definePlugin({
    name: '@moxxy/plugin-tts-openai',
    version: '0.0.0',
    synthesizers: [
      defineSynthesizer({
        name: OPENAI_TTS_SYNTHESIZER_NAME,
        displayName: 'OpenAI TTS',
        // `create` runs lazily and may re-run (buildOnRead) — keep it cheap and
        // side-effect free; the key is resolved inside `synthesize`.
        create: (ctx) =>
          new OpenAiSynthesizer({
            ...defaults,
            ...configToOptions(ctx.config),
            ...(ctx.getSecret ? { getSecret: ctx.getSecret } : {}),
          }),
      }),
    ],
  });
}

/** Narrow the untrusted per-activation config record into typed options. Only
 *  string `model` / `voice` / `baseURL` / `apiKey` and a known `format` are
 *  honored; anything else is ignored so a malformed config can't break create. */
function configToOptions(config: Record<string, unknown>): Partial<OpenAiSynthesizerOptions> {
  const out: { -readonly [K in keyof OpenAiSynthesizerOptions]?: OpenAiSynthesizerOptions[K] } = {};
  if (typeof config.model === 'string' && config.model) out.model = config.model;
  if (typeof config.voice === 'string' && config.voice) out.voice = config.voice;
  if (typeof config.baseURL === 'string' && config.baseURL) out.baseURL = config.baseURL;
  if (typeof config.apiKey === 'string' && config.apiKey) out.apiKey = config.apiKey;
  const format = normalizeFormat(config.format);
  if (format) out.format = format;
  return out;
}

const KNOWN_FORMATS: ReadonlyArray<OpenAiTtsFormat> = ['mp3', 'opus', 'wav', 'aac'];

/** Accept only the exact supported format strings (guards against inherited
 *  keys like `constructor` slipping through an `in` check). */
function normalizeFormat(value: unknown): OpenAiTtsFormat | undefined {
  return typeof value === 'string' && (KNOWN_FORMATS as ReadonlyArray<string>).includes(value)
    ? (value as OpenAiTtsFormat)
    : undefined;
}

// Discovery entry: `createPluginLoader` requires a default Plugin export.
export default buildOpenAiTtsPlugin();
