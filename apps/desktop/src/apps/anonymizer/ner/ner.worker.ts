/**
 * On-device NER worker. Runs transformers.js (`Xenova/bert-base-NER`) on the
 * onnxruntime-web WASM backend, entirely offline.
 *
 * Offline enforcement (defense in depth atop the renderer CSP):
 *   - `remoteHost` points transformers.js at the local `moxxy-app://` scheme, so
 *     the model is loaded from the install dir — a huggingface.co request can
 *     never leave this worker (and CSP `connect-src` excludes all real network).
 *   - The onnxruntime-web wasm runtime is bundled into the app by Vite (from
 *     `@huggingface/transformers`) and loads from `'self'`, so no `wasmPaths`
 *     override is needed; we only force single-threaded + no proxy worker.
 * The heavy work is here so the UI thread never blocks while a ~109 MB model
 * loads and runs.
 */
import { env, pipeline } from '@huggingface/transformers';

const ctx = self as unknown as {
  postMessage: (message: unknown) => void;
  onmessage: ((e: MessageEvent) => void) | null;
};

// Load the model from the locally installed copy under our custom scheme.
// `pathJoin` only trims boundary slashes, so the `://` in remoteHost survives:
// final URL = moxxy-app://assets/anonymizer/<model>/resolve/<rev>/<file>, which
// the asset protocol serves from `userData/moxxy-apps/anonymizer/...`.
env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = false;
env.remoteHost = 'moxxy-app://assets/anonymizer/';
env.remotePathTemplate = '{model}/resolve/{revision}/';

// onnxruntime-web: the wasm runtime is bundled by Vite (loads from 'self'), so
// no wasmPaths override. Force single-threaded (no SharedArrayBuffer / COOP-COEP)
// and no proxy worker so nothing tries to re-fetch a loader at runtime.
const wasmBackend = env.backends?.onnx?.wasm;
if (wasmBackend) {
  wasmBackend.numThreads = 1;
  wasmBackend.proxy = false;
}

const MODEL_ID = 'Xenova/bert-base-NER';
type NerFn = (
  text: string,
) => Promise<Array<{ entity: string; word: string; index: number; score: number }>>;
let nerPromise: Promise<NerFn> | null = null;

function getNer(): Promise<NerFn> {
  if (!nerPromise) {
    nerPromise = pipeline('token-classification', MODEL_ID, {
      progress_callback: (progress: unknown) => ctx.postMessage({ type: 'progress', progress }),
    }) as unknown as Promise<NerFn>;
  }
  return nerPromise;
}

ctx.onmessage = (e: MessageEvent): void => {
  const msg = e.data as { type?: string; id?: number; text?: string };
  if (msg?.type !== 'infer' || typeof msg.text !== 'string') return;
  void (async () => {
    try {
      const ner = await getNer();
      const tokens = await ner(msg.text!);
      ctx.postMessage({ type: 'result', id: msg.id, tokens });
    } catch (err) {
      ctx.postMessage({
        type: 'error',
        id: msg.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();
};
