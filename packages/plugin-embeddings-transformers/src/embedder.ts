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
}

const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2';

export class TransformersEmbedder implements EmbeddingProvider {
  readonly name = 'transformers';
  readonly model: string;
  private readonly explicitDim?: number;
  private readonly pipelineFactory: PipelineFactory | null;
  private extractor: Awaited<ReturnType<PipelineFactory>> | null = null;
  private extractorPromise: Promise<Awaited<ReturnType<PipelineFactory>>> | null = null;

  constructor(opts: TransformersEmbedderOptions = {}) {
    this.model = opts.model ?? DEFAULT_MODEL;
    this.explicitDim = opts.dimensions;
    this.pipelineFactory = opts.pipelineFactory ?? null;
    if (opts.cacheDir) {
      // Honor HF caching env var so users can pin where models land.
      process.env.HF_HOME = opts.cacheDir;
    }
  }

  get dim(): number | 'dynamic' {
    return this.explicitDim ?? KNOWN_DIMS[this.model] ?? 'dynamic';
  }

  private async ensureExtractor(): Promise<Awaited<ReturnType<PipelineFactory>>> {
    if (this.extractor) return this.extractor;
    if (this.extractorPromise) return await this.extractorPromise;
    this.extractorPromise = (async () => {
      const factory = this.pipelineFactory ?? (await loadDefaultFactory());
      const extractor = await factory('feature-extraction', this.model);
      this.extractor = extractor;
      return extractor;
    })();
    return await this.extractorPromise;
  }

  async embed(texts: ReadonlyArray<string>): Promise<ReadonlyArray<ReadonlyArray<number>>> {
    if (texts.length === 0) return [];
    const extractor = await this.ensureExtractor();
    const result = await extractor([...texts], { pooling: 'mean', normalize: true });
    const list = result.tolist();
    return normalizeShape(list, texts.length);
  }
}

async function loadDefaultFactory(): Promise<PipelineFactory> {
  try {
    const mod = (await import('@huggingface/transformers')) as { pipeline: PipelineFactory };
    return mod.pipeline;
  } catch (err) {
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
  if (!Array.isArray(data) || data.length === 0) return [];

  const first = data[0];
  if (typeof first === 'number') {
    // Got a flat vector — wrap as a single-element batch.
    return [data as number[]];
  }
  if (Array.isArray(first) && (first.length === 0 || typeof first[0] === 'number')) {
    return data as number[][];
  }
  // Unexpected 3D shape: take the first vector per sequence (fallback).
  const nested = data as number[][][];
  if (nested.length !== expected) return [];
  return nested.map((seq) => (seq[0] ?? []) as number[]);
}

export function createTransformersEmbedder(opts: TransformersEmbedderOptions = {}): TransformersEmbedder {
  return new TransformersEmbedder(opts);
}
