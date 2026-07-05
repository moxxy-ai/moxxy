/**
 * The `local-piper` Synthesizer: fully local, on-device text-to-speech.
 *
 * On the first synthesis for a voice it downloads + verifies that voice's Piper
 * model (once, via @moxxy/model-fetch), then hands text to the sherpa sidecar
 * ({@link HostClient}) and wraps the returned samples as WAV. No key, no network
 * at synthesis time. Language routing sends `pl*` requests to the configured
 * Polish voice; an explicit `opts.voice` (a catalog id) overrides everything.
 *
 * Every collaborator is injectable (`ensureModelImpl`, `hostFactory`, `log`,
 * `modelsDir`, `fetchImpl`) so the whole flow is unit-testable without the
 * native addon or a real download.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MoxxyError, type SynthesizeOptions, type SynthesisResult, type Synthesizer } from '@moxxy/sdk';
import { moxxyPath } from '@moxxy/sdk/server';
import {
  ensureModel,
  type EnsureModelProgress,
  type EnsureModelResult,
  type FetchLike,
} from '@moxxy/model-fetch';

import { HostClient, type HostClientLike } from './host-client.js';
import { resolveSherpaLibDir, sherpaEnv, sherpaPlatformPackage } from './platform.js';
import {
  DEFAULT_POLISH_VOICE_ID,
  DEFAULT_VOICE_ID,
  requireVoice,
  routeVoice,
  type VoiceEntry,
} from './voices.js';
import { encodeWav } from './wav.js';

/** The single registered synthesizer name — surfaces show this in `set_voice`. */
export const LOCAL_PIPER_SYNTHESIZER_NAME = 'local-piper';

/** Local speaking-rate bounds. Piper distorts badly outside this range. */
const MIN_SPEED = 0.5;
const MAX_SPEED = 2.0;
const DEFAULT_NUM_THREADS = 2;

/** Map a `SynthesizeOptions.rate` multiplier onto sherpa's `speed`, clamped.
 *  An absent / non-finite rate yields 1.0 (natural speed). */
export function clampSpeed(rate: number | undefined): number {
  if (rate === undefined || !Number.isFinite(rate)) return 1.0;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, rate));
}

/** Resolved on-disk paths sherpa needs for one voice. */
export interface VoiceModelPaths {
  readonly model: string;
  readonly tokens: string;
  readonly dataDir: string;
}

export interface LocalPiperOptions {
  /** Default (non-Polish) voice id. Default `en_US-amy-medium`. */
  readonly voice?: string;
  /** Voice used for `pl*` language requests. Default `pl_PL-gosia-medium`. */
  readonly polishVoice?: string;
  /** Inference threads. Default 2. */
  readonly numThreads?: number;
  /** Root for downloaded voices. Default `~/.moxxy/models/tts` (MOXXY_HOME-aware). */
  readonly modelsDir?: string;
  /** sherpa compute provider. Default `cpu`. */
  readonly provider?: string;
  /** Absolute path to the built sidecar entry. Default: `sidecar.js` beside
   *  this module (i.e. `dist/sidecar.js` in a published build). Overridable so
   *  the source-run live test can point at the compiled sidecar. */
  readonly sidecarPath?: string;
  /** Injected model-ensure (tests). Defaults to @moxxy/model-fetch `ensureModel`. */
  readonly ensureModelImpl?: typeof ensureModel;
  /** Injected `fetch`, threaded into `ensureModel` (tests). */
  readonly fetchImpl?: FetchLike;
  /** Injected sidecar host factory (tests). Defaults to a real {@link HostClient}. */
  readonly hostFactory?: () => HostClientLike;
  /** Diagnostic log sink (download progress etc.). Defaults to stderr. */
  readonly log?: (msg: string) => void;
}

/** Process-wide set of live synthesizers so the plugin's `onShutdown` hook can
 *  kill every sidecar it spawned. */
const ACTIVE_SYNTHS = new Set<LocalPiperSynthesizer>();

/** Shut down every live local synthesizer (kills their sidecars). */
export function shutdownLocalTts(): void {
  for (const s of ACTIVE_SYNTHS) s.shutdown();
  ACTIVE_SYNTHS.clear();
}

export class LocalPiperSynthesizer implements Synthesizer {
  readonly name = LOCAL_PIPER_SYNTHESIZER_NAME;
  readonly mimeType = 'audio/wav';

  private readonly voiceId: string;
  private readonly polishVoiceId: string;
  private readonly numThreads: number;
  private readonly modelsDir: string;
  private readonly provider: string;
  private readonly sidecarPath: string | undefined;
  private readonly ensureModelImpl: typeof ensureModel;
  private readonly fetchImpl: FetchLike | undefined;
  private readonly hostFactory: () => HostClientLike;
  private readonly log: (msg: string) => void;

  private host: HostClientLike | null = null;
  /** In-flight per-voice download promises — de-dupes concurrent first-use. */
  private readonly ensuring = new Map<string, Promise<EnsureModelResult>>();

  constructor(opts: LocalPiperOptions = {}) {
    // Validate configured voice ids up front so a bad config fails clearly at
    // construction rather than on the first (possibly channel-triggered) call.
    this.voiceId = requireVoice(opts.voice ?? DEFAULT_VOICE_ID, 'voice').id;
    this.polishVoiceId = requireVoice(opts.polishVoice ?? DEFAULT_POLISH_VOICE_ID, 'polishVoice').id;
    this.numThreads =
      opts.numThreads && Number.isInteger(opts.numThreads) && opts.numThreads > 0
        ? opts.numThreads
        : DEFAULT_NUM_THREADS;
    this.modelsDir = opts.modelsDir ?? moxxyPath('models', 'tts');
    this.provider = opts.provider ?? 'cpu';
    this.sidecarPath = opts.sidecarPath;
    this.ensureModelImpl = opts.ensureModelImpl ?? ensureModel;
    this.fetchImpl = opts.fetchImpl;
    this.hostFactory = opts.hostFactory ?? (() => this.defaultHost());
    this.log = opts.log ?? ((msg) => process.stderr.write(`${msg}\n`));
    ACTIVE_SYNTHS.add(this);
  }

