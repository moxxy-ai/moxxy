import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  beginTransaction,
  diffSnapshot,
  failedAttemptCount,
  gcTransactions,
  listTransactions,
  readJournal,
  recordAttempt,
  resolveTarget,
  restoreSnapshot,
  writeJournal,
} from './transaction.js';

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function makeMoxxyDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-su-'));
  tempDirs.push(dir);
  await fs.mkdir(path.join(dir, 'plugins'), { recursive: true });
  await fs.mkdir(path.join(dir, 'skills'), { recursive: true });
  return dir;
}

describe('resolveTarget', () => {
  it('rejects path-traversal names', () => {
    expect(() => resolveTarget('/m', 'plugin', '../evil')).toThrow(/invalid plugin name/);
    expect(() => resolveTarget('/m', 'skill', 'a/b')).toThrow(/invalid skill name/);
  });

  it('maps kinds to the right paths', () => {
    expect(resolveTarget('/m', 'plugin', 'foo').path).toBe(path.join('/m', 'plugins', 'foo'));
    expect(resolveTarget('/m', 'skill', 'foo').path).toBe(path.join('/m', 'skills', 'foo.md'));
  });
});

describe('snapshot / restore round-trip', () => {
  it('restores a modified plugin byte-for-byte', async () => {
    const moxxy = await makeMoxxyDir();
    const dir = path.join(moxxy, 'plugins', 'foo');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'index.mjs'), 'export default 1;\n', 'utf8');

    const journal = await beginTransaction({ moxxyDir: moxxy, kind: 'plugin', name: 'foo' });
    expect(journal.existedBefore).toBe(true);

    // Mutate after snapshot, then restore.
    await fs.writeFile(path.join(dir, 'index.mjs'), 'BROKEN\n', 'utf8');
    await fs.writeFile(path.join(dir, 'extra.txt'), 'junk\n', 'utf8');
    await restoreSnapshot(moxxy, journal);

    expect(await fs.readFile(path.join(dir, 'index.mjs'), 'utf8')).toBe('export default 1;\n');
    await expect(fs.access(path.join(dir, 'extra.txt'))).rejects.toBeTruthy();
  });

  it('deletes a newly-created artifact on restore (tombstone)', async () => {
    const moxxy = await makeMoxxyDir();
    const journal = await beginTransaction({ moxxyDir: moxxy, kind: 'plugin', name: 'newp' });
    expect(journal.existedBefore).toBe(false);

    const dir = path.join(moxxy, 'plugins', 'newp');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'index.mjs'), 'x\n', 'utf8');

    await restoreSnapshot(moxxy, journal);
    await expect(fs.access(dir)).rejects.toBeTruthy();
  });
});

describe('journal persistence', () => {
  it('round-trips and tracks failed attempts', async () => {
    const moxxy = await makeMoxxyDir();
    const journal = await beginTransaction({ moxxyDir: moxxy, kind: 'skill', name: 'note' });
    recordAttempt(journal, { stage: 'parse', ok: false, message: 'boom' });
    journal.state = 'open';
    await writeJournal(moxxy, journal);

    const again = await readJournal(moxxy, journal.txnId);
    expect(failedAttemptCount(again)).toBe(1);
    expect(again.target.kind).toBe('skill');
  });

  it('lists newest-first and gc keeps N most recent terminal txns', async () => {
    const moxxy = await makeMoxxyDir();
    for (let i = 0; i < 4; i++) {
      const j = await beginTransaction({ moxxyDir: moxxy, kind: 'plugin', name: `p${i}` });
      j.state = 'committed';
      await writeJournal(moxxy, j);
      await new Promise((r) => setTimeout(r, 5));
    }
    expect((await listTransactions(moxxy)).length).toBe(4);
    await gcTransactions(moxxy, 2);
    expect((await listTransactions(moxxy)).length).toBe(2);
  });
});

describe('diffSnapshot', () => {
  it('returns only the added names per kind', () => {
    const before = { tools: ['a'], agents: [] };
    const after = { tools: ['a', 'b'], agents: ['x'] };
    expect(diffSnapshot(before, after)).toEqual({ tools: ['b'], agents: ['x'] });
  });

  it('is empty when nothing was added', () => {
    expect(diffSnapshot({ tools: ['a'] }, { tools: ['a'] })).toEqual({});
  });
});
