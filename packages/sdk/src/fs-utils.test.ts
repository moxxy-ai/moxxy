import { mkdtemp, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { moxxyHome, moxxyPath, writeFileAtomic, writeFileAtomicSync } from './fs-utils.js';

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
