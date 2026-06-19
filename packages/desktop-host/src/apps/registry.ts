/**
 * The registry of installable desktop apps (their downloadable asset bundles).
 *
 * Only apps that need a one-time local asset fetch appear here. Today that is
 * the document anonymizer, which downloads an on-device NER model (a quantised
 * `tjruesch/xlm-roberta-base-ner-hrl-onnx` ONNX bundle, ~300 MB — multilingual,
 * so it detects names in Polish and other languages, not just English) so it can
 * detect names entirely offline at use time. The onnxruntime-web wasm RUNTIME
 * (~21 MB) is NOT fetched
 * on demand — it ships as part of the app shell: Vite copies it from
 * `@huggingface/transformers` into the renderer build (`dist/ort/`, served from
 * `'self'`; see `apps/desktop/electron.vite.config.ts`), so only the large model
 * is downloaded at install time.
 *
 * IMPORTANT — dest mirrors the URL the renderer will request EXACTLY. The
 * renderer's NER worker rewrites transformers.js model fetches to
 * `moxxy-app://assets/anonymizer/<hf-resolve-path>`; the asset protocol serves
 * `<appsRoot>/anonymizer/<that-same-path>`. So each asset's `dest` is that path
 * verbatim — URL and dest must line up or the worker 404s on its own model.
 */

import type { AppInstallSpec } from './installer.js';

/**
 * Hugging Face files that make up the quantised NER model bundle.
 *
 * XLM-RoBERTa is a SentencePiece tokenizer, so the bundle carries
 * `sentencepiece.bpe.model` + `tokenizer.json` instead of WordPiece's `vocab.txt`.
 * The weight file is `onnx/model_quantized.onnx`: on the WASM backend
 * transformers.js defaults to the `q8` dtype (suffix `_quantized`), so the worker
 * requests exactly this file — keep them in sync.
 */
const HF_MODEL_FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'sentencepiece.bpe.model',
  'onnx/model_quantized.onnx',
] as const;

const HF_RESOLVE_BASE = 'tjruesch/xlm-roberta-base-ner-hrl-onnx/resolve/main/';
const HF_URL_BASE = `https://huggingface.co/${HF_RESOLVE_BASE}`;

const ANONYMIZER: AppInstallSpec = {
  id: 'anonymizer',
  // Bump this when the model bundle changes so existing installs re-download.
  version: 'xlmr-base-ner-hrl-q8-v1',
  assets: HF_MODEL_FILES.map((file) => ({
    url: HF_URL_BASE + file,
    // dest === the HF resolve path, so it lines up with the renderer's rewrite.
    dest: HF_RESOLVE_BASE + file,
    // No bytes/sha256: Content-Length drives the progress bar, and the HF
    // resolve endpoint serves the canonical artifact (the onnx is ~278 MB).
  })),
};

/** Installable apps keyed by id. Apps NOT listed here need no asset install
 *  (they're trivially "installed" from the gallery's perspective). */
export const APP_INSTALLERS: Readonly<Record<string, AppInstallSpec>> = {
  [ANONYMIZER.id]: ANONYMIZER,
};
