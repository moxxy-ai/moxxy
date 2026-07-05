import { definePlugin, defineSynthesizer, type Plugin } from '@moxxy/sdk';

import {
  createLocalPiperSynthesizer,
  LOCAL_PIPER_SYNTHESIZER_NAME,
  shutdownLocalTts,
  type LocalPiperOptions,
} from './local-tts.js';

export {
  LocalPiperSynthesizer,
  createLocalPiperSynthesizer,
  clampSpeed,
  shutdownLocalTts,
  LOCAL_PIPER_SYNTHESIZER_NAME,
  type LocalPiperOptions,
  type VoiceModelPaths,
} from './local-tts.js';
export { encodeWav, WAV_HEADER_BYTES } from './wav.js';
export {
  VOICE_CATALOG,
  voiceIds,
  findVoice,
  routeVoice,
  requireVoice,
  DEFAULT_VOICE_ID,
  DEFAULT_POLISH_VOICE_ID,
  type VoiceEntry,
  type VoiceLanguage,
} from './voices.js';
export { HostClient, type HostClientLike, type ForkLike, type ChildHandle } from './host-client.js';
export {
  sherpaPlatformPackage,
  resolveSherpaLibDir,
  sherpaEnv,
  libraryPathVar,
} from './platform.js';

export interface BuildLocalTtsPluginOptions {
  /** Build-time defaults / test seams for the synthesizer (injected
   *  `ensureModelImpl`, `hostFactory`, `fetchImpl`, `modelsDir`, `log`). */
  readonly defaults?: LocalPiperOptions;
}

/**
 * Build the @moxxy/plugin-tts-local plugin. Registers exactly one synthesizer,
 * `local-piper`, backed by sherpa-onnx Piper voices running in a forked
 * sidecar. Side-effect free at load: no model is downloaded and no process is
 * spawned until the first `synthesize`. Per-activation config
 * (`session.synthesizers.setActive('local-piper', { voice, polishVoice,
 * numThreads })`) overrides the build-time defaults.
 */
export function buildLocalTtsPlugin(opts: BuildLocalTtsPluginOptions = {}): Plugin {
  const defaults = opts.defaults ?? {};
  return definePlugin({
    name: '@moxxy/plugin-tts-local',
    version: '0.0.0',
    synthesizers: [
      defineSynthesizer({
        name: LOCAL_PIPER_SYNTHESIZER_NAME,
        displayName: 'Local (Piper — offline, EN+PL)',
        // `create` runs lazily and may re-run (buildOnRead) — keep it cheap and
        // side-effect free; the sidecar + download happen on first synthesize.
        create: (ctx) =>
          createLocalPiperSynthesizer({ ...defaults, ...configToOptions(ctx.config) }),
      }),
    ],
    // Kill every spawned sidecar when the session/runner shuts down.
    hooks: { onShutdown: () => shutdownLocalTts() },
  });
}

/** Narrow the untrusted per-activation config into typed options — only the
 *  known string `voice` / `polishVoice` and a positive-integer `numThreads` are
 *  honored so a malformed config can't break `create` or route to a bad voice
 *  (unknown ids are caught by `requireVoice` at construction). */
function configToOptions(config: Record<string, unknown>): Partial<LocalPiperOptions> {
  const out: { -readonly [K in keyof LocalPiperOptions]?: LocalPiperOptions[K] } = {};
  if (typeof config.voice === 'string' && config.voice) out.voice = config.voice;
  if (typeof config.polishVoice === 'string' && config.polishVoice) {
    out.polishVoice = config.polishVoice;
  }
  if (typeof config.numThreads === 'number' && Number.isInteger(config.numThreads) && config.numThreads > 0) {
    out.numThreads = config.numThreads;
  }
  return out;
}

// Discovery entry: `createPluginLoader` requires a default Plugin export.
export default buildLocalTtsPlugin();
