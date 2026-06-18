import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

import { isRepo, status, diff } from './git';

let tmp: string;

function run(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function initRepo(cwd: string): void {
  run(cwd, 'init', '-q');
  run(cwd, 'config', 'user.email', 't@t.com');
  run(cwd, 'config', 'user.name', 'tester');
  run(cwd, 'config', 'commit.gpgsign', 'false');
}

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'git-helpers-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('isRepo', () => {
  it('returns false outside a work tree', async () => {
    expect(await isRepo(tmp)).toBe(false);
  });

  it('returns true inside a work tree', async () => {
    initRepo(tmp);
    expect(await isRepo(tmp)).toBe(true);
  });
});

describe('status', () => {
  it('returns an empty list for a non-repo (degrades, never throws)', async () => {
    await expect(status(tmp)).resolves.toEqual([]);
  });

  it('reports an untracked file with the ?? code', async () => {
    initRepo(tmp);
    writeFileSync(path.join(tmp, 'new.txt'), 'hello\n');
    const files = await status(tmp);
    expect(files).toEqual([{ path: 'new.txt', status: '??' }]);
  });

  it('reports a modified tracked file', async () => {
    initRepo(tmp);
    writeFileSync(path.join(tmp, 'a.txt'), 'one\n');
    run(tmp, 'add', 'a.txt');
    run(tmp, 'commit', '-qm', 'init');
    writeFileSync(path.join(tmp, 'a.txt'), 'two\n');
    const files = await status(tmp);
    expect(files).toEqual([{ path: 'a.txt', status: ' M' }]);
  });

  it('preserves paths with spaces (NUL-delimited parse)', async () => {
    initRepo(tmp);
    writeFileSync(path.join(tmp, 'with space.txt'), 'x\n');
    const files = await status(tmp);
    expect(files).toEqual([{ path: 'with space.txt', status: '??' }]);
  });

  it('emits ONE ChangedFile for a staged rename — no phantom old-path entry', async () => {
    // Regression for u56-2: `-z` encodes a rename as `R  new\0old\0`; the old
    // path must be consumed, not parsed into a phantom `{ status: 'a.', ... }`.
    initRepo(tmp);
    writeFileSync(path.join(tmp, 'old-name.txt'), 'content\n');
    run(tmp, 'add', 'old-name.txt');
    run(tmp, 'commit', '-qm', 'init');
    run(tmp, 'mv', 'old-name.txt', 'new-name.txt');
    const files = await status(tmp);
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe('new-name.txt');
    expect(files[0]?.status[0]).toBe('R');
    // The old path must not surface as its own (phantom) entry.
    expect(files.some((f) => f.path === 'old-name.txt')).toBe(false);
    expect(files.some((f) => f.path === 'xt')).toBe(false);
  });
});

describe('diff', () => {
  it('returns a unified diff for a modified tracked file', async () => {
    initRepo(tmp);
    writeFileSync(path.join(tmp, 'a.txt'), 'one\n');
    run(tmp, 'add', 'a.txt');
    run(tmp, 'commit', '-qm', 'init');
    writeFileSync(path.join(tmp, 'a.txt'), 'two\n');
    const result = await diff(tmp, 'a.txt');
    expect(result.path).toBe('a.txt');
    expect(result.diff).toContain('-one');
    expect(result.diff).toContain('+two');
    expect(result.truncated).toBe(false);
  });

  it('diffs an untracked file against the null device (new-file diff)', async () => {
    initRepo(tmp);
    writeFileSync(path.join(tmp, 'fresh.txt'), 'brand new\n');
    const result = await diff(tmp, 'fresh.txt');
    expect(result.path).toBe('fresh.txt');
    expect(result.diff).toContain('new file');
    expect(result.diff).toContain('+brand new');
  });

  it('truncates a diff that exceeds the byte cap', async () => {
    initRepo(tmp);
    const big = 'x'.repeat(2_000_000) + '\n';
    writeFileSync(path.join(tmp, 'big.txt'), big);
    const result = await diff(tmp, 'big.txt');
    expect(result.truncated).toBe(true);
    expect(result.diff.length).toBeLessThanOrEqual(1_000_000);
  });
});
