/**
 * The tree hash is written into update journals and compared by later
 * versions of the app, so it may get faster but never different. It is held
 * here against the plain, one-file-at-a-time definition of it.
 */

import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readdir, readFile, lstat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { removeDir } from '@moxxy/vitest-preset/fs';
import { computerTreeHash } from './computer-update.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => removeDir(root))); });

/** The definition: directories and files in sorted, depth-first order. */
async function definedHash(directory: string): Promise<string> {
  const records: Array<[string, string]> = [];
  async function walk(file: string, relative: string): Promise<void> {
    if ((await lstat(file)).isDirectory()) {
      records.push([`${relative}/`, 'directory']);
      for (const name of (await readdir(file)).sort()) await walk(join(file, name), relative ? `${relative}/${name}` : name);
    } else {
      records.push([relative, createHash('sha256').update(await readFile(file)).digest('hex')]);
    }
  }
  await walk(directory, '');
  return createHash('sha256').update(JSON.stringify(records)).digest('hex');
}

/** A package the size and shape of a real one: nested, with files of many sizes. */
async function tree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'moxxy-tree-hash-')); roots.push(root);
  for (let dir = 0; dir < 12; dir++) {
    const path = join(root, 'node_modules', `dep-${dir}`, dir % 2 ? 'dist' : 'lib', 'nested');
    await mkdir(path, { recursive: true });
    for (let file = 0; file < 40; file++) {
      await writeFile(join(path, `file-${file}.js`), `export const value = ${dir * 100 + file};\n`.repeat(1 + ((dir * file) % 50)));
    }
  }
  await mkdir(join(root, 'empty'));
  await writeFile(join(root, 'package.json'), '{"name":"fixture"}');
  return root;
}

it('is the sorted, depth-first hash of every directory and file', async () => {
  const root = await tree();

  expect(await computerTreeHash(root)).toBe(await definedHash(root));
});

it('is the same every time, whichever file is read first', async () => {
  const root = await tree();

  const hashes = await Promise.all(Array.from({ length: 4 }, () => computerTreeHash(root)));

  expect(new Set(hashes).size).toBe(1);
});

it('changes when one file deep inside changes', async () => {
  const root = await tree();
  const before = await computerTreeHash(root);

  await writeFile(join(root, 'node_modules', 'dep-7', 'dist', 'nested', 'file-39.js'), 'changed');

  expect(await computerTreeHash(root)).not.toBe(before);
});

it('refuses a tree with a link in it', async () => {
  const root = await tree();
  await symlink(join(root, 'empty'), join(root, 'node_modules', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');

  await expect(computerTreeHash(root)).rejects.toThrow(/symbolic links/);
});

it('is null for a directory that is not there', async () => {
  expect(await computerTreeHash(join(tmpdir(), 'moxxy-no-such-tree'))).toBeNull();
});
