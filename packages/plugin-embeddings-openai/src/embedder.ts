import OpenAI from 'openai';
import type { EmbeddingProvider } from '@moxxy/sdk';

export type OpenAIEmbeddingModel =
  | 'text-embedding-3-small'
  | 'text-embedding-3-large'
  | 'text-embedding-ada-002';

const MODEL_DIM: Record<OpenAIEmbeddingModel, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
};

const DEFAULT_BATCH_SIZE = 100; // OpenAI accepts up to 2048; 100 is a safe default.

// The OpenAI SDK defaults to a 10-minute per-request timeout and 2 retries, so a
// hostile or merely slow `baseURL` (an explicitly supported, untrusted config —
// Ollama/LocalAI/vLLM proxies) can stall embed() — and the whole recall path that
// awaits it — for up to ~30 minutes per call. Bound it to fail fast and degrade
// (a thrown timeout propagates like any network error) instead of wedging the agent.
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const MAX_TIMEOUT_MS = 10 * 60_000; // The SDK's own default ceiling; refuse anything larger.

export interface OpenAIEmbedderOptions {
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly model?: OpenAIEmbeddingModel;
  /** Override dim — useful for `text-embedding-3-*` which support `dimensions` truncation. */
  readonly dimensions?: number;
  /** Batch size for embed() calls. Larger = fewer round trips, slightly higher latency per call. */
  readonly batchSize?: number;
  /**
   * Per-request timeout in ms (default 30_000). Bounds how long a slow/hostile
   * `baseURL` can stall the recall path. Set explicitly to widen for a known-slow
   * local model; capped at 10 minutes.
   */
  readonly timeoutMs?: number;
  /** Max SDK retries per request (default 2). Lower it to tighten total wall-clock. */
  readonly maxRetries?: number;
  /** Inject a pre-built OpenAI client (tests use this with a mock). */
  readonly client?: OpenAI;
}

export class OpenAIEmbedder implements EmbeddingProvider {
  readonly model: OpenAIEmbeddingModel;
  private readonly client: OpenAI;
  private readonly batchSize: number;
  private readonly explicitDim: number | undefined;

