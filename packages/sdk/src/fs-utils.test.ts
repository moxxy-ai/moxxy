import { chmod, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ensurePrivateDir,
  ensurePrivateFile,
  moxxyHome,
  moxxyPath,
  pruneStaleTempFiles,
  writeFileAtomic,
  writeFileAtomicSync,
} from './fs-utils.js';

describe('writeFileAtomic', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'moxxy-fs-'));
  });

  it('writes content and creates missing parent dirs', async () => {
    const target = join(dir, 'nested', 'deep', 'file.json');
    await writeFileAtomic(target, '{"a":1}');
    expect(await readFile(target, 'utf8')).toBe('{"a":1}');
  });

  it('overwrites an existing file and leaves no temp file behind', async () => {
    const target = join(dir, 'file.txt');
    await writeFileAtomic(target, 'first');
    await writeFileAtomic(target, 'second');
    expect(await readFile(target, 'utf8')).toBe('second');
    const leftovers = (await readdir(dir)).filter((n) => n.includes('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('enforces the requested mode past umask', async () => {
    const target = join(dir, 'secret.json');
    await writeFileAtomic(target, 'shh', { mode: 0o600 });
    const mode = (await stat(target)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('writes binary data unchanged', async () => {
    const target = join(dir, 'bytes.bin');
    const bytes = new Uint8Array([0, 1, 2, 255]);
    await writeFileAtomic(target, bytes);
    const read = await readFile(target);
    expect(Array.from(read)).toEqual([0, 1, 2, 255]);
  });
});

describe('writeFileAtomicSync', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'moxxy-fss-'));
  });

  it('writes content and creates missing parent dirs', async () => {
    const target = join(dir, 'nested', 'deep', 'file.json');
    writeFileAtomicSync(target, '{"a":1}');
    expect(await readFile(target, 'utf8')).toBe('{"a":1}');
  });

  it('overwrites an existing file and leaves no temp file behind', async () => {
    const target = join(dir, 'file.txt');
    writeFileAtomicSync(target, 'first');
    writeFileAtomicSync(target, 'second');
    expect(await readFile(target, 'utf8')).toBe('second');
    const leftovers = (await readdir(dir)).filter((n) => n.includes('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('enforces the requested mode past umask', async () => {
    const target = join(dir, 'secret.json');
    writeFileAtomicSync(target, 'shh', { mode: 0o600 });
    const mode = (await stat(target)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('writes binary data unchanged', async () => {
    const target = join(dir, 'bytes.bin');
    writeFileAtomicSync(target, new Uint8Array([0, 1, 2, 255]));
    expect(Array.from(await readFile(target))).toEqual([0, 1, 2, 255]);
  });

  it('cleans up the temp file and throws when rename fails', async () => {
    // A directory in place of the final file makes renameSync fail; the temp
    // file must be removed and the error surfaced rather than swallowed.
    const { mkdir } = await import('node:fs/promises');
    const target = join(dir, 'as-dir');
    await mkdir(target);
    expect(() => writeFileAtomicSync(target, 'nope')).toThrow();
    const leftovers = (await readdir(dir)).filter((n) => n.includes('.tmp'));
    expect(leftovers).toEqual([]);
  });
});

describe('moxxyHome / moxxyPath', () => {
  const original = process.env.MOXXY_HOME;
  afterEach(() => {
    if (original === undefined) delete process.env.MOXXY_HOME;
    else process.env.MOXXY_HOME = original;
  });

  it('honors MOXXY_HOME when set', () => {
    process.env.MOXXY_HOME = '/custom/moxxy';
    expect(moxxyHome()).toBe('/custom/moxxy');
    expect(moxxyPath('vault.json')).toBe('/custom/moxxy/vault.json');
  });

  it('falls back to ~/.moxxy when unset', () => {
    delete process.env.MOXXY_HOME;
    expect(moxxyHome().endsWith('/.moxxy')).toBe(true);
  });
});

// POSIX modes are meaningless on Windows (chmod only toggles the read-only
// flag), where these helpers are deliberate no-ops. Assert the guarantee only
// where the platform can actually provide it.
describe.skipIf(process.platform === 'win32')('ensurePrivateDir / ensurePrivateFile', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'moxxy-priv-'));
  });

  it('creates a directory owner-only', async () => {
    const target = join(dir, 'sessions');
    await ensurePrivateDir(target);
    expect((await stat(target)).mode & 0o777).toBe(0o700);
  });

  it('tightens a directory that already exists with group/other bits', async () => {
    const target = join(dir, 'legacy');
    await mkdir(target, { mode: 0o755 });
    await chmod(target, 0o755); // defeat umask so the pre-state is really loose
    await ensurePrivateDir(target);
    expect((await stat(target)).mode & 0o777).toBe(0o700);
  });

  it('creates a missing file owner-only without truncating an existing one', async () => {
    const target = join(dir, 'log.jsonl');
    await ensurePrivateFile(target);
    expect((await stat(target)).mode & 0o777).toBe(0o600);

    await writeFile(target, 'line\n');
    await ensurePrivateFile(target);
    expect(await readFile(target, 'utf8')).toBe('line\n');
  });

  it('tightens a file that already exists world-readable', async () => {
    const target = join(dir, 'legacy.jsonl');
    await writeFile(target, 'secret transcript\n');
    await chmod(target, 0o644);
    await ensurePrivateFile(target);
    expect((await stat(target)).mode & 0o777).toBe(0o600);
    expect(await readFile(target, 'utf8')).toBe('secret transcript\n');
  });

  it('creates parent directories', async () => {
    const target = join(dir, 'a', 'b', 'c');
    await ensurePrivateDir(target);
    expect((await stat(target)).isDirectory()).toBe(true);
  });
});

describe('pruneStaleTempFiles', () => {
  let dir: string;
  const DAY = 24 * 60 * 60 * 1000;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'moxxy-prune-'));
  });

  const tmpName = (base: string): string =>
    `${base}.4242.3f2504e0-4f89-11d3-9a0c-0305e82c3301.tmp`;

  it('removes an abandoned temp file older than a day', async () => {
    const stale = join(dir, tmpName('schedules.json'));
    await writeFile(stale, '{}');
    const removed = await pruneStaleTempFiles([dir], Date.now() + 2 * DAY);
    expect(removed).toBe(1);
    expect(await readdir(dir)).toEqual([]);
  });

  // The guarantee that makes this safe to run while another moxxy process is
  // mid-write: a live temp file is milliseconds old and can never be selected.
  it('leaves a freshly-written temp file alone', async () => {
    const live = join(dir, tmpName('vault.json'));
    await writeFile(live, '{}');
    expect(await pruneStaleTempFiles([dir])).toBe(0);
    expect(await readdir(dir)).toEqual([tmpName('vault.json')]);
  });

  it('ignores files that merely end in .tmp', async () => {
    await writeFile(join(dir, 'notes.tmp'), 'user data');
    await writeFile(join(dir, 'draft.md.tmp'), 'user data');
    expect(await pruneStaleTempFiles([dir], Date.now() + 2 * DAY)).toBe(0);
    expect((await readdir(dir)).sort()).toEqual(['draft.md.tmp', 'notes.tmp']);
  });

  it('never throws on a missing directory', async () => {
    await expect(pruneStaleTempFiles([join(dir, 'nope')])).resolves.toBe(0);
  });
});
