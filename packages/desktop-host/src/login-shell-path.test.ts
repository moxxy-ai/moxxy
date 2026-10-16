/**
 * The PATH the person's terminal has. A desktop app started from Finder or the
 * Dock gets a short system PATH instead, so it found other programs than the
 * terminal does: an old Homebrew `claude` before the one in `~/.local/bin`.
 * The shells here are the real `bash`, in a temporary home.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { removeDir } from '@moxxy/vitest-preset/fs';
import { posixShell } from '@moxxy/vitest-preset/platform';
import { readLoginShellPath, withLoginShellPath } from './login-shell-path.js';

let home: string;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-login-shell-'));
});

afterEach(async () => {
  await removeDir(home);
});

/** A home whose bash profile runs `profile`, as a terminal's login shell would. */
async function bashHome(profile: string): Promise<NodeJS.ProcessEnv> {
  await fs.writeFile(path.join(home, '.bash_profile'), `${profile}\n`);
  return { HOME: home, SHELL: '/bin/bash', PATH: '/usr/bin:/bin' };
}

describe.skipIf(!posixShell)("reading the terminal's PATH", () => {
  it('is the PATH the login shell sets up, not the one this process started with', async () => {
    const env = await bashHome('export PATH="$HOME/.local/bin:$PATH"');

    const found = await readLoginShellPath({ env });

    expect(found?.split(':')[0]).toBe(path.join(home, '.local', 'bin'));
  });

  it('is only the PATH, whatever the profile prints', async () => {
    const env = await bashHome('echo "Welcome back"; export PATH="/opt/agents/bin:$PATH"; echo "last login: today"');

    const found = await readLoginShellPath({ env });

    expect(found?.split(':')[0]).toBe('/opt/agents/bin');
    expect(found).not.toMatch(/Welcome|last login/);
  });

  it('gives up on a shell that does not answer in time', async () => {
    const env = await bashHome('sleep 30');
    const started = Date.now();

    expect(await readLoginShellPath({ env, timeoutMs: 300 })).toBeNull();
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('gives up on a shell that fails', async () => {
    const env = await bashHome('exit 3');

    expect(await readLoginShellPath({ env })).toBeNull();
  });
});

describe('when there is no terminal PATH to read', () => {
  it('reads none on Windows, where an app gets the full PATH from the start', async () => {
    expect(await readLoginShellPath({ platform: 'win32', env: { SHELL: '/bin/bash' } })).toBeNull();
  });

  it('reads none without a shell to ask', async () => {
    expect(await readLoginShellPath({ env: { PATH: '/usr/bin' } })).toBeNull();
  });
});

describe("putting the terminal's PATH first", () => {
  it('keeps the folders of both, the terminal order first, each once', () => {
    expect(withLoginShellPath('/usr/bin:/opt/homebrew/bin', '/home/me/.local/bin:/usr/bin')).toBe(
      '/home/me/.local/bin:/usr/bin:/opt/homebrew/bin',
    );
  });

  it('leaves the PATH as it is without one from the terminal', () => {
    expect(withLoginShellPath('/usr/bin', null)).toBe('/usr/bin');
  });
});
