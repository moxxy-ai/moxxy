/**
 * The `local-whisper` Transcriber: fully local, on-device speech-to-text.
 *
 * On the first transcription for a model it downloads + verifies that model's
 * Whisper files (once, via @moxxy/model-fetch), then decodes the inbound audio
 * to Float32 mono @ 16 kHz IN-PROCESS (raw PCM / WAV) or via ffmpeg (compressed
 * containers) and hands the samples to the sherpa sidecar ({@link HostClient}).
 * No key, no network at transcription time.
 *
 * Every collaborator is injectable (`ensureModelFilesImpl`, `hostFactory`, `log`,
 * `modelsDir`, `fetchImpl`, `spawnImpl`) so the whole flow is unit-testable
 * without the native addon, a real download, or ffmpeg.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { spawn } from 'node:child_process';

import {
  MoxxyError,
  type TranscribeOptions,
  type Transcriber,
  type TranscriptionResult,
} from '@moxxy/sdk';
import {
  ensureModelFiles,
  type EnsureModelFilesResult,
  type FetchLike,
  type ModelFilesProgress,
} from '@moxxy/model-fetch';

import { TARGET_SAMPLE_RATE } from './audio.js';
import { decodeToMono16k } from './decode.js';
import { HostClient, type HostClientLike } from './host-client.js';
import {
  DEFAULT_MODEL_ID,
  defaultModelsDir,
  modelBytes,
  modelDir,
  modelFiles,
  requireModel,
  type WhisperModelEntry,
} from './models.js';
import { resolveSherpaLibDir, sherpaEnv, sherpaPlatformPackage } from './platform.js';

/** The single registered transcriber name. */
export const LOCAL_WHISPER_TRANSCRIBER_NAME = 'local-whisper';

const DEFAULT_NUM_THREADS = 2;

/** Resolved on-disk paths sherpa needs for one model. */
export interface WhisperModelPaths {
  readonly encoder: string;
  readonly decoder: string;
  readonly tokens: string;
}

export interface LocalWhisperOptions {
  /** Model id. The only one is `turbo`, also the default. */
  readonly model?: string;
  /** Default Whisper language tag (BCP-47-ish, e.g. `en`, `pl`). Per-call
   *  `TranscribeOptions.language` overrides it; omit to let Whisper auto-detect. */
  readonly language?: string;
  /** Inference threads. Default 2. */
  readonly numThreads?: number;
  /** Root for downloaded models. Default `~/.moxxy/models/stt` (MOXXY_HOME-aware). */
  readonly modelsDir?: string;
  /** sherpa compute provider. Default `cpu`. */
  readonly provider?: string;
  /** Absolute path to the built sidecar entry. Default: `sidecar.js` beside
   *  this module (i.e. `dist/sidecar.js` in a published build). */
  readonly sidecarPath?: string;
  /** Injected model download (tests). Defaults to @moxxy/model-fetch `ensureModelFiles`. */
  readonly ensureModelFilesImpl?: typeof ensureModelFiles;
  /** Injected `fetch`, threaded into the model download (tests). */
  readonly fetchImpl?: FetchLike;
  /** Injected sidecar host factory (tests). Defaults to a real {@link HostClient}. */
  readonly hostFactory?: () => HostClientLike;
  /** Injected `spawn` for the ffmpeg decode path (tests). */
  readonly spawnImpl?: typeof spawn;
  /** Diagnostic log sink (download progress etc.). Defaults to stderr. */
  readonly log?: (msg: string) => void;
}

/** Process-wide set of live transcribers so the plugin's `onShutdown` hook can
 *  kill every sidecar it spawned. */
const ACTIVE_STT = new Set<LocalWhisperTranscriber>();

/** Shut down every live local transcriber (kills their sidecars). */
export function shutdownLocalStt(): void {
  for (const t of ACTIVE_STT) t.shutdown();
  ACTIVE_STT.clear();
}

export class LocalWhisperTranscriber implements Transcriber {
  readonly name = LOCAL_WHISPER_TRANSCRIBER_NAME;

  private readonly model: WhisperModelEntry;
  private readonly defaultLanguage: string;
  private readonly numThreads: number;
  private readonly modelsDir: string;
  private readonly provider: string;
  private readonly sidecarPath: string | undefined;
  private readonly ensureModelFilesImpl: typeof ensureModelFiles;
  private readonly fetchImpl: FetchLike | undefined;
  private readonly hostFactory: () => HostClientLike;
  private readonly spawnImpl: typeof spawn | undefined;
  private readonly log: (msg: string) => void;

  private host: HostClientLike | null = null;
  /** In-flight model download promise — de-dupes concurrent first-use. */
  private ensuring: Promise<EnsureModelFilesResult> | null = null;

