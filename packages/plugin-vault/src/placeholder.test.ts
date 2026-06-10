import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MoxxyError } from '@moxxy/sdk';
import { VaultStore } from './store.js';
import { createStaticKeySource } from './keysource.js';
import { deriveKey, generateSalt } from './crypto.js';
import { containsPlaceholder, resolveString, resolveValue } from './placeholder.js';

let tmp: string;
let vault: VaultStore;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-vault-ph-'));
  vault = new VaultStore({
    filePath: path.join(tmp, 'vault.json'),
    keySource: createStaticKeySource(deriveKey('pw', generateSalt())),
  });
  await vault.set('API_KEY', 'sk-xyz');
  await vault.set('CHAT_ID', '42');
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('resolveString', () => {
  it('returns input unchanged when no placeholder', async () => {
    expect(await resolveString('plain', vault)).toBe('plain');
  });

  it('substitutes a single placeholder', async () => {
    expect(await resolveString('Bearer ${vault:API_KEY}', vault)).toBe('Bearer sk-xyz');
  });

  it('substitutes multiple placeholders', async () => {
    const out = await resolveString('${vault:API_KEY}-${vault:CHAT_ID}', vault);
    expect(out).toBe('sk-xyz-42');
  });

  it('throws a CONFIG_INVALID MoxxyError on missing required entries', async () => {
    await expect(resolveString('${vault:MISSING}', vault)).rejects.toThrow(/missing required entry/);
    const err = await resolveString('${vault:MISSING}', vault).catch((e) => e);
    expect(MoxxyError.isMoxxyError(err)).toBe(true);
    expect((err as MoxxyError).code).toBe('CONFIG_INVALID');
    expect((err as MoxxyError).context).toMatchObject({ name: 'MISSING' });
  });
});

describe('resolveValue', () => {
  it('walks nested objects and arrays', async () => {
    const result = await resolveValue(
      {
        provider: {
          config: { apiKey: '${vault:API_KEY}' },
          tags: ['${vault:CHAT_ID}', 'literal'],
        },
        depth: 3,
        flag: true,
      },
      vault,
    );
    expect(result).toEqual({
      provider: { config: { apiKey: 'sk-xyz' }, tags: ['42', 'literal'] },
      depth: 3,
      flag: true,
    });
  });
});

describe('containsPlaceholder', () => {
  it('finds placeholders at any depth', () => {
    expect(containsPlaceholder('${vault:X}')).toBe(true);
    expect(containsPlaceholder('plain')).toBe(false);
    expect(containsPlaceholder({ a: { b: ['${vault:X}'] } })).toBe(true);
    expect(containsPlaceholder({ a: { b: ['plain'] } })).toBe(false);
  });
});
