import type { EmbeddingProvider } from '@moxxy/sdk';

/**
 * Tensor shape exposed by @huggingface/transformers. We only need `.tolist()`
 * to extract the floats; everything else is opaque.
 */
interface FeatureTensor {
  tolist(): number[] | number[][] | number[][][];
}

/** Subset of the `pipeline()` factory signature we depend on. */
export type PipelineFactory = (
  task: string,
  model: string,
) => Promise<(input: string | string[], opts?: Record<string, unknown>) => Promise<FeatureTensor>>;

/**
 * Defensive per-input byte cap. The model's own token window (512 for the
 * MiniLM/BGE family) is enforced via `{ truncation: true }` below, but memory
 * text reaching embed() via recall is untrusted: a multi-MB body would still be
 * fully tokenized before truncation kicks in, spiking RAM/CPU and stalling the
 * synchronous-ish extractor call for the whole chunk. Clamp the raw string
 * first so a pathological/hostile input can't OOM the on-device extractor.
 */
const MAX_INPUT_BYTES = 64 * 1024;

/** Known sentence-transformer models we ship metadata for. Extensible via `dimensions:`. */
const KNOWN_DIMS: Record<string, number> = {
  'Xenova/all-MiniLM-L6-v2': 384,
  'Xenova/all-MiniLM-L12-v2': 384,
  'Xenova/bge-small-en-v1.5': 384,
  'Xenova/bge-base-en-v1.5': 768,
  'Xenova/all-mpnet-base-v2': 768,
  'Xenova/multi-qa-MiniLM-L6-cos-v1': 384,
};

export interface TransformersEmbedderOptions {
  readonly model?: string;
  /** Override `dim` for non-standard models. */
  readonly dimensions?: number;
  /** Inject a custom pipeline factory (used by tests with a stub). */
  readonly pipelineFactory?: PipelineFactory;
  /** Force model files to load from a local directory (set HF_HOME or equivalent). */
  readonly cacheDir?: string;
  /**
   * Max inputs sent to the ONNX extractor per call. Bounds peak RAM and keeps a
   * large memory-consolidation batch from stalling the event loop on-device.
   * Defaults to a conservative on-device size; mirrors the OpenAI sibling's
   * chunking. Output order/length is preserved across chunks.
   */
  readonly batchSize?: number;
}

const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2';
// Conservative on-device default: small enough to bound ONNX peak memory and
// keep each synchronous extractor call short, large enough to amortize overhead.
const DEFAULT_BATCH_SIZE = 32;

export class TransformersEmbedder implements EmbeddingProvider {
  /**
   * Model-scoped so different transformer models get distinct cache
   * namespaces. A static `'transformers'` collides every model's vectors in
   * `CachedEmbeddingProvider` / the memory `EmbeddingIndex` (keyed on `name`).
   */
  readonly name: string;
  readonly model: string;
  private readonly explicitDim?: number;
  private readonly pipelineFactory: PipelineFactory | null;
  private readonly batchSize: number;
  private readonly cacheDir?: string;
  private extractor: Awaited<ReturnType<PipelineFactory>> | null = null;
  private extractorPromise: Promise<Awaited<ReturnType<PipelineFactory>>> | null = null;
  /**
   * The vector length the model actually emits, captured from the first vector
   * ever produced. Every subsequent vector is validated against it so a model
   * that emits *ragged* (within-batch inconsistent) or empty vectors fails loud
   * instead of silently feeding mismatched-length rows into the memory index —
   * cosineSimilarity zips to the shorter length and never errors, so a single
   * short/empty vector silently corrupts recall otherwise.
   */
  private observedDim: number | null = null;

  // embed() assumes the caller serializes concurrent embed() calls per instance
  // (the memory store wraps recall in a per-instance mutex). transformers.js
  // pipelines are not documented as reentrant; overlapping embed() calls share
  // one extractor instance with unspecified interleaving. The extractorPromise
  // latch only deduplicates *loading*, not invocation.
  constructor(opts: TransformersEmbedderOptions = {}) {
    this.model = opts.model ?? DEFAULT_MODEL;
    this.explicitDim = opts.dimensions;
    // Bake the dimensions override into the identity (mirrors the OpenAI
    // sibling) so two embedders for the same model but different `dimensions`
    // never collide on `name` — the stable identity the SDK docs promise.
    this.name =
      this.explicitDim !== undefined
        ? `transformers:${this.model}:${this.explicitDim}`
        : `transformers:${this.model}`;
    this.pipelineFactory = opts.pipelineFactory ?? null;
    this.batchSize = opts.batchSize && opts.batchSize > 0 ? opts.batchSize : DEFAULT_BATCH_SIZE;
    // Stash the cache dir; apply it only at actual model-load time (not here).
    // Constructing an embedder must be a cheap, side-effect-free createClient
    // (per the EmbedderDef contract) — mutating the process-global HF_HOME in
    // the ctor meant the last-constructed embedder silently rebound the cache
    // dir for every other instance and any other HF reader, order-dependently.
    if (opts.cacheDir) this.cacheDir = opts.cacheDir;
  }

