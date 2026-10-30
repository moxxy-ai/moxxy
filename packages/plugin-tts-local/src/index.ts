import { definePlugin, defineSynthesizer, type Plugin } from '@moxxy/sdk';

import {
  createLocalSupertonicSynthesizer,
  LEGACY_PIPER_SYNTHESIZER_NAME,
  LOCAL_SUPERTONIC_SYNTHESIZER_NAME,
  shutdownLocalTts,
  type LocalSupertonicOptions,
} from './local-tts.js';

export {
  LocalSupertonicSynthesizer,
  createLocalSupertonicSynthesizer,
  clampSpeed,
  shutdownLocalTts,
  LEGACY_PIPER_SYNTHESIZER_NAME,
  LOCAL_SUPERTONIC_SYNTHESIZER_NAME,
  type LocalSupertonicOptions,
} from './local-tts.js';
export { encodeWav, WAV_HEADER_BYTES } from './wav.js';
export {
  DEFAULT_VOICE,
  DENOISING_STEPS,
  SUPERTONIC_LANGUAGES,
  VOICE_CATALOG,
  speechLanguage,
  voiceModelPaths,
  type VoiceEntry,
  type VoiceModelPaths,
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
  readonly defaults?: LocalSupertonicOptions;
}

/**
 * Build the @moxxy/plugin-tts-local plugin. Registers `local-supertonic`, backed
 * by Supertonic 3 running in a forked sherpa sidecar, and the same synthesizer
 * under `local-piper`, the name older settings saved. Side-effect free at load:
 * no model is downloaded and no process is spawned until the first `synthesize`.
 * Per-activation config (`session.synthesizers.setActive('local-supertonic',
 * { numThreads })`) overrides the build-time defaults.
 */
export function buildLocalTtsPlugin(opts: BuildLocalTtsPluginOptions = {}): Plugin {
  const defaults = opts.defaults ?? {};
  // `create` runs lazily and may re-run (buildOnRead) — keep it cheap and
  // side-effect free; the sidecar + download happen on first synthesize.
  const define = (name: string) =>
    defineSynthesizer({
      name,
      displayName: 'Local (Supertonic 3 — offline)',
      create: (ctx) =>
        createLocalSupertonicSynthesizer({ ...defaults, ...configToOptions(ctx.config) }),
    });
  return definePlugin({
    name: '@moxxy/plugin-tts-local',
    version: '0.0.0',
    synthesizers: [define(LOCAL_SUPERTONIC_SYNTHESIZER_NAME), define(LEGACY_PIPER_SYNTHESIZER_NAME)],
    // Kill every spawned sidecar when the session/runner shuts down.
    hooks: { onShutdown: () => shutdownLocalTts() },
  });
}

/** Narrow the untrusted per-activation config into typed options — only a
 *  positive-integer `numThreads` is honored. The voice settings older installs
 *  saved are ignored: there is one voice now. */
function configToOptions(config: Record<string, unknown>): Partial<LocalSupertonicOptions> {
  if (typeof config.numThreads === 'number' && Number.isInteger(config.numThreads) && config.numThreads > 0) {
    return { numThreads: config.numThreads };
  }
  return {};
}

// Discovery entry: `createPluginLoader` requires a default Plugin export.
export default buildLocalTtsPlugin();
