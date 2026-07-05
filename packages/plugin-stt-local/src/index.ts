import { definePlugin, defineTranscriber, type Plugin } from '@moxxy/sdk';

import {
  createLocalWhisperTranscriber,
  LOCAL_WHISPER_TRANSCRIBER_NAME,
  shutdownLocalStt,
  type LocalWhisperOptions,
} from './local-stt.js';

export {
  LocalWhisperTranscriber,
  createLocalWhisperTranscriber,
  shutdownLocalStt,
  LOCAL_WHISPER_TRANSCRIBER_NAME,
  type LocalWhisperOptions,
  type WhisperModelPaths,
} from './local-stt.js';
export {
  MODEL_CATALOG,
  DEFAULT_MODEL_ID,
  modelIds,
  findModel,
  requireModel,
  type WhisperModelEntry,
  type WhisperModelId,
} from './models.js';
export {
  pcm16ToFloat32,
  downmixToMono,
  resampleLinear,
  parseWav,
  isRiffWave,
  TARGET_SAMPLE_RATE,
  type ParsedWav,
} from './audio.js';
export { decodeToMono16k, type DecodeOptions } from './decode.js';
export {
  decodeViaFfmpeg,
  missingFfmpegError,
  __resetFfmpegProbeForTest,
} from './ffmpeg.js';
export { HostClient, type HostClientLike, type ForkLike, type ChildHandle } from './host-client.js';
export {
  sherpaPlatformPackage,
  resolveSherpaLibDir,
  sherpaEnv,
  libraryPathVar,
} from './platform.js';

export interface BuildLocalSttPluginOptions {
  /** Build-time defaults / test seams for the transcriber (injected
   *  `ensureModelImpl`, `hostFactory`, `fetchImpl`, `modelsDir`, `log`, …). */
  readonly defaults?: LocalWhisperOptions;
}

/**
 * Build the @moxxy/plugin-stt-local plugin. Registers exactly one transcriber,
 * `local-whisper`, backed by sherpa-onnx Whisper models running in a forked
 * sidecar. Side-effect free at load: no model is downloaded and no process is
 * spawned until the first `transcribe`. Per-activation config
 * (`session.transcribers.setActive('local-whisper', { model, language,
 * numThreads })`) overrides the build-time defaults.
 *
 * Like the OpenAI STT sibling, the plugin does NOT set itself active —
 * registering it is side-effect free (no auto-adopt in TranscriberRegistry).
 * The host/user activates it explicitly, so a local-only setup never
 * surprises anyone with a network call (there isn't one here) and a mixed
 * setup keeps whatever STT backend was chosen.
 */
export function buildLocalSttPlugin(opts: BuildLocalSttPluginOptions = {}): Plugin {
  const defaults = opts.defaults ?? {};
  return definePlugin({
    name: '@moxxy/plugin-stt-local',
    version: '0.0.0',
    transcribers: [
      defineTranscriber({
        name: LOCAL_WHISPER_TRANSCRIBER_NAME,
        displayName: 'Local Whisper (offline, multilingual)',
        createClient: (config: Record<string, unknown>) =>
          createLocalWhisperTranscriber({ ...defaults, ...configToOptions(config) }),
      }),
    ],
    // Kill every spawned sidecar when the session/runner shuts down.
    hooks: { onShutdown: () => shutdownLocalStt() },
  });
}

/** Narrow the untrusted per-activation config into typed options — only the
 *  known string `model` / `language` / `provider` and a positive-integer
 *  `numThreads` are honored so a malformed config can't break `createClient` or
 *  route to a bad model (unknown ids are caught by `requireModel`). */
function configToOptions(config: Record<string, unknown>): Partial<LocalWhisperOptions> {
  const out: { -readonly [K in keyof LocalWhisperOptions]?: LocalWhisperOptions[K] } = {};
  if (typeof config.model === 'string' && config.model) out.model = config.model;
  if (typeof config.language === 'string') out.language = config.language;
  if (typeof config.provider === 'string' && config.provider) out.provider = config.provider;
  if (
    typeof config.numThreads === 'number' &&
    Number.isInteger(config.numThreads) &&
    config.numThreads > 0
  ) {
    out.numThreads = config.numThreads;
  }
  return out;
}

// Discovery entry: `createPluginLoader` requires a default Plugin export.
export default buildLocalSttPlugin();
