/**
 * On-device NER worker. Runs transformers.js (`Xenova/bert-base-NER`) on the
 * onnxruntime-web WASM backend, entirely offline.
 *
 * Offline enforcement (defense in depth atop the renderer CSP):
 *   - `remoteHost` points transformers.js at the local `moxxy-app://` scheme, so
 *     the model is loaded from the install dir — a huggingface.co request can
 *     never leave this worker (and CSP `connect-src` excludes all real network).
 *   - The onnxruntime-web WASM runtime (the `ort-wasm-simd-threaded.jsep.{mjs,wasm}`
 *     glue + binary) is NOT bundled into the worker chunk — onnxruntime-web
 *     dynamically `import()`s its glue at session-create time, and by DEFAULT
 *     transformers.js resolves that from the jsdelivr CDN. That would (a) break
 *     the offline guarantee and (b) fail outright (CSP-blocked / offline). So we
 *     ship those artifacts as part of the app shell (Vite copies them to
 *     `dist/ort/`, served from the renderer's own origin) and pin
 *     `env.backends.onnx.wasm.wasmPaths` to that LOCAL base below, BEFORE the
 *     pipeline creates the ORT session — ORT then appends the filename and loads
 *     from `'self'`, never the CDN. See {@link ../../../../electron.vite.config.ts}.
 * The heavy work is here so the UI thread never blocks while a ~109 MB model
 * loads and runs.
 */
import { env, pipeline } from '@huggingface/transformers';

const ctx = self as unknown as {
  postMessage: (message: unknown) => void;
  onmessage: ((e: MessageEvent) => void) | null;
};

/**
 * Base URL the onnxruntime-web WASM artifacts are served from. They live at
 * `/ort/` under the renderer origin in all three serving modes:
 *   - dev:      the Vite dev server (a middleware serves `/ort/*`);
 *   - prod:     the loopback HTTPS origin (`dist/ort/...`);
 *   - fallback: `file://.../dist/ort/...`.
 * For http(s) origins an origin-rooted `/ort/` is exact. For a `file://` worker
 * `self.location.origin` is the opaque `"null"`, so resolve RELATIVE to the
 * worker chunk instead (it lives in `dist/assets/`, so `../ort/` lands in
 * `dist/ort/`). ORT appends the filename, so the path MUST end in a slash.
 */
function ortWasmBase(): string {
  const here = self.location;
  if (here.protocol === 'file:') {
    return new URL('../ort/', here.href).href;
  }
  return new URL('/ort/', here.origin).href;
}

// Load the model from the locally installed copy under our custom scheme.
// `pathJoin` only trims boundary slashes, so the `://` in remoteHost survives:
// final URL = moxxy-app://assets/anonymizer/<model>/resolve/<rev>/<file>, which
// the asset protocol serves from `userData/moxxy-apps/anonymizer/...`.
env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = false;
env.remoteHost = 'moxxy-app://assets/anonymizer/';
env.remotePathTemplate = '{model}/resolve/{revision}/';

// onnxruntime-web: pin the WASM artifact base to our locally-served `/ort/` so
// ORT loads `ort-wasm-simd-threaded.jsep.{mjs,wasm}` from the app's own origin
// instead of the jsdelivr CDN (transformers.js only falls back to the CDN when
// `wasmPaths` is unset — setting it here, before the pipeline creates the ORT
// session, defeats that fallback). Force single-threaded (no SharedArrayBuffer /
// COOP-COEP) and no proxy worker so nothing tries to re-fetch a loader at runtime.
const wasmBackend = env.backends?.onnx?.wasm;
if (wasmBackend) {
  wasmBackend.wasmPaths = ortWasmBase();
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
