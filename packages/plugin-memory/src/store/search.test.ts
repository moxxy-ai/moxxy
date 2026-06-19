import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { EmbeddingProvider, Mutex } from '@moxxy/sdk';
import { createMutex } from '@moxxy/sdk';
import { rankByKeywords, recallVector } from './search.js';
import { EmbeddingIndex } from '../embedding-cache.js';
import type { MemoryEntry, MemoryType } from './types.js';

function entry(
  name: string,
  description: string,
  body: string,
  opts: { type?: MemoryType; tags?: string[] } = {},
): MemoryEntry {
  return {
    frontmatter: {
      name,
      type: opts.type ?? 'fact',
      description,
      ...(opts.tags ? { tags: opts.tags } : {}),
    },
    body,
    path: `/tmp/${name}.md`,
  };
}

describe('rankByKeywords', () => {
  it('counts repeated occurrences in the body (no array-split regression)', () => {
    // "deploy" appears 3x in the body; the non-allocating indexOf count must
    // match the old `split(t).length - 1` behavior exactly.
    const e = entry('ci', 'continuous integration', 'deploy then deploy and deploy again');
    const ranked = rankByKeywords([e], 'deploy', 5);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.score).toBe(3);
  });

  it('weights name and description hits above body-only hits', () => {
    const named = entry('deploy-runbook', 'how to ship', 'steps here');
    const described = entry('runbook', 'deploy guide', 'steps here');
    const bodyOnly = entry('notes', 'misc', 'we deploy on fridays');
    const ranked = rankByKeywords([bodyOnly, described, named], 'deploy', 5);
    // name match (+3) > description match (+2) > body-only (+1)
    expect(ranked.map((r) => r.entry.frontmatter.name)).toEqual([
      'deploy-runbook',
      'runbook',
      'notes',
    ]);
  });

  it('sums scores across multiple query tokens and ranks by total', () => {
    const both = entry('a', 'alpha beta', 'alpha beta gamma');
    const one = entry('b', 'just alpha', 'nothing else');
    const ranked = rankByKeywords([one, both], 'alpha beta', 5);
    expect(ranked[0]!.entry.frontmatter.name).toBe('a');
  });

  it('drops zero-score entries and respects the limit', () => {
    const hit = entry('x', 'has the word widget', 'widget widget');
    const miss = entry('y', 'unrelated', 'nothing relevant');
    const ranked = rankByKeywords([hit, miss], 'widget', 1);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.entry.frontmatter.name).toBe('x');
  });

  it('an empty query matches every entry with score 1', () => {
    const ranked = rankByKeywords([entry('a', 'd', 'b'), entry('c', 'e', 'f')], '   ', 5);
    expect(ranked).toHaveLength(2);
    expect(ranked.every((r) => r.score === 1)).toBe(true);
  });

  it('searches tags too', () => {
    const e = entry('a', 'desc', 'body', { tags: ['kubernetes', 'infra'] });
    const ranked = rankByKeywords([e], 'kubernetes', 5);
    expect(ranked).toHaveLength(1);
  });
});

describe('recallVector dimension-drift hardening', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-search-'));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('skips a cached entry whose vector dim no longer matches the query (no silently-wrong score)', async () => {
    const mutex: Mutex = createMutex();
    // Pre-seed the persistent cache with a dim-3 vector for `stale`.
    const seed = new EmbeddingIndex(tmp, 'drift');
    const stale = entry('stale', 'stale desc', 'stale body');
    const corpusText = ['stale', 'stale desc', '', 'stale body'].join('\n');
    seed.set('stale', corpusText, [1, 0, 0]);
    await seed.flush();

    // An embedder that now returns dim-2 vectors (model/dim drift). The cached
    // `stale` entry is dim-3; the fresh query is dim-2.
    const driftEmbedder: EmbeddingProvider = {
      name: 'drift',
      dim: 2,
      async embed(texts) {
        return texts.map(() => [1, 0]);
      },
    };
    const index = new EmbeddingIndex(tmp, 'drift'); // no dim → cache not invalidated on dim
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const ranked = await recallVector([stale], 'q', 5, driftEmbedder, index, mutex);
      // The mismatched-dim entry is dropped, not ranked on a truncated basis.
      expect(ranked).toHaveLength(0);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
