/**
 * workspace-fs is the cwd-confinement security boundary for the agent rail's
 * Files pane: listDir/readFile must never escape the workspace root (via `..`,
 * an absolute path, or a symlink that resolves outside), and readFile caps
 * oversized reads + flags binary files. These tempdir-based tests exercise that
 * guard and the read-shaping directly.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, symlink, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { listDir, readFile } from './workspace-fs';

let root = '';
let outside = '';

beforeEach(async () => {
  // realpath so macOS /var → /private/var canonicalisation matches the module.
  const base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'wsfs-')));
  root = path.join(base, 'workspace');
  outside = path.join(base, 'outside');
  await mkdir(root, { recursive: true });
  await mkdir(outside, { recursive: true });
});

afterEach(async () => {
  if (root) await rm(path.dirname(root), { recursive: true, force: true });
});

describe('resolveInside guard (via listDir/readFile)', () => {
  it('rejects a parent-traversal path', async () => {
    await expect(listDir(root, '../outside')).rejects.toThrow(/escapes the workspace root/);
  });

  it('rejects an absolute path outside the root', async () => {
    await expect(listDir(root, outside)).rejects.toThrow(/escapes the workspace root/);
  });

  it('rejects a symlink that points outside the root', async () => {
    await writeFile(path.join(outside, 'secret.txt'), 'shh');
    await symlink(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'));
    await expect(readFile(root, 'link.txt')).rejects.toThrow(/escapes the workspace root via a symlink/);
  });

  it('allows reading a file that is genuinely inside the root', async () => {
    await writeFile(path.join(root, 'hello.txt'), 'hi there');
    const r = await readFile(root, 'hello.txt');
    expect(r.text).toBe(true);
    expect(r.content).toBe('hi there');
    expect(r.truncated).toBe(false);
  });
});

describe('readFile shaping', () => {
  it('truncates an oversized file and flags it', async () => {
    const big = 'a'.repeat(1_000_000 + 50);
    await writeFile(path.join(root, 'big.log'), big);
    const r = await readFile(root, 'big.log');
    expect(r.truncated).toBe(true);
    expect(r.text).toBe(true);
    expect(r.content.length).toBe(1_000_000);
  });

  it('returns a binary placeholder for a file with a NUL byte', async () => {
    await writeFile(path.join(root, 'data.bin'), Buffer.from([1, 2, 0, 3, 4]));
    const r = await readFile(root, 'data.bin');
    expect(r.text).toBe(false);
    expect(r.content).toMatch(/^\[binary file — \d+ bytes\]$/);
  });

  it('returns an empty non-text result for a non-file path', async () => {
    await mkdir(path.join(root, 'adir'));
    const r = await readFile(root, 'adir');
    expect(r.text).toBe(false);
    expect(r.content).toBe('');
  });
});

describe('listDir filtering + ordering', () => {
  it('omits ignored dirs and hidden entries, dirs before files alphabetically', async () => {
    await mkdir(path.join(root, 'node_modules'));
    await mkdir(path.join(root, '.git'));
    await mkdir(path.join(root, 'zdir'));
    await mkdir(path.join(root, 'adir'));
    await writeFile(path.join(root, '.hidden'), 'x');
    await writeFile(path.join(root, 'b.txt'), 'x');
    await writeFile(path.join(root, 'a.txt'), 'x');

    const r = await listDir(root);
    expect(r.entries).toEqual([
      { name: 'adir', kind: 'dir' },
      { name: 'zdir', kind: 'dir' },
      { name: 'a.txt', kind: 'file' },
      { name: 'b.txt', kind: 'file' },
    ]);
  });

  it('omits a symlink pointing outside the root but keeps in-tree symlinks (no out-of-sandbox disclosure)', async () => {
    // An out-of-tree dir + file the listing must NOT disclose by name/kind.
    await mkdir(path.join(outside, 'secretdir'));
    await writeFile(path.join(outside, 'secret.txt'), 'shh');
    await symlink(path.join(outside, 'secretdir'), path.join(root, 'escape-dir'));
    await symlink(path.join(outside, 'secret.txt'), path.join(root, 'escape-file'));
    // A symlink that stays inside the workspace is still listed (resolved kind).
    await mkdir(path.join(root, 'realdir'));
    await symlink(path.join(root, 'realdir'), path.join(root, 'inside-link'));
    await writeFile(path.join(root, 'plain.txt'), 'x');

    const r = await listDir(root);
    const names = r.entries.map((e) => e.name).sort();
    // Escaping symlinks are dropped; in-tree entries (incl. in-tree symlink) remain.
    expect(names).toEqual(['inside-link', 'plain.txt', 'realdir']);
    expect(r.entries.find((e) => e.name === 'inside-link')?.kind).toBe('dir');
  });

  it('reveals hidden entries once the user is already inside a hidden path', async () => {
    await mkdir(path.join(root, '.config'));
    await writeFile(path.join(root, '.config', '.secretrc'), 'x');
    await writeFile(path.join(root, '.config', 'plain.txt'), 'x');

    const r = await listDir(root, '.config');
    const names = r.entries.map((e) => e.name).sort();
    expect(names).toEqual(['.secretrc', 'plain.txt']);
  });
});
