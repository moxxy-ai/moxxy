import { describe, expect, it } from 'vitest';
import { TfIdfEmbedder, cosineSimilarity, tokenize } from './tfidf.js';

describe('tokenize', () => {
  it('lowercases, splits on non-alphanumerics, drops short tokens + stopwords', () => {
    expect(tokenize('The QUICK brown fox')).toEqual(['quick', 'brown', 'fox']);
    expect(tokenize('foo-bar baz_qux 123abc')).toEqual(['foo-bar', 'baz_qux', '123abc']);
  });

  it('strips diacritics for stable matching', () => {
    expect(tokenize('café naïve')).toEqual(['cafe', 'naive']);
  });
});

describe('TfIdfEmbedder', () => {
  it('embed() before fit() returns empty vectors', async () => {
    const e = new TfIdfEmbedder();
    const [v] = await e.embed(['hello world']);
    expect(v).toEqual([]);
  });

  it('produces vectors over a fitted vocab', async () => {
    const corpus = [
      'team prefers tRPC over REST',
      'production runs Postgres 16',
      'sentry alerts go to slack',
    ];
    const e = new TfIdfEmbedder();
    e.fit(corpus);
    const vectors = await e.embed(corpus);
    expect(vectors).toHaveLength(3);
    expect(vectors[0]!.length).toBeGreaterThan(0);
    expect(vectors[0]!.length).toBe(vectors[1]!.length);
  });

  it('ranks a relevant query higher than an irrelevant one', async () => {
    const corpus = [
      'team prefers tRPC over REST for endpoints',
      'production database is Postgres 16',
      'feature flags live in GrowthBook',
    ];
    const e = new TfIdfEmbedder();
    e.fit([...corpus, 'what API style does the team use', 'database flavor in prod']);
    const v = await e.embed([...corpus, 'what API style does the team use']);
    const queryVec = v[v.length - 1]!;
    const scores = corpus.map((_, i) => cosineSimilarity(v[i]!, queryVec));
    // tRPC entry should be most similar to "API style" query
    expect(scores[0]).toBeGreaterThan(scores[1]!);
    expect(scores[0]).toBeGreaterThan(scores[2]!);
  });

  it('cosineSimilarity returns 1 for identical normalized vectors', () => {
    expect(cosineSimilarity([0.6, 0.8], [0.6, 0.8])).toBeCloseTo(1, 5);
  });

  it('cosineSimilarity returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });
});
