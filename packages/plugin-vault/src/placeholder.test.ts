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

  it('preserves object key insertion order', async () => {
    const result = (await resolveValue(
      { z: '${vault:API_KEY}', a: 'lit', m: '${vault:CHAT_ID}' },
      vault,
    )) as Record<string, unknown>;
    expect(Object.keys(result)).toEqual(['z', 'a', 'm']);
    expect(result).toEqual({ z: 'sk-xyz', a: 'lit', m: '42' });
  });

  it('resolves object properties concurrently (overlapped awaits)', async () => {
    // Wrap vault.get with a small delay + concurrency counter; if object
    // properties resolved sequentially, max concurrency would be 1.
    let active = 0;
    let maxActive = 0;
    const realGet = vault.get.bind(vault);
    vault.get = async (name: string) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      try {
        return await realGet(name);
      } finally {
        active--;
      }
    };
    const result = (await resolveValue(
      { a: '${vault:API_KEY}', b: '${vault:CHAT_ID}', c: '${vault:API_KEY}' },
      vault,
    )) as Record<string, unknown>;
    expect(result).toEqual({ a: 'sk-xyz', b: '42', c: 'sk-xyz' });
    expect(maxActive).toBeGreaterThan(1);
  });
});

describe('containsPlaceholder', () => {
  it('finds placeholders at any depth', () => {
    expect(containsPlaceholder('${vault:X}')).toBe(true);
    expect(containsPlaceholder('plain')).toBe(false);
    expect(containsPlaceholder({ a: { b: ['${vault:X}'] } })).toBe(true);
    expect(containsPlaceholder({ a: { b: ['plain'] } })).toBe(false);
  });

  it('does not stack-overflow on a reference cycle', () => {
    const cyclic: Record<string, unknown> = { a: 'plain' };
    cyclic.self = cyclic; // legal in-memory cycle
    expect(() => containsPlaceholder(cyclic)).not.toThrow();
    expect(containsPlaceholder(cyclic)).toBe(false);
    cyclic.secret = '${vault:X}';
    expect(containsPlaceholder(cyclic)).toBe(true);
  });

  it('throws (rather than overflowing) on pathologically deep input', () => {
    let node: Record<string, unknown> = { leaf: 'plain' };
    for (let i = 0; i < 200; i++) node = { nested: node };
    expect(() => containsPlaceholder(node)).toThrow(/nested too deeply/);
  });
});

describe('resolveValue worst-case guards', () => {
  it('throws a CONFIG_INVALID MoxxyError on a reference cycle instead of overflowing', async () => {
    const cyclic: Record<string, unknown> = { apiKey: '${vault:API_KEY}' };
    cyclic.self = cyclic;
    const err = await resolveValue(cyclic, vault).catch((e) => e);
    expect(MoxxyError.isMoxxyError(err)).toBe(true);
    expect((err as MoxxyError).code).toBe('CONFIG_INVALID');
  });

  it('throws on pathologically deep input rather than blowing the stack', async () => {
    let node: Record<string, unknown> = { leaf: '${vault:API_KEY}' };
    for (let i = 0; i < 200; i++) node = { nested: node };
    await expect(resolveValue(node, vault)).rejects.toThrow(/nested too deeply/);
  });
});
