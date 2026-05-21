import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ProviderDef, ToolDef } from '@moxxy/sdk';
import { buildProviderAdminPlugin, type ProviderRegistryLike } from './index.js';
import { readProvidersConfig } from './store.js';

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
let tools: Map<string, ToolDef>;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-provider-admin-tools-'));
  cfgPath = path.join(tmpDir, 'providers.json');
  registry = new FakeRegistry();
  const plugin = buildProviderAdminPlugin({ providerRegistry: registry, configPath: cfgPath });
  tools = new Map((plugin.tools ?? []).map((t) => [t.name, t]));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function call(name: string, input: Record<string, unknown>): Promise<unknown> {
  const tool = tools.get(name);
  if (!tool) throw new Error(`no tool: ${name}`);
  const parsed = tool.inputSchema.parse(input);
  return Promise.resolve(tool.handler(parsed, {} as never));
}

const zaiInput = {
  kind: 'openai-compat' as const,
  name: 'zai',
  baseURL: 'https://api.z.ai/api/coding/paas/v4',
  defaultModel: 'glm-4.6',
  models: [
    { id: 'glm-4.6', contextWindow: 200_000, supportsTools: true, supportsStreaming: true },
  ],
};

describe('provider_add', () => {
  it('registers in the live registry AND persists to providers.json', async () => {
    const result = (await call('provider_add', zaiInput)) as { ok: boolean; replaced: boolean };
    expect(result.ok).toBe(true);
    expect(result.replaced).toBe(false);
    expect(registry.defs.has('zai')).toBe(true);
    const cfg = await readProvidersConfig(cfgPath);
    expect(cfg.providers.map((p) => p.name)).toEqual(['zai']);
  });

  it('replaces an existing provider with the same slug', async () => {
    await call('provider_add', zaiInput);
    const second = (await call('provider_add', {
      ...zaiInput,
      defaultModel: 'glm-4.5-air',
      models: [
        { id: 'glm-4.5-air', contextWindow: 128_000, supportsTools: true, supportsStreaming: true },
      ],
    })) as { ok: boolean; replaced: boolean };
    expect(second.replaced).toBe(true);
    const cfg = await readProvidersConfig(cfgPath);
    expect(cfg.providers).toHaveLength(1);
    expect(cfg.providers[0]!.defaultModel).toBe('glm-4.5-air');
  });

  it('rejects when defaultModel is not in the models list', async () => {
    await expect(
      call('provider_add', { ...zaiInput, defaultModel: 'not-in-list' }),
    ).rejects.toThrow(/not in the models list/);
    expect(registry.defs.size).toBe(0);
    const cfg = await readProvidersConfig(cfgPath);
    expect(cfg.providers).toEqual([]);
  });

  it('rejects invalid slug shapes via inputSchema', () => {
    const tool = tools.get('provider_add')!;
    const bad = tool.inputSchema.safeParse({ ...zaiInput, name: 'NotASlug' });
    expect(bad.success).toBe(false);
  });
});

describe('provider_list', () => {
  it('reflects the persisted config', async () => {
    await call('provider_add', zaiInput);
    const list = (await call('provider_list', {})) as {
      providers: Array<{ name: string; envVar: string }>;
    };
    expect(list.providers).toHaveLength(1);
    expect(list.providers[0]).toMatchObject({ name: 'zai', envVar: 'ZAI_API_KEY' });
  });
});

describe('provider_remove', () => {
  it('drops the entry from disk AND the live registry', async () => {
    await call('provider_add', zaiInput);
    const removed = (await call('provider_remove', { name: 'zai' })) as { ok: boolean };
    expect(removed.ok).toBe(true);
    expect(registry.defs.has('zai')).toBe(false);
    const cfg = await readProvidersConfig(cfgPath);
    expect(cfg.providers).toEqual([]);
  });

  it('is a no-op when the slug is unknown', async () => {
    const removed = (await call('provider_remove', { name: 'never-existed' })) as { ok: boolean };
    expect(removed.ok).toBe(false);
  });
});

describe('onInit', () => {
  it('re-registers everything stored on disk', async () => {
    // Pre-seed providers.json the way it would look after a previous session.
    await fs.writeFile(
      cfgPath,
      JSON.stringify({ providers: [{ ...zaiInput, kind: 'openai-compat' }] }),
      'utf8',
    );
    // Fresh registry — simulate a brand-new session pointing at the same store.
    const fresh = new FakeRegistry();
    const plugin = buildProviderAdminPlugin({ providerRegistry: fresh, configPath: cfgPath });
    await plugin.hooks!.onInit!({} as never);
    expect(fresh.defs.has('zai')).toBe(true);
    const def = fresh.defs.get('zai')!;
    expect(def.models[0]!.id).toBe('glm-4.6');
  });
});
