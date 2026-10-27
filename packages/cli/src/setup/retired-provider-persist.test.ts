import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readProviderMigrationNotice } from '@moxxy/config';
import { removeDir } from '@moxxy/vitest-preset/fs';
import { persistRetiredProviderMigration } from './retired-provider.js';

// Real config file and notice under a throwaway MOXXY_HOME.
let home: string;
let previousHome: string | undefined;
beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'moxxy-retired-persist-'));
  previousHome = process.env.MOXXY_HOME;
  process.env.MOXXY_HOME = home;
});
afterEach(async () => {
  if (previousHome === undefined) delete process.env.MOXXY_HOME;
  else process.env.MOXXY_HOME = previousHome;
  await removeDir(home);
});

it('writes the Codex agent into the config once, and leaves a notice to show once', async () => {
  await writeFile(path.join(home, 'config.yaml'), 'plugins:\n  provider:\n    default: openai-codex\n');

  await persistRetiredProviderMigration({ warn: vi.fn() });

  expect(await readFile(path.join(home, 'config.yaml'), 'utf8')).toContain('default: codex-agent');
  expect(await readProviderMigrationNotice()).toEqual({ from: 'openai-codex', to: 'codex-agent' });
});

it('leaves no notice when the config no longer names the ChatGPT sign-in', async () => {
  await writeFile(path.join(home, 'config.yaml'), 'plugins:\n  provider:\n    default: codex-agent\n');

  await persistRetiredProviderMigration({ warn: vi.fn() });

  expect(await readProviderMigrationNotice()).toBeNull();
});

it('never stops startup when the config cannot be written', async () => {
  // A file where the notices folder should be makes the save fail.
  await writeFile(path.join(home, 'notices'), 'not a directory');
  await writeFile(path.join(home, 'config.yaml'), 'plugins:\n  provider:\n    default: openai-codex\n');
  const warn = vi.fn();

  await expect(persistRetiredProviderMigration({ warn })).resolves.toBeUndefined();
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not save'), expect.anything());
});
