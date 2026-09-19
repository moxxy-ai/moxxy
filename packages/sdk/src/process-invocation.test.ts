import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  executableCandidates,
  execExecutableTargetSync,
  findExecutable,
  resolveExecutableTarget,
  spawnExecutableTarget,
} from './process-invocation.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'moxxy-process-invocation-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function put(relative: string, body = ''): string {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
  chmodSync(file, 0o755);
  return file;
}

describe('executableCandidates', () => {
  it('uses PATHEXT order on Windows and never selects an extensionless Unix shim', () => {
    expect(executableCandidates('moxxy', 'win32', '.EXE;.CMD;.PS1')).toEqual([
      'moxxy.exe',
      'moxxy.cmd',
      'moxxy.ps1',
    ]);
  });

  it('keeps a caller-supplied extension verbatim and uses bare names off Windows', () => {
    expect(executableCandidates('npm.cmd', 'win32', '.EXE;.CMD')).toEqual(['npm.cmd']);
    expect(executableCandidates('npm', 'linux')).toEqual(['npm']);
  });
});

describe('findExecutable', () => {
  it('ignores an extensionless Windows shim and finds the first PATHEXT candidate', () => {
    put('moxxy', 'a Unix npm shim');
    const command = put('moxxy.cmd', '@echo off');

    expect(
      findExecutable('moxxy', [], {
        platform: 'win32',
        pathEnv: root,
        pathext: '.EXE;.CMD',
      }),
    ).toBe(command);
  });
});