  async synthesize(text: string, opts: SynthesizeOptions = {}): Promise<SynthesisResult> {
    opts.signal?.throwIfAborted();
    const voice = routeVoice({
      ...(opts.voice !== undefined ? { requestedVoice: opts.voice } : {}),
      ...(opts.language !== undefined ? { language: opts.language } : {}),
      defaultVoice: this.voiceId,
      polishVoice: this.polishVoiceId,
    });

    const paths = await this.ensureVoice(voice, opts.signal);
    opts.signal?.throwIfAborted();

    const host = this.getHost();
    const { samples, sampleRate } = await host.synthesize({
      voiceKey: paths.model,
      model: paths.model,
      tokens: paths.tokens,
      dataDir: paths.dataDir,
      numThreads: this.numThreads,
      provider: this.provider,
      text,
      sid: 0,
      speed: clampSpeed(opts.rate),
    });

    if (!samples || samples.length === 0) {
      throw new MoxxyError({
        code: 'INTERNAL',
        message: 'Local TTS produced no audio samples.',
        context: { voice: voice.id },
      });
    }
    return { audio: encodeWav(samples, sampleRate), mimeType: this.mimeType };
  }

  /** Kill this synthesizer's sidecar (if any) and drop registration. */
  shutdown(): void {
    this.host?.shutdown();
    this.host = null;
    ACTIVE_SYNTHS.delete(this);
  }

  private getHost(): HostClientLike {
    this.host ??= this.hostFactory();
    return this.host;
  }

  /** Resolve on-disk paths for `voice`, downloading + extracting it once. */
  private async ensureVoice(voice: VoiceEntry, signal?: AbortSignal): Promise<VoiceModelPaths> {
    const dir = path.join(this.modelsDir, voice.id);
    let inflight = this.ensuring.get(voice.id);
    if (!inflight) {
      inflight = this.ensureModelImpl({
        url: voice.url,
        sha256: voice.sha256,
        dir,
        ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
        ...(signal ? { signal } : {}),
        onProgress: this.makeProgressLogger(voice),
      });
      this.ensuring.set(voice.id, inflight);
      // On failure, forget the promise so a later call retries the download.
      inflight.catch(() => this.ensuring.delete(voice.id));
    }
    await inflight;
    return this.voicePaths(voice, dir);
  }

  private voicePaths(voice: VoiceEntry, dir: string): VoiceModelPaths {
    const root = path.join(dir, voice.archiveRootDir);
    return {
      model: path.join(root, voice.modelFile),
      tokens: path.join(root, 'tokens.txt'),
      dataDir: path.join(root, 'espeak-ng-data'),
    };
  }

  /** A progress callback that logs a single start line then ~every-10% ticks,
   *  and an extraction line — but stays silent when the voice is already
   *  present (ensureModel emits only `done`). */
  private makeProgressLogger(voice: VoiceEntry): (p: EnsureModelProgress) => void {
    let started = false;
    let extracting = false;
    let lastPct = -1;
    return (p) => {
      if (p.phase === 'downloading') {
        if (!started) {
          started = true;
          this.log(
            `tts-local: first use — downloading ${voice.id} (~${voice.approxMb} MB) to ${this.modelsDir}, one-time`,
          );
        }
        if (p.totalBytes > 0) {
          const pct = Math.floor((p.receivedBytes / p.totalBytes) * 100);
          if (pct >= lastPct + 10) {
            lastPct = pct - (pct % 10);
            this.log(`tts-local: downloading ${voice.id} … ${lastPct}%`);
          }
        }
      } else if (p.phase === 'extracting' && !extracting) {
        extracting = true;
        this.log(`tts-local: extracting ${voice.id} …`);
      } else if (p.phase === 'done' && started) {
        this.log(`tts-local: ${voice.id} ready.`);
      }
    };
  }

  /** Build a real sidecar-backed host, resolving the platform loader path.
   *  Fails clearly when no sherpa binary exists for this platform/arch. */
  private defaultHost(): HostClientLike {
    const libDir = resolveSherpaLibDir();
    if (!libDir) {
      const pkg = sherpaPlatformPackage();
      throw new MoxxyError({
        code: 'PLUGIN_LOAD_FAILED',
        message: pkg
          ? `Local TTS could not load the sherpa-onnx binary (${pkg}). Reinstall @moxxy/plugin-tts-local so its platform dependency is fetched.`
          : `Local TTS has no sherpa-onnx binary for ${process.platform}-${process.arch}.`,
        hint: 'Use the OpenAI or ElevenLabs read-aloud backend instead, or run on a supported platform (macOS/Linux/Windows x64, macOS/Linux arm64).',
        context: { platform: process.platform, arch: process.arch },
      });
    }
    const hostPath =
      this.sidecarPath ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'sidecar.js');
    return new HostClient({
      hostPath,
      env: { ...process.env, ...sherpaEnv(libDir) },
      log: this.log,
    });
  }
}

export function createLocalPiperSynthesizer(opts: LocalPiperOptions = {}): LocalPiperSynthesizer {
  return new LocalPiperSynthesizer(opts);
}
