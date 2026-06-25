import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { VaultStore, createStaticKeySource, deriveKey, generateSalt } from '@moxxy/plugin-vault';
import {
  resolveProviderCredentials,
  resolveProviderCredentialsDetailed,
} from './provider-credentials.js';

let tmp: string;
let vault: VaultStore;
let codexAuth: string;
let claudeCreds: string;
const priorMoxxyHome = process.env.MOXXY_HOME;
const priorCodexHome = process.env.CODEX_HOME;
const priorClaudeFile = process.env.MOXXY_CLAUDE_CREDENTIALS_FILE;
const CLAUDE_ENV_VARS = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_AUTH_TOKEN'] as const;
const priorClaudeEnv = new Map(CLAUDE_ENV_VARS.map((k) => [k, process.env[k]] as const));

beforeEach(async () => {
  // A real token in the ambient env would win before the installed-CLI fallback
  // and make these tests non-hermetic — clear them for the suite.
  for (const k of CLAUDE_ENV_VARS) delete process.env[k];
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-creds-'));
  // storedProviderApiKeyName reads ~/.moxxy/providers.json via moxxyPath —
  // point MOXXY_HOME at the temp dir so tests never touch the real one.
  process.env.MOXXY_HOME = tmp;
  // Point the installed-CLI sources at temp paths (missing by default) so the
  // suite is hermetic and never reads this machine's real codex/claude creds.
  process.env.CODEX_HOME = path.join(tmp, 'codex');
  codexAuth = path.join(tmp, 'codex', 'auth.json');
  claudeCreds = path.join(tmp, 'claude-creds.json');
  process.env.MOXXY_CLAUDE_CREDENTIALS_FILE = claudeCreds;
  vault = new VaultStore({
    filePath: path.join(tmp, 'vault.json'),
    keySource: createStaticKeySource(deriveKey('test', generateSalt())),
  });
});

afterEach(async () => {
  restoreEnv('MOXXY_HOME', priorMoxxyHome);
  restoreEnv('CODEX_HOME', priorCodexHome);
  restoreEnv('MOXXY_CLAUDE_CREDENTIALS_FILE', priorClaudeFile);
  for (const [k, v] of priorClaudeEnv) restoreEnv(k, v);
  await fs.rm(tmp, { recursive: true, force: true });
});

function restoreEnv(name: string, prior: string | undefined): void {
  if (prior === undefined) delete process.env[name];
  else process.env[name] = prior;
}

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

  it('borrows the installed claude CLI token when the vault/env are empty', async () => {
    await fs.writeFile(
      claudeCreds,
      JSON.stringify({
        claudeAiOauth: { accessToken: 'borrowed-AT', refreshToken: 'RT', expiresAt: Date.now() + 3_600_000 },
      }),
      'utf8',
    );
    const { config, source } = await resolveProviderCredentialsDetailed('claude-code', vault);
    expect(source).toBe('installed-cli');
    expect(config.oauthToken).toBe('borrowed-AT');
    // A refresh hook is wired because a refresh token is available.
    expect(typeof config.oauthRefresh).toBe('function');
  });

  it('borrows the installed codex CLI auth.json when the vault is empty', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
    await fs.mkdir(path.dirname(codexAuth), { recursive: true });
    await fs.writeFile(
      codexAuth,
      JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: { access_token: `${header}.${payload}.s`, refresh_token: 'RT', account_id: 'acct' },
      }),
      'utf8',
    );
    const { config, source } = await resolveProviderCredentialsDetailed('openai-codex', vault);
    expect(source).toBe('installed-cli');
    expect(config.tokens).toMatchObject({ refresh: 'RT', accountId: 'acct' });
    expect(typeof config.reloadTokens).toBe('function');
  });

  it('throws when no claude credentials are available anywhere', async () => {
    // Vault empty, no env token, installed-CLI override points at a missing file.
    await expect(resolveProviderCredentials('claude-code', vault)).rejects.toThrow(
      /Claude subscription credentials/i,
    );
  });
});
