import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { findGitBash, msysPathList, shellFor, spawnShell, systemShell, withPathFirst, type Shell } from './shell.js';
import { removeDirSync } from '@moxxy/vitest-preset/fs';

function run(command: string, env: Record<string, string>, shell?: Shell): Promise<{ out: string; err: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawnShell(command, { cwd: tmpdir(), env, ...(shell ? { shell } : {}) });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { err += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ out, err, code }));
  });
}
const output = async (command: string, env: Record<string, string>, shell?: Shell) => (await run(command, env, shell)).out;

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) removeDirSync(dir);
});

/** A folder of empty files, for the lookups that only ask whether a file is there. */
function tree(files: string[]): string {
  const root = mkdtempSync(path.join(tmpdir(), 'moxxy shell-'));
  made.push(root);
  for (const file of files) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), '');
  }
  return root;
}

describe('withPathFirst', () => {
  it('leaves a command alone when the host names no folders', () => {
    expect(withPathFirst('echo hi', undefined)).toBe('echo hi');
    expect(withPathFirst('echo hi', '')).toBe('echo hi');
  });

  it('puts the folders back in front, quoted so a path with spaces or a quote stays one word', () => {
    expect(withPathFirst('echo hi', "/Users/it's me/py/bin:/opt/x")).toBe(`export PATH='/Users/it'\\''s me/py/bin:/opt/x':"$PATH"\necho hi`);
  });
});

describe('msysPathList', () => {
  it('spells a Windows PATH list the way Git Bash does', () => {
    expect(msysPathList(String.raw`C:\Users\it's me\py;D:\tools\bin;;\\server\share\bin`)).toBe(
      "/c/Users/it's me/py:/d/tools/bin://server/share/bin",
    );
  });
});

describe('findGitBash', () => {
  it('finds the bash of the Git on PATH', () => {
    const git = tree(['Git/cmd/git.exe', 'Git/bin/bash.exe']);
    expect(findGitBash({ PATH: path.join(git, 'Git', 'cmd') })).toBe(path.join(git, 'Git', 'bin', 'bash.exe'));
  });

  it('finds it when PATH names the Git inside mingw64', () => {
    const git = tree(['Git/mingw64/bin/git.exe', 'Git/bin/bash.exe']);
    expect(findGitBash({ PATH: path.join(git, 'Git', 'mingw64', 'bin') })).toBe(path.join(git, 'Git', 'bin', 'bash.exe'));
  });

  it('looks where the Git installer puts it when Git is not on PATH', () => {
    const programs = tree(['Git/bin/bash.exe']);
    expect(findGitBash({ PATH: '', ProgramFiles: programs })).toBe(path.join(programs, 'Git', 'bin', 'bash.exe'));
  });

  it('takes the bash named in MOXXY_GIT_BASH first', () => {
    const own = tree(['tools/bash.exe', 'Git/bin/bash.exe']);
    expect(findGitBash({ MOXXY_GIT_BASH: path.join(own, 'tools', 'bash.exe'), ProgramFiles: own })).toBe(
      path.join(own, 'tools', 'bash.exe'),
    );
  });

  // C:\Windows\System32\bash.exe starts WSL: a Linux machine with its own files and paths.
  it('never takes a bash.exe that is only on PATH, without Git beside it', () => {
    const wsl = tree(['System32/bash.exe']);
    expect(findGitBash({ PATH: path.join(wsl, 'System32') })).toBeNull();
  });
});

describe('shellFor', () => {
  it('runs /bin/sh off Windows', () => {
    expect(shellFor('linux', {}).kind).toBe('sh');
    expect(shellFor('darwin', {}).file).toBe('/bin/sh');
  });

  it('runs Git Bash on Windows when Git is installed', () => {
    const programs = tree(['Git/bin/bash.exe']);
    const shell = shellFor('win32', { PATH: '', ProgramFiles: programs });
    expect(shell).toMatchObject({ kind: 'git-bash', file: path.join(programs, 'Git', 'bin', 'bash.exe') });
  });

  it('falls back to Windows PowerShell on a Windows machine without Git', () => {
    const shell = shellFor('win32', { PATH: '', SystemRoot: 'C:\\Windows' });
    expect(shell).toMatchObject({ kind: 'powershell', file: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' });
  });
});

describe.skipIf(process.platform === 'win32')('spawnShell under /bin/sh', () => {
  it('keeps the folders the host put first ahead of the system ones, which a login shell moves to the front', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'moxxy path first-'));
    try {
      const shown = await output('printf %s "$PATH"', { MOXXY_PATH_FIRST: dir, PATH: `${dir}:/usr/bin:/bin` });
      expect(shown.split(':')[0]).toBe(dir);
    } finally {
      removeDirSync(dir);
    }
  });

  it('runs the command unchanged when the host names no folders', async () => {
    expect(await output('printf %s "$0"', { MOXXY_PATH_FIRST: '' })).toBe('/bin/sh');
  });
});

const gitBash = process.platform === 'win32' && systemShell().kind === 'git-bash';

describe.runIf(gitBash)('spawnShell under Git Bash', () => {
  it('passes quotes, backslashes and non-ASCII text through unchanged', async () => {
    const shown = await output(String.raw`printf '%s|' "a\"b" 'C:\Users\x' "zażółć"`, {});
    expect(shown).toBe(String.raw`a"b|C:\Users\x|zażółć|`);
  });

  it('puts the folders the host names first on PATH', async () => {
    const first = tree(['bin/marker.txt']);
    const dir = path.join(first, 'bin');
    const shown = await output('cygpath -w "${PATH%%:*}"', { MOXXY_PATH_FIRST: dir });
    expect(shown.trim().toLowerCase()).toBe(dir.toLowerCase());
  });
});

describe.runIf(process.platform === 'win32')('spawnShell under Windows PowerShell', () => {
  const powershell = shellFor('win32', { PATH: '', SystemRoot: process.env.SystemRoot ?? 'C:\\Windows' });

  it('returns the exit code of the program the command ran', async () => {
    expect((await run('cmd /c exit 3', {}, powershell)).code).toBe(3);
    expect((await run('exit 7', {}, powershell)).code).toBe(7);
  });

  it('fails when the last command failed, with the error as plain text', async () => {
    const result = await run('Get-Item C:\\moxxy-does-not-exist', {}, powershell);
    expect(result.code).toBe(1);
    expect(result.err).toContain('moxxy-does-not-exist');
    expect(result.err).not.toContain('CLIXML');
  });

  it('passes quotes and non-ASCII text through and prints UTF-8', async () => {
    const result = await run("Write-Output 'a\"b' \"zażółć\"", {}, powershell);
    expect(result.out.split(/\r?\n/u).filter(Boolean)).toEqual(['a"b', 'zażółć']);
    expect(result.code).toBe(0);
  });
});
