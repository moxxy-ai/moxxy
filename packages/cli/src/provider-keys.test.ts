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
  delete process.env.GOOGLE_API_KEY;
  delete process.env.GEMINI_API_KEY;
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

  it('forced interactive with no promptFn on a non-TTY throws instead of hanging', async () => {
    // A daemon/piped caller that forces interactive:true but supplies no
    // promptFn must NOT wedge readline.question on a closed stdin — it should
    // fall through to AUTH_NO_CREDENTIALS. (stdin.isTTY is falsy under vitest.)
    const restore = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    try {
      await expect(
        resolveProviderApiKey('anthropic', vault, { interactive: true }),
      ).rejects.toThrow(/No API key found for provider/);
    } finally {
      if (restore) Object.defineProperty(process.stdin, 'isTTY', restore);
      else delete (process.stdin as { isTTY?: unknown }).isTTY;
    }
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

  it('falls back to a vendor-doc env alias when the canonical name is unset (GEMINI → google)', async () => {
    // Google AI Studio docs hand users GEMINI_API_KEY; the google provider
    // resolves under the canonical GOOGLE_API_KEY. The alias must be honored so
    // a user who followed Google's own setup just works.
    process.env.GEMINI_API_KEY = 'sk-gemini';
    const out = await resolveProviderApiKey('google', vault, { interactive: false });
    expect(out.source).toBe('env');
    expect(out.providerConfig.apiKey).toBe('sk-gemini');
    // The reported/persisted name stays canonical — we never store the alias.
    expect(out.canonicalName).toBe('GOOGLE_API_KEY');
  });

  it('the canonical env var wins over the alias when both are set', async () => {
    process.env.GOOGLE_API_KEY = 'sk-canonical';
    process.env.GEMINI_API_KEY = 'sk-alias';
    const out = await resolveProviderApiKey('google', vault, { interactive: false });
    expect(out.providerConfig.apiKey).toBe('sk-canonical');
  });

  it('the vault still outranks a vendor-doc env alias', async () => {
    await vault.set('GOOGLE_API_KEY', 'sk-from-vault');
    process.env.GEMINI_API_KEY = 'sk-alias';
    const out = await resolveProviderApiKey('google', vault, { interactive: false });
    expect(out.source).toBe('vault');
    expect(out.providerConfig.apiKey).toBe('sk-from-vault');
  });

  it('an empty alias env var is ignored (does not satisfy resolution)', async () => {
    // A user who `export GEMINI_API_KEY=` (empty) must not be treated as having a
    // key — fall through to AUTH_NO_CREDENTIALS rather than activating with ''.
    process.env.GEMINI_API_KEY = '';
    await expect(
      resolveProviderApiKey('google', vault, { interactive: false }),
    ).rejects.toThrow(/No API key found for provider/);
  });
});
