/**
 * Provider of dense vector embeddings for text. Used by @moxxy/plugin-memory
 * for semantic recall. Implementations might call OpenAI, Voyage, Anthropic
 * (when available), or run a local model via transformers.js.
 *
 * @moxxy/plugin-memory ships a built-in TF-IDF embedder for zero-dep operation
 * — set `mode: 'auto'` (default) and it picks the registered provider when
 * available, else TF-IDF.
 */
export interface EmbeddingProvider {
  /** Short stable name, e.g. 'openai-text-embedding-3-small'. */
  readonly name: string;

  /**
   * Vector dimensionality. Consumers may verify this matches their stored
   * index. For TF-IDF this is the vocab size (dynamic).
   */
  readonly dim: number | 'dynamic';

  /** Embed a batch of strings. Returns vectors in input order. */
  embed(texts: ReadonlyArray<string>): Promise<ReadonlyArray<ReadonlyArray<number>>>;
}
