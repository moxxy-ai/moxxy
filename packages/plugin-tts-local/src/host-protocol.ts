/**
 * The tiny JSON message protocol spoken between the parent (host-client) and
 * the forked sherpa sidecar, plus the pure per-message handler the sidecar
 * runs. Kept free of `node:child_process` so BOTH sides can import it (the
 * parent for the types, the child for the handler) without dragging fork
 * plumbing into either bundle.
 *
 * Wire shape (over the fork IPC channel, `serialization: 'advanced'` so the
 * Float32Array round-trips intact):
 *   parent → child:  SynthesizeRequest
 *   child  → parent: HostReply
 */

/** One synthesis request. Carries the full model config so the sidecar is
 *  stateless-per-message except for a model cache keyed by `voiceKey`. */
export interface SynthesizeRequest {
  readonly id: number;
  readonly type: 'synthesize';
  /** Cache key for the loaded model (the absolute `.onnx` path). */
  readonly voiceKey: string;
  /** Absolute path to the VITS `.onnx` model. */
  readonly model: string;
  /** Absolute path to `tokens.txt`. */
  readonly tokens: string;
  /** Absolute path to the `espeak-ng-data` directory. */
  readonly dataDir: string;
  /** Inference thread count. */
  readonly numThreads: number;
  /** Compute provider (`cpu`). */
  readonly provider: string;
  /** Text to speak. */
  readonly text: string;
  /** Speaker id within the model (0 for single-speaker Piper voices). */
  readonly sid: number;
  /** Speaking-rate multiplier already clamped by the caller. */
  readonly speed: number;
}

export type HostRequest = SynthesizeRequest;

export type HostErrorKind =
  /** Model failed to load (bad/absent files, unsupported arch, addon dlopen). */
  | 'init'
  /** Synthesis itself threw. */
  | 'runtime';

export type HostReply =
  | {
      readonly id: number;
      readonly ok: true;
      readonly sampleRate: number;
      /** Mono PCM in [-1, 1]; structured-cloned intact over advanced IPC. */
      readonly samples: Float32Array;
    }
  | {
      readonly id: number;
      readonly ok: false;
      readonly error: { readonly message: string; readonly kind: HostErrorKind };
    };

/** The subset of the sherpa-onnx-node surface the sidecar uses. Declared here
 *  (rather than leaning on the addon's ambient types) so the handler is
 *  unit-testable with a fake module and typechecks without the native addon. */
export interface SherpaOfflineTts {
  generateAsync(args: {
    text: string;
    sid: number;
    speed: number;
  }): Promise<{ samples: Float32Array; sampleRate: number }>;
}

export interface SherpaModule {
  OfflineTts: new (config: unknown) => SherpaOfflineTts;
}

/** Lazily load the native sherpa module (so a dlopen failure surfaces as a
 *  classified reply, not a boot crash). */
export type LoadSherpa = () => SherpaModule;

export type HostMessageHandler = (req: HostRequest) => Promise<HostReply>;

/**
 * Build the sidecar's message handler. Loads the sherpa module on first use and
 * caches one `OfflineTts` per `voiceKey` so repeated calls on the same voice
 * reuse the loaded model. Every failure becomes a typed `ok:false` reply —
 * nothing throws out of `handle`.
 */
export function createMessageHandler(loadSherpa: LoadSherpa): HostMessageHandler {
  const cache = new Map<string, SherpaOfflineTts>();
  let mod: SherpaModule | null = null;

  return async function handle(req: HostRequest): Promise<HostReply> {
    let tts = cache.get(req.voiceKey);
    if (!tts) {
      try {
        mod ??= loadSherpa();
        tts = new mod.OfflineTts({
          model: {
            vits: { model: req.model, tokens: req.tokens, dataDir: req.dataDir },
            numThreads: req.numThreads,
            provider: req.provider,
            debug: false,
          },
          maxNumSentences: 1,
        });
        cache.set(req.voiceKey, tts);
      } catch (err) {
        return { id: req.id, ok: false, error: { message: errMsg(err), kind: 'init' } };
      }
    }

    try {
      const out = await tts.generateAsync({ text: req.text, sid: req.sid, speed: req.speed });
      const samples =
        out.samples instanceof Float32Array
          ? out.samples
          : Float32Array.from(out.samples as ArrayLike<number>);
      return { id: req.id, ok: true, sampleRate: out.sampleRate, samples };
    } catch (err) {
      return { id: req.id, ok: false, error: { message: errMsg(err), kind: 'runtime' } };
    }
  };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
