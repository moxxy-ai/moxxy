import type { EmbeddingProvider } from '@moxxy/sdk';

/**
 * Built-in zero-dependency TF-IDF embedder. Computes a sparse-but-stored-dense
 * vector per text. Builds vocabulary lazily from the corpus you provide via
 * `fit()`. Once fit, `embed()` produces vectors over that fixed vocabulary.
 *
 * Quality is meh by neural-embedding standards but: deterministic, runs in
 * <1ms for hundreds of entries, no network, no model download, no API key.
 * Real semantic embeddings can be wired by passing a different EmbeddingProvider
 * to MemoryStore.
 */
export class TfIdfEmbedder implements EmbeddingProvider {
  readonly name = 'tfidf';
  private vocab: ReadonlyArray<string> = [];
  private vocabIndex = new Map<string, number>();
  private idf: ReadonlyArray<number> = [];

  get dim(): number | 'dynamic' {
    return this.vocab.length || 'dynamic';
  }

  /**
   * Compute vocabulary + IDF weights from the corpus. Call this whenever the
   * source corpus changes; embed() must be called only after fit().
   */
  fit(corpus: ReadonlyArray<string>): void {
    const docs = corpus.map(tokenize);
    const df = new Map<string, number>();
    for (const doc of docs) {
      const seen = new Set<string>();
      for (const t of doc) {
        if (seen.has(t)) continue;
        seen.add(t);
        df.set(t, (df.get(t) ?? 0) + 1);
      }
    }
    // Filter: keep tokens appearing at least once and at most in 95% of docs.
    const N = Math.max(1, docs.length);
    const maxDf = Math.max(1, Math.ceil(N * 0.95));
    const kept: Array<[string, number]> = [];
    for (const [token, count] of df) {
      if (count <= maxDf) kept.push([token, count]);
    }
    kept.sort((a, b) => a[0].localeCompare(b[0]));
    this.vocab = kept.map((x) => x[0]);
    this.vocabIndex = new Map(this.vocab.map((t, i) => [t, i]));
    this.idf = kept.map(([, dfi]) => Math.log((N + 1) / (dfi + 1)) + 1);
  }

  embedSync(text: string): number[] {
    if (this.vocab.length === 0) return [];
    const tokens = tokenize(text);
    const tf = new Map<number, number>();
    for (const t of tokens) {
      const idx = this.vocabIndex.get(t);
      if (idx === undefined) continue;
      tf.set(idx, (tf.get(idx) ?? 0) + 1);
    }
    const vec = new Array<number>(this.vocab.length).fill(0);
    const docLen = tokens.length || 1;
    for (const [idx, count] of tf) {
      vec[idx] = (count / docLen) * (this.idf[idx] ?? 1);
    }
    return l2Normalize(vec);
  }

  async embed(texts: ReadonlyArray<string>): Promise<ReadonlyArray<ReadonlyArray<number>>> {
    return texts.map((t) => this.embedSync(t));
  }
}

export function cosineSimilarity(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot;
}

export function l2Normalize(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  if (sum === 0) return v;
  const norm = Math.sqrt(sum);
  return v.map((x) => x / norm);
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9_-]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'should', 'could', 'may', 'might', 'must', 'shall', 'to', 'of', 'in', 'for',
  'on', 'at', 'by', 'with', 'from', 'as', 'into', 'through', 'about', 'between',
  'this', 'that', 'these', 'those', 'it', 'its', 'they', 'them', 'their', 'we',
  'us', 'our', 'you', 'your', 'he', 'she', 'his', 'her', 'i', 'me', 'my',
  'so', 'than', 'too', 'very', 'just', 'not', 'no', 'yes', 'if', 'then',
]);
