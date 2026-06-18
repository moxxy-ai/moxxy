import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { readVaultKeys } from './onboarding';

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
  rmSync(home, { recursive: true, force: true });
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
