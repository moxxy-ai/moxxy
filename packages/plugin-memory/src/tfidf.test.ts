import { describe, expect, it } from 'vitest';
import { assertDefined } from '@moxxy/sdk';
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
    const v0 = vectors[0];
    const v1 = vectors[1];
    assertDefined(v0, 'embed returns a vector per corpus entry');
    assertDefined(v1, 'embed returns a vector per corpus entry');
    expect(v0.length).toBeGreaterThan(0);
    expect(v0.length).toBe(v1.length);
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
    const queryVec = v[v.length - 1];
    assertDefined(queryVec, 'embed returns the query vector last');
    const scores = corpus.map((_, i) => {
      const vi = v[i];
      assertDefined(vi, 'embed returns a vector per corpus entry');
      return cosineSimilarity(vi, queryVec);
    });
    // tRPC entry should be most similar to "API style" query
    const s1 = scores[1];
    const s2 = scores[2];
    assertDefined(s1, 'scores has an entry per corpus entry');
    assertDefined(s2, 'scores has an entry per corpus entry');
    expect(scores[0]).toBeGreaterThan(s1);
    expect(scores[0]).toBeGreaterThan(s2);
  });

  it('cosineSimilarity returns 1 for identical normalized vectors', () => {
    expect(cosineSimilarity([0.6, 0.8], [0.6, 0.8])).toBeCloseTo(1, 5);
  });

  it('cosineSimilarity returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });
});
