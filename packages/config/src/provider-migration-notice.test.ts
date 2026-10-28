import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { removeDir } from '@moxxy/vitest-preset/fs';
import {
  clearProviderMigrationNotice,
  readProviderMigrationNotice,
  recordProviderMigrationNotice,
} from './provider-migration-notice.js';

let home: string;
let previousHome: string | undefined;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-migration-notice-'));
  previousHome = process.env.MOXXY_HOME;
  process.env.MOXXY_HOME = home;
});

afterEach(async () => {
  if (previousHome === undefined) delete process.env.MOXXY_HOME;
  else process.env.MOXXY_HOME = previousHome;
  await removeDir(home);
});

it('keeps a provider migration until it has been shown once', async () => {
  expect(await readProviderMigrationNotice()).toBeNull();

  await recordProviderMigrationNotice({ from: 'openai-codex', to: 'codex-agent' });
  expect(await readProviderMigrationNotice()).toEqual({ from: 'openai-codex', to: 'codex-agent' });

  await clearProviderMigrationNotice();
  expect(await readProviderMigrationNotice()).toBeNull();
  await clearProviderMigrationNotice();
});

it('ignores a damaged notice instead of failing', async () => {
  await fs.mkdir(path.join(home, 'notices'), { recursive: true });
  await fs.writeFile(path.join(home, 'notices', 'provider-migration.json'), '{not json');
  expect(await readProviderMigrationNotice()).toBeNull();
});