  constructor(opts: LocalWhisperOptions = {}) {
    // Validate the configured model up front so a bad config fails clearly at
    // construction rather than on the first (possibly channel-triggered) call.
    this.model = requireModel(opts.model ?? DEFAULT_MODEL_ID, 'model');
    this.defaultLanguage = typeof opts.language === 'string' ? opts.language.trim() : '';
    this.numThreads =
      opts.numThreads && Number.isInteger(opts.numThreads) && opts.numThreads > 0
        ? opts.numThreads
        : DEFAULT_NUM_THREADS;
    this.modelsDir = opts.modelsDir ?? defaultModelsDir();
    this.provider = opts.provider ?? 'cpu';
    this.sidecarPath = opts.sidecarPath;
    this.ensureModelFilesImpl = opts.ensureModelFilesImpl ?? ensureModelFiles;
    this.fetchImpl = opts.fetchImpl;
    this.hostFactory = opts.hostFactory ?? (() => this.defaultHost());
    this.spawnImpl = opts.spawnImpl;
    this.log = opts.log ?? ((msg) => process.stderr.write(`${msg}\n`));
    ACTIVE_STT.add(this);
  }

  async transcribe(
    audio: Uint8Array | ArrayBuffer,
    opts: TranscribeOptions = {},
  ): Promise<TranscriptionResult> {
    opts.signal?.throwIfAborted();

    // Decode to the canonical Float32 mono @ 16 kHz sherpa wants. This is where
    // raw PCM / WAV are handled in-process and compressed audio goes to ffmpeg.
    const samples = await decodeToMono16k(audio, opts.mimeType, {
      ...(this.spawnImpl ? { spawnImpl: this.spawnImpl } : {}),
    });
    opts.signal?.throwIfAborted();

    if (samples.length === 0) {
      return { text: '' };
    }

    const paths = await this.ensureModelFiles(opts.signal);
    opts.signal?.throwIfAborted();

    const language = ((opts.language ?? this.defaultLanguage) || '').trim();
    const host = this.getHost();
    const result = await host.transcribe({
      modelKey: paths.encoder,
      encoder: paths.encoder,
      decoder: paths.decoder,
      tokens: paths.tokens,
      numThreads: this.numThreads,
      provider: this.provider,
      language,
      task: 'transcribe',
      samples,
      sampleRate: TARGET_SAMPLE_RATE,
    });

    const durationSec = samples.length / TARGET_SAMPLE_RATE;
    // Prefer Whisper's detected language; else the caller/default hint (when
    // set) so downstream still gets a BCP-47 tag.
    const reported = result.language ?? (language || undefined);
    const out: {
      text: string;
      language?: string;
      durationSec?: number;
    } = { text: result.text.trim(), durationSec };
    if (reported) out.language = reported;
    return out;
  }

  /** Kill this transcriber's sidecar (if any) and drop registration. */
  shutdown(): void {
    this.host?.shutdown();
    this.host = null;
    ACTIVE_STT.delete(this);
  }

  private getHost(): HostClientLike {
    this.host ??= this.hostFactory();
    return this.host;
  }

  /** Resolve on-disk paths for the model, downloading its files once. */
  private async ensureModelFiles(signal?: AbortSignal): Promise<WhisperModelPaths> {
    const dir = modelDir(this.model, this.modelsDir);
    let inflight = this.ensuring;
    if (!inflight) {
      inflight = this.ensureModelFilesImpl({
        files: modelFiles(this.model),
        dir,
        ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
        ...(signal ? { signal } : {}),
        onProgress: this.makeProgressLogger(),
      });
      this.ensuring = inflight;
      // On failure, forget the promise so a later call retries the download.
      inflight.catch(() => {
        if (this.ensuring === inflight) this.ensuring = null;
      });
    }
    await inflight;
    return {
      encoder: path.join(dir, this.model.encoder.name),
      decoder: path.join(dir, this.model.decoder.name),
      tokens: path.join(dir, this.model.tokens.name),
    };
  }

  /** A progress callback that logs a single start line then ~every-10% ticks,
   *  but stays silent when the model is already present (nothing to fetch). */
  private makeProgressLogger(): (p: ModelFilesProgress) => void {
    let started = false;
    let lastPct = -1;
    return (p) => {
      const pct = p.totalBytes > 0 ? Math.floor((p.receivedBytes / p.totalBytes) * 100) : 0;
      if (!started) {
        if (pct >= 100) return;
        started = true;
        const mb = Math.round(modelBytes(this.model) / 1_000_000);
        this.log(`stt-local: first use — downloading Whisper ${this.model.id} (~${mb} MB) to ${this.modelsDir}, one-time`);
      }
      if (pct >= lastPct + 10) {
        lastPct = pct - (pct % 10);
        this.log(lastPct >= 100 ? `stt-local: ${this.model.id} ready.` : `stt-local: downloading ${this.model.id} … ${lastPct}%`);
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
          ? `Local Whisper could not load the sherpa-onnx binary (${pkg}). Reinstall @moxxy/plugin-stt-local so its platform dependency is fetched.`
          : `Local Whisper has no sherpa-onnx binary for ${process.platform}-${process.arch}.`,
        hint: 'Use the OpenAI Whisper backend instead, or run on a supported platform (macOS/Linux/Windows x64, macOS/Linux arm64).',
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

export function createLocalWhisperTranscriber(opts: LocalWhisperOptions = {}): LocalWhisperTranscriber {
  return new LocalWhisperTranscriber(opts);
}