  get dim(): number | 'dynamic' {
    return this.explicitDim ?? KNOWN_DIMS[this.model] ?? 'dynamic';
  }

  private async ensureExtractor(): Promise<Awaited<ReturnType<PipelineFactory>>> {
    if (this.extractor) return this.extractor;
    if (this.extractorPromise) return await this.extractorPromise;
    // Clear the latch on rejection so a transient load failure (ONNX/download/
    // OOM/missing native binary) doesn't brick the embedder for the whole
    // process lifetime — the next embed() retries instead of re-throwing the
    // cached rejection.
    this.extractorPromise = (async () => {
      const factory = this.pipelineFactory ?? (await this.loadDefaultFactory());
      const extractor = await factory('feature-extraction', this.model);
      this.extractor = extractor;
      return extractor;
    })().catch((err) => {
      this.extractorPromise = null;
      throw err;
    });
    return await this.extractorPromise;
  }

  /** Load the real `@huggingface/transformers` pipeline, pinning the cache dir
   *  through the library's own `env.cacheDir` knob (not the process-global
   *  HF_HOME) immediately before the loader resolves the model. Scoping this to
   *  the actual load — rather than the constructor — keeps construction
   *  side-effect-free. Injected pipelineFactory paths (tests) never reach here. */
  private async loadDefaultFactory(): Promise<PipelineFactory> {
    return await loadDefaultFactory(this.cacheDir);
  }

  async embed(texts: ReadonlyArray<string>): Promise<ReadonlyArray<ReadonlyArray<number>>> {
    if (texts.length === 0) return [];
    const extractor = await this.ensureExtractor();
    // Chunk by batchSize so a large corpus can't spike ONNX RAM or stall the
    // event loop in one giant synchronous-ish call. Accumulate in input order.
    const out: ReadonlyArray<number>[] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const chunk = texts.slice(i, i + this.batchSize).map((t) => clampBytes(t, MAX_INPUT_BYTES));
      // `truncation: true` bounds each input to the model's token window so a
      // single over-long text can't error or balloon the extractor's memory.
      const result = await extractor([...chunk], {
        pooling: 'mean',
        normalize: true,
        truncation: true,
      });
      const list = result.tolist();
      for (const vec of normalizeShape(list, chunk.length)) {
        this.checkObservedDim(vec.length);
        out.push(vec);
      }
    }
    return out;
  }

  /**
   * Validate EVERY produced vector's length, not just the first:
   *   1. Catch a stale `KNOWN_DIMS` entry, a swapped/quantized model, or a wrong
   *      `dimensions` override, instead of silently building the memory index
   *      with one dimensionality while the model emits another.
   *   2. Reject a zero-length vector (e.g. the 3D-fallback's empty-sequence row,
   *      or a partially-loaded model) — a 0-dim vector cosines to 0 against
   *      everything and silently ruins that record's ranking.
   *   3. Reject a ragged batch (vectors of differing lengths within one embed()
   *      call) — cosineSimilarity zips to `Math.min(len)` and never errors, so a
   *      single short row otherwise misranks with no diagnostic.
   * Checks 2 and 3 hold even for `'dynamic'`-dim models (which adopt whatever the
   * model returns); check 1 only fires when a concrete dim is declared.
   */
  private checkObservedDim(observed: number): void {
    if (observed <= 0) {
      throw new Error(
        `transformers embedder: model '${this.model}' produced a zero-length vector; ` +
          'a 0-dim embedding silently corrupts the memory index (cosine 0 vs all).',
      );
    }
    if (this.observedDim === null) {
      this.observedDim = observed;
      const declared = this.dim;
      if (declared !== 'dynamic' && observed !== declared) {
        throw new Error(
          `transformers embedder: model '${this.model}' produced ${observed}-dim vectors ` +
            `but '${this.name}' declares dim ${declared}. Fix the 'dimensions' override or ` +
            `KNOWN_DIMS before this corrupts the memory index.`,
        );
      }
      return;
    }
    if (observed !== this.observedDim) {
      throw new Error(
        `transformers embedder: model '${this.model}' produced a ${observed}-dim vector ` +
          `after a ${this.observedDim}-dim vector (ragged batch). Mismatched-length vectors ` +
          'zip to the shorter length in cosine similarity and silently corrupt recall.',
      );
    }
  }
}

