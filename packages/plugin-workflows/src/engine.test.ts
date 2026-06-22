import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sweepStaleRecords } from './engine.js';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wf-records-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('sweepStaleRecords', () => {
  it('removes only *.jsonl records past the TTL, leaving fresh ones and non-records', async () => {
    const stale = path.join(dir, 'stale-flow-abc.jsonl');
    const fresh = path.join(dir, 'fresh-flow-def.jsonl');
    const other = path.join(dir, 'notes.txt'); // never a run record — must survive
    await fs.writeFile(stale, '{"kind":"run"}\n');
    await fs.writeFile(fresh, '{"kind":"run"}\n');
    await fs.writeFile(other, 'keep me');

    // Backdate the stale record well past any TTL.
    const old = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    await fs.utimes(stale, old, old);

    const removed = await sweepStaleRecords(dir, 30 * 24 * 60 * 60 * 1000);
    expect(removed).toBe(1);
    await expect(fs.access(stale)).rejects.toBeDefined();
    await expect(fs.access(fresh)).resolves.toBeUndefined();
    // A non-record file in the same dir is never touched.
    expect(await fs.readFile(other, 'utf8')).toBe('keep me');
  });

  it('returns 0 on a missing directory rather than throwing', async () => {
    const missing = path.join(dir, 'does-not-exist');
    await expect(sweepStaleRecords(missing)).resolves.toBe(0);
  });

  it('keeps every record when none is past the TTL', async () => {
    await fs.writeFile(path.join(dir, 'a-flow-1.jsonl'), '{}\n');
    await fs.writeFile(path.join(dir, 'b-flow-2.jsonl'), '{}\n');
    const removed = await sweepStaleRecords(dir, 30 * 24 * 60 * 60 * 1000);
    expect(removed).toBe(0);
    expect((await fs.readdir(dir)).filter((f) => f.endsWith('.jsonl'))).toHaveLength(2);
  });
});
