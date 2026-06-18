/**
 * The registry of installable desktop apps (their downloadable asset bundles).
 *
 * Only apps that need a one-time local asset fetch appear here. Today that is
 * the document anonymizer, which downloads an on-device NER model (a quantised
 * `Xenova/bert-base-NER` ONNX bundle, ~109 MB) so it can detect names entirely
 * offline at use time. The onnxruntime-web wasm RUNTIME (~21 MB) is NOT here —
 * Vite bundles it into the app from `@huggingface/transformers` (served from
 * `'self'`); only the large model is fetched on demand.
 *
 * IMPORTANT — dest mirrors the URL the renderer will request EXACTLY. The
 * renderer's NER worker rewrites transformers.js model fetches to
 * `moxxy-app://assets/anonymizer/<hf-resolve-path>`; the asset protocol serves
 * `<appsRoot>/anonymizer/<that-same-path>`. So each asset's `dest` is that path
 * verbatim — URL and dest must line up or the worker 404s on its own model.
 */

import type { AppInstallSpec } from './installer.js';

/** Hugging Face files that make up the quantised NER model bundle. */
const HF_MODEL_FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'vocab.txt',
  'onnx/model_quantized.onnx',
] as const;

const HF_RESOLVE_BASE = 'Xenova/bert-base-NER/resolve/main/';
const HF_URL_BASE = `https://huggingface.co/${HF_RESOLVE_BASE}`;

const ANONYMIZER: AppInstallSpec = {
  id: 'anonymizer',
  // Bump this when the model bundle changes so existing installs re-download.
  version: 'xenova-bert-base-ner-q8-v1',
  assets: HF_MODEL_FILES.map((file) => ({
    url: HF_URL_BASE + file,
    // dest === the HF resolve path, so it lines up with the renderer's rewrite.
    dest: HF_RESOLVE_BASE + file,
    // No bytes/sha256: Content-Length drives the progress bar, and the HF
    // resolve endpoint serves the canonical artifact (the onnx is ~109 MB).
  })),
};

/** Installable apps keyed by id. Apps NOT listed here need no asset install
 *  (they're trivially "installed" from the gallery's perspective). */
export const APP_INSTALLERS: Readonly<Record<string, AppInstallSpec>> = {
  [ANONYMIZER.id]: ANONYMIZER,
};
