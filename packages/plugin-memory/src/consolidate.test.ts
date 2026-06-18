import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { LLMProvider, ProviderEvent } from '@moxxy/sdk';
import { MemoryStore } from './store.js';
import { consolidateMemory, planConsolidation } from './consolidate.js';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-cons-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const fakeProvider = (jsonReply: string): LLMProvider => ({
  name: 'fake',
  models: [{ id: 'fake', contextWindow: 1000, maxOutputTokens: 1000, supportsTools: false, supportsStreaming: true }],
  async *stream(): AsyncIterable<ProviderEvent> {
    yield { type: 'message_start', model: 'fake' };
    yield { type: 'text_delta', delta: jsonReply };
    yield { type: 'message_end', stopReason: 'end_turn' };
  },
  async countTokens() {
    return 0;
  },
});

describe('planConsolidation', () => {
  it('groups entries by shared first tag', () => {
    const entries = [
      mkEntry('a', { tags: ['api'] }),
      mkEntry('b', { tags: ['api'] }),
      mkEntry('c', { tags: ['db'] }),
    ];
    const plan = planConsolidation(entries);
    const apiCluster = plan.clusters.find((c) => c.key === 'tag:api');
    expect(apiCluster?.members.sort()).toEqual(['a', 'b']);
    expect(plan.stable).toContain('c');
  });

  it('handles tagless entries via description token overlap', () => {
    const entries = [
      mkEntry('a', { description: 'team prefers tRPC over REST endpoints' }),
      mkEntry('b', { description: 'tRPC endpoints style for the team' }),
      mkEntry('c', { description: 'production uses Postgres 16' }),
    ];
    const plan = planConsolidation(entries);
    // a and b should cluster on shared tokens
    const overlapCluster = plan.clusters.find((c) => c.members.includes('a') && c.members.includes('b'));
    expect(overlapCluster).toBeDefined();
    expect(plan.stable).toContain('c');
  });

  it('singletons go to `stable`', () => {
    const entries = [mkEntry('lonely', { tags: ['solo'] })];
    const plan = planConsolidation(entries);
    expect(plan.clusters).toEqual([]);
    expect(plan.stable).toEqual(['lonely']);
  });

  it('filters by tag when opts.tag is set', () => {
    const entries = [
      mkEntry('a', { tags: ['api'] }),
      mkEntry('b', { tags: ['api'] }),
      mkEntry('c', { tags: ['db'] }),
      mkEntry('d', { tags: ['db'] }),
    ];
    const plan = planConsolidation(entries, { tag: 'api' });
    expect(plan.clusters).toHaveLength(1);
    expect(plan.clusters[0]!.members.sort()).toEqual(['a', 'b']);
  });
});

