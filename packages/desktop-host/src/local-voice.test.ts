import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadCategoryDefault, setCategoryDefault } from '@moxxy/config';
import {
  adoptSeededLocalVoice,
  createLocalVoiceInstaller,
  isLocalVoiceInstalled,
  LOCAL_VOICE_PACKAGE,
  migrateLocalVoiceChoice,
} from './local-voice';
import { removeDir } from '@moxxy/vitest-preset/fs';

const temporaryDirectories: string[] = [];

async function temporaryMoxxyHome(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'moxxy-local-voice-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    removeDir(directory)
  )));
});

describe('offline voice package probe', () => {
  it('requires the first-party package manifest and compiled plugin entry', async () => {
    const home = await temporaryMoxxyHome();
    expect(await isLocalVoiceInstalled(home)).toBe(false);

    const packageDirectory = path.join(
      home,
      'plugins',
      'node_modules',
      '@moxxy',
      'plugin-tts-local',
    );
    await mkdir(path.join(packageDirectory, 'dist'), { recursive: true });
    await writeFile(path.join(packageDirectory, 'package.json'), JSON.stringify({
      name: LOCAL_VOICE_PACKAGE,
      moxxy: { plugin: { entry: './dist/index.js' } },
    }));
    expect(await isLocalVoiceInstalled(home)).toBe(false);

    await writeFile(path.join(packageDirectory, 'dist', 'index.js'), 'export default {};');
    expect(await isLocalVoiceInstalled(home)).toBe(true);
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

    expect(await isLocalVoiceInstalled(home)).toBe(false);
  });
});

describe('offline voice installer', () => {
  it('installs, enables and selects only the fixed offline voice contribution', async () => {
    const run = vi.fn(async () => undefined);
    const repairManifest = vi.fn(async () => undefined);
    const install = createLocalVoiceInstaller({
      runCommand: run,
      repairManifest,
      isInstalled: async () => false,
    });

    await install();

    expect(repairManifest).toHaveBeenCalledTimes(1);
    expect(run.mock.calls).toEqual([
      [['plugins', 'install', LOCAL_VOICE_PACKAGE]],
      [['plugins', 'enable', LOCAL_VOICE_PACKAGE]],
      [['plugins', 'set-default', 'synthesizer', 'local-supertonic']],
    ]);
  });

  it('selects a voice that is already on disk without going to npm', async () => {
    const run = vi.fn(async () => undefined);
    const repairManifest = vi.fn(async () => undefined);
    const install = createLocalVoiceInstaller({
      runCommand: run,
      repairManifest,
      isInstalled: async () => true,
    });

    await install();

    expect(repairManifest).not.toHaveBeenCalled();
    expect(run.mock.calls).toEqual([
      [['plugins', 'enable', LOCAL_VOICE_PACKAGE]],
      [['plugins', 'set-default', 'synthesizer', 'local-supertonic']],
    ]);
  });

  it('shares one in-flight installation across concurrent renderer requests', async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = vi.fn(async () => gate);
    const repairManifest = vi.fn(async () => undefined);
    const install = createLocalVoiceInstaller({
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
    const install = createLocalVoiceInstaller({
      runCommand: run,
      repairManifest,
      isInstalled: async () => false,
    });

    await expect(install()).rejects.toThrow('manifest could not be repaired');
    expect(calls).toEqual(['repair']);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('voice shipped with the installer', () => {
  it('becomes the voice when the installer just put it there and none was chosen', async () => {
    const configPath = path.join(await temporaryMoxxyHome(), 'config.yaml');

    const adopted = await adoptSeededLocalVoice([LOCAL_VOICE_PACKAGE, '@moxxy/sdk'], { configPath });

    expect(adopted).toBe(true);
    expect(await loadCategoryDefault('synthesizer', { configPath })).toBe('local-supertonic');
  });

  it('keeps the voice the user chose', async () => {
    const configPath = path.join(await temporaryMoxxyHome(), 'config.yaml');
    await setCategoryDefault('synthesizer', 'gemini-tts', { configPath });

    const adopted = await adoptSeededLocalVoice([LOCAL_VOICE_PACKAGE], { configPath });

    expect(adopted).toBe(false);
    expect(await loadCategoryDefault('synthesizer', { configPath })).toBe('gemini-tts');
  });

  it('changes nothing on a launch that copied no voice', async () => {
    const configPath = path.join(await temporaryMoxxyHome(), 'config.yaml');

    const adopted = await adoptSeededLocalVoice(['@moxxy/sdk'], { configPath });

    expect(adopted).toBe(false);
    expect(await loadCategoryDefault('synthesizer', { configPath })).toBeNull();
  });
});

describe('moving the old local voice to Supertonic', () => {
  it('rewrites the saved choice, once', async () => {
    const home = await temporaryMoxxyHome();
    const opts = { configPath: path.join(home, 'config.yaml') };
    await setCategoryDefault('synthesizer', 'local-piper', opts);

    await expect(migrateLocalVoiceChoice(opts)).resolves.toBe(true);
    await expect(loadCategoryDefault('synthesizer', opts)).resolves.toBe('local-supertonic');
    await expect(migrateLocalVoiceChoice(opts)).resolves.toBe(false);
  });

  it('leaves any other voice alone', async () => {
    const home = await temporaryMoxxyHome();
    const opts = { configPath: path.join(home, 'config.yaml') };
    await setCategoryDefault('synthesizer', 'gemini-tts', opts);

    await expect(migrateLocalVoiceChoice(opts)).resolves.toBe(false);
    await expect(loadCategoryDefault('synthesizer', opts)).resolves.toBe('gemini-tts');
  });

  it('chooses nothing for someone who has no voice yet', async () => {
    const home = await temporaryMoxxyHome();
    const opts = { configPath: path.join(home, 'config.yaml') };

    await expect(migrateLocalVoiceChoice(opts)).resolves.toBe(false);
    await expect(loadCategoryDefault('synthesizer', opts)).resolves.toBeNull();
  });
});
