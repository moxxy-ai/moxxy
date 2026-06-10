import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync, realpathSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  resolveMoxxyCli,
  executableCandidates,
  augmentedPaths,
  electronNodeBinary,
  findExecutable,
} from './cli-resolver';

let tmp: string;
const originalEnv = { ...process.env };

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'cli-resolver-'));
  process.env = { ...originalEnv };
  process.env.PATH = tmp;
  process.env.HOME = tmp;
  delete process.env.MOXXY_CLI_ENTRY;
  process.chdir(tmp);
});

afterEach(() => {
  process.chdir(originalCwd);
});

const originalCwd = process.cwd();

afterEach(() => {
  process.env = originalEnv;
}, 0);

describe('resolveMoxxyCli', () => {
  it('returns null when nothing is found', () => {
    expect(resolveMoxxyCli()).toBeNull();
  });

  it('prefers MOXXY_CLI_ENTRY when set to an existing file', () => {
    const bin = path.join(tmp, 'bin.js');
    writeFileSync(bin, '#!/usr/bin/env node\nconsole.log("hi")');
    process.env.MOXXY_CLI_ENTRY = bin;
    const result = resolveMoxxyCli();
    expect(result).toEqual({ kind: 'node', entry: bin });
  });

  it('ignores MOXXY_CLI_ENTRY when the file does not exist', () => {
    process.env.MOXXY_CLI_ENTRY = path.join(tmp, 'no-such-file.js');
    // Fall through. With nothing else on PATH, null is the right answer.
    expect(resolveMoxxyCli()).toBeNull();
  });

  it('finds moxxy on PATH and returns a `direct` invocation', () => {
    const bin = path.join(tmp, 'moxxy');
    writeFileSync(bin, '#!/bin/sh\necho moxxy\n');
    chmodSync(bin, 0o755);
    const result = resolveMoxxyCli();
    expect(result).toEqual({ kind: 'direct', bin });
  });

  it('walks the monorepo tree to packages/cli/dist/bin.js', () => {
    const repoRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'fakemonorepo-')));
    const cliDist = path.join(repoRoot, 'packages', 'cli', 'dist');
    mkdirSync(cliDist, { recursive: true });
    const bin = path.join(cliDist, 'bin.js');
    writeFileSync(bin, '// moxxy cli');
    const restoreCwd = process.cwd();
    process.chdir(repoRoot);
    try {
      const result = resolveMoxxyCli();
      expect(result).toEqual({ kind: 'node', entry: bin });
    } finally {
      process.chdir(restoreCwd);
    }
  });

  it('walks the monorepo tree from nested cwd', () => {
    const repoRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'nestedmonorepo-')));
    const cliDist = path.join(repoRoot, 'packages', 'cli', 'dist');
    mkdirSync(cliDist, { recursive: true });
    const bin = path.join(cliDist, 'bin.js');
    writeFileSync(bin, '// moxxy cli');
    const nested = path.join(repoRoot, 'apps', 'desktop', 'electron', 'main');
    mkdirSync(nested, { recursive: true });
    const restoreCwd = process.cwd();
    process.chdir(nested);
    try {
      const result = resolveMoxxyCli();
      expect(result).toEqual({ kind: 'node', entry: bin });
    } finally {
      process.chdir(restoreCwd);
    }
  });

  it.skipIf(process.platform === 'win32')('skips non-files on PATH', () => {
    // A directory under PATH named `moxxy` shouldn't match.
    const fake = path.join(tmp, 'moxxy');
    mkdirSync(fake);
    expect(resolveMoxxyCli()).toBeNull();
  });

  it('MOXXY_CLI_ENTRY overrides PATH', () => {
    const onPath = path.join(tmp, 'moxxy');
    writeFileSync(onPath, '#!/bin/sh\necho path\n');
    chmodSync(onPath, 0o755);

    const override = path.join(tmp, 'override.js');
    writeFileSync(override, '// override');
    process.env.MOXXY_CLI_ENTRY = override;

    expect(resolveMoxxyCli()).toEqual({ kind: 'node', entry: override });
  });
});

