/**
 * Confinement guard for the workspace file browser (`readFile` / `listDir`).
 *
 * This is the primary defense against a hostile renderer reading out-of-
 * workspace files: `resolveInside` rejects `..` / absolute paths AND a symlink
 * inside the root that points out of it, and the read gates a binary / oversized
 * file behind a `confirm`. The routing test (`workspace-fs.test.ts`) covers
 * cwd selection; this one locks the security-critical worst-case paths so a
 * "simplification" of resolveInside can't silently reopen arbitrary read.
 */

import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ ipcMain: { handle: () => undefined } }));

import { listDir, readFile } from '../workspace-fs';

describe('workspace-fs confinement guard', () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'wsfs-root-'));
    outside = mkdtempSync(path.join(tmpdir(), 'wsfs-out-'));
    mkdirSync(path.join(root, 'sub'), { recursive: true });
    writeFileSync(path.join(root, 'sub', 'a.txt'), 'inside\n');
    writeFileSync(path.join(outside, 'secret.txt'), 'TOP SECRET\n');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  describe('readFile', () => {
    it('reads a plain text file inside the workspace', async () => {
      const res = await readFile(root, 'sub/a.txt');
      expect(res.kind).toBe('text');
      expect(res.content).toBe('inside\n');
    });

    it('throws on a "../" traversal that escapes the workspace', async () => {
      const rel = path.join('..', path.basename(outside), 'secret.txt');
      await expect(readFile(root, rel)).rejects.toThrow(/escapes the workspace/);
    });

    it('throws on an absolute path outside the workspace', async () => {
      await expect(readFile(root, path.join(outside, 'secret.txt'))).rejects.toThrow(
        /escapes the workspace/,
      );
    });

    it('refuses a symlink inside the root that points out of it', async () => {
      symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'));
      await expect(readFile(root, 'link.txt')).rejects.toThrow(/escapes the workspace.*symlink/);
    });

    it('returns a binary-confirm for a NUL-containing file', async () => {
      writeFileSync(path.join(root, 'bin.dat'), Buffer.from([0x41, 0x00, 0x42, 0x00]));
      const res = await readFile(root, 'bin.dat');
      expect(res.kind).toBe('confirm');
      expect(res.reason).toBe('binary');
    });

    it('force=true overrides the binary confirm and returns text', async () => {
      writeFileSync(path.join(root, 'bin.dat'), Buffer.from([0x41, 0x00, 0x42, 0x00]));
      const res = await readFile(root, 'bin.dat', { force: true });
      expect(res.kind).toBe('text');
    });

    it('returns a large-confirm for a text file over the confirm threshold', async () => {
      // > CONFIRM_BYTES (2_000_000) of NUL-free text → reason 'large', not read.
      writeFileSync(path.join(root, 'big.txt'), 'a'.repeat(2_000_001));
      const res = await readFile(root, 'big.txt');
      expect(res.kind).toBe('confirm');
      expect(res.reason).toBe('large');
    });
  });

  describe('listDir', () => {
    it('lists entries within the workspace root', async () => {
      const res = await listDir(root, 'sub');
      expect(res.entries.map((e) => e.name)).toContain('a.txt');
    });

    it('throws on a "../" escape to a directory outside the root', async () => {
      const rel = path.join('..', path.basename(outside));
      await expect(listDir(root, rel)).rejects.toThrow(/escapes the workspace/);
    });

    it('drops a symlinked subdir that points out of the workspace', async () => {
      symlinkSync(outside, path.join(root, 'escape'));
      const res = await listDir(root, '.');
      expect(res.entries.map((e) => e.name)).not.toContain('escape');
    });
  });
});