  constructor(opts: OpenAIEmbedderOptions = {}) {
    this.model = opts.model ?? 'text-embedding-3-small';
    this.explicitDim = opts.dimensions;
    // `dimensions` comes from untrusted user config. A non-positive/fractional/garbage
    // value would build the persistent index with a bogus dimensionality and only 400
    // at embed() time — after the index is already corrupted. Reject it at construct
    // time so selectEmbedder's try/catch falls back to TF-IDF instead.
    if (
      this.explicitDim !== undefined &&
      (!Number.isInteger(this.explicitDim) || this.explicitDim < 1)
    ) {
      throw new Error(
        `@moxxy/plugin-embeddings-openai: 'dimensions' (${String(this.explicitDim)}) ` +
          'must be a positive integer.',
      );
    }
    // `dimensions` truncation is only supported by the text-embedding-3-* family.
    // ada-002 rejects the parameter (the API 400s), and forwarding it would also
    // make `dim`/`name` report a size the API will never produce. Drop it + warn
    // so dim/embed stay consistent with what ada-002 actually returns (1536).
    if (this.model === 'text-embedding-ada-002' && this.explicitDim !== undefined) {
      console.warn(
        `@moxxy/plugin-embeddings-openai: 'dimensions' (${this.explicitDim}) is not ` +
          "supported by 'text-embedding-ada-002'; ignoring it (dim stays 1536).",
      );
      this.explicitDim = undefined;
    }
    // Reject an unknown model unless the caller supplies an explicit dim. Otherwise
    // `dim` would be undefined and the memory index would be built with no
    // dimensionality check — silently corruptible. selectEmbedder catches this
    // and falls back to TF-IDF with a warning.
    if (this.explicitDim === undefined && MODEL_DIM[this.model] === undefined) {
      throw new Error(
        `@moxxy/plugin-embeddings-openai: unknown embedding model '${this.model}'; ` +
          'set embeddings.dimensions or use a known model ' +
          `(${Object.keys(MODEL_DIM).join(', ')}).`,
      );
    }
    // `batchSize` comes from untrusted user config. A value <= 0 makes embed()'s
    // chunking loop (`i += this.batchSize`) never advance — an infinite loop that
    // re-POSTs forever and wedges the recall path. Validate + bound to OpenAI's
    // 2048-input array limit *before* building the client, so a bad config fails
    // fast (and routes through selectEmbedder's construct-time fallback to TF-IDF)
    // regardless of whether an API key is present.
    const bs = opts.batchSize ?? DEFAULT_BATCH_SIZE;
    if (!Number.isInteger(bs) || bs < 1 || bs > 2048) {
      throw new Error(
        `@moxxy/plugin-embeddings-openai: 'batchSize' (${String(bs)}) must be an ` +
          'integer between 1 and 2048.',
      );
    }
    this.batchSize = bs;
    // `timeoutMs`/`maxRetries` come from untrusted user config; validate so a bad
    // value can't silently disable the bound (e.g. NaN/0 → SDK default 10min) or
    // make embed() loop on retries forever. Both fail fast → TF-IDF fallback.
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
      throw new Error(
        `@moxxy/plugin-embeddings-openai: 'timeoutMs' (${String(timeoutMs)}) must be an ` +
          `integer between 1 and ${MAX_TIMEOUT_MS}.`,
      );
    }
    const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 10) {
      throw new Error(
        `@moxxy/plugin-embeddings-openai: 'maxRetries' (${String(maxRetries)}) must be an ` +
          'integer between 0 and 10.',
      );
    }
    this.client =
      opts.client ??
      new OpenAI({
        apiKey: opts.apiKey ?? process.env.OPENAI_API_KEY,
        timeout: timeoutMs,
        maxRetries,
        ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
      });
  }

  /**
   * Identity includes the model (and any `dimensions` override) so caches keyed
   * by name invalidate on a model/dim switch. A bare 'openai' would let a
   * 1536-dim cache serve a 3072-dim model's lookups.
   */
  get name(): string {
    return this.explicitDim !== undefined
      ? `openai:${this.model}:${this.explicitDim}`
      : `openai:${this.model}`;
  }

  get dim(): number {
    return this.explicitDim ?? MODEL_DIM[this.model];
  }

  async embed(texts: ReadonlyArray<string>): Promise<ReadonlyArray<ReadonlyArray<number>>> {
    if (texts.length === 0) return [];
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const chunk = texts.slice(i, i + this.batchSize);
      const response = await this.client.embeddings.create({
        model: this.model,
        input: [...chunk],
        ...(this.explicitDim !== undefined ? { dimensions: this.explicitDim } : {}),
      });
      // `baseURL` can point at any OpenAI-compatible proxy (Ollama/LocalAI/vLLM),
      // so the response shape is untrusted. Guard the array, reorder by the
      // per-item `index` (array order is not a hard guarantee), and assert the
      // count — a length/ordering mismatch would silently map the wrong vector to
      // each memory entry or leave `out` short (→ undefined vectors / NaN cosine
      // downstream). Convert all of that into one loud, catchable error.
      const data = response.data;
      if (!Array.isArray(data)) {
        throw new Error(
          `@moxxy/plugin-embeddings-openai: malformed embeddings response (data is ` +
            `not an array) from '${this.model}'.`,
        );
      }
      if (data.length !== chunk.length) {
        throw new Error(
          `@moxxy/plugin-embeddings-openai: '${this.model}' returned ${data.length} ` +
            `embeddings for ${chunk.length} inputs.`,
        );
      }
      const vecs = new Array<ReadonlyArray<number>>(chunk.length);
      for (const item of data) {
        if (item === null || typeof item !== 'object') {
          throw new Error(
            `@moxxy/plugin-embeddings-openai: '${this.model}' returned a malformed ` +
              `embedding item.`,
          );
        }
        const idx = item.index;
        if (!Number.isInteger(idx) || idx < 0 || idx >= chunk.length) {
          throw new Error(
            `@moxxy/plugin-embeddings-openai: '${this.model}' returned an embedding ` +
              `with an out-of-range index (${String(idx)}).`,
          );
        }
        if (!Array.isArray(item.embedding)) {
          throw new Error(
            `@moxxy/plugin-embeddings-openai: '${this.model}' returned a non-vector ` +
              `embedding at index ${idx}.`,
          );
        }
        // A non-conforming proxy can return a vector containing NaN/Infinity/
        // non-number entries. They sail past Array.isArray and downstream
        // cosineSimilarity turns them into NaN scores: a NaN *query* vector
        // silently empties ALL recall results (invisible corruption). Reject up
        // front. Empty is also invalid — it would dim-mismatch every entry.
        const vec = item.embedding as unknown[];
        if (vec.length === 0) {
          throw new Error(
            `@moxxy/plugin-embeddings-openai: '${this.model}' returned an empty ` +
              `embedding at index ${idx}.`,
          );
        }
        for (const n of vec) {
          if (typeof n !== 'number' || !Number.isFinite(n)) {
            throw new Error(
              `@moxxy/plugin-embeddings-openai: '${this.model}' returned a non-finite ` +
                `embedding value (${String(n)}) at index ${idx}.`,
            );
          }
        }
        if (vecs[idx] !== undefined) {
          throw new Error(
            `@moxxy/plugin-embeddings-openai: '${this.model}' returned a duplicate ` +
              `embedding index (${idx}).`,
          );
        }
        vecs[idx] = item.embedding;
      }
      for (const v of vecs) out.push(v as number[]);
    }
    return out;
  }
}

export function createOpenAIEmbedder(opts: OpenAIEmbedderOptions = {}): OpenAIEmbedder {
  return new OpenAIEmbedder(opts);
}
