import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { providerApiKeyName, storedProviderApiKeyName } from './key-name.js';
import { upsertStoredProvider } from './store.js';
import type { StoredProvider } from './types.js';

describe('providerApiKeyName', () => {
  it('upper-snakes the slug and appends _API_KEY', () => {
    expect(providerApiKeyName('deepseek')).toBe('DEEPSEEK_API_KEY');
  });

  it('maps hyphens to underscores so the result is a valid env-var name', () => {
    // The CLI's old derivation kept the hyphen (`Z-AI_API_KEY`), which is
    // not a valid POSIX env-var name and diverged from the desktop's.
    expect(providerApiKeyName('z-ai')).toBe('Z_AI_API_KEY');
    expect(providerApiKeyName({ name: 'z-ai' })).toBe('Z_AI_API_KEY');
  });

  it('honors a stored envVar override over the derived name', () => {
    expect(providerApiKeyName({ name: 'zai', envVar: 'ZHIPU_KEY' })).toBe('ZHIPU_KEY');
  });
});

describe('storedProviderApiKeyName', () => {
  let tmpDir: string;
  let cfgPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-key-name-'));
    cfgPath = path.join(tmpDir, 'providers.json');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const entry = (over: Partial<StoredProvider> = {}): StoredProvider => ({
    kind: 'openai-compat',
    name: 'my-vendor',
    baseURL: 'https://api.example.com/v1',
    defaultModel: 'm1',
    models: [{ id: 'm1', contextWindow: 100_000, supportsTools: true, supportsStreaming: true }],
    ...over,
  });

  it('returns the envVar override for a stored provider', async () => {
    await upsertStoredProvider(entry({ envVar: 'CUSTOM_KEY' }), cfgPath);
    await expect(storedProviderApiKeyName('my-vendor', cfgPath)).resolves.toBe('CUSTOM_KEY');
  });

  it('falls back to the canonical derivation when no override is stored', async () => {
    await upsertStoredProvider(entry(), cfgPath);
    await expect(storedProviderApiKeyName('my-vendor', cfgPath)).resolves.toBe('MY_VENDOR_API_KEY');
  });

  it('returns null for providers not in providers.json (built-ins)', async () => {
    await expect(storedProviderApiKeyName('anthropic', cfgPath)).resolves.toBeNull();
  });
});
