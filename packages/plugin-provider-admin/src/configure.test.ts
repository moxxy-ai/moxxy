import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MoxxyError, type ProviderDef } from '@moxxy/sdk';
import { buildProviderAdminPluginWithApi, type ProviderRegistryLike } from './index.js';
import { readProvidersConfig, upsertStoredProvider } from './store.js';
import type { StoredProvider } from './types.js';

class FakeRegistry implements ProviderRegistryLike {
  defs = new Map<string, ProviderDef>();
  register(def: ProviderDef): void {
    if (this.defs.has(def.name)) throw new Error(`already registered: ${def.name}`);
    this.defs.set(def.name, def);
  }
  replace(def: ProviderDef): void {
    this.defs.set(def.name, def);
  }
  unregister(name: string): void {
    this.defs.delete(name);
  }
  list(): ReadonlyArray<ProviderDef> {
    return [...this.defs.values()];
  }
}

let tmpDir: string;
let cfgPath: string;
let registry: FakeRegistry;

const zaiEntry: StoredProvider = {
  kind: 'openai-compat',
  name: 'zai',
  baseURL: 'https://api.z.ai/api/coding/paas/v4',
  defaultModel: 'glm-4.6',
  models: [
    { id: 'glm-4.6', contextWindow: 200_000, supportsTools: true, supportsStreaming: true },
    { id: 'glm-4.5-air', contextWindow: 128_000, supportsTools: true, supportsStreaming: true },
  ],
  createdAt: new Date('2026-01-01').toISOString(),
};

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-provider-admin-configure-'));
  cfgPath = path.join(tmpDir, 'providers.json');
  registry = new FakeRegistry();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function build(reg: ProviderRegistryLike = registry) {
  return buildProviderAdminPluginWithApi({ providerRegistry: reg, configPath: cfgPath });
}

async function seedZai(): Promise<void> {
  await upsertStoredProvider(zaiEntry, cfgPath);
}

describe('buildProviderAdminPluginWithApi.configure', () => {
  it('throws CONFIG_INVALID when no stored provider has that name', async () => {
    const { api } = build();
    const err = await api.configure('nope', { defaultModel: 'x' }).catch((e) => e);
    expect(MoxxyError.isMoxxyError(err)).toBe(true);
    expect((err as MoxxyError).code).toBe('CONFIG_INVALID');
    expect((err as MoxxyError).message).toMatch(/no stored provider named "nope"/);
  });

  it('refuses to reconfigure a built-in provider (reserved name)', async () => {
    const reg = new FakeRegistry();
    reg.register({ name: 'openai', models: [{ id: 'gpt-x', contextWindow: 1 }] } as unknown as ProviderDef);
    const { api } = build(reg);
    const err = await api.configure('openai', { defaultModel: 'gpt-x' }).catch((e) => e);
    expect(MoxxyError.isMoxxyError(err)).toBe(true);
    expect((err as MoxxyError).code).toBe('CONFIG_INVALID');
    expect((err as MoxxyError).message).toMatch(/built-in/i);
  });

  it('merges only the provided patch fields, leaving the rest intact', async () => {
    await seedZai();
    const { api } = build();
    await api.configure('zai', { baseURL: 'https://new.example.com/v1' });
    const cfg = await readProvidersConfig(cfgPath);
    const stored = cfg.providers.find((p) => p.name === 'zai')!;
    expect(stored.baseURL).toBe('https://new.example.com/v1');
    // Untouched fields preserved.
    expect(stored.defaultModel).toBe('glm-4.6');
    expect(stored.models.map((m) => m.id)).toEqual(['glm-4.6', 'glm-4.5-air']);
  });

  it('throws CONFIG_INVALID when the merged defaultModel is not in the models list', async () => {
    await seedZai();
    const { api } = build();
    const err = await api.configure('zai', { defaultModel: 'not-a-model' }).catch((e) => e);
    expect(MoxxyError.isMoxxyError(err)).toBe(true);
    expect((err as MoxxyError).code).toBe('CONFIG_INVALID');
    expect((err as MoxxyError).message).toMatch(/not in the models list/);
  });

  it('lets defaultModel point at a model introduced by the same patch', async () => {
    await seedZai();
    const { api } = build();
    await api.configure('zai', {
      defaultModel: 'glm-4.7',
      models: [{ id: 'glm-4.7', contextWindow: 256_000, supportsTools: true, supportsStreaming: true }],
    });
    const stored = (await readProvidersConfig(cfgPath)).providers.find((p) => p.name === 'zai')!;
    expect(stored.defaultModel).toBe('glm-4.7');
    expect(stored.models.map((m) => m.id)).toEqual(['glm-4.7']);
  });

  it('updates both the live registry def and the on-disk store on success', async () => {
    await seedZai();
    // Mirror the runtime: the entry is also live in the registry (onInit would
    // have registered it). configure() must replace() it, not register().
    const { plugin, api } = build();
    await plugin.hooks!.onInit!({} as never);
    expect(registry.defs.has('zai')).toBe(true);

    await api.configure('zai', { defaultModel: 'glm-4.5-air' });
    const def = registry.defs.get('zai')!;
    expect(def.models.find((m) => m.id === 'glm-4.5-air')).toBeTruthy();
    const stored = (await readProvidersConfig(cfgPath)).providers.find((p) => p.name === 'zai')!;
    expect(stored.defaultModel).toBe('glm-4.5-air');
  });

  it('rolls back the live def to the prior registration when the disk write fails', async () => {
    // The entry is readable on disk AND already live in the registry, but the
    // write target is made unwritable so upsertStoredProvider rejects after the
    // live replace() — driving the rollback branch (restore the prior def).
    await seedZai();
    const reg = new FakeRegistry();
    const priorDef = {
      name: 'zai',
      models: [{ id: 'glm-4.6', contextWindow: 1 }],
    } as unknown as ProviderDef;
    reg.register(priorDef);
    const { api } = build(reg);

    // Read still works (file present), but the dir is read-only so the atomic
    // write's temp-file create / rename fails.
    await fs.chmod(tmpDir, 0o500);
    try {
      const err = await api.configure('zai', { defaultModel: 'glm-4.5-air' }).catch((e) => e);
      expect(err).toBeTruthy();
      // The prior def must be restored EXACTLY (not the patched one, not deleted).
      expect(reg.defs.get('zai')).toBe(priorDef);
    } finally {
      await fs.chmod(tmpDir, 0o700);
    }
    // Disk is unchanged: still the seeded defaultModel.
    const stored = (await readProvidersConfig(cfgPath)).providers.find((p) => p.name === 'zai')!;
    expect(stored.defaultModel).toBe('glm-4.6');
  });
});
