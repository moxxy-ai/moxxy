/**
 * The tiny message protocol spoken between the parent (host-client) and the
 * forked sherpa sidecar, plus the pure per-message handler the sidecar runs.
 * Kept free of `node:child_process` so BOTH sides can import it (the parent for
 * the types, the child for the handler) without dragging fork plumbing into
 * either bundle.
 *
 * Wire shape (over the fork IPC channel, `serialization: 'advanced'` so the
 * `Float32Array` of samples round-trips intact):
 *   parent → child:  TranscribeRequest  (carries the decoded 16 kHz mono PCM)
 *   child  → parent: HostReply          (the transcript text)
 */

/** One transcription request. Carries the full model config so the sidecar is
 *  stateless-per-message except for a recognizer cache keyed by `modelKey`. The
 *  audio is already decoded to Float32 mono @ 16 kHz by the parent — the sidecar
 *  only owns the native recognition. */
export interface TranscribeRequest {
  readonly id: number;
  readonly type: 'transcribe';
  /** Cache key for the loaded recognizer (the absolute encoder path). */
  readonly modelKey: string;
  /** Absolute path to the Whisper encoder `.onnx`. */
  readonly encoder: string;
  /** Absolute path to the Whisper decoder `.onnx`. */
  readonly decoder: string;
  /** Absolute path to `<id>-tokens.txt`. */
  readonly tokens: string;
  /** Inference thread count. */
  readonly numThreads: number;
  /** Compute provider (`cpu`). */
  readonly provider: string;
  /** Best-effort Whisper language tag; empty string ⇒ auto-detect. */
  readonly language: string;
  /** Whisper task: `transcribe` (same-language) or `translate` (→ English). */
  readonly task: string;
  /** Mono PCM in [-1, 1] at `sampleRate`; structured-cloned intact over IPC. */
  readonly samples: Float32Array;
  /** Sample rate of `samples` (16000 — the parent resamples before sending). */
  readonly sampleRate: number;
}

export type HostRequest = TranscribeRequest;

export type HostErrorKind =
  /** Recognizer failed to load (bad/absent files, unsupported arch, dlopen). */
  | 'init'
  /** Decoding itself threw. */
  | 'runtime';

export interface TranscribeResult {
  readonly text: string;
  /** Whisper's detected language, when the native result reports one. */
  readonly language?: string;
}

export type HostReply =
  | ({ readonly id: number; readonly ok: true } & TranscribeResult)
  | {
      readonly id: number;
      readonly ok: false;
      readonly error: { readonly message: string; readonly kind: HostErrorKind };
    };

/** The subset of the sherpa-onnx-node surface the sidecar uses. Declared here
 *  (rather than leaning on the addon's ambient types) so the handler is
 *  unit-testable with a fake module and typechecks without the native addon. */
export interface SherpaOfflineStream {
  acceptWaveform(args: { sampleRate: number; samples: Float32Array }): void;
}

export interface SherpaOfflineRecognizerResult {
  readonly text: string;
  /** Whisper detected-language field on some builds; read defensively. */
  readonly lang?: string;
}

export interface SherpaOfflineRecognizer {
  createStream(): SherpaOfflineStream;
  decode(stream: SherpaOfflineStream): void;
  getResult(stream: SherpaOfflineStream): SherpaOfflineRecognizerResult;
}

export interface SherpaModule {
  OfflineRecognizer: new (config: unknown) => SherpaOfflineRecognizer;
}

/** Lazily load the native sherpa module (so a dlopen failure surfaces as a
 *  classified reply, not a boot crash). */
export type LoadSherpa = () => SherpaModule;

export type HostMessageHandler = (req: HostRequest) => Promise<HostReply>;

/**
 * Build the sidecar's message handler. Loads the sherpa module on first use and
 * caches one `OfflineRecognizer` per `modelKey` so repeated calls on the same
 * model reuse the loaded weights. Every failure becomes a typed `ok:false`
 * reply — nothing throws out of `handle`.
 */
export function createMessageHandler(loadSherpa: LoadSherpa): HostMessageHandler {
  const cache = new Map<string, SherpaOfflineRecognizer>();
  let mod: SherpaModule | null = null;

  return async function handle(req: HostRequest): Promise<HostReply> {
    let recognizer = cache.get(req.modelKey);
    if (!recognizer) {
      try {
        mod ??= loadSherpa();
        recognizer = new mod.OfflineRecognizer({
          featConfig: { sampleRate: 16_000, featureDim: 80 },
          modelConfig: {
            whisper: {
              encoder: req.encoder,
              decoder: req.decoder,
              // `language`/`task` are present in the OfflineWhisperModelConfig
              // types but exercised by no upstream example — pass them through
              // best-effort (empty language ⇒ Whisper auto-detects anyway).
              language: req.language,
              task: req.task,
            },
            tokens: req.tokens,
            numThreads: req.numThreads,
            provider: req.provider,
            debug: false,
          },
        });
        cache.set(req.modelKey, recognizer);
      } catch (err) {
        return { id: req.id, ok: false, error: { message: errMsg(err), kind: 'init' } };
      }
    }

    try {
      const stream = recognizer.createStream();
      stream.acceptWaveform({ sampleRate: req.sampleRate, samples: req.samples });
      recognizer.decode(stream);
      const result = recognizer.getResult(stream);
      const text = typeof result?.text === 'string' ? result.text : '';
      const reply: { id: number; ok: true } & TranscribeResult =
        typeof result?.lang === 'string' && result.lang
          ? { id: req.id, ok: true, text, language: result.lang }
          : { id: req.id, ok: true, text };
      return reply;
    } catch (err) {
      return { id: req.id, ok: false, error: { message: errMsg(err), kind: 'runtime' } };
    }
  };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
