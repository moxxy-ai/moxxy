import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLocalPiperInstaller,
  describeLocalPiperFailure,
  isLocalPiperInstalled,
  LOCAL_PIPER_PACKAGE,
} from './local-piper';

const temporaryDirectories: string[] = [];

async function temporaryMoxxyHome(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'moxxy-local-piper-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe('Local Piper package probe', () => {
  it('requires the first-party package manifest and compiled plugin entry', async () => {
    const home = await temporaryMoxxyHome();
    expect(await isLocalPiperInstalled(home)).toBe(false);

    const packageDirectory = path.join(
      home,
      'plugins',
      'node_modules',
      '@moxxy',
      'plugin-tts-local',
    );
    await mkdir(path.join(packageDirectory, 'dist'), { recursive: true });
    await writeFile(path.join(packageDirectory, 'package.json'), JSON.stringify({
      name: LOCAL_PIPER_PACKAGE,
      moxxy: { plugin: { entry: './dist/index.js' } },
    }));
    expect(await isLocalPiperInstalled(home)).toBe(false);

    await writeFile(path.join(packageDirectory, 'dist', 'index.js'), 'export default {};');
    expect(await isLocalPiperInstalled(home)).toBe(true);
  });

  it('rejects a malformed or substituted package manifest', async () => {
    const home = await temporaryMoxxyHome();
    const packageDirectory = path.join(
      home,
      'plugins',
      'node_modules',
      '@moxxy',
      'plugin-tts-local',
    );
    await mkdir(path.join(packageDirectory, 'dist'), { recursive: true });
    await writeFile(path.join(packageDirectory, 'dist', 'index.js'), 'export default {};');
    await writeFile(path.join(packageDirectory, 'package.json'), JSON.stringify({
      name: '@attacker/substitute',
      moxxy: { plugin: { entry: './dist/index.js' } },
    }));

    expect(await isLocalPiperInstalled(home)).toBe(false);
  });
});

/**
 * Reported bug: the install failed with "The offline voice package could not be
 * installed. Check your internet connection and try again." — on a machine
 * whose internet was fine.
 *
 * The message was a hardcoded guess. `runLocalPiperCliCommand` spawned the CLI
 * with `stdio: 'ignore'`, so the one thing that said WHY was discarded, and
 * every non-zero exit was blamed on the network. The reproduced failure on a
 * host without Node is `error: spawn npm ENOENT` on stderr with exit 1 — a user
 * following that advice would check their WiFi forever.
 *
 * These cases are the CLI's real observed output, not invented strings.
 */
describe('Local Piper failure diagnosis', () => {
  const install = ['plugins', 'install', LOCAL_PIPER_PACKAGE];

  it('names npm/Node as missing rather than blaming the network', () => {
    const message = describeLocalPiperFailure(
      install,
      'pinned install @moxxy/plugin-tts-local@0.35.4 failed (spawn npm ENOENT); ' +
        'retrying latest @moxxy/plugin-tts-local\nerror: spawn npm ENOENT\n',
    );
    expect(message).toMatch(/node\.js|npm/i);
    expect(message).not.toMatch(/internet connection/i);
  });

  it('recognises the Windows spelling of a missing npm', () => {
    const message = describeLocalPiperFailure(
      install,
      "'npm' is not recognized as an internal or external command",
    );
    expect(message).toMatch(/node\.js|npm/i);
    expect(message).not.toMatch(/internet connection/i);
  });

  it('blames the network only when the output actually says so', () => {
    for (const output of [
      'npm error code ENOTFOUND\nnpm error syscall getaddrinfo',
      'npm error code EAI_AGAIN',
      'request to https://registry.npmjs.org/... failed, reason: connect ECONNREFUSED',
      'npm error network request to https://registry.npmjs.org failed, reason: ETIMEDOUT',
    ]) {
      expect(describeLocalPiperFailure(install, output)).toMatch(/internet|network|offline/i);
    }
  });

  it('calls out a permissions failure so the user stops retrying', () => {
    const message = describeLocalPiperFailure(
      install,
      'npm error code EACCES\nnpm error syscall mkdir\nnpm error path /Users/x/.moxxy/plugins',
    );
    expect(message).toMatch(/permission/i);
    expect(message).not.toMatch(/internet connection/i);
  });

  it('surfaces an unrecognised reason verbatim instead of inventing one', () => {
    const message = describeLocalPiperFailure(install, 'npm error code ETARGET no matching version');
    // A wrong-but-confident diagnosis is worse than an honest quote: the user
    // can paste this into an issue, and we can read it off a screenshot.
    expect(message).toContain('ETARGET');
  });

  it('stays honest when the CLI said nothing at all', () => {
    const message = describeLocalPiperFailure(install, '   \n  ');
    expect(message).toMatch(/download|install/i);
    expect(message).not.toMatch(/undefined|null/);
  });

  it('bounds a runaway CLI transcript so it cannot flood the UI', () => {
    const message = describeLocalPiperFailure(install, `${'x'.repeat(20_000)}\nnpm error code EBADPLATFORM`);
    expect(message.length).toBeLessThan(1_200);
  });
});

