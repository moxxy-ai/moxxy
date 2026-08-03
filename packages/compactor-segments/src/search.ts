/**
 * Ranking for `session_recall`. Zero-dependency idf-weighted overlap over the
 * session's own summaries, deliberately NOT the embeddings path: recall over a
 * few dozen short summaries must be instant, offline, and free, and it runs
 * inside a turn the user is waiting on.
 */

export interface SessionDoc {
  readonly kind: 'segment' | 'chapter';
  readonly ordinal: number;
  readonly turnIds: ReadonlyArray<string>;
  readonly from: number;
  readonly to: number;
  readonly summary: string;
  /** Summary plus the raw prompts it covers, which is what gets matched against. */
  readonly searchText: string;
}

export interface RankedDoc {
  readonly doc: SessionDoc;
  readonly score: number;
}

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []) as string[];
}

export function rank(docs: ReadonlyArray<SessionDoc>, query: string, limit: number): RankedDoc[] {
  const terms = new Set(tokenize(query));
  if (terms.size === 0 || docs.length === 0) return [];

  const tokenized = docs.map((doc) => {
    const counts = new Map<string, number>();
    for (const t of tokenize(doc.searchText)) counts.set(t, (counts.get(t) ?? 0) + 1);
    return { doc, counts, length: Math.max(1, counts.size) };
  });

  const df = new Map<string, number>();
  for (const term of terms) {
    let n = 0;
    for (const entry of tokenized) if (entry.counts.has(term)) n += 1;
    df.set(term, n);
  }

  const scored: RankedDoc[] = [];
  for (const entry of tokenized) {
    let score = 0;
    for (const term of terms) {
      const tf = entry.counts.get(term);
      if (!tf) continue;
      const idf = Math.log(1 + docs.length / (1 + (df.get(term) ?? 0)));
      score += idf * (1 + Math.log(tf));
    }
    if (score <= 0) continue;
    // Length-normalize so a long chapter doesn't outrank the one segment that
    // actually answers the question just by containing more words.
    scored.push({ doc: entry.doc, score: score / Math.sqrt(entry.length) });
  }
  // Ties break toward the more recent sub-session, because later work usually
  // supersedes earlier work on the same subject.
  scored.sort((a, b) => b.score - a.score || b.doc.ordinal - a.doc.ordinal);
  return scored.slice(0, limit);
}
