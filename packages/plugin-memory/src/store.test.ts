import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertDefined } from '@moxxy/sdk';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MemoryStore } from './store.js';

let tmp: string;
const newStore = () => new MemoryStore({ dir: tmp });

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-mem-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('MemoryStore', () => {
  it('saves and round-trips an entry', async () => {
    const store = newStore();
    await store.save({ name: 'foo', type: 'fact', description: 'foo desc', body: 'foo body' });
    const got = await store.get('foo');
    expect(got?.frontmatter.name).toBe('foo');
    expect(got?.frontmatter.type).toBe('fact');
    expect(got?.body).toBe('foo body');
  });

  it('emits valid Markdown with frontmatter on disk', async () => {
    const store = newStore();
    await store.save({ name: 'foo', type: 'fact', description: 'desc', body: 'body' });
    const raw = await fs.readFile(path.join(tmp, 'foo.md'), 'utf8');
    expect(raw).toContain('---');
    expect(raw).toContain('name: foo');
    expect(raw).toContain('type: fact');
    expect(raw).toMatch(/createdAt: .+/);
  });

  it('serializes concurrent saves so MEMORY.md keeps every entry', async () => {
    const store = newStore();
    // Without the per-instance mutex, each save's rebuildIndex can read the
    // entry list before a sibling save has written its file, so a concurrent
    // save's row is dropped from MEMORY.md (and the writes race the file).
    await Promise.all([
      store.save({ name: 'a', type: 'fact', description: 'A.', body: 'a' }),
      store.save({ name: 'b', type: 'fact', description: 'B.', body: 'b' }),
      store.save({ name: 'c', type: 'fact', description: 'C.', body: 'c' }),
    ]);
    const idx = await fs.readFile(path.join(tmp, 'MEMORY.md'), 'utf8');
    expect(idx).toContain('[a](a.md)');
    expect(idx).toContain('[b](b.md)');
    expect(idx).toContain('[c](c.md)');
    expect(await store.list()).toHaveLength(3);
  });

  it('rebuilds the MEMORY.md index after each save', async () => {
    const store = newStore();
    await store.save({ name: 'a', type: 'fact', description: 'A.', body: '...' });
    await store.save({ name: 'b', type: 'preference', description: 'B.', body: '...' });
    const idx = await fs.readFile(path.join(tmp, 'MEMORY.md'), 'utf8');
    expect(idx).toContain('## fact');
    expect(idx).toContain('## preference');
    expect(idx).toContain('[a](a.md)');
    expect(idx).toContain('[b](b.md)');
  });

  it('list filters by type', async () => {
    const store = newStore();
    await store.save({ name: 'a', type: 'fact', description: 'A', body: '.' });
    await store.save({ name: 'b', type: 'preference', description: 'B', body: '.' });
    const facts = await store.list('fact');
    expect(facts).toHaveLength(1);
    const fact = facts[0];
    assertDefined(fact, 'facts has one entry');
    expect(fact.frontmatter.name).toBe('a');
  });

  it('update preserves createdAt but bumps updatedAt', async () => {
    const store = newStore();
    await store.save({ name: 'foo', type: 'fact', description: 'd', body: 'orig' });
    const first = await store.get('foo');
    assertDefined(first, 'foo was just saved');
    await new Promise((r) => setTimeout(r, 10));
    await store.update('foo', { body: 'updated' });
    const second = await store.get('foo');
    assertDefined(second, 'foo still exists after update');
    expect(second.frontmatter.createdAt).toBe(first.frontmatter.createdAt);
    expect(second.frontmatter.updatedAt).not.toBe(first.frontmatter.updatedAt);
    expect(second.body).toBe('updated');
  });

  it('forget deletes the file and updates the index', async () => {
    const store = newStore();
    await store.save({ name: 'a', type: 'fact', description: 'A', body: '.' });
    expect(await store.forget('a')).toBe(true);
    expect(await store.forget('a')).toBe(false);
    const idx = await fs.readFile(path.join(tmp, 'MEMORY.md'), 'utf8').catch(() => '');
    expect(idx).not.toContain('[a]');
  });

  it('returns empty list when dir does not exist', async () => {
    const store = new MemoryStore({ dir: path.join(tmp, 'nope') });
    expect(await store.list()).toEqual([]);
  });

  it('recall ranks by token frequency + name/description matches', async () => {
    const store = newStore();
    await store.save({
      name: 'team-likes-trpc',
      type: 'preference',
      description: 'The team prefers tRPC over REST.',
      body: 'When generating new endpoints, scaffold a tRPC router.',
    });
    await store.save({
      name: 'prod-postgres',
      type: 'project',
      description: 'Production runs Postgres 16.',
      body: 'All migrations target Postgres 16. Use `pg_dump` for backups.',
    });
    const matches = await store.recall('trpc endpoints');
    const topMatch = matches[0];
    assertDefined(topMatch, 'recall returns a match');
    expect(topMatch.entry.frontmatter.name).toBe('team-likes-trpc');
    const pg = await store.recall('postgres');
    const topPg = pg[0];
    assertDefined(topPg, 'recall returns a match');
    expect(topPg.entry.frontmatter.name).toBe('prod-postgres');
  });

  it('rejects invalid frontmatter at save time via the schema', async () => {
    const store = newStore();
    await expect(
      store.save({ name: 'Bad Name', type: 'fact', description: 'd', body: '.' } as never),
    ).rejects.toThrow();
  });

  it('maintains the index incrementally — a save does not re-read every memory file', async () => {
    const store = newStore();
    // First save hydrates the row cache from disk (one readdir + reads).
    await store.save({ name: 'a', type: 'fact', description: 'A', body: 'a' });
    const readdirSpy = vi.spyOn(fs, 'readdir');
    const readFileSpy = vi.spyOn(fs, 'readFile');
    try {
      await store.save({ name: 'b', type: 'fact', description: 'B', body: 'b' });
      await store.save({ name: 'c', type: 'preference', description: 'C', body: 'c' });
      // No directory re-scan; the only reads are each entry's own
      // read-modify-write (createdAt preservation), not a full re-index.
      expect(readdirSpy).not.toHaveBeenCalled();
      expect(readFileSpy.mock.calls.length).toBeLessThanOrEqual(2);
    } finally {
      readdirSpy.mockRestore();
      readFileSpy.mockRestore();
    }
    const idx = await fs.readFile(path.join(tmp, 'MEMORY.md'), 'utf8');
    expect(idx).toContain('[a](a.md)');
    expect(idx).toContain('[b](b.md)');
    expect(idx).toContain('[c](c.md)');
  });

  it('incremental index survives forget and a fresh store rehydrates from disk', async () => {
    const store = newStore();
    await store.save({ name: 'a', type: 'fact', description: 'A', body: 'a' });
    await store.save({ name: 'b', type: 'fact', description: 'B', body: 'b' });
    await store.forget('a');
    const idx = await fs.readFile(path.join(tmp, 'MEMORY.md'), 'utf8');
    expect(idx).not.toContain('[a](a.md)');
    expect(idx).toContain('[b](b.md)');
    // A new instance (cold cache) sees the same state.
    const fresh = newStore();
    await fresh.save({ name: 'c', type: 'fact', description: 'C', body: 'c' });
    const idx2 = await fs.readFile(path.join(tmp, 'MEMORY.md'), 'utf8');
    expect(idx2).not.toContain('[a](a.md)');
    expect(idx2).toContain('[b](b.md)');
    expect(idx2).toContain('[c](c.md)');
  });

  it('soft cap is warn-only: saves past maxMemories succeed, capStatus flips, nothing evicted', async () => {
    const store = new MemoryStore({ dir: tmp, maxMemories: 2 });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await store.save({ name: 'a', type: 'fact', description: 'A', body: 'a' });
      await store.save({ name: 'b', type: 'fact', description: 'B', body: 'b' });
      expect((await store.capStatus()).over).toBe(false);
      expect(warn).not.toHaveBeenCalled();

      await store.save({ name: 'c', type: 'fact', description: 'C', body: 'c' });
      const cap = await store.capStatus();
      expect(cap).toEqual({ count: 3, max: 2, over: true });
      expect(warn).toHaveBeenCalledOnce();
      // Warn-only: every entry is still on disk and listed.
      expect((await store.list()).map((e) => e.frontmatter.name).sort()).toEqual(['a', 'b', 'c']);
    } finally {
      warn.mockRestore();
    }
  });
});
