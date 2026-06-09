import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { VaultStore, createStaticKeySource, deriveKey, generateSalt } from '@moxxy/plugin-vault';
import { resolveProviderCredentials } from './provider-credentials.js';

let tmp: string;
let vault: VaultStore;
const priorMoxxyHome = process.env.MOXXY_HOME;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-creds-'));
  // storedProviderApiKeyName reads ~/.moxxy/providers.json via moxxyPath —
  // point MOXXY_HOME at the temp dir so tests never touch the real one.
  process.env.MOXXY_HOME = tmp;
  vault = new VaultStore({
    filePath: path.join(tmp, 'vault.json'),
    keySource: createStaticKeySource(deriveKey('test', generateSalt())),
  });
});

afterEach(async () => {
  if (priorMoxxyHome === undefined) delete process.env.MOXXY_HOME;
  else process.env.MOXXY_HOME = priorMoxxyHome;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('resolveProviderCredentials', () => {
  it('honors the stored envVar override for runtime-registered providers', async () => {
    // The desktop already resolved this provider's key from ZHIPU_KEY; the
    // CLI/runner used to derive ZAI_API_KEY instead and miss it entirely.
    await fs.writeFile(
      path.join(tmp, 'providers.json'),
      JSON.stringify({
        providers: [
          {
            kind: 'openai-compat',
            name: 'zai',
            baseURL: 'https://api.z.ai/api/coding/paas/v4',
            defaultModel: 'glm-4.6',
            models: [{ id: 'glm-4.6', contextWindow: 200_000, supportsTools: true, supportsStreaming: true }],
            envVar: 'ZHIPU_KEY',
          },
        ],
      }),
      'utf8',
    );
    await vault.set('ZHIPU_KEY', 'sk-from-override');
    const cfg = await resolveProviderCredentials('zai', vault, { interactive: false });
    expect(cfg.apiKey).toBe('sk-from-override');
  });

  it('falls back to the canonical <NAME>_API_KEY for stored providers without an override', async () => {
    await fs.writeFile(
      path.join(tmp, 'providers.json'),
      JSON.stringify({
        providers: [
          {
            kind: 'openai-compat',
            name: 'my-vendor',
            baseURL: 'https://api.example.com/v1',
            defaultModel: 'm1',
            models: [{ id: 'm1', contextWindow: 100_000, supportsTools: true, supportsStreaming: true }],
          },
        ],
      }),
      'utf8',
    );
    await vault.set('MY_VENDOR_API_KEY', 'sk-canonical');
    const cfg = await resolveProviderCredentials('my-vendor', vault, { interactive: false });
    expect(cfg.apiKey).toBe('sk-canonical');
  });

  it('passes provider.config options through to the codex client config', async () => {
    // Seed the OAuth bundle the codex resolver reads. client_id + token_url
    // are required setup-meta — readStoredCreds treats their absence as a
    // partial store and reports no credentials.
    await vault.set('oauth/openai-codex/access_token', 'AT');
    await vault.set('oauth/openai-codex/refresh_token', 'RT');
    await vault.set('oauth/openai-codex/expires_at', String(Date.now() + 3_600_000));
    await vault.set('oauth/openai-codex/client_id', 'client-test');
    await vault.set('oauth/openai-codex/token_url', 'https://auth.openai.com/oauth/token');

    const cfg = await resolveProviderCredentials('openai-codex', vault, {
      providerConfig: { reasoningEffort: 'high' },
    });
    // The configured option survives (previously dropped: the resolver
    // returned a fresh object with only tokens + refresh hooks).
    expect(cfg.reasoningEffort).toBe('high');
    expect(cfg.tokens).toMatchObject({ access: 'AT', refresh: 'RT' });
    expect(typeof cfg.onTokensRefreshed).toBe('function');
  });
});
