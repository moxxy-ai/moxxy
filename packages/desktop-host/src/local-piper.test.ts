import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadCategoryDefault, setCategoryDefault } from '@moxxy/config';
import {
  adoptSeededLocalPiper,
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
    const install = createLocalPiperInstaller({
      runCommand: run,
      repairManifest,
      isInstalled: async () => false,
    });

    await install();

    expect(repairManifest).toHaveBeenCalledTimes(1);
    expect(run.mock.calls).toEqual([
      [['plugins', 'install', LOCAL_PIPER_PACKAGE]],
      [['plugins', 'enable', LOCAL_PIPER_PACKAGE]],
      [['plugins', 'set-default', 'synthesizer', 'local-piper']],
    ]);
  });

  it('selects a Piper that is already on disk without going to npm', async () => {
    const run = vi.fn(async () => undefined);
    const repairManifest = vi.fn(async () => undefined);
    const install = createLocalPiperInstaller({
      runCommand: run,
      repairManifest,
      isInstalled: async () => true,
    });

    await install();

    expect(repairManifest).not.toHaveBeenCalled();
    expect(run.mock.calls).toEqual([
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
    const install = createLocalPiperInstaller({
      runCommand: run,
      repairManifest,
      isInstalled: async () => false,
    });

    const first = install();
    const second = install();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));

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
    const install = createLocalPiperInstaller({
      runCommand: run,
      repairManifest,
      isInstalled: async () => false,
    });

    await expect(install()).rejects.toThrow('manifest could not be repaired');
    expect(calls).toEqual(['repair']);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('Piper shipped with the installer', () => {
  it('becomes the voice when the installer just put it there and none was chosen', async () => {
    const configPath = path.join(await temporaryMoxxyHome(), 'config.yaml');

    const adopted = await adoptSeededLocalPiper([LOCAL_PIPER_PACKAGE, '@moxxy/sdk'], { configPath });

    expect(adopted).toBe(true);
    expect(await loadCategoryDefault('synthesizer', { configPath })).toBe('local-piper');
  });

  it('keeps the voice the user chose', async () => {
    const configPath = path.join(await temporaryMoxxyHome(), 'config.yaml');
    await setCategoryDefault('synthesizer', 'gemini-tts', { configPath });

    const adopted = await adoptSeededLocalPiper([LOCAL_PIPER_PACKAGE], { configPath });

    expect(adopted).toBe(false);
    expect(await loadCategoryDefault('synthesizer', { configPath })).toBe('gemini-tts');
  });

  it('changes nothing on a launch that copied no Piper', async () => {
    const configPath = path.join(await temporaryMoxxyHome(), 'config.yaml');

    const adopted = await adoptSeededLocalPiper(['@moxxy/sdk'], { configPath });

    expect(adopted).toBe(false);
    expect(await loadCategoryDefault('synthesizer', { configPath })).toBeNull();
  });
});
