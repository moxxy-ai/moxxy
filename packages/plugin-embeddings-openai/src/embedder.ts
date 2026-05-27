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

export interface OpenAIEmbedderOptions {
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly model?: OpenAIEmbeddingModel;
  /** Override dim — useful for `text-embedding-3-*` which support `dimensions` truncation. */
  readonly dimensions?: number;
  /** Batch size for embed() calls. Larger = fewer round trips, slightly higher latency per call. */
  readonly batchSize?: number;
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
    this.client =
      opts.client ??
      new OpenAI({
        apiKey: opts.apiKey ?? process.env.OPENAI_API_KEY,
        ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
      });
    this.batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
    this.explicitDim = opts.dimensions;
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
      // Response data is ordered to match the input array (per OpenAI spec).
      for (const item of response.data) out.push(item.embedding);
    }
    return out;
  }
}

export function createOpenAIEmbedder(opts: OpenAIEmbedderOptions = {}): OpenAIEmbedder {
  return new OpenAIEmbedder(opts);
}
