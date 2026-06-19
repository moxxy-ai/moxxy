import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { EmbeddingProvider } from '@moxxy/sdk';
import { EmbeddingIndex } from './embedding-cache.js';
import { MemoryStore } from './store.js';

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-cache-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('EmbeddingIndex', () => {
  it('returns null on lookup before load()', () => {
    const idx = new EmbeddingIndex(tmp, 'test');
    expect(idx.lookup('foo', 'body')).toBeNull();
  });

  it('round-trips a vector through flush+load', async () => {
    const a = new EmbeddingIndex(tmp, 'test');
    a.set('foo', 'body text', [0.1, 0.2, 0.3]);
    await a.flush();

    const b = new EmbeddingIndex(tmp, 'test');
    await b.load();
    expect(b.lookup('foo', 'body text')).toEqual([0.1, 0.2, 0.3]);
  });

  it('returns null when body hash changes (stale entry)', async () => {
    const a = new EmbeddingIndex(tmp, 'test');
    a.set('foo', 'original', [1, 2, 3]);
    await a.flush();

    const b = new EmbeddingIndex(tmp, 'test');
    await b.load();
    expect(b.lookup('foo', 'changed body')).toBeNull();
  });

  it('invalidates cache when embedder name changes', async () => {
    const a = new EmbeddingIndex(tmp, 'openai');
    a.set('foo', 'body', [1, 2, 3]);
    await a.flush();

    const b = new EmbeddingIndex(tmp, 'transformers');
    await b.load();
    expect(b.lookup('foo', 'body')).toBeNull();
  });

  it('invalidates cache when the dim changes under the same embedder name', async () => {
    // Same name (e.g. the OpenAI embedder's coarse name), different dim — a
    // model switch (1536 → 3072) must NOT reuse incomparable vectors.
    const a = new EmbeddingIndex(tmp, 'openai', 1536);
    a.set('foo', 'body', [1, 2, 3]);
    await a.flush();

    const b = new EmbeddingIndex(tmp, 'openai', 3072);
    await b.load();
    expect(b.lookup('foo', 'body')).toBeNull();

    // Same name AND dim → cache is reused.
    const c = new EmbeddingIndex(tmp, 'openai', 1536);
    await c.load();
    expect(c.lookup('foo', 'body')).toEqual([1, 2, 3]);
  });

  it('prune() removes entries not in the current set', async () => {
    const idx = new EmbeddingIndex(tmp, 'test');
    idx.set('keep', 'b1', [1]);
    idx.set('drop', 'b2', [2]);
    idx.prune(['keep']);
    await idx.flush();

    const reloaded = new EmbeddingIndex(tmp, 'test');
    await reloaded.load();
    expect(reloaded.lookup('keep', 'b1')).toEqual([1]);
    expect(reloaded.lookup('drop', 'b2')).toBeNull();
  });

  it('flush() is a no-op when nothing changed', async () => {
    const idx = new EmbeddingIndex(tmp, 'test');
    await idx.load(); // no file yet
    await idx.flush();
    await expect(fs.access(path.join(tmp, '.embeddings.json'))).rejects.toThrow();
  });

  it('reads the cache file at most once across repeated load() calls', async () => {
    const seed = new EmbeddingIndex(tmp, 'test');
    seed.set('foo', 'body', [1, 2, 3]);
    await seed.flush();

    const idx = new EmbeddingIndex(tmp, 'test');
    const readSpy = vi.spyOn(fs, 'readFile');
    await idx.load();
    await idx.load();
    await idx.load();
    expect(readSpy.mock.calls.length).toBe(1);
    // The in-memory cache is still consulted after the single read.
    expect(idx.lookup('foo', 'body')).toEqual([1, 2, 3]);
    readSpy.mockRestore();
  });

  it('does not re-read after an initial miss (no file on disk)', async () => {
    const idx = new EmbeddingIndex(tmp, 'test');
    const readSpy = vi.spyOn(fs, 'readFile');
    await idx.load(); // ENOENT
    await idx.load();
    expect(readSpy.mock.calls.length).toBe(1);
    readSpy.mockRestore();
  });

  it('degrades a corrupt (unparseable) cache file to a cold cache instead of throwing', async () => {
    await fs.writeFile(path.join(tmp, '.embeddings.json'), '{ this is not valid json ', 'utf8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const idx = new EmbeddingIndex(tmp, 'test');
    try {
      await expect(idx.load()).resolves.toBeUndefined(); // never throws
      expect(idx.lookup('anything', 'body')).toBeNull(); // cold cache
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('degrades a structurally-valid-but-shapeless cache file (no entries) to a cold cache', async () => {
    // {version,embedder} with no `entries` previously threw a TypeError at
    // Object.entries(undefined), permanently breaking every recall.
    await fs.writeFile(
      path.join(tmp, '.embeddings.json'),
      JSON.stringify({ version: 1, embedder: 'test' }),
      'utf8',
    );
    const idx = new EmbeddingIndex(tmp, 'test');
    await expect(idx.load()).resolves.toBeUndefined();
    expect(idx.lookup('foo', 'body')).toBeNull();
  });

  it('skips malformed entries but keeps the well-formed ones', async () => {
    await fs.writeFile(
      path.join(tmp, '.embeddings.json'),
      JSON.stringify({
        version: 1,
        embedder: 'test',
        entries: {
          good: { hash: EmbeddingIndex.hash('body'), vector: [1, 2, 3] },
          bad: { hash: 42, vector: 'not-an-array' },
          alsoBad: { vector: [1, 2] }, // missing hash
        },
      }),
      'utf8',
    );
    const idx = new EmbeddingIndex(tmp, 'test');
    await idx.load();
    expect(idx.lookup('good', 'body')).toEqual([1, 2, 3]);
    expect(idx.lookup('bad', 'body')).toBeNull();
    expect(idx.lookup('alsoBad', 'body')).toBeNull();
  });
});

describe('MemoryStore vector recall with persistent index', () => {
  const makeCountingEmbedder = (): EmbeddingProvider & { calls: number; embed: ReturnType<typeof vi.fn> } => {
    const state = { calls: 0 };
    const embed = vi.fn(async (texts: ReadonlyArray<string>) => {
      state.calls += texts.length;
      // Deterministic per-text vector: hash → 3 small floats
      return texts.map((t) => {
        const code = t.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
        return [code / 1000, (code * 7) % 1, (code * 13) % 1];
      });
    });
    return Object.assign(
      { name: 'counting', dim: 3 as const, embed },
      {
        get calls() {
          return state.calls;
        },
      },
    );
  };

  it('first recall embeds the full corpus + query', async () => {
    const embedder = makeCountingEmbedder();
    const store = new MemoryStore({ dir: tmp, embedder });
    await store.save({ name: 'a', type: 'fact', description: 'A', body: 'body A' });
    await store.save({ name: 'b', type: 'fact', description: 'B', body: 'body B' });
    embedder.embed.mockClear();
    await store.recall('q');
    // 2 entries + 1 query
    const totalEmbeds = embedder.embed.mock.calls.reduce(
      (sum, call) => sum + (call[0] as string[]).length,
      0,
    );
    expect(totalEmbeds).toBe(3);
  });

  it('second recall with unchanged corpus only embeds the new query', async () => {
    const embedder = makeCountingEmbedder();
    const store = new MemoryStore({ dir: tmp, embedder });
    await store.save({ name: 'a', type: 'fact', description: 'A', body: 'body A' });
    await store.save({ name: 'b', type: 'fact', description: 'B', body: 'body B' });

    await store.recall('first query');   // populates cache
    embedder.embed.mockClear();
    await store.recall('second query');  // should only re-embed the new query

    const totalEmbeds = embedder.embed.mock.calls.reduce(
      (sum, call) => sum + (call[0] as string[]).length,
      0,
    );
    expect(totalEmbeds).toBe(1);
  });

  it('changing one entry re-embeds only that one + query', async () => {
    const embedder = makeCountingEmbedder();
    const store = new MemoryStore({ dir: tmp, embedder });
    await store.save({ name: 'a', type: 'fact', description: 'A', body: 'body A' });
    await store.save({ name: 'b', type: 'fact', description: 'B', body: 'body B' });

    await store.recall('q');
    embedder.embed.mockClear();
    await store.update('a', { body: 'CHANGED body A' });
    await store.recall('q');

    const totalEmbeds = embedder.embed.mock.calls.reduce(
      (sum, call) => sum + (call[0] as string[]).length,
      0,
    );
    // 'a' changed → re-embed; 'b' unchanged → cached; query → fresh. Total = 2.
    expect(totalEmbeds).toBe(2);
  });

  it('persists across MemoryStore instances (cache survives process restart)', async () => {
    const e1 = makeCountingEmbedder();
    const s1 = new MemoryStore({ dir: tmp, embedder: e1 });
    await s1.save({ name: 'a', type: 'fact', description: 'A', body: 'body A' });
    await s1.recall('q');

    const e2 = makeCountingEmbedder();
    const s2 = new MemoryStore({ dir: tmp, embedder: e2 });
    e2.embed.mockClear();
    await s2.recall('q2');

    // s2's cache loads from disk → only embeds the new query
    const totalEmbeds = e2.embed.mock.calls.reduce(
      (sum, call) => sum + (call[0] as string[]).length,
      0,
    );
    expect(totalEmbeds).toBe(1);
  });

  it('persistEmbeddings: false disables caching even for neural embedders', async () => {
    const embedder = makeCountingEmbedder();
    const store = new MemoryStore({ dir: tmp, embedder, persistEmbeddings: false });
    await store.save({ name: 'a', type: 'fact', description: 'A', body: 'body A' });
    await store.recall('q');
    embedder.embed.mockClear();
    await store.recall('q');
    // No cache → re-embeds everything
    const totalEmbeds = embedder.embed.mock.calls.reduce(
      (sum, call) => sum + (call[0] as string[]).length,
      0,
    );
    expect(totalEmbeds).toBe(2); // 1 entry + 1 query
  });
});
