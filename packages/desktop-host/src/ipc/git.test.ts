/**
 * git.diff path-confinement guard. The renderer-supplied diff target flows into
 * `git diff --no-index`, which would otherwise read ANY filesystem path; this
 * suite locks the worst-case rejections so a future refactor can't silently
 * reopen arbitrary-file-read through the diff viewer.
 */

import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// shared.ts (imported transitively) touches electron; importing it must not
// require the GUI binary.
vi.mock('electron', () => ({ ipcMain: { handle: () => undefined } }));

import { confineDiffPath } from './git';

describe('confineDiffPath', () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'gitdiff-root-'));
    outside = mkdtempSync(path.join(tmpdir(), 'gitdiff-out-'));
    mkdirSync(path.join(root, 'sub'), { recursive: true });
    writeFileSync(path.join(root, 'sub', 'a.txt'), 'inside\n');
    writeFileSync(path.join(outside, 'secret.txt'), 'TOP SECRET\n');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('returns a repo-relative path for a file inside the workspace', async () => {
    expect(await confineDiffPath(root, 'sub/a.txt')).toBe(path.join('sub', 'a.txt'));
  });

  it('rejects a "../" traversal that escapes the workspace', async () => {
    const rel = path.join('..', path.basename(outside), 'secret.txt');
    await expect(confineDiffPath(root, rel)).rejects.toThrow(/escapes the workspace/);
  });

  it('rejects an absolute path outside the workspace', async () => {
    await expect(confineDiffPath(root, path.join(outside, 'secret.txt'))).rejects.toThrow(
      /escapes the workspace/,
    );
  });

  it('rejects a symlink inside the workspace that points outside it', async () => {
    symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'));
    await expect(confineDiffPath(root, 'link.txt')).rejects.toThrow(/escapes the workspace.*symlink/);
  });

  it('rejects an empty or oversized path', async () => {
    await expect(confineDiffPath(root, '')).rejects.toThrow(/invalid diff path/);
    await expect(confineDiffPath(root, 'x'.repeat(4097))).rejects.toThrow(/invalid diff path/);
  });

  it('rejects a non-string path (untrusted transport with no schema)', async () => {
    // git.diff has no validation.ts schema, so the handler is the only guard.
    await expect(confineDiffPath(root, undefined as unknown as string)).rejects.toThrow(
      /invalid diff path/,
    );
  });

  it('allows a not-yet-existing file inside the root (untracked/new)', async () => {
    expect(await confineDiffPath(root, 'sub/new.txt')).toBe(path.join('sub', 'new.txt'));
  });
});
