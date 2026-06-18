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

  it('gates a NUL-byte file behind a binary confirm, then forces it to text', async () => {
    await writeFile(path.join(root, 'data.bin'), Buffer.from([1, 2, 0, 3, 4]));
    const r = await readFile(root, 'data.bin');
    expect(r.kind).toBe('confirm');
    expect(r.reason).toBe('binary');
    expect(r.text).toBe(false);
    // …and `force` decodes it as text anyway.
    const forced = await readFile(root, 'data.bin', { force: true });
    expect(forced.kind).toBe('text');
    expect(forced.text).toBe(true);
  });

  it('gates a very large file behind a large confirm', async () => {
    // Just over CONFIRM_BYTES (2MB) but not binary.
    await writeFile(path.join(root, 'huge.txt'), 'a'.repeat(2_000_050));
    const r = await readFile(root, 'huge.txt');
    expect(r.kind).toBe('confirm');
    expect(r.reason).toBe('large');
  });

  it('returns an image inline as base64', async () => {
    // Minimal 1×1 PNG header is enough to exercise the image branch by ext.
    await writeFile(path.join(root, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
    const r = await readFile(root, 'pic.png');
    expect(r.kind).toBe('image');
    expect(r.mediaType).toBe('image/png');
    expect(typeof r.base64).toBe('string');
  });

  it('returns a pdf inline as base64', async () => {
    await writeFile(path.join(root, 'doc.pdf'), Buffer.from('%PDF-1.4\n...'));
    const r = await readFile(root, 'doc.pdf');
    expect(r.kind).toBe('pdf');
    expect(r.mediaType).toBe('application/pdf');
    expect(typeof r.base64).toBe('string');
  });

  it('previews an Office/ODF doc as its extracted text, not raw bytes', async () => {
    // RTF is an Office-family format parseBufferToText handles dependency-free,
    // so it exercises the office-text branch without needing a real .docx zip.
    const rtf = '{\\rtf1\\ansi\\deff0 Hello \\b Jane Doe\\b0 from Berlin.\\par}';
    await writeFile(path.join(root, 'memo.rtf'), rtf);
    const r = await readFile(root, 'memo.rtf');
    expect(r.kind).toBe('text');
    expect(r.text).toBe(true);
    expect(r.content).toContain('Hello Jane Doe from Berlin');
    // No RTF control words leak into the preview.
    expect(r.content).not.toMatch(/\\rtf1|\\par/);
  });

  it('confirms (no preview) for an Office doc with no extractable text', async () => {
    // A .docx that is not a valid zip → no text → a clear confirm, not garbage.
    await writeFile(path.join(root, 'broken.docx'), Buffer.from('PK\x03\x04 not a real docx'));
    const r = await readFile(root, 'broken.docx');
    expect(r.kind).toBe('confirm');
    expect(r.reason).toBe('binary');
  });

  it('returns empty text for a non-file path', async () => {
    await mkdir(path.join(root, 'adir'));
    const r = await readFile(root, 'adir');
    expect(r.content).toBe('');
    expect(r.kind).toBe('text');
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