describe('consolidateMemory', () => {
  it('dryRun: true reports the plan without modifying anything', async () => {
    const store = new MemoryStore({ dir: tmp, embedder: null });
    await store.save({ name: 'a', type: 'fact', description: 'A', body: 'aaa', tags: ['api'] });
    await store.save({ name: 'b', type: 'fact', description: 'B', body: 'bbb', tags: ['api'] });

    const before = await store.list();
    const outcome = await consolidateMemory(store, fakeProvider(''), { dryRun: true });
    expect(outcome.clusters[0]?.dryRun).toBe(true);
    expect(outcome.clusters[0]?.into).toBeNull();
    const after = await store.list();
    expect(after.length).toBe(before.length);
  });

  it('without dryRun: writes the consolidated entry and deletes the merged ones', async () => {
    const store = new MemoryStore({ dir: tmp, embedder: null });
    await store.save({ name: 'a', type: 'fact', description: 'A', body: 'aaa', tags: ['api'] });
    await store.save({ name: 'b', type: 'fact', description: 'B', body: 'bbb', tags: ['api'] });

    const jsonReply = JSON.stringify({
      name: 'a-and-b-merged',
      type: 'fact',
      description: 'Merged: A and B.',
      body: 'aaa\nbbb',
      tags: ['api'],
    });
    const outcome = await consolidateMemory(store, fakeProvider(jsonReply));
    expect(outcome.clusters[0]?.into).toBe('a-and-b-merged');

    const remaining = await store.list();
    const names = remaining.map((m) => m.frontmatter.name).sort();
    expect(names).toEqual(['a-and-b-merged']);
  });

  it('handles model output wrapped in ```json fences', async () => {
    const store = new MemoryStore({ dir: tmp, embedder: null });
    await store.save({ name: 'a', type: 'fact', description: 'A', body: 'a', tags: ['t'] });
    await store.save({ name: 'b', type: 'fact', description: 'B', body: 'b', tags: ['t'] });

    const fenced =
      '```json\n' +
      JSON.stringify({
        name: 'merged',
        type: 'fact',
        description: 'desc',
        body: 'body',
      }) +
      '\n```';
    const outcome = await consolidateMemory(store, fakeProvider(fenced));
    expect(outcome.clusters[0]?.into).toBe('merged');
  });

  it('skips when there are not enough entries to cluster', async () => {
    const store = new MemoryStore({ dir: tmp, embedder: null });
    await store.save({ name: 'lonely', type: 'fact', description: 'L', body: 'l' });
    const outcome = await consolidateMemory(store, fakeProvider(''));
    expect(outcome.clusters).toEqual([]);
    expect(outcome.stable).toContain('lonely');
  });

  it('reports a clear error when a stray } precedes the first { (inverted braces)', async () => {
    const store = new MemoryStore({ dir: tmp, embedder: null });
    await store.save({ name: 'a', type: 'fact', description: 'A', body: 'a', tags: ['t'] });
    await store.save({ name: 'b', type: 'fact', description: 'B', body: 'b', tags: ['t'] });

    // '}' at index < the first '{' → no well-formed object span. Must yield the
    // intended "no JSON object" message, not an opaque JSON.parse failure.
    await expect(consolidateMemory(store, fakeProvider('done } then {'))).rejects.toThrow(
      /no JSON object/,
    );
  });

  it('rejects model output that fails schema validation', async () => {
    const store = new MemoryStore({ dir: tmp, embedder: null });
    await store.save({ name: 'a', type: 'fact', description: 'A', body: 'a', tags: ['t'] });
    await store.save({ name: 'b', type: 'fact', description: 'B', body: 'b', tags: ['t'] });

    const invalid = JSON.stringify({ name: 'Bad Name', type: 'fact', description: 'd', body: 'b' });
    await expect(consolidateMemory(store, fakeProvider(invalid))).rejects.toThrow();
  });

  it('refuses to clobber an entry merged earlier in the SAME run with a colliding name', async () => {
    // Two independent tag-clusters (api, db). The fake LLM names BOTH merges
    // 'foo'. The first cluster legitimately produces 'foo'. The second cluster
    // must NOT overwrite it — 'foo' is not in the second cluster's members, so
    // writing it would destroy the first merge's body (within-run data loss).
    const store = new MemoryStore({ dir: tmp, embedder: null });
    await store.save({ name: 'a', type: 'fact', description: 'A', body: 'a', tags: ['api'] });
    await store.save({ name: 'b', type: 'fact', description: 'B', body: 'b', tags: ['api'] });
    await store.save({ name: 'c', type: 'fact', description: 'C', body: 'c', tags: ['db'] });
    await store.save({ name: 'd', type: 'fact', description: 'D', body: 'd', tags: ['db'] });

    const fooReply = JSON.stringify({
      name: 'foo',
      type: 'fact',
      description: 'first merge',
      body: 'FIRST-MERGE-BODY',
    });
    const outcome = await consolidateMemory(store, fakeProvider(fooReply));

    // Exactly one cluster merged into 'foo'; the other was refused.
    const intos = outcome.clusters.map((c) => c.into);
    expect(intos.filter((x) => x === 'foo')).toHaveLength(1);
    expect(intos.filter((x) => x === null)).toHaveLength(1);

    // The first merge's body survives — it was not clobbered by the second.
    const remaining = await store.list();
    const foo = remaining.find((e) => e.frontmatter.name === 'foo');
    expect(foo?.body).toBe('FIRST-MERGE-BODY');
  });

  it('refuses to overwrite an unrelated memory when the LLM picks a colliding name', async () => {
    // Setup: a + b cluster on tag 'api'; an unrelated entry 'c' exists.
    // If the LLM's consolidated name happens to be 'c', writing it would
    // silently destroy the real 'c'. We expect the merge to be skipped.
    const store = new MemoryStore({ dir: tmp, embedder: null });
    await store.save({ name: 'a', type: 'fact', description: 'A', body: 'a', tags: ['api'] });
    await store.save({ name: 'b', type: 'fact', description: 'B', body: 'b', tags: ['api'] });
    await store.save({ name: 'c', type: 'fact', description: 'C-real', body: 'C-original' });

    const collidingReply = JSON.stringify({
      name: 'c',
      type: 'fact',
      description: 'merged a+b',
      body: 'should not land',
    });
    const outcome = await consolidateMemory(store, fakeProvider(collidingReply));

    // The cluster was found but the merge was refused.
    expect(outcome.clusters[0]?.merged).toEqual(['a', 'b']);
    expect(outcome.clusters[0]?.into).toBeNull();

    // All three originals survive; the real 'c' was not overwritten.
    const remaining = await store.list();
    expect(remaining.map((e) => e.frontmatter.name).sort()).toEqual(['a', 'b', 'c']);
    const realC = remaining.find((e) => e.frontmatter.name === 'c');
    expect(realC?.body).toBe('C-original');
    expect(realC?.frontmatter.description).toBe('C-real');
  });
});

function mkEntry(
  name: string,
  overrides: { tags?: string[]; description?: string } = {},
): import('./store.js').MemoryEntry {
  return {
    frontmatter: {
      name,
      type: 'fact',
      description: overrides.description ?? `entry ${name}`,
      tags: overrides.tags,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    body: `body ${name}`,
    path: `/${name}.md`,
  };
}
