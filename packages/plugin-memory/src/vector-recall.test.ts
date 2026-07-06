import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { EmbeddingProvider } from '@moxxy/sdk';
import { assertDefined } from '@moxxy/sdk';
import { MemoryStore } from './store.js';

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-vec-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const sampleCorpus = async (store: MemoryStore): Promise<void> => {
  await store.save({
    name: 'trpc-preference',
    type: 'preference',
    description: 'Team prefers tRPC API over REST API.',
    body: 'When generating new API endpoints scaffold a tRPC procedure rather than a REST controller. tRPC API style is the standard.',
  });
  await store.save({
    name: 'postgres-prod',
    type: 'project',
    description: 'Production database is Postgres 16.',
    body: 'All migrations target Postgres 16. Run pg_dump for backups every night.',
  });
  await store.save({
    name: 'growthbook-flags',
    type: 'reference',
    description: 'Feature flags live in GrowthBook.',
    body: 'GrowthBook owns flag definitions. The SDK is initialized in app/bootstrap.ts.',
  });
};

describe('MemoryStore vector recall (TF-IDF default)', () => {
  it('uses vector mode by default when an embedder is configured', async () => {
    const store = new MemoryStore({ dir: tmp });
    expect(store.embedderName).toBe('tfidf');
    await sampleCorpus(store);
    const matches = await store.recall('what API style does the team prefer');
    const top = matches[0];
    assertDefined(top, 'recall returns a match');
    expect(top.entry.frontmatter.name).toBe('trpc-preference');
  });

  it('vector recall ranks semantically relevant entries above incidental keyword matches', async () => {
    const store = new MemoryStore({ dir: tmp });
    await sampleCorpus(store);
    const matches = await store.recall('postgres database backups', { limit: 3 });
    const top = matches[0];
    assertDefined(top, 'recall returns a match');
    expect(top.entry.frontmatter.name).toBe('postgres-prod');
  });

  it('mode: "keyword" forces the legacy scorer', async () => {
    const store = new MemoryStore({ dir: tmp });
    await sampleCorpus(store);
    const matches = await store.recall('postgres', { mode: 'keyword' });
    const top = matches[0];
    assertDefined(top, 'recall returns a match');
    expect(top.entry.frontmatter.name).toBe('postgres-prod');
  });

  it('embedder: null disables vector entirely and forces keyword', async () => {
    const store = new MemoryStore({ dir: tmp, embedder: null });
    expect(store.embedderName).toBe('keyword');
    await sampleCorpus(store);
    const matches = await store.recall('database flavor in prod');
    // Falls through to keyword: "database" + "prod" only appear in postgres-prod
    const top = matches[0];
    assertDefined(top, 'recall returns a match');
    expect(top.entry.frontmatter.name).toBe('postgres-prod');
  });

  it('accepts a custom EmbeddingProvider via the constructor', async () => {
    const stub: EmbeddingProvider = {
      name: 'stub',
      dim: 3,
      async embed(texts) {
        return texts.map((t) => (t.includes('postgres') ? [1, 0, 0] : [0, 1, 0]));
      },
    };
    const store = new MemoryStore({ dir: tmp, embedder: stub });
    expect(store.embedderName).toBe('stub');
    await sampleCorpus(store);
    const matches = await store.recall('postgres');
    const top = matches[0];
    assertDefined(top, 'recall returns a match');
    expect(top.entry.frontmatter.name).toBe('postgres-prod');
  });

  it('returns empty list when corpus is empty', async () => {
    const store = new MemoryStore({ dir: tmp });
    expect(await store.recall('anything')).toEqual([]);
  });
});
