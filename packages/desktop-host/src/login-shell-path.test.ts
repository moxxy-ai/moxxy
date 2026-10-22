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
const noLaunchctl = async (): Promise<string | null> => null;

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

    const found = await readLoginShellPath({ env, launchctl: noLaunchctl });

    expect(found?.split(':')[0]).toBe(path.join(home, '.local', 'bin'));
  });

  it('is only the PATH, whatever the profile prints', async () => {
    const env = await bashHome('echo "Welcome back"; export PATH="/opt/agents/bin:$PATH"; echo "last login: today"');

    const found = await readLoginShellPath({ env, launchctl: noLaunchctl });

    expect(found?.split(':')[0]).toBe('/opt/agents/bin');
    expect(found).not.toMatch(/Welcome|last login/);
  });

  it('gives up on a shell that does not answer in time, without asking another one', async () => {
    const env = await bashHome('sleep 30');
    const logged: string[] = [];
    const started = Date.now();

    expect(await readLoginShellPath({ env, timeoutMs: 300, userShell: '/bin/bash', launchctl: noLaunchctl, log: (line) => logged.push(line) })).toBeNull();
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(logged).toEqual([expect.stringMatching(/^terminal PATH: \/bin\/bash did not answer in 300 ms$/)]);
  });

  it('gives up on a shell that fails', async () => {
    const env = await bashHome('exit 3');

    expect(await readLoginShellPath({ env, userShell: '/bin/bash', fallbackShell: undefined, launchctl: noLaunchctl })).toBeNull();
  });

  it("asks the account's own shell when the one in SHELL fails", async () => {
    const env = { ...(await bashHome('export PATH="/opt/agents/bin:$PATH"')), SHELL: path.join(home, 'no-such-shell') };
    const logged: string[] = [];

    const found = await readLoginShellPath({ env, userShell: '/bin/bash', launchctl: noLaunchctl, log: (line) => logged.push(line) });

    expect(found?.split(':')[0]).toBe('/opt/agents/bin');
    expect(logged).toEqual([
      expect.stringMatching(/no-such-shell failed$/),
      expect.stringMatching(/^terminal PATH: read from \/bin\/bash in \d+ ms$/),
    ]);
  });

  it('says how long the shell took', async () => {
    const env = await bashHome('export PATH="$HOME/.local/bin:$PATH"');
    const logged: string[] = [];

    await readLoginShellPath({ env, launchctl: noLaunchctl, log: (line) => logged.push(line) });

    expect(logged).toEqual([expect.stringMatching(/^terminal PATH: read from \/bin\/bash in \d+ ms$/)]);
  });
});

describe('when no shell gives a PATH', () => {
  const failing = { HOME: '/nowhere', SHELL: '/nowhere/no-such-shell' };

  it("on macOS takes the PATH launchd gives the person's apps", async () => {
    const logged: string[] = [];

    const found = await readLoginShellPath({
      env: failing,
      platform: 'darwin',
      userShell: '/nowhere/no-such-shell',
      fallbackShell: '/nowhere/no-such-shell',
      launchctl: async () => '/opt/tools/bin:/usr/bin',
      log: (line) => logged.push(line),
    });

    expect(found).toBe('/opt/tools/bin:/usr/bin');
    expect(logged.at(-1)).toBe('terminal PATH: taken from launchctl');
  });

  it('asks launchd only on macOS', async () => {
    let asked = false;

    const found = await readLoginShellPath({
      env: failing,
      platform: 'linux',
      userShell: '/nowhere/no-such-shell',
      fallbackShell: '/nowhere/no-such-shell',
      launchctl: async () => {
        asked = true;
        return '/opt/tools/bin';
      },
    });

    expect(found).toBeNull();
    expect(asked).toBe(false);
  });
});

describe('when there is no terminal PATH to read', () => {
  it('reads none on Windows, where an app gets the full PATH from the start', async () => {
    expect(await readLoginShellPath({ platform: 'win32', env: { SHELL: '/bin/bash' } })).toBeNull();
  });

  it('reads none without a shell to ask', async () => {
    expect(await readLoginShellPath({ env: { PATH: '/usr/bin' }, userShell: undefined, fallbackShell: undefined, launchctl: noLaunchctl })).toBeNull();
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
