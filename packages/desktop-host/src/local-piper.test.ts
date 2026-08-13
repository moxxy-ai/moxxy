import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLocalPiperInstaller,
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

describe('Local Piper installer', () => {
  it('installs, enables and selects only the fixed Local Piper contribution', async () => {
    const run = vi.fn(async () => undefined);
    const repairManifest = vi.fn(async () => undefined);
    const install = createLocalPiperInstaller({ runCommand: run, repairManifest });

    await install();

    expect(repairManifest).toHaveBeenCalledTimes(1);
    expect(run.mock.calls).toEqual([
      [['plugins', 'install', LOCAL_PIPER_PACKAGE]],
      [['plugins', 'enable', LOCAL_PIPER_PACKAGE]],
      [['plugins', 'set-default', 'synthesizer', 'local-piper']],
    ]);
  });

  it('shares one in-flight installation across concurrent renderer requests', async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = vi.fn(async () => gate);
    const repairManifest = vi.fn(async () => undefined);
    const install = createLocalPiperInstaller({ runCommand: run, repairManifest });

    const first = install();
    const second = install();
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);

    release?.();
    await Promise.all([first, second]);
    expect(repairManifest).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('repairs the plugin ledger before npm install and stops on repair failure', async () => {
    const calls: string[] = [];
    const run = vi.fn(async () => {
      calls.push('install');
    });
    const repairManifest = vi.fn(async () => {
      calls.push('repair');
      throw new Error('manifest could not be repaired');
    });
    const install = createLocalPiperInstaller({ runCommand: run, repairManifest });

    await expect(install()).rejects.toThrow('manifest could not be repaired');
    expect(calls).toEqual(['repair']);
    expect(run).not.toHaveBeenCalled();
  });
});
