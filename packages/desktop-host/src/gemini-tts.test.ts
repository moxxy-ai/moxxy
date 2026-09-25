import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createGeminiTtsInstaller,
  GEMINI_TTS_PACKAGE,
  isGeminiTtsInstalled,
} from './gemini-tts';

const temporaryDirectories: string[] = [];

async function temporaryMoxxyHome(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'moxxy-gemini-tts-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe('Gemini TTS package probe', () => {
  it('requires the fixed package manifest and compiled plugin entry', async () => {
    const home = await temporaryMoxxyHome();
    expect(await isGeminiTtsInstalled(home)).toBe(false);

    const packageDirectory = path.join(home, 'plugins', 'node_modules', '@moxxy', 'plugin-tts-gemini');
    await mkdir(path.join(packageDirectory, 'dist'), { recursive: true });
    await writeFile(path.join(packageDirectory, 'package.json'), JSON.stringify({
      name: GEMINI_TTS_PACKAGE,
      moxxy: { plugin: { entry: './dist/index.js' } },
    }));
    expect(await isGeminiTtsInstalled(home)).toBe(false);

    await writeFile(path.join(packageDirectory, 'dist', 'index.js'), 'export default {};');
    expect(await isGeminiTtsInstalled(home)).toBe(true);
  });

  it('rejects a substituted package manifest', async () => {
    const home = await temporaryMoxxyHome();
    const packageDirectory = path.join(home, 'plugins', 'node_modules', '@moxxy', 'plugin-tts-gemini');
    await mkdir(path.join(packageDirectory, 'dist'), { recursive: true });
    await writeFile(path.join(packageDirectory, 'package.json'), JSON.stringify({
      name: '@attacker/substitute',
      moxxy: { plugin: { entry: './dist/index.js' } },
    }));
    await writeFile(path.join(packageDirectory, 'dist', 'index.js'), 'export default {};');

    expect(await isGeminiTtsInstalled(home)).toBe(false);
  });
});

describe('Gemini TTS installer', () => {
  it('installs, enables and selects only the fixed Gemini package', async () => {
    const runCommand = vi.fn(async () => undefined);
    const install = createGeminiTtsInstaller({ runCommand, isInstalled: async () => false });

    await install();

    expect(runCommand.mock.calls).toEqual([
      [['plugins', 'install', '@moxxy/plugin-tts-gemini']],
      [['plugins', 'enable', '@moxxy/plugin-tts-gemini']],
      [['plugins', 'set-default', 'synthesizer', 'gemini-tts']],
    ]);
  });

  it('skips npm installation when a local Gemini package is already present', async () => {
    const runCommand = vi.fn(async () => undefined);
    const install = createGeminiTtsInstaller({ runCommand, isInstalled: async () => true });

    await install();

    expect(runCommand.mock.calls).toEqual([
      [['plugins', 'enable', GEMINI_TTS_PACKAGE]],
      [['plugins', 'set-default', 'synthesizer', 'gemini-tts']],
    ]);
  });

  it('shares an in-flight install until setup is complete', async () => {
    let releaseInstall: (() => void) | undefined;
    const installGate = new Promise<void>((resolve) => { releaseInstall = resolve; });
    const runCommand = vi.fn(async (args: ReadonlyArray<string>) => {
      if (args[1] === 'install') await installGate;
    });
    const install = createGeminiTtsInstaller({ runCommand, isInstalled: async () => false });

    const first = install();
    const second = install();
    expect(second).toBe(first);
    await Promise.resolve();
    expect(runCommand).toHaveBeenCalledTimes(1);
    releaseInstall?.();
    await Promise.all([first, second]);
    expect(runCommand).toHaveBeenCalledTimes(3);
  });
});