describe('resolveExecutableTarget', () => {
  it('maps npm.cmd to npm-cli.js and runs it through Node without a shell', () => {
    put('npm.cmd', '@echo off');
    const npmCli = put(
      path.join('node_modules', 'npm', 'bin', 'npm-cli.js'),
      'process.stdout.write(JSON.stringify(process.argv.slice(2)))',
    );
    const args = ['install', '--prefix', path.join(root, 'A&B workspace'), 'pkg@1.2.3'];

    const target = resolveExecutableTarget('npm', {
      platform: 'win32',
      pathEnv: root,
      pathext: '.CMD',
      nodeCommand: process.execPath,
    });

    expect(target).toEqual({
      kind: 'node',
      command: process.execPath,
      entry: npmCli,
      env: {},
    });
    expect(target).not.toBeNull();
    if (!target) throw new Error('npm target must resolve');

    const child = spawnSync(
      target.command,
      target.kind === 'node' ? [target.entry, ...args] : args,
      { encoding: 'utf8', env: process.env },
    );
    expect(child.status).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual(args);
  });

  it('recognizes an explicitly supplied Windows launcher case-insensitively', () => {
    const shim = put('NPM.CMD', '@echo off');
    const entry = put(path.join('node_modules', 'npm', 'bin', 'npm-cli.js'));

    expect(
      resolveExecutableTarget(shim, {
        platform: 'win32',
        nodeCommand: process.execPath,
      }),
    ).toMatchObject({ kind: 'node', entry });
  });

  it('maps a global moxxy.cmd to the installed CLI JavaScript entry', () => {
    put('moxxy.cmd', '@echo off');
    const entry = put(path.join('node_modules', '@moxxy', 'cli', 'dist', 'bin.js'));

    expect(
      resolveExecutableTarget('moxxy', {
        platform: 'win32',
        pathEnv: root,
        pathext: '.CMD',
        nodeCommand: 'C:\\Moxxy\\Moxxy.exe',
        electron: true,
      }),
    ).toEqual({
      kind: 'node',
      command: 'C:\\Moxxy\\Moxxy.exe',
      entry,
      env: { ELECTRON_RUN_AS_NODE: '1' },
    });
  });

  it('maps a project-local node_modules/.bin/moxxy.cmd to its sibling package', () => {
    const project = path.join(root, 'project');
    const binDir = path.join(project, 'node_modules', '.bin');
    mkdirSync(binDir, { recursive: true });
    writeFileSync(path.join(binDir, 'moxxy.cmd'), '@echo off');
    const entry = path.join(project, 'node_modules', '@moxxy', 'cli', 'dist', 'bin.js');
    mkdirSync(path.dirname(entry), { recursive: true });
    writeFileSync(entry, '');

    expect(
      resolveExecutableTarget('moxxy', {
        platform: 'win32',
        pathEnv: binDir,
        pathext: '.CMD',
      }),
    ).toMatchObject({ kind: 'node', entry });
  });

  it('maps pnpm.cmd and yarn.cmd to Corepack JavaScript entrypoints', () => {
    put('pnpm.cmd', '@echo off');
    put('yarn.cmd', '@echo off');
    const pnpmEntry = put(path.join('node_modules', 'corepack', 'dist', 'pnpm.js'));
    const yarnEntry = put(path.join('node_modules', 'corepack', 'dist', 'yarn.js'));
    const options = {
      platform: 'win32' as const,
      pathEnv: root,
      pathext: '.CMD',
      nodeCommand: process.execPath,
    };

    expect(resolveExecutableTarget('pnpm', options)).toMatchObject({
      kind: 'node',
      entry: pnpmEntry,
    });
    expect(resolveExecutableTarget('yarn', options)).toMatchObject({
      kind: 'node',
      entry: yarnEntry,
    });
  });

  it('accepts an explicit non-adjacent entrypoint for a known Windows launcher', () => {
    put('pnpm.cmd', '@echo off');
    const entry = put(path.join('tools', 'pnpm', 'bin', 'pnpm.cjs'));

    expect(
      resolveExecutableTarget('pnpm', {
        platform: 'win32',
        pathEnv: root,
        pathext: '.CMD',
        nodeEntryHint: entry,
      }),
    ).toMatchObject({ kind: 'node', entry });
  });

  it('fails clearly instead of passing an unknown .cmd file through a shell', () => {
    put('custom.cmd', '@echo off');

    expect(() =>
      resolveExecutableTarget('custom', {
        platform: 'win32',
        pathEnv: root,
        pathext: '.CMD',
      }),
    ).toThrow(/refusing to execute unknown Windows command shim.*custom\.cmd/i);
  });

  it('fails clearly when a known shim has no matching JavaScript entry', () => {
    const shim = put('npm.cmd', '@echo off');

    expect(() =>
      resolveExecutableTarget('npm', {
        platform: 'win32',
        pathEnv: root,
        pathext: '.CMD',
      }),
    ).toThrow(new RegExp(`cannot resolve npm JavaScript entry.*${path.basename(shim)}`, 'i'));
  });

  it('runs native Windows executables directly', () => {
    const executable = put('bun.exe');

    expect(
      resolveExecutableTarget('bun', {
        platform: 'win32',
        pathEnv: root,
        pathext: '.EXE;.CMD',
      }),
    ).toEqual({ kind: 'direct', command: executable });
  });
});

describe('spawnExecutableTarget', () => {
  it('prepends the mapped JavaScript entry and preserves each caller argument', () => {
    const entry = put(
      'cli.js',
      'process.stdout.write(JSON.stringify(process.argv.slice(2)))',
    );
    const target = {
      kind: 'node' as const,
      command: process.execPath,
      entry,
      env: {},
    };
    const args = ['one argument', 'A&B', 'value|still-one-argv'];

    const child = spawnExecutableTarget(target, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });

    return new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) => {
        try {
          expect(code).toBe(0);
          expect(JSON.parse(stdout)).toEqual(args);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  });

  it('runs a mapped target synchronously while preserving argv boundaries', () => {
    const entry = put(
      'sync-cli.js',
      "require('node:fs').writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)))",
    );
    const observed = path.join(root, 'sync-argv.json');
    const args = [observed, 'A&B', 'two words', 'still|one'];

    execExecutableTargetSync(
      { kind: 'node', command: process.execPath, entry, env: {} },
      args,
      { stdio: 'ignore' },
    );

    expect(JSON.parse(readFileSync(observed, 'utf8'))).toEqual(args.slice(1));
  });
});
