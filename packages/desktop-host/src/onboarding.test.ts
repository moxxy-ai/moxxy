import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { VaultStore, createStaticKeySource, deriveKey, generateSalt } from '@moxxy/plugin-vault';

import { readVaultKeys, saveProviderKey } from './onboarding';
import { removeDirSync } from '@moxxy/vitest-preset/fs';

let home: string;

function writeVault(doc: unknown): void {
  const dir = path.join(home, '.moxxy');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'vault.json'), JSON.stringify(doc));
}

beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), 'onboarding-'));
});

afterEach(() => {
  removeDirSync(home);
});

describe('readVaultKeys', () => {
  it('returns [] when the vault file is missing', async () => {
    await expect(readVaultKeys(home)).resolves.toEqual([]);
  });

  it('returns [] for a malformed vault file (degrades, never throws)', async () => {
    const dir = path.join(home, '.moxxy');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'vault.json'), '{not json');
    await expect(readVaultKeys(home)).resolves.toEqual([]);
  });

  it('returns [] when entries is absent', async () => {
    writeVault({ version: 1 });
    await expect(readVaultKeys(home)).resolves.toEqual([]);
  });

  it('lists the stored entry names', async () => {
    writeVault({ entries: { OPENAI_API_KEY: 'cipher', ANTHROPIC_API_KEY: 'cipher' } });
    const keys = await readVaultKeys(home);
    expect(keys.sort()).toEqual(['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']);
  });
});

/**
 * The first-run key form used to hand the key to `moxxy vault set`, a command
 * the CLI does not have, so every API-key provider failed with
 * "unknown command: vault". It now writes the vault the runner reads directly.
 */
describe('saveProviderKey', () => {
  const vault = (): VaultStore =>
    new VaultStore({
      filePath: path.join(home, 'vault.json'),
      keySource: createStaticKeySource(deriveKey('test', generateSalt())),
    });

  it("stores the key in the vault under the provider's canonical name", async () => {
    const store = vault();

    await saveProviderKey('anthropic', 'sk-ant-test', store);

    await expect(store.get('ANTHROPIC_API_KEY')).resolves.toBe('sk-ant-test');
  });

  it('refuses a provider name that is not a plain slug, before touching the vault', async () => {
    const store = vault();

    await expect(saveProviderKey('../evil', 'sk', store)).rejects.toThrow();
    await expect(store.list()).resolves.toEqual([]);
  });
});
