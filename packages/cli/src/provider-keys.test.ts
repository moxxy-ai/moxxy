import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { VaultStore, createStaticKeySource, deriveKey, generateSalt } from '@moxxy/plugin-vault';
import { resolveProviderApiKey } from './provider-keys.js';

let tmp: string;
let vault: VaultStore;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-keys-'));
  vault = new VaultStore({
    filePath: path.join(tmp, 'vault.json'),
    keySource: createStaticKeySource(deriveKey('test', generateSalt())),
  });
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
});

describe('resolveProviderApiKey', () => {
  it('skips resolution when config already has an apiKey', async () => {
    const out = await resolveProviderApiKey('anthropic', vault, {
      providerConfig: { apiKey: 'sk-explicit' },
    });
    expect(out.source).toBe('config');
    expect(out.providerConfig.apiKey).toBe('sk-explicit');
  });

  it('reads from vault first when available', async () => {
    await vault.set('ANTHROPIC_API_KEY', 'sk-from-vault');
    process.env.ANTHROPIC_API_KEY = 'sk-from-env';
    const out = await resolveProviderApiKey('anthropic', vault);
    expect(out.source).toBe('vault');
    expect(out.providerConfig.apiKey).toBe('sk-from-vault');
  });

  it('falls back to env when vault has nothing', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-env-only';
    const out = await resolveProviderApiKey('anthropic', vault);
    expect(out.source).toBe('env');
    expect(out.providerConfig.apiKey).toBe('sk-env-only');
  });

  it('prompts via injected promptFn when neither vault nor env has it', async () => {
    const out = await resolveProviderApiKey('anthropic', vault, {
      interactive: true,
      promptFn: async () => 'sk-via-prompt',
    });
    expect(out.source).toBe('prompt');
    expect(out.providerConfig.apiKey).toBe('sk-via-prompt');
    // Persisted to vault for next time
    expect(await vault.get('ANTHROPIC_API_KEY')).toBe('sk-via-prompt');
  });

  it('throws when no key found and interactive is false', async () => {
    await expect(
      resolveProviderApiKey('anthropic', vault, { interactive: false }),
    ).rejects.toThrow(/No API key found for provider/);
  });

  it('throws on empty prompt response', async () => {
    await expect(
      resolveProviderApiKey('anthropic', vault, {
        interactive: true,
        promptFn: async () => '',
      }),
    ).rejects.toThrow(/No ANTHROPIC_API_KEY provided/);
  });

  it('honors persistToVault: false (does not save the prompted value)', async () => {
    await resolveProviderApiKey('anthropic', vault, {
      interactive: true,
      persistToVault: false,
      promptFn: async () => 'sk-ephemeral',
    });
    expect(await vault.get('ANTHROPIC_API_KEY')).toBeNull();
  });

  it('derives the canonical key name for any provider (hyphens → underscores)', async () => {
    const out = await resolveProviderApiKey('vendor-z', vault, {
      providerConfig: { apiKey: 'hi' },
    });
    expect(out.source).toBe('config');
    // Shared derivation with provider-admin + the desktop: the old CLI-local
    // one produced `VENDOR-Z_API_KEY` (an invalid env-var name, and a
    // different vault entry than the one the desktop reads).
    expect(out.canonicalName).toBe('VENDOR_Z_API_KEY');
  });

  it('honors a keyName override (stored envVar for runtime providers)', async () => {
    await vault.set('ZHIPU_KEY', 'sk-override');
    const out = await resolveProviderApiKey('zai', vault, { keyName: 'ZHIPU_KEY' });
    expect(out.source).toBe('vault');
    expect(out.providerConfig.apiKey).toBe('sk-override');
    expect(out.canonicalName).toBe('ZHIPU_KEY');
  });

  it('OPENAI_API_KEY resolves analogously for the openai provider', async () => {
    await vault.set('OPENAI_API_KEY', 'sk-openai');
    const out = await resolveProviderApiKey('openai', vault);
    expect(out.providerConfig.apiKey).toBe('sk-openai');
    expect(out.canonicalName).toBe('OPENAI_API_KEY');
  });
});
