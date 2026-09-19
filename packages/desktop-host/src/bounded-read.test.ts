/**
 * The point of readBoundedFile is that the type and size guards apply to the
 * bytes actually returned. The old shape (lstat the path, then readFile the
 * path) could be repointed between the two, so these tests pin the guards to
 * the read rather than to a prior look at the path.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readBoundedFile } from './bounded-read.js';

const dirs: string[] = [];

async function tmp(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-bounded-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

describe('readBoundedFile', () => {
  it('returns the contents of a regular file within the limit', async () => {
    const dir = await tmp();
    const file = path.join(dir, 'ok.json');
    await fs.writeFile(file, '{"a":1}');
    expect((await readBoundedFile(file, 4096, 'bad')).toString('utf8')).toBe('{"a":1}');
  });

  it('rejects a file over the limit', async () => {
    const dir = await tmp();
    const file = path.join(dir, 'big.bin');
    await fs.writeFile(file, Buffer.alloc(200));
    await expect(readBoundedFile(file, 100, 'too big')).rejects.toThrow('too big');
  });

  it('accepts a file exactly at the limit', async () => {
    const dir = await tmp();
    const file = path.join(dir, 'edge.bin');
    await fs.writeFile(file, Buffer.alloc(100));
    expect((await readBoundedFile(file, 100, 'bad')).length).toBe(100);
  });

  it('rejects a symlink even when its target would pass every guard', async () => {
    const dir = await tmp();
    const target = path.join(dir, 'target.json');
    const link = path.join(dir, 'link.json');
    await fs.writeFile(target, '{}');
    await fs.symlink(target, link);
    await expect(readBoundedFile(link, 4096, 'no symlinks')).rejects.toThrow('no symlinks');
  });

  it('rejects a directory', async () => {
    const dir = await tmp();
    await expect(readBoundedFile(dir, 4096, 'not a file')).rejects.toThrow('not a file');
  });

  it('leaves ENOENT to the caller, which uses it to mean "absent"', async () => {
    const dir = await tmp();
    await expect(
      readBoundedFile(path.join(dir, 'missing.json'), 4096, 'bad'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