/**
 * The pure classifier above cannot catch the actual shipped defect: the CLI was
 * spawned with `stdio: 'ignore'`, so there was never any output to classify.
 * This drives the REAL spawn path — real child process, real pipe, real exit
 * code — with `MOXXY_CLI_ENTRY` pointed at a stub CLI, so only the CLI itself
 * is substituted. Reintroducing `stdio: 'ignore'` fails this test.
 */
describe('Local Piper installer (real spawn)', () => {
  const previousEntry = process.env.MOXXY_CLI_ENTRY;

  afterEach(() => {
    if (previousEntry === undefined) delete process.env.MOXXY_CLI_ENTRY;
    else process.env.MOXXY_CLI_ENTRY = previousEntry;
  });

  async function stubCli(body: string): Promise<string> {
    const directory = await temporaryMoxxyHome();
    const entry = path.join(directory, 'stub-cli.js');
    await writeFile(entry, body);
    return entry;
  }

  it('captures the CLI’s stderr and reports the real reason', async () => {
    process.env.MOXXY_CLI_ENTRY = await stubCli(
      "process.stderr.write('error: spawn npm ENOENT\\n'); process.exit(1);",
    );

    await expect(createLocalPiperInstaller()()).rejects.toThrow(/Node\.js/i);
    await expect(createLocalPiperInstaller()()).rejects.not.toThrow(/internet connection/i);
  });

  it('succeeds silently when every step exits cleanly', async () => {
    process.env.MOXXY_CLI_ENTRY = await stubCli('process.exit(0);');
    await expect(createLocalPiperInstaller()()).resolves.toBeUndefined();
  });
});

describe('Local Piper installer', () => {
  it('installs, enables and selects only the fixed Local Piper contribution', async () => {
    const run = vi.fn(async () => undefined);
    const install = createLocalPiperInstaller(run);

    await install();

    expect(run.mock.calls).toEqual([
      [['plugins', 'install', LOCAL_PIPER_PACKAGE]],
      [['plugins', 'enable', LOCAL_PIPER_PACKAGE]],
      [['plugins', 'set-default', 'synthesizer', 'local-piper']],
    ]);
  });

  it('reports which step failed, not just that something did', async () => {
    const run = vi.fn(async (args: ReadonlyArray<string>) => {
      if (args[1] === 'set-default') throw new Error('boom');
    });
    const install = createLocalPiperInstaller(run);

    // Naming the step is half the diagnosis: "install" failing is a download
    // problem, "set-default" failing is a discovery problem, and the old
    // message could not tell a user (or us, from a screenshot) which it was.
    await expect(install()).rejects.toThrow(/set-default|voice as the default/i);
  });

  it('shares one in-flight installation across concurrent renderer requests', async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = vi.fn(async () => gate);
    const install = createLocalPiperInstaller(run);

    const first = install();
    const second = install();
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);

    release?.();
    await Promise.all([first, second]);
    expect(run).toHaveBeenCalledTimes(3);
  });
});