/**
 * Truncate a string to at most `maxBytes` UTF-8 bytes (on a char boundary).
 * Coerces non-strings to '' rather than throwing: `embed()` is typed
 * `ReadonlyArray<string>`, but a buggy/hostile caller can still pass a
 * `null`/`undefined`/non-string through the untyped boundary, and a TypeError
 * here would crash the whole recall instead of degrading. An empty string still
 * yields a valid (non-empty) embedding from the model, so positional alignment
 * with the input batch is preserved.
 */
function clampBytes(text: string, maxBytes: number): string {
  if (typeof text !== 'string') return '';
  // Fast path: ASCII-heavy strings within the cap (1 char >= 1 byte).
  if (text.length <= maxBytes) return text;
  const encoded = new TextEncoder().encode(text);
  if (encoded.length <= maxBytes) return text;
  // `fatal:false` (default) emits U+FFFD for a multi-byte char split at the
  // byte boundary rather than throwing — so truncation never crashes.
  return new TextDecoder().decode(encoded.subarray(0, maxBytes));
}

/**
 * `@huggingface/transformers` is a process-singleton whose cache dir is global.
 * Once one embedder pins it, a *different* cacheDir from a second co-resident
 * embedder would silently route to the wrong cache (order-dependent). Record the
 * first pinned dir and fail loud on a genuine conflict instead of clobbering.
 */
let pinnedCacheDir: string | undefined;

async function loadDefaultFactory(cacheDir?: string): Promise<PipelineFactory> {
  try {
    const mod = (await import('@huggingface/transformers')) as {
      pipeline: PipelineFactory;
      env?: { cacheDir?: string; localModelPath?: string };
    };
    if (cacheDir) {
      if (pinnedCacheDir !== undefined && pinnedCacheDir !== cacheDir) {
        throw new Error(
          "@moxxy/plugin-embeddings-transformers: conflicting cacheDir for the shared " +
            `'@huggingface/transformers' singleton ('${pinnedCacheDir}' vs '${cacheDir}'). ` +
            'Use one cacheDir per process — the library cannot serve two cache dirs at once.',
        );
      }
      pinnedCacheDir = cacheDir;
      // Pin via the library's own knob, not the process-global HF_HOME, so we
      // don't rebind the cache dir for unrelated HF readers in the same process.
      if (mod.env) mod.env.cacheDir = cacheDir;
    }
    return mod.pipeline;
  } catch (err) {
    // Re-throw our own conflict error verbatim; only wrap genuine load failures.
    if (err instanceof Error && err.message.includes('conflicting cacheDir')) throw err;
    throw new Error(
      "@moxxy/plugin-embeddings-transformers: failed to load '@huggingface/transformers'. " +
        'Make sure the dependency is installed (it ships ONNX binaries that need a successful install). ' +
        `Original error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * `extractor()` returns one of:
 *   - number[]            (single text, but really shaped as a batch-of-1)
 *   - number[][]          (batch — what we want, one vector per input)
 *   - number[][][]        (when pooling is not applied, shape [batch, seq_len, hidden])
 *
 * Our call with `{ pooling: 'mean', normalize: true }` should always yield [batch, hidden].
 */
function normalizeShape(
  data: number[] | number[][] | number[][][],
  expected: number,
): ReadonlyArray<ReadonlyArray<number>> {
  // Contract (sdk/embedding.ts): one vector per input, in input order.
  // Downstream consumers (plugin-memory store/search) read vectors strictly
  // positionally with non-null assertions, so producing fewer vectors than
  // inputs would read `undefined` as the query vector → NaN-poisoned cosine or
  // an outright crash. Every malformed shape must FAIL LOUD rather than return a
  // short/empty list — never let a misbehaving/partially-loaded model silently
  // misalign vectors to the wrong memory record ids.
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(
      `transformers embedder: model returned no vectors for ${expected} inputs`,
    );
  }

  const first = data[0];
  if (typeof first === 'number') {
    // Got a flat vector — only valid as a single-element batch.
    if (expected !== 1) {
      throw new Error(
        `transformers embedder: model returned 1 vector for ${expected} inputs`,
      );
    }
    return [data as number[]];
  }
  if (Array.isArray(first) && (first.length === 0 || typeof first[0] === 'number')) {
    const batch = data as number[][];
    if (batch.length !== expected) {
      throw new Error(
        `transformers embedder: model returned ${batch.length} vectors for ${expected} inputs`,
      );
    }
    return batch;
  }
  // Unexpected 3D shape: take the first vector per sequence (fallback).
  const nested = data as number[][][];
  if (nested.length !== expected) {
    throw new Error(
      `transformers embedder: model returned ${nested.length} vectors for ${expected} inputs`,
    );
  }
  return nested.map((seq) => (seq[0] ?? []) as number[]);
}

export function createTransformersEmbedder(opts: TransformersEmbedderOptions = {}): TransformersEmbedder {
  return new TransformersEmbedder(opts);
}
