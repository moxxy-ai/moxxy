import type { EmbeddingProvider, Mutex } from '@moxxy/sdk';
import { TfIdfEmbedder, cosineSimilarity, tokenize } from '../tfidf.js';
import type { EmbeddingIndex } from '../embedding-cache.js';
import type { MemoryEntry } from './types.js';

export interface RankedMemory {
  readonly entry: MemoryEntry;
  readonly score: number;
}

export async function recallVector(
  all: ReadonlyArray<MemoryEntry>,
  query: string,
  limit: number,
  embedder: EmbeddingProvider,
  index: EmbeddingIndex | null,
  mutex: Mutex,
): Promise<ReadonlyArray<RankedMemory>> {
  const corpus = all.map((e) => entryForEmbedding(e));

  // TF-IDF special-cases the persistent cache (vocab is corpus-wide).
  if (embedder instanceof TfIdfEmbedder) {
    embedder.fit([...corpus, query]);
    return rankAllFresh(all, corpus, query, limit, embedder);
  }

  // Neural embedders: consult the persistent cache, only embed misses + query.
  if (index) {
    // The index load->lookup->set->prune->flush cycle mutates the shared
    // on-disk cache, so it must run under the store's write mutex — otherwise
    // two concurrent recalls (or a recall racing forget()'s rebuildIndex)
    // read the same snapshot and clobber each other's writes. Only the cache
    // bookkeeping is serialized; the pure cosine ranking stays outside.
    const { vectors, queryVec } = await mutex.run(async () => {
      await index.load();
      const cached: Array<ReadonlyArray<number> | null> = [];
      const misses: { index: number; text: string }[] = [];
      for (let i = 0; i < all.length; i++) {
        const hit = index.lookup(all[i]!.frontmatter.name, corpus[i]!);
        cached.push(hit);
        if (!hit) misses.push({ index: i, text: corpus[i]! });
      }
      const queryIdx = misses.length;
      const toEmbed = [...misses.map((m) => m.text), query];
      const fresh = await embedder.embed(toEmbed);
      const qVec = fresh[queryIdx];
      // Map each missed corpus index to its freshly-embedded vector so the
      // stitch loop below stays O(1) per entry instead of scanning `misses`.
      // A misbehaving embedder may under-return; only valid vectors get mapped,
      // and missing ones stay absent so rankCosine drops them (never crashes).
      const freshByEntryIndex = new Map<number, ReadonlyArray<number>>();
      for (const [j, m] of misses.entries()) {
        const v = fresh[j];
        if (Array.isArray(v)) freshByEntryIndex.set(m.index, v);
      }
      // Stitch results: cached + freshly-embedded. Holes (undefined) survive to
      // rankCosine, which skips them rather than throwing.
      const vecs: Array<ReadonlyArray<number> | undefined> = [];
      for (let i = 0; i < all.length; i++) {
        vecs.push(cached[i] ?? freshByEntryIndex.get(i));
      }
      // Persist ONLY valid fresh vectors — never write an `undefined`/non-array
      // vector to the on-disk cache, which would poison it permanently (every
      // future recall would read back a corrupt entry).
      for (const [j, m] of misses.entries()) {
        const v = fresh[j];
        if (Array.isArray(v)) index.set(all[m.index]!.frontmatter.name, m.text, v);
      }
      index.prune(all.map((e) => e.frontmatter.name));
      await index.flush();
      return { vectors: vecs, queryVec: qVec };
    });
    return rankCosine(all, vectors, queryVec, limit);
  }

  // No cache configured — embed everything every time.
  return rankAllFresh(all, corpus, query, limit, embedder);
}