describe('vi sanity', () => {
  it('preserves environment between tests', () => {
    process.env.PATH = '/foo';
    expect(process.env.PATH).toBe('/foo');
    vi.restoreAllMocks();
  });
});

describe('executableCandidates (Windows .exe / PATHEXT resolution)', () => {
  it('returns just the bare name off Windows', () => {
    expect(executableCandidates('node', 'linux')).toEqual(['node']);
    expect(executableCandidates('node', 'darwin')).toEqual(['node']);
  });

  it('expands to PATHEXT variants on Windows (so node → node.exe, npm → npm.cmd)', () => {
    const got = executableCandidates('node', 'win32', '.COM;.EXE;.BAT;.CMD');
    expect(got).toEqual(['node', 'node.com', 'node.exe', 'node.bat', 'node.cmd']);
    expect(executableCandidates('npm', 'win32', '.EXE;.CMD')).toContain('npm.cmd');
  });

  it('falls back to a default PATHEXT when the env var is absent', () => {
    expect(executableCandidates('node', 'win32', undefined)).toContain('node.exe');
  });

  it('uses an already-extensioned name verbatim', () => {
    expect(executableCandidates('node.exe', 'win32')).toEqual(['node.exe']);
  });
});

describe('augmentedPaths', () => {
  it('includes the standard Windows Node install dirs (stale-PATH re-check)', () => {
    process.env['ProgramFiles'] = 'C:\\Program Files';
    process.env.LOCALAPPDATA = 'C:\\Users\\me\\AppData\\Local';
    const paths = augmentedPaths('win32');
    expect(paths).toContain(path.join('C:\\Program Files', 'nodejs'));
    expect(paths).toContain(path.join('C:\\Users\\me\\AppData\\Local', 'Programs', 'nodejs'));
  });

  it('includes the homebrew/usr-local dirs on macOS', () => {
    expect(augmentedPaths('darwin')).toEqual(expect.arrayContaining(['/opt/homebrew/bin']));
  });

  it('adds no platform dirs on linux', () => {
    delete process.env.HOME;
    expect(augmentedPaths('linux')).toEqual([]);
  });
});

describe('findExecutable', () => {
  it('finds a bare-name binary in an extra dir (POSIX)', () => {
    if (process.platform === 'win32') return; // bare name only resolves off Windows
    const bin = path.join(tmp, 'mybin');
    writeFileSync(bin, '#!/bin/sh\necho v1');
    chmodSync(bin, 0o755);
    const found = findExecutable('mybin', [tmp]);
    expect(found && path.basename(found)).toBe('mybin');
  });

  it('returns null when the binary is absent', () => {
    expect(findExecutable('definitely-not-here', [tmp])).toBeNull();
  });
});

describe('electronNodeBinary (macOS Helper substitution for run-as-node children)', () => {
  const bundleExec = path.join('/Applications', 'My App.app', 'Contents', 'MacOS', 'My App');
  const helperExec = path.join(
    '/Applications',
    'My App.app',
    'Contents',
    'Frameworks',
    'My App Helper.app',
    'Contents',
    'MacOS',
    'My App Helper',
  );

  it('prefers the LSUIElement Helper binary when execPath is inside a bundle and the helper exists', () => {
    expect(electronNodeBinary(bundleExec, 'darwin', (p) => p === helperExec)).toBe(helperExec);
  });

  it('falls back to execPath when the helper binary is missing', () => {
    expect(electronNodeBinary(bundleExec, 'darwin', () => false)).toBe(bundleExec);
  });

  it('leaves non-bundle paths alone on darwin', () => {
    const bare = path.join('/usr', 'local', 'bin', 'electron');
    expect(electronNodeBinary(bare, 'darwin', () => true)).toBe(bare);
  });

  it('never substitutes on linux or windows', () => {
    expect(electronNodeBinary(bundleExec, 'linux', () => true)).toBe(bundleExec);
    const winExec = path.join('C:', 'Apps', 'My App.app', 'Contents', 'MacOS', 'My App');
    expect(electronNodeBinary(winExec, 'win32', () => true)).toBe(winExec);
  });
});
