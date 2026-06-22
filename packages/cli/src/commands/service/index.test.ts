import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readServiceLog } from './index.js';
import { serviceLogPath } from './common.js';

describe('readServiceLog (bounded tail)', () => {
  let home: string;
  const prevHome = process.env.MOXXY_HOME;

  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), 'moxxy-svc-'));
    process.env.MOXXY_HOME = home;
  });

  afterEach(async () => {
    if (prevHome === undefined) delete process.env.MOXXY_HOME;
    else process.env.MOXXY_HOME = prevHome;
    await rm(home, { recursive: true, force: true });
  });

  async function writeLog(id: string, content: string): Promise<void> {
    const p = serviceLogPath({ id });
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, content, 'utf8');
  }

  it('returns the last N lines of a small log', async () => {
    await writeLog('svc', Array.from({ length: 10 }, (_, i) => `line${i}`).join('\n'));
    const out = await readServiceLog({ id: 'svc' }, 3);
    expect(out.split('\n')).toEqual(['line7', 'line8', 'line9']);
  });

  it('returns "" when the log does not exist', async () => {
    expect(await readServiceLog({ id: 'missing' }, 40)).toBe('');
  });

  it('tails a huge log without buffering the whole file (bounded, no OOM)', async () => {
    // ~5 MB of distinct lines. The tail must only read the trailing bytes.
    const lines = Array.from({ length: 200_000 }, (_, i) => `entry-${i.toString().padStart(8, '0')}`);
    await writeLog('big', lines.join('\n'));
    const out = await readServiceLog({ id: 'big' }, 5);
    const got = out.split('\n');
    expect(got).toEqual([
      'entry-00199995',
      'entry-00199996',
      'entry-00199997',
      'entry-00199998',
      'entry-00199999',
    ]);
  });

  it('drops the partial leading line produced by a mid-file positioned read', async () => {
    // Build a log whose total size exceeds the per-line tail budget so the read
    // starts mid-file; the first (partial) line must be discarded, never shown.
    const big = 'X'.repeat(600 * 1024); // > MAX_TAIL_BYTES on its own
    await writeLog('partial', `${big}\nclean-tail-line`);
    const out = await readServiceLog({ id: 'partial' }, 1);
    expect(out).toBe('clean-tail-line');
    expect(out).not.toContain('X');
  });

  it('coerces a non-positive / non-finite line count to 1 (no crash)', async () => {
    await writeLog('coerce', 'a\nb\nc');
    expect(await readServiceLog({ id: 'coerce' }, 0)).toBe('c');
    expect(await readServiceLog({ id: 'coerce' }, -5)).toBe('c');
    expect(await readServiceLog({ id: 'coerce' }, Number.NaN)).toBe('c');
  });
});
