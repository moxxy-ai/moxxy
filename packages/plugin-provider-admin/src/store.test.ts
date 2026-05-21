import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  readProvidersConfig,
  removeStoredProvider,
  upsertStoredProvider,
  writeProvidersConfig,
} from './store.js';
import type { StoredProvider } from './types.js';

const sampleEntry: StoredProvider = {
  kind: 'openai-compat',
  name: 'zai',
  baseURL: 'https://api.z.ai/api/coding/paas/v4',
  defaultModel: 'glm-4.6',
  models: [{ id: 'glm-4.6', contextWindow: 200_000, supportsTools: true, supportsStreaming: true }],
};

let tmpDir: string;
let cfgPath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-provider-admin-'));
  cfgPath = path.join(tmpDir, 'providers.json');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('providers.json store', () => {
  it('returns an empty list when the file is missing', async () => {
    const cfg = await readProvidersConfig(cfgPath);
    expect(cfg.providers).toEqual([]);
  });

  it('round-trips a single provider through write/read', async () => {
    await writeProvidersConfig({ providers: [sampleEntry] }, cfgPath);
    const cfg = await readProvidersConfig(cfgPath);
    expect(cfg.providers).toHaveLength(1);
    expect(cfg.providers[0]).toMatchObject({ name: 'zai', defaultModel: 'glm-4.6' });
  });

  it('upsert replaces an entry with the same name (no duplicates)', async () => {
    await upsertStoredProvider(sampleEntry, cfgPath);
    const updated: StoredProvider = { ...sampleEntry, defaultModel: 'glm-4.5-air' };
    const next = await upsertStoredProvider(updated, cfgPath);
    expect(next.providers).toHaveLength(1);
    expect(next.providers[0]!.defaultModel).toBe('glm-4.5-air');
  });

  it('upsert appends distinct entries', async () => {
    await upsertStoredProvider(sampleEntry, cfgPath);
    const second: StoredProvider = { ...sampleEntry, name: 'deepseek', baseURL: 'https://api.deepseek.com' };
    const next = await upsertStoredProvider(second, cfgPath);
    expect(next.providers).toHaveLength(2);
    expect(next.providers.map((p) => p.name).sort()).toEqual(['deepseek', 'zai']);
  });

  it('remove returns false when the entry was not present', async () => {
    expect(await removeStoredProvider('nonexistent', cfgPath)).toBe(false);
  });

  it('remove drops the entry and returns true', async () => {
    await upsertStoredProvider(sampleEntry, cfgPath);
    expect(await removeStoredProvider('zai', cfgPath)).toBe(true);
    const cfg = await readProvidersConfig(cfgPath);
    expect(cfg.providers).toEqual([]);
  });

  it('treats malformed JSON as empty', async () => {
    await fs.writeFile(cfgPath, '{ not json', 'utf8');
    const cfg = await readProvidersConfig(cfgPath);
    expect(cfg.providers).toEqual([]);
  });
});
