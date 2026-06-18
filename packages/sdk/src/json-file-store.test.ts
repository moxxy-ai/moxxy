import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createJsonFileStore } from './json-file-store.js';

interface Item {
  id: string;
  n: number;
}

const itemSchema = z.object({ id: z.string(), n: z.number() });
const fileSchema = z.object({ version: z.literal(1), items: z.array(itemSchema) });

/** A `load` that mirrors the scheduler policy: corrupt/invalid -> empty. */
function lenientLoad(raw: string | null): Item[] {
  if (raw === null) return [];
  try {
    const parsed = fileSchema.safeParse(JSON.parse(raw));
    return parsed.success ? [...parsed.data.items] : [];
  } catch {
    return [];
  }
}

describe('createJsonFileStore', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'moxxy-jfs-'));
    file = join(dir, 'sub', 'store.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function store() {
    return createJsonFileStore<Item>({ file, load: lenientLoad });
  }

  it('returns an empty list when the file is missing (ENOENT)', async () => {
    expect(await store().read()).toEqual([]);
  });

  it('persists { version: 1, items } pretty-printed and creates parent dirs', async () => {
    const s = store();
    await s.mutate((items) => [...items, { id: 'a', n: 1 }]);
    const raw = await readFile(file, 'utf8');
    expect(JSON.parse(raw)).toEqual({ version: 1, items: [{ id: 'a', n: 1 }] });
    // pretty-printed with 2-space indent
    expect(raw).toContain('\n  "version": 1');
    // a fresh instance reads the persisted state back
    expect(await store().read()).toEqual([{ id: 'a', n: 1 }]);
  });

  it('get() finds by id and returns null for misses', async () => {
    const s = store();
    await s.mutate((items) => [...items, { id: 'a', n: 1 }, { id: 'b', n: 2 }]);
    expect(await s.get('b')).toEqual({ id: 'b', n: 2 });
    expect(await s.get('zzz')).toBeNull();
  });

  it('read() and the mutator each get a fresh copy (caller cannot mutate cache)', async () => {
    const s = store();
    await s.mutate((items) => [...items, { id: 'a', n: 1 }]);

    // Mutating the array returned by read() must not affect the store.
    const snap = await s.read();
    snap.push({ id: 'evil', n: 99 });
    expect(await s.read()).toEqual([{ id: 'a', n: 1 }]);

    // The mutator receives a fresh slice; pushing into it then returning a
    // DIFFERENT array means the push is discarded (proves it's a copy, not the
    // live cache).
    await s.mutate((items) => {
      items.push({ id: 'discarded', n: -1 });
      return [{ id: 'a', n: 2 }];
    });
    expect(await s.read()).toEqual([{ id: 'a', n: 2 }]);
  });

  it('serializes concurrent mutate() calls so neither clobbers the other', async () => {
    const s = store();
    // Fire many overlapping appends. Without the mutex these read the same
    // baseline and the last write wins, dropping entries.
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        s.mutate((items) => [...items, { id: `k${i}`, n: i }]),
      ),
    );
    const all = await s.read();
    expect(all).toHaveLength(25);
    expect(new Set(all.map((x) => x.id)).size).toBe(25);
    // The on-disk file agrees (every write landed atomically).
    const onDisk = JSON.parse(await readFile(file, 'utf8')) as { items: Item[] };
    expect(onDisk.items).toHaveLength(25);
  });

  it('leaves the prior file intact when serializing the new state throws', async () => {
    const s = store();
    await s.mutate((items) => [...items, { id: 'a', n: 1 }]);
    const before = await readFile(file, 'utf8');

    // A value JSON.stringify cannot serialize (BigInt) makes the persist throw
    // before any bytes hit disk; the previously-persisted file must survive.
    await expect(
      s.mutate(() => [{ id: 'bad', n: 1n as unknown as number }]),
    ).rejects.toThrow();

    expect(await readFile(file, 'utf8')).toBe(before);
    const leftovers = (await readdir(join(dir, 'sub'))).filter((n) => n.includes('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('leaves the prior file intact when the atomic rename fails mid-write', async () => {
    const s = store();
    await s.mutate((items) => [...items, { id: 'a', n: 1 }]);
    const before = await readFile(file, 'utf8');

    // Replace the parent dir's write path: make the TARGET a directory so the
    // temp-file rename throws. We can't do that to `file` itself without losing
    // the prior copy, so use a sibling store whose target is a directory and
    // assert no temp file is orphaned. The original store's file is untouched.
    const sib = join(dir, 'sub', 'sibling');
    await mkdir(sib, { recursive: true });
    const s2 = createJsonFileStore<Item>({ file: sib, load: lenientLoad });
    await expect(s2.mutate((items) => [...items, { id: 'x', n: 1 }])).rejects.toThrow();

    // No orphaned temp files, and the unrelated prior file is intact.
    const leftovers = (await readdir(join(dir, 'sub'))).filter((n) => n.includes('.tmp'));
    expect(leftovers).toEqual([]);
    expect(await readFile(file, 'utf8')).toBe(before);
  });

  it('lenient load resets a corrupt file to empty (scheduler policy)', async () => {
    await mkdir(join(dir, 'sub'), { recursive: true });
    await writeFile(file, '{ not json', 'utf8');
    const s = store();
    expect(await s.read()).toEqual([]);
    // The bad file is left in place until the next write.
    expect(await readFile(file, 'utf8')).toBe('{ not json');
  });

  it('lenient load resets a schema-mismatched file to empty', async () => {
    await mkdir(join(dir, 'sub'), { recursive: true });
    await writeFile(file, JSON.stringify({ version: 99, items: [] }), 'utf8');
    expect(await store().read()).toEqual([]);
  });

  it('onReadError lets a store refuse to operate on a non-ENOENT read error', async () => {
    // Point the store at a directory so readFile throws EISDIR (not ENOENT).
    const asDir = join(dir, 'as-dir');
    await mkdir(asDir, { recursive: true });
    const s = createJsonFileStore<Item>({
      file: asDir,
      load: lenientLoad,
      onReadError: (err) => {
        throw new Error(`refusing: ${(err as NodeJS.ErrnoException).code}`);
      },
    });
    await expect(s.read()).rejects.toThrow(/refusing:/);
  });

  it('re-throws a non-ENOENT read error by default (no onReadError)', async () => {
    const asDir = join(dir, 'as-dir2');
    await mkdir(asDir, { recursive: true });
    const s = createJsonFileStore<Item>({ file: asDir, load: lenientLoad });
    await expect(s.read()).rejects.toThrow();
  });

  it('honors a custom itemsKey, fileFields, stringify and writeOptions', async () => {
    const f = join(dir, 'custom.json');
    const s = createJsonFileStore<Item>({
      file: f,
      itemsKey: 'rows',
      fileFields: {},
      stringify: (obj) => JSON.stringify(obj) + '\n',
      writeOptions: { mode: 0o600 },
      load: (raw) => {
        if (raw === null) return [];
        const obj = JSON.parse(raw) as { rows: Item[] };
        return obj.rows;
      },
    });
    await s.mutate((items) => [...items, { id: 'a', n: 1 }]);
    const raw = await readFile(f, 'utf8');
    // versionless, name-key `rows`, compact, trailing newline
    expect(raw).toBe('{"rows":[{"id":"a","n":1}]}\n');
    const { stat } = await import('node:fs/promises');
    expect((await stat(f)).mode & 0o777).toBe(0o600);
  });

  it('invalidate() forces a re-read from disk', async () => {
    const s = store();
    await s.mutate((items) => [...items, { id: 'a', n: 1 }]);
    // Write a second entry directly to disk behind the store's back.
    await writeFile(file, JSON.stringify({ version: 1, items: [{ id: 'b', n: 2 }] }), 'utf8');
    // Stale cache still shows the first entry…
    expect(await s.read()).toEqual([{ id: 'a', n: 1 }]);
    s.invalidate();
    // …until invalidated.
    expect(await s.read()).toEqual([{ id: 'b', n: 2 }]);
  });
});
