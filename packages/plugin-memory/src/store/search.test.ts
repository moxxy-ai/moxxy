import { describe, expect, it } from 'vitest';
import { rankByKeywords } from './search.js';
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
