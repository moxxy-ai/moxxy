import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pack as tarPack } from 'tar-stream';

import { extractTarBz2, safeEntryPath } from './extract.js';

/** Whether an executable is runnable (fixtures need system tar + bzip2). */
function have(cmd: string): boolean {
  try {
    execFileSync(cmd, ['--help'], { stdio: 'ignore' });
    return true;
  } catch {
    // bzip2 exits non-zero for --help on some platforms but is still present.
    try {
      execFileSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
}

const FIXTURES_OK = process.platform !== 'win32' && have('tar') && have('bzip2');

let root: string;
let goodArchive: string;
let symlinkArchive: string;
let traversalArchive: string;

beforeAll(async () => {
  if (!FIXTURES_OK) return;
  root = await mkdtemp(path.join(tmpdir(), 'extract-fix-'));

  // A benign tree → payload/{a.txt, sub/b.txt}
  const treeBase = path.join(root, 'tree');
  await mkdir(path.join(treeBase, 'payload', 'sub'), { recursive: true });
  await writeFile(path.join(treeBase, 'payload', 'a.txt'), 'alpha');
  await writeFile(path.join(treeBase, 'payload', 'sub', 'b.txt'), 'beta');
  goodArchive = path.join(root, 'good.tar.bz2');
  execFileSync('tar', ['-cjf', goodArchive, '-C', treeBase, 'payload']);

  // A tree containing a symlink that escapes the destination.
  const symBase = path.join(root, 'symtree');
  await mkdir(symBase, { recursive: true });
  await symlink('/etc/passwd', path.join(symBase, 'evil'));
  await writeFile(path.join(symBase, 'ok.txt'), 'fine');
  symlinkArchive = path.join(root, 'sym.tar.bz2');
  execFileSync('tar', ['-cjf', symlinkArchive, '-C', symBase, '.']);

  // A hand-packed tar whose entry name traverses out of the destination.
  const tarPath = path.join(root, 'traversal.tar');
  await new Promise<void>((resolve, reject) => {
    const p = tarPack();
    const out = createWriteStream(tarPath);
    out.on('finish', () => resolve());
    out.on('error', reject);
    p.on('error', reject);
    p.pipe(out);
    p.entry({ name: '../escape.txt' }, 'pwned');
    p.finalize();
  });
  execFileSync('bzip2', ['-f', tarPath]);
  traversalArchive = `${tarPath}.bz2`;
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe('safeEntryPath', () => {
  const base = path.resolve('/tmp/dest');
  it('resolves a nested relative entry under the root', () => {
    expect(safeEntryPath(base, 'payload/sub/b.txt')).toBe(path.join(base, 'payload/sub/b.txt'));
  });
  it('rejects an absolute entry', () => {
    expect(() => safeEntryPath(base, '/etc/passwd')).toThrow(/absolute/);
  });
  it('rejects a `..` traversal', () => {
    expect(() => safeEntryPath(base, '../escape.txt')).toThrow(/\.\./);
    expect(() => safeEntryPath(base, 'a/../../escape')).toThrow(/\.\./);
  });
  it('rejects a NUL byte', () => {
    expect(() => safeEntryPath(base, 'a\0b')).toThrow(/NUL/);
  });
  it('rejects a Windows drive-absolute entry', () => {
    expect(() => safeEntryPath(base, 'C:\\evil')).toThrow(/absolute/);
  });
});

describe.skipIf(!FIXTURES_OK)('extractTarBz2 (fixture-driven)', () => {
  it('extracts a benign archive and cleans up the temp dir', async () => {
    const dest = path.join(root, 'out-good');
    const phases: string[] = [];
    await extractTarBz2(goodArchive, dest, { onProgress: (p) => phases.push(p.phase) });
    expect(await readFile(path.join(dest, 'payload', 'a.txt'), 'utf8')).toBe('alpha');
    expect(await readFile(path.join(dest, 'payload', 'sub', 'b.txt'), 'utf8')).toBe('beta');
    expect(phases.at(-1)).toBe('done');
    // No leftover .extracting-* temp beside the destination.
    const siblings = await readdir(root);
    expect(siblings.some((n) => n.includes('.extracting-'))).toBe(false);
  });

  it('refuses a symlink entry (would escape the destination)', async () => {
    const dest = path.join(root, 'out-sym');
    await expect(extractTarBz2(symlinkArchive, dest, {})).rejects.toMatchObject({
      code: 'UNSAFE_ENTRY',
    });
    // The destination was never published (temp cleaned).
    await expect(readdir(dest)).rejects.toThrow();
  });

  it('refuses a `..` traversal entry', async () => {
    const dest = path.join(root, 'out-traversal');
    await expect(extractTarBz2(traversalArchive, dest, {})).rejects.toMatchObject({
      code: 'UNSAFE_ENTRY',
    });
    // The traversal target must NOT have been written outside the destination.
    await expect(readFile(path.join(root, 'escape.txt'), 'utf8')).rejects.toThrow();
  });
});