// Embed `[...corpus, query]` in one batch, then cosine-rank the corpus against
// the (last) query vector. Shared by the TF-IDF and no-cache branches.
async function rankAllFresh(
  all: ReadonlyArray<MemoryEntry>,
  corpus: ReadonlyArray<string>,
  query: string,
  limit: number,
  embedder: EmbeddingProvider,
): Promise<ReadonlyArray<RankedMemory>> {
  const vectors = await embedder.embed([...corpus, query]);
  // The query is embedded at index `corpus.length`. Address it by that fixed
  // position (not `vectors.length - 1`): if the embedder under-returns and drops
  // the query, `length - 1` would silently grab the last CORPUS vector and use
  // it as the query. `vectors[corpus.length]` is `undefined` in that case, which
  // rankCosine handles by returning an empty result — degrade, never mislead.
  const queryVec = vectors[corpus.length];
  return rankCosine(all, vectors.slice(0, all.length), queryVec, limit);
}

export function rankByKeywords(
  all: ReadonlyArray<MemoryEntry>,
  query: string,
  limit: number,
): ReadonlyArray<RankedMemory> {
  const tokens = tokenize(query);
  return all
    .map((entry) => ({ entry, score: scoreEntry(entry, tokens) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function rankCosine(
  entries: ReadonlyArray<MemoryEntry>,
  vectors: ReadonlyArray<ReadonlyArray<number> | undefined>,
  query: ReadonlyArray<number> | undefined,
  limit: number,
): ReadonlyArray<RankedMemory> {
  // A misbehaving/hostile embedder can return fewer vectors than requested (or
  // a non-array element) — the EmbeddingProvider.embed contract promises order
  // but not count. Without this guard `query.length`/`vec.length` throws an
  // opaque TypeError and recall crashes instead of degrading. A bad embedder
  // must yield an empty/partial result set, never crash memory_recall.
  if (!Array.isArray(query) || query.length === 0) {
    console.warn(
      '[plugin-memory] embedder returned no usable query vector; skipping vector recall',
    );
    return [];
  }
  const ranked: RankedMemory[] = [];
  for (let i = 0; i < entries.length; i++) {
    const vec = vectors[i];
    // cosineSimilarity silently truncates to the shorter vector, so a stale
    // cached vector or a provider quirk of the wrong dimensionality would
    // produce a plausible-but-wrong score (invisible corruption). A missing
    // vector (embedder under-returned) is the same hazard. Skip the entry
    // loudly instead of ranking it on a mismatched or absent basis.
    if (!Array.isArray(vec) || vec.length !== query.length) {
      console.warn(
        `[plugin-memory] skipping '${entries[i]!.frontmatter.name}' in recall: ` +
          `vector dim ${Array.isArray(vec) ? vec.length : 'missing'} != query dim ${query.length} (cache/embedder drift)`,
      );
      continue;
    }
    const score = cosineSimilarity(vec, query);
    if (score > 0) ranked.push({ entry: entries[i]!, score });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, limit);
}

// Count non-overlapping occurrences of `needle` in `haystack` without
// allocating the intermediate array `haystack.split(needle)` would build.
// Identical result to `split(needle).length - 1` for the non-empty tokens
// `tokenize` yields. Tokens are `[a-z0-9_-]+`, so there are no overlap or
// empty-needle edge cases to worry about.
function countOccurrences(haystack: string, needle: string): number {
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    n += 1;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return n;
}

function entryForEmbedding(entry: MemoryEntry): string {
  return [
    entry.frontmatter.name,
    entry.frontmatter.description,
    (entry.frontmatter.tags ?? []).join(' '),
    entry.body,
  ].join('\n');
}

function scoreEntry(entry: MemoryEntry, tokens: ReadonlyArray<string>): number {
  if (tokens.length === 0) return 1;
  const haystack = (
    entry.frontmatter.name +
    ' ' +
    entry.frontmatter.description +
    ' ' +
    (entry.frontmatter.tags ?? []).join(' ') +
    ' ' +
    entry.body
  ).toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (!t) continue;
    const matches = countOccurrences(haystack, t);
    if (matches > 0) {
      score += matches;
      if (entry.frontmatter.name.toLowerCase().includes(t)) score += 3;
      if (entry.frontmatter.description.toLowerCase().includes(t)) score += 2;
    }
  }
  return score;
}
